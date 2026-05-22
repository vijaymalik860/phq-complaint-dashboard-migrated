import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { sendSuccess, sendNotFound, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { getCctnsToken, fetchCctnsComplaints, clearCctnsToken } from '../services/cctns.js';
import {
  CctnsComplaintRow,
  NormalizedCctnsComplaint,
  normalizeComplaintRow,
} from '../services/cctns-normalize.js';
import {
  enrichWithMasterIds,
  loadAllLookups,
  resolveMasterIds,
  MasterLookups,
  remapComplaintMasterIds,
  getDistrictNameByIdMap,
} from '../services/master-mapping.js';
import { syncDistricts, syncOffices, syncPoliceStationsByDistrict } from './government.js';
import { buildPrismaWhereClause } from '../utils/filters.js';

const parseBigIntCsv = (value: string): bigint[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/^-?\d+$/.test(item) ? BigInt(item) : null))
    .filter((item): item is bigint => item !== null);
import { runCctnsSync, runCctnsFullRollingSync } from '../jobs/cctns-sync-job.js';

const processInBatches = async <T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<void>
) => {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => processor(item)));
  }
};

const toNormalizedUnique = (rows: CctnsComplaintRow[]): NormalizedCctnsComplaint[] => {
  const byRegNum = new Map<string, NormalizedCctnsComplaint>();
  for (const row of rows) {
    const normalized = normalizeComplaintRow(row);
    if (!normalized) continue;
    byRegNum.set(normalized.complRegNum, normalized);
  }
  return Array.from(byRegNum.values());
};

const parseDdMmYyyy = (value: string): Date => {
  const [dd, mm, yyyy] = value.split('/').map((part) => Number(part));
  return new Date(yyyy, mm - 1, dd);
};

const formatDdMmYyyy = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const collectComplaintsByRange = async (timeFrom: string, timeTo: string, dType: 'P' | 'F' = 'P', onProgress?: (pct: number) => void) => {
  const start = parseDdMmYyyy(timeFrom);
  const end = parseDdMmYyyy(timeTo);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('Invalid date range. Expected DD/MM/YYYY with timeFrom <= timeTo');
  }

  const rows: CctnsComplaintRow[] = [];
  const WINDOW_DAYS = 3;
  let cursor = new Date(start);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 3600 * 24) + 1);
  let daysProcessed = 0;

  while (cursor <= end) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + WINDOW_DAYS - 1);
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime());
    }

    const chunkRows = await fetchCctnsComplaints(
      formatDdMmYyyy(chunkStart),
      formatDdMmYyyy(chunkEnd),
      dType
    );
    rows.push(...(chunkRows as CctnsComplaintRow[]));

    const currentChunkDays = (chunkEnd.getTime() - chunkStart.getTime()) / (1000 * 3600 * 24) + 1;
    daysProcessed += currentChunkDays;
    if (onProgress) {
      onProgress(Math.min(80, Math.round((daysProcessed / totalDays) * 80)));
    }

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return rows;
};

const saveNormalizedComplaints = async (
  rows: NormalizedCctnsComplaint[],
  lookups: MasterLookups,
  batchSize: number = 15,
  onProgress?: (pct: number) => void
) => {
  let created = 0;
  let updated = 0;
  let errors = 0;

  // Pre-filter invalid records
  const validRows = rows.filter((row, index) => {
    if (!row.complRegNum) {
      console.warn(`⚠️ Skipping record ${index}: missing complRegNum`);
      return false;
    }
    return true;
  });

  if (validRows.length < rows.length) {
    console.log(`ℹ️ Filtered out ${rows.length - validRows.length} invalid records`);
  }

  const totalRows = validRows.length;
  let processedRows = 0;

  // Use the pre-loaded lookups for every record — avoids N×3 DB queries
  await processInBatches(validRows, batchSize, async (data) => {
    try {
      const resolved = await resolveMasterIds(data, lookups);
      const mapped = { ...data, ...resolved };
      
      // Validate required fields before DB operation
      if (!mapped.complRegNum) {
        throw new Error('Missing complRegNum after enrichment');
      }

      await prisma.complaint.upsert({
        where: { complRegNum: data.complRegNum },
        update: mapped,
        create: mapped,
      });
      updated++;
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      // Distinguish between different error types
      if (error?.code === 'P2002') { // Unique constraint violation
        console.warn(`⚠️ Duplicate complaint: ${data.complRegNum}`);
        updated++; // Treat as update
      } else if (error?.code === 'P2010') { // Invalid value
        console.error(`❌ Invalid data for ${data.complRegNum}:`, errMsg);
        errors++;
      } else {
        console.error(`❌ Database error for ${data.complRegNum}:`, errMsg);
        errors++;
      }
    }
    processedRows++;
    if (onProgress && totalRows > 0) {
      onProgress(80 + Math.min(20, Math.round((processedRows / totalRows) * 20)));
    }
  });

  created = Math.max(validRows.length - updated - errors, 0);
  return { created, updated, errors };
};

// In-memory job tracking for async fetch operations
interface FetchJob {
  id: string;
  status: 'pending' | 'running' | 'success' | 'error';
  timeFrom: string;
  timeTo: string;
  progress?: string;
  progressPercentage?: number;
  result?: {
    fetched: number;
    uniqueComplaints: number;
    created: number;
    updated: number;
    errors: number;
  };
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  syncRunId?: number;
}

const fetchJobs = new Map<string, FetchJob>();

const runFetchJob = async (jobId: string, timeFrom: string, timeTo: string, dType: 'P' | 'F' = 'P') => {
  const job = fetchJobs.get(jobId);
  if (!job) return;

  job.status = 'running';
  console.log(`[FETCH-JOB ${jobId}] Starting fetch job: ${timeFrom} to ${timeTo}`);

  // Create initial SyncRun record so we have a log even if the server restarts
  try {
    const run = await prisma.syncRun.create({
      data: {
        kind: 'cctns-manual',
        status: 'running',
        startedAt: job.startedAt,
        timeFrom: timeFrom,
        timeTo: timeTo,
        syncType: dType,
        message: `Manual fetch started: ${timeFrom} to ${timeTo}`,
      },
    });
    job.syncRunId = run.id;
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    console.error(`[FETCH-JOB ${jobId}] Failed to create initial sync run record:`, errMsg);
  }

  try {
    // Validate date range early
    const startDate = parseDdMmYyyy(timeFrom);
    const endDate = parseDdMmYyyy(timeTo);
    
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
      throw new Error(`Invalid date range: ${timeFrom} to ${timeTo}`);
    }

    // Load master lookups ONCE at the start of the job to maintain efficiency and constant-space usage
    job.progress = 'Loading master lookups...';
    job.progressPercentage = 1;
    console.log(`[FETCH-JOB ${jobId}] Loading master lookups once...`);
    const lookups = await loadAllLookups();

    const WINDOW_DAYS = 3;
    let cursor = new Date(startDate);
    const totalDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24) + 1);
    let daysProcessed = 0;

    let totalFetched = 0;
    let totalUnique = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    while (cursor <= endDate) {
      const chunkStart = new Date(cursor);
      const chunkEnd = new Date(cursor);
      chunkEnd.setDate(chunkEnd.getDate() + WINDOW_DAYS - 1);
      if (chunkEnd > endDate) {
        chunkEnd.setTime(endDate.getTime());
      }

      const chunkStartStr = formatDdMmYyyy(chunkStart);
      const chunkEndStr = formatDdMmYyyy(chunkEnd);

      // Calculate start percentage of this chunk
      const startPct = Math.round((daysProcessed / totalDays) * 100);
      job.progress = `Fetching records for ${chunkStartStr} - ${chunkEndStr}...`;
      job.progressPercentage = Math.max(1, startPct);
      console.log(`[FETCH-JOB ${jobId}] Fetching records for ${chunkStartStr} - ${chunkEndStr}...`);

      // Fetch complaints from CCTNS API
      let chunkRows: CctnsComplaintRow[] = [];
      try {
        const result = await fetchCctnsComplaints(chunkStartStr, chunkEndStr, dType);
        chunkRows = (result as CctnsComplaintRow[]) || [];
      } catch (fetchError: any) {
        const errMsg = fetchError?.message || String(fetchError);
        console.error(`[FETCH-JOB ${jobId}] CCTNS API fetch failed for chunk ${chunkStartStr} - ${chunkEndStr}:`, errMsg);
        throw new Error(`CCTNS API failed for chunk ${chunkStartStr} - ${chunkEndStr}: ${errMsg}`);
      }

      totalFetched += chunkRows.length;

      if (chunkRows.length > 0) {
        // Normalize the rows into unique complaints
        const chunkNormalized = toNormalizedUnique(chunkRows);
        totalUnique += chunkNormalized.length;

        // Save normalized rows in small, memory-efficient batches
        job.progress = `Saving ${chunkNormalized.length} records for ${chunkStartStr} - ${chunkEndStr}...`;
        console.log(`[FETCH-JOB ${jobId}] Saving ${chunkNormalized.length} records...`);

        const currentChunkDays = (chunkEnd.getTime() - chunkStart.getTime()) / (1000 * 3600 * 24) + 1;

        const { created, updated, errors } = await saveNormalizedComplaints(
          chunkNormalized,
          lookups,
          15, // Reduced batch size (15 instead of 50) for database connection pool safety
          (pct) => {
            // Mapping progress linearly between daysProcessed and nextDaysProcessed
            const savePct = (pct - 80) / 20; // 0 to 1
            const linearPct = Math.round(((daysProcessed + savePct * currentChunkDays) / totalDays) * 100);
            job.progressPercentage = Math.min(99, Math.max(1, linearPct));
          }
        );

        totalCreated += created;
        totalUpdated += updated;
        totalErrors += errors;
      }

      const currentChunkDays = (chunkEnd.getTime() - chunkStart.getTime()) / (1000 * 3600 * 24) + 1;
      daysProcessed += currentChunkDays;

      // Update linear progress percentage at the end of the chunk
      const endPct = Math.round((daysProcessed / totalDays) * 100);
      job.progressPercentage = Math.min(99, Math.max(1, endPct));

      cursor = new Date(chunkEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    job.status = 'success';
    job.progressPercentage = 100;
    job.progress = `Sync completed! Fetched ${totalFetched} records, created ${totalCreated}, updated ${totalUpdated}, errors: ${totalErrors}.`;
    job.result = {
      fetched: totalFetched,
      uniqueComplaints: totalUnique,
      created: totalCreated,
      updated: totalUpdated,
      errors: totalErrors,
    };
    job.completedAt = new Date();
    
    console.log(`[FETCH-JOB ${jobId}] Completed successfully:`, job.result);

    // Also update/create a SyncRun record for audit trail
    try {
      const data = {
        kind: 'cctns-manual',
        status: totalErrors > 0 ? 'partial' : 'success',
        startedAt: job.startedAt,
        endedAt: job.completedAt,
        fetchedCount: totalFetched,
        upsertedCount: totalCreated + totalUpdated,
        errorCount: totalErrors,
        timeFrom: timeFrom,
        timeTo: timeTo,
        syncType: dType,
        message: `Manual fetch: ${timeFrom} to ${timeTo}`,
      };
      
      if (job.syncRunId) {
        await prisma.syncRun.update({ where: { id: job.syncRunId }, data });
      } else {
        await prisma.syncRun.create({ data });
      }
    } catch (syncRunError: any) {
      const errMsg = syncRunError?.message || String(syncRunError);
      console.error(`[FETCH-JOB ${jobId}] Failed to create sync run record:`, errMsg);
    }
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    job.status = 'error';
    job.error = errorMsg;
    job.completedAt = new Date();
    
    console.error(`[FETCH-JOB ${jobId}] Job failed:`, errorMsg);

    // Always try to update/create error sync run for audit
    try {
      const data = {
        kind: 'cctns-manual',
        status: 'error',
        startedAt: job.startedAt,
        endedAt: job.completedAt,
        errorCount: 1,
        timeFrom: timeFrom,
        timeTo: timeTo,
        syncType: dType,
        message: `Manual fetch failed: ${timeFrom} to ${timeTo} — ${errorMsg}`,
      };
      
      if (job.syncRunId) {
        await prisma.syncRun.update({ where: { id: job.syncRunId }, data });
      } else {
        await prisma.syncRun.create({ data });
      }
    } catch (syncRunError: any) {
      const errMsg = syncRunError?.message || String(syncRunError);
      console.error(`[FETCH-JOB ${jobId}] Failed to create error sync run record:`, errMsg);
    }
  }
};

export const cctnsRoutes = async (fastify: FastifyInstance) => {
  // —— List complaints with pagination, search, filter ——
  fastify.get('/cctns', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const {
      page = '1',
      limit = '50',
      search = '',
      district = '',
      statusGroup = '',
      dateFrom = '',
      dateTo = '',
      sortBy = 'id',
      sortOrder = 'desc',
      isDisposedMissingDate = '',
      // Global dashboard filters forwarded from card navigation
      districtIds = '',
      policeStationIds = '',
      officeIds = '',
      classOfIncident = '',
      fromDate = '',
      toDate = '',
      pendencyAge = '',
      disposalAge = '',
      unmappedPs = '',
      // PS name fallback when policeStationMasterId not available
      psName = '',
    } = request.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    // Allow up to 50,000 records for export requests; normal UI requests stay at ≤500
    const limitNum = Math.min(50000, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build where clause using AND so multiple filters never overwrite each other
    const andConditions: any[] = [];

// ── District filter from drill-down navigation ───────────────────────────
    // When district is passed from DistrictDetail page drill-down (and no global districtIds), 
    // apply the district filter to maintain consistent counts. 
    // We MUST apply the district filter even if policeStationIds is passed because 
    // DistrictDetail counts records for a specific PS by querying with the district filter FIRST, 
    // then grouping by PS. To match those exact counts in the drawer, we must filter by BOTH district and PS.
    if (district && !districtIds) {
      const districtRecord = await prisma.district.findFirst({
        where: { name: { equals: district, mode: 'insensitive' } },
        select: { id: true },
      });
      if (districtRecord) {
        andConditions.push({ districtMasterId: districtRecord.id });
      } else {
        // Fallback: text search on districtName field
        andConditions.push({
          OR: [
            { districtName:    { contains: district, mode: 'insensitive' } },
            { addressDistrict: { contains: district, mode: 'insensitive' } },
          ],
        });
      }
    }

    // ── PS name filter fallback (when policeStationMasterId is not available) ─
    // This handles cases where PS data doesn't have master IDs mapped.
    // IMPORTANT: We need to look up the PS by name to get its master ID, then filter by that ID
    // (matching exactly how DistrictDetail calculates the count - by PS master ID, not by text search)
    if (psName && !policeStationIds) {
      // First, try to find the PS by name to get its master ID
      const psRecord = await prisma.policeStation.findFirst({
        where: { name: { equals: psName, mode: 'insensitive' } },
        select: { id: true },
      });
      
      if (psRecord) {
        // Found the PS by name - filter by master ID (exactly matching DistrictDetail's approach)
        andConditions.push({ policeStationMasterId: psRecord.id });
      } else {
        // Fallback: if PS name not found in master table, try text search on address fields
        andConditions.push({
          OR: [
            { addressPs: { contains: psName, mode: 'insensitive' } },
            { submitPsCd: { contains: psName, mode: 'insensitive' } },
          ],
        });
      }
    }

    // ── Global dashboard filters (district IDs, PS IDs, office IDs, class, date range)
    // These mirror what buildPrismaWhereClause does in the dashboard summary route,
    // ensuring the gateway shows exactly the same records the card counted.
    // IMPORTANT: When navigating from DistrictDetail with a specific PS, we want to filter
    // ONLY by that PS (matching how DistrictDetail counts records for that PS).
    // So we pass PS filter separately and exclude it from globalWhere to avoid any conflicts.
    const globalWhere = buildPrismaWhereClause({
      districtIds,
      officeIds,
      classOfIncident,
      fromDate,
      toDate,
    });
    // Spread each top-level key of globalWhere as separate AND conditions
    for (const [key, val] of Object.entries(globalWhere)) {
      andConditions.push({ [key]: val });
    }

    // ── Explicit PS filter (from DistrictDetail navigation) ─────────────────────
    // Apply PS filter explicitly to match exactly what DistrictDetail counts for this PS.
    // This ensures we don't have any conflicts or duplicate filtering.
    if (policeStationIds) {
      const psIds = parseBigIntCsv(policeStationIds);
      if (psIds.length > 0) {
        andConditions.push({ policeStationMasterId: { in: psIds } });
      }
    }

    if (search) {
      andConditions.push({
        OR: [
          { complRegNum:   { contains: search, mode: 'insensitive' } },
          { firstName:     { contains: search, mode: 'insensitive' } },
          { lastName:      { contains: search, mode: 'insensitive' } },
          { mobile:        { contains: search, mode: 'insensitive' } },
          { complDesc:     { contains: search, mode: 'insensitive' } },
          { districtName:  { contains: search, mode: 'insensitive' } },
          { addressPs:     { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (statusGroup) {
      andConditions.push({ statusGroup: statusGroup.toLowerCase() });
    }

    if (isDisposedMissingDate === 'true') {
      andConditions.push({ isDisposedMissingDate: true });
    }

    if (dateFrom || dateTo) {
      const dateFilter: any = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo)   dateFilter.lte = new Date(dateTo);
      andConditions.push({ complRegDt: dateFilter });
    }

    if (unmappedPs === 'true') {
      andConditions.push({ policeStationMasterId: null });
    }

    if (pendencyAge) {
      const now = new Date();
      if (pendencyAge === 'u7') {
        const d = new Date(now); d.setDate(d.getDate() - 7);
        andConditions.push({ complRegDt: { gt: d } });
      } else if (pendencyAge === 'u15') {
        const d15 = new Date(now); d15.setDate(d15.getDate() - 15);
        const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
        andConditions.push({ complRegDt: { gt: d15, lte: d7 } });
      } else if (pendencyAge === 'u30') {
        const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
        const d15 = new Date(now); d15.setDate(d15.getDate() - 15);
        andConditions.push({ complRegDt: { gt: d30, lte: d15 } });
      } else if (pendencyAge === 'o30') {
        const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
        const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
        andConditions.push({ complRegDt: { gt: d60, lte: d30 } });
      } else if (pendencyAge === 'o60') {
        const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
        andConditions.push({ complRegDt: { lte: d60 } });
      }
    }

if (disposalAge) {
      if (disposalAge === 'u7') {
        andConditions.push({
          disposalDate: { gte: new Date(Date.now() - 7 * 86400000), not: null },
          statusGroup: 'disposed', isDisposedMissingDate: false,
        });
      } else if (disposalAge === 'u15') {
        andConditions.push({
          disposalDate: { lte: new Date(Date.now() - 7 * 86400000), gte: new Date(Date.now() - 15 * 86400000), not: null },
          statusGroup: 'disposed', isDisposedMissingDate: false,
        });
      } else if (disposalAge === 'u30') {
        andConditions.push({
          disposalDate: { lte: new Date(Date.now() - 15 * 86400000), gte: new Date(Date.now() - 30 * 86400000), not: null },
          statusGroup: 'disposed', isDisposedMissingDate: false,
        });
      } else if (disposalAge === 'o30') {
        andConditions.push({
          disposalDate: { lte: new Date(Date.now() - 30 * 86400000), gte: new Date(Date.now() - 60 * 86400000), not: null },
          statusGroup: 'disposed', isDisposedMissingDate: false,
        });
      } else if (disposalAge === 'o60') {
        andConditions.push({
          disposalDate: { lte: new Date(Date.now() - 60 * 86400000), not: null },
          statusGroup: 'disposed', isDisposedMissingDate: false,
        });
      }
    }

    const where: any = andConditions.length > 0 ? { AND: andConditions } : {};

    // Validate sortBy to prevent injection
    const allowedSortFields = [
      'id', 'complRegNum', 'complRegDt', 'districtName', 'addressPs',
      'statusOfComplaint', 'disposalDate', 'createdAt', 'updatedAt',
    ];
    const orderByField = allowedSortFields.includes(sortBy) ? sortBy : 'id';
    const orderByDirection = sortOrder === 'asc' ? 'asc' : 'desc';

    const [records, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [orderByField]: orderByDirection },
      }),
      prisma.complaint.count({ where }),
    ]);

    const districtMap = await getDistrictNameByIdMap();
    const enrichedRecords = records.map(c => {
      let resolvedDistrictName = c.districtName;
      if (c.districtMasterId) {
        resolvedDistrictName = districtMap.get(c.districtMasterId.toString()) || resolvedDistrictName;
      }
      return {
        ...c,
        districtMasterId: c.districtMasterId?.toString(),
        districtName: resolvedDistrictName || c.addressDistrict || '-',
      };
    });

    return sendSuccess(reply, {
      data: enrichedRecords,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  fastify.get('/cctns/district', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    const counts = await prisma.complaint.groupBy({
      by: ['districtName', 'addressDistrict'],
      _count: { _all: true },
    });

    const districtMap = new Map<string, number>();
    for (const row of counts) {
      const district = row.addressDistrict || row.districtName || 'Unknown';
      districtMap.set(district, (districtMap.get(district) || 0) + row._count._all);
    }

    const data = Array.from(districtMap.entries()).map(([district, count]) => ({
      district,
      count,
    }));

    return sendSuccess(reply, data);
  });

  fastify.get('/cctns/status', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    try {
      const secretKey = process.env.CCTNS_SECRET_KEY;
      const decryptKey = process.env.CCTNS_DECRYPT_KEY;
      const complaintApi = process.env.CCTNS_COMPLAINT_API;

      const configured = !!(
        secretKey &&
        secretKey !== 'your_secret_key_here' &&
        decryptKey &&
        decryptKey !== 'your_decrypt_key_here' &&
        complaintApi
      );

      return sendSuccess(reply, {
        configured,
        hasSecretKey: !!secretKey && secretKey !== 'your_secret_key_here',
        hasDecryptKey: !!decryptKey && decryptKey !== 'your_decrypt_key_here',
        hasApis: !!complaintApi,
      });
    } catch {
      return sendError(reply, 'Failed to get CCTNS status');
    }
  });

  fastify.post('/cctns/token', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    try {
      clearCctnsToken();
      const token = await getCctnsToken();
      return sendSuccess(reply, { token: `${token.substring(0, 20)}...` }, 'Token obtained');
    } catch (error) {
      return sendError(
        reply,
        `Failed to get token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // —— Deprecated: direct live fetch without persistence ——
  // Kept for backward compatibility but marked as deprecated
  fastify.get('/cctns/complaints-live', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { timeFrom, timeTo, dType } = request.query as Record<string, string>;
      if (!timeFrom || !timeTo) {
        return sendError(reply, 'timeFrom and timeTo query params are required (format: DD/MM/YYYY)');
      }

      const complaints = await fetchCctnsComplaints(timeFrom, timeTo, (dType as 'P'|'F') || 'P');
      return sendSuccess(reply, {
        total: complaints.length,
        timeFrom,
        timeTo,
        records: complaints,
        deprecated: true,
        note: 'This endpoint does not persist data. Use POST /cctns/fetch-and-sync instead.',
      });
    } catch (error) {
      return sendError(
        reply,
        `Failed to fetch data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // —— Unified: Fetch from CCTNS API and persist directly to DB ——
  fastify.post('/cctns/fetch-and-sync', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { timeFrom, timeTo, dType } = request.body as Record<string, string>;
      if (!timeFrom || !timeTo) {
        return sendError(reply, 'timeFrom and timeTo are required');
      }

      // Validate date format
      const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
      if (!dateRegex.test(timeFrom) || !dateRegex.test(timeTo)) {
        return sendError(reply, 'Invalid date format. Expected DD/MM/YYYY');
      }

      const jobId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const job: FetchJob = {
        id: jobId,
        status: 'pending',
        timeFrom,
        timeTo,
        startedAt: new Date(),
      };
      fetchJobs.set(jobId, job);

      // Start the job asynchronously — do not await
      runFetchJob(jobId, timeFrom, timeTo, (dType as 'P'|'F') || 'P').catch((error) => {
        console.error(`[FETCH-JOB ${jobId}] Unhandled error:`, error);
        const j = fetchJobs.get(jobId);
        if (j) {
          j.status = 'error';
          j.error = error instanceof Error ? error.message : 'Unknown error';
          j.completedAt = new Date();
        }
      });

      // Return immediately with job ID for polling
      return sendSuccess(reply, {
        jobId,
        status: 'pending',
        message: 'Fetch and sync job started. Poll GET /cctns/fetch-status/:jobId for progress.',
      }, 'Fetch job started', 202);
    } catch (error) {
      console.error('[FETCH-AND-SYNC] Failed to start job:', error);
      return sendError(reply, `Failed to start fetch job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // —— Poll fetch job status ——
  fastify.get('/cctns/fetch-status/:jobId', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { jobId } = request.params as Record<string, string>;
    const job = fetchJobs.get(jobId);

    if (!job) {
      return sendNotFound(reply, 'Fetch job not found');
    }

    return sendSuccess(reply, {
      id: job.id,
      status: job.status,
      progress: job.progress,
      progressPercentage: job.progressPercentage,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  });

  // —— Deprecated: manual sync endpoint (redundant after fetch-and-sync) ——
  fastify.post('/cctns/sync-complaints', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { timeFrom, timeTo, dType } = request.body as Record<string, string>;
      if (!timeFrom || !timeTo) {
        return sendError(reply, 'timeFrom and timeTo are required');
      }

      const complaints = await collectComplaintsByRange(timeFrom, timeTo, (dType as 'P'|'F') || 'P');
      const normalized = toNormalizedUnique(complaints);
      const lookups = await loadAllLookups();
      const { created, updated, errors } = await saveNormalizedComplaints(normalized, lookups);

      return sendSuccess(reply, {
        message: 'Sync completed (deprecated: use POST /cctns/fetch-and-sync)',
        fetched: complaints.length,
        uniqueComplaints: normalized.length,
        created,
        updated,
        errors,
        deprecated: true,
      });
    } catch (error) {
      return sendError(reply, `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // —— Sync run history ——
  fastify.get('/cctns/sync-runs', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { page = '1', limit = '20' } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Clean up stale 'running' jobs (older than 1 hour) killed by Vercel timeouts
    const staleTime = new Date(Date.now() - 60 * 60 * 1000);
    try {
      await prisma.syncRun.updateMany({
        where: {
          status: 'running',
          startedAt: { lt: staleTime },
        },
        data: {
          status: 'error',
          message: 'Job timed out or was killed by serverless environment',
          endedAt: new Date(),
        },
      });
    } catch (e) {
      console.error('[SYNC] Failed to clean up stale jobs:', e);
    }

    const [runs, total] = await Promise.all([
      prisma.syncRun.findMany({
        orderBy: { startedAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.syncRun.count(),
    ]);

    return sendSuccess(reply, {
      data: runs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  fastify.post('/cctns/remap-masters', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    try {
      // Step 1: ensure master tables are populated from govt API
      await syncDistricts();

      const allDistricts = await prisma.district.findMany({ select: { id: true, name: true } });
      const districtIdsWithPS = (
        await prisma.policeStation.findMany({ select: { districtId: true }, distinct: ['districtId'] })
      ).map((r) => r.districtId?.toString()).filter(Boolean);

      const missingPS = allDistricts.filter((d) => !districtIdsWithPS.includes(d.id.toString()));
      if (missingPS.length > 0) {
        console.log(`[remap-masters] Syncing PS for ${missingPS.length} district(s) missing PS...`);
        for (let i = 0; i < missingPS.length; i += 5) {
          await Promise.all(
            missingPS.slice(i, i + 5).map((d) =>
              syncPoliceStationsByDistrict(d.id).catch((e) =>
                console.error(`[remap-masters] PS sync failed for ${d.name}:`, e.message)
              )
            )
          );
        }
      }

      await syncOffices();

      // Step 2: remap complaint master IDs with freshest lookups
      const stats = await remapComplaintMasterIds();
      return sendSuccess(reply, {
        ...stats,
        message: `Synced ${missingPS.length} missing district(s) PS before remap`,
      }, 'Master mapping recomputed');
    } catch (error) {
      return sendError(reply, `Remap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });


  // ── Return the date of the most recent successful sync run ──
  // Used by the frontend "Quick Sync" button label AND as the from-date for the next sync.
  // We use the last SyncRun startedAt (when we last pulled data) rather than MAX(complRegDt)
  // so the label matches the "Last updated" footer and feels intuitive to the user.
  fastify.get('/cctns/last-sync-date', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    try {
      // 1. Find the most recent successful (or partial) sync run
      const lastRun = await prisma.syncRun.findFirst({
        where: { status: { in: ['success', 'partial'] } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });

      // 2. Also get MAX(complRegDt) as the fallback if no SyncRun exists
      const result = await prisma.$queryRaw<{ last_date: Date | null }[]>`
        SELECT MAX("complRegDt") AS last_date FROM "Complaint"
      `;
      const maxRegDt = result[0]?.last_date || null;

      // Use the last sync run date if available, otherwise fall back to max complRegDt
      const lastDate: Date | null = lastRun?.startedAt ?? maxRegDt;

      let apiDate: string | null = null;
      let isoDate: string | null = null;
      if (lastDate) {
        const d = new Date(lastDate);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        apiDate = `${dd}/${mm}/${yyyy}`;
        isoDate = `${yyyy}-${mm}-${dd}`;
      }
      return sendSuccess(reply, {
        lastDate: lastDate ? lastDate.toISOString() : null,
        apiDate,
        isoDate,
        // Also expose the raw max complRegDt for debugging
        maxComplRegDt: maxRegDt ? maxRegDt.toISOString() : null,
      });
    } catch (error: any) {
      return sendError(reply, `Failed to get last sync date: ${error.message}`);
    }
  });

  // ── Quick Sync — fetch from last successful sync date → today ──
  fastify.post('/cctns/quick-sync', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    try {
      // 1. Try to use last successful SyncRun date as the from-date.
      //    This matches what the Quick Sync button label shows the user.
      const lastRun = await prisma.syncRun.findFirst({
        where: { status: { in: ['success', 'partial'] } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });

      // 2. Fallback: use MAX(complRegDt) if no sync history exists
      const result = await prisma.$queryRaw<{ last_date: Date | null }[]>`
        SELECT MAX("complRegDt") AS last_date FROM "Complaint"
      `;
      const maxRegDt = result[0]?.last_date;

      let fromDate: Date;
      if (lastRun?.startedAt) {
        // Start from the beginning of the day of the last sync run.
        // This ensures we catch any complaints registered that day after the sync ran.
        fromDate = new Date(lastRun.startedAt);
        fromDate.setHours(0, 0, 0, 0);
      } else if (maxRegDt) {
        // No sync history — start from the max complRegDt day (truncated to midnight)
        fromDate = new Date(maxRegDt);
        fromDate.setHours(0, 0, 0, 0);
      } else {
        // Completely empty DB — default to 30 days ago
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
      }

      const today = new Date();
      if (fromDate > today) {
        return sendSuccess(reply, {
          skipped: true,
          message: 'Database already up to date. No new dates to fetch.',
        });
      }

      const formatDDMMYYYY = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${d.getFullYear()}`;
      };

      const timeFrom = formatDDMMYYYY(fromDate);
      const timeTo   = formatDDMMYYYY(today);

      const jobId = `quick-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const job: FetchJob = {
        id: jobId,
        status: 'pending',
        timeFrom,
        timeTo,
        startedAt: new Date(),
      };
      fetchJobs.set(jobId, job);

      runFetchJob(jobId, timeFrom, timeTo).catch((err) => {
        console.error(`[QUICK-SYNC ${jobId}] Unhandled error:`, err);
        const j = fetchJobs.get(jobId);
        if (j) { j.status = 'error'; j.error = String(err); j.completedAt = new Date(); }
      });

      return sendSuccess(reply, {
        jobId,
        status: 'pending',
        timeFrom,
        timeTo,
        message: `Quick sync started from ${timeFrom} to ${timeTo}. Poll /cctns/fetch-status/${jobId} for progress.`,
      }, 'Quick sync started', 202);
    } catch (error: any) {
      return sendError(reply, `Quick sync failed to start: ${error.message}`);
    }
  });

  fastify.get('/cctns/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    const record = await prisma.complaint.findUnique({ where: { id: parseInt(id, 10) } });
    if (!record) return sendNotFound(reply, 'Record not found');
    return sendSuccess(reply, record);
  });

  fastify.post('/cctns', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const data = await enrichWithMasterIds(request.body as Record<string, any>);
    if (!data.complRegNum) {
      return sendError(reply, 'complRegNum is required');
    }
    const record = await prisma.complaint.create({ data: data as any });
    return sendSuccess(reply, record, 'Record created');
  });

  fastify.put('/cctns/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    const data = await enrichWithMasterIds(request.body as Record<string, any>);
    const record = await prisma.complaint.update({
      where: { id: parseInt(id, 10) },
      data: data as any,
    });
    return sendSuccess(reply, record, 'Record updated');
  });

  fastify.delete('/cctns/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    await prisma.complaint.delete({ where: { id: parseInt(id, 10) } });
    return sendSuccess(reply, null, 'Record deleted');
  });

  // ── Vercel Cron endpoint (Issue #1 fix) ──────────────────────────────────
  // vercel.json points "0 0 * * *" to /api/cctns/cron-sync
  // Protected by CRON_SECRET env var to prevent unauthorized triggers.
  fastify.get('/cctns/cron-sync', async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    const authHeader = (request.headers['authorization'] || '') as string;
    if (secret && authHeader !== `Bearer ${secret}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    // Run 1-day recent sync (faster, reduces timeout risk)
    const result = await runCctnsSync({ label: 'vercel-cron-daily', days: 1 });
    return sendSuccess(reply, result ?? { skipped: true }, 'Daily cron sync triggered');
  });

  // ── Manual rolling sync trigger (authenticated admin route) ──────────────
  // Use this to immediately re-sync the last 365 days and fix stale pending records.
  fastify.post('/cctns/trigger-rolling-sync', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    // Fire and forget — rolling sync can take several minutes
    runCctnsFullRollingSync().catch((err) =>
      console.error('[SYNC] Manual rolling sync error:', err)
    );
    return sendSuccess(reply, {
      message: 'Full rolling sync started (last 365 days in 30-day chunks). Check sync history for progress.',
    });
  });
};
