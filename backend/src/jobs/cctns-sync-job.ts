import { prisma } from '../config/database.js';
import { fetchCctnsComplaints } from '../services/cctns.js';
import { clearCache } from '../utils/cache.js';
import {
  CctnsComplaintRow,
  normalizeComplaintRow,
  NormalizedCctnsComplaint,
} from '../services/cctns-normalize.js';
import { enrichWithMasterIds } from '../services/master-mapping.js';

const formatDateStr = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const processInBatches = async <T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<void>,
  onBatchComplete?: () => Promise<void>
) => {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => processor(item)));
    if (onBatchComplete) {
      await onBatchComplete();
    }
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

interface CctnsSyncResult {
  timeFrom: string;
  timeTo: string;
  complaints: {
    fetched: number;
    upserted: number;
    errors: number;
  };
  syncFailed?: boolean;
}

export interface BackgroundSyncProgress {
  status: 'running' | 'idle';
  progress: string;
  progressPercentage: number;
  fetched: number;
  upserted: number;
  errors: number;
  startedAt?: Date;
}

export let activeBackgroundSync: BackgroundSyncProgress = {
  status: 'idle',
  progress: '',
  progressPercentage: 0,
  fetched: 0,
  upserted: 0,
  errors: 0,
};

let isSyncing = false;

// Retry a DB operation up to `attempts` times with `delayMs` gap
const withRetry = async <T>(fn: () => Promise<T>, attempts = 3, delayMs = 5000): Promise<T> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        console.log(`[SYNC] DB not ready, retrying in ${delayMs / 1000}s... (attempt ${i + 1}/${attempts})`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
};

const areComplaintsEqual = (existing: any, mapped: any): boolean => {
  for (const key of Object.keys(mapped)) {
    const val1 = existing[key];
    const val2 = mapped[key];

    if (val1 instanceof Date || val2 instanceof Date || key.toLowerCase().includes('date') || key.toLowerCase().includes('dt')) {
      const d1 = val1 ? new Date(val1).getTime() : 0;
      const d2 = val2 ? new Date(val2).getTime() : 0;
      if (d1 !== d2) return false;
    } else {
      const s1 = val1 === null || val1 === undefined ? '' : String(val1).trim().toLowerCase();
      const s2 = val2 === null || val2 === undefined ? '' : String(val2).trim().toLowerCase();
      if (s1 !== s2) return false;
    }
  }
  return true;
};

export const runCctnsSyncInternal = async (
  options: { fromDate?: string; toDate?: string; label?: string; days?: number; dType?: 'P' | 'F' } = {}
): Promise<CctnsSyncResult | null> => {
  // Use provided days or default to last 1 day (recent registrations) - reduced from 2 to avoid timeout
  const daysToSync = options.days ?? 1;
  const endDate = new Date();
  const defaultStart = new Date();
  defaultStart.setDate(endDate.getDate() - daysToSync);

  const timeFrom = options.fromDate ?? formatDateStr(defaultStart);
  const timeTo   = options.toDate   ?? formatDateStr(endDate);
  const label    = options.label    ?? 'background';
  const dType    = options.dType    ?? 'P';

  console.log(`[SYNC] Starting ${label} CCTNS sync: ${timeFrom} → ${timeTo} (${daysToSync} day${daysToSync > 1 ? 's' : ''}) (DType: ${dType})`);

  const result: CctnsSyncResult = {
    timeFrom,
    timeTo,
    complaints: { fetched: 0, upserted: 0, errors: 0 },
  };

  let syncRun: { id: number };
  try {
    syncRun = await withRetry(() => prisma.syncRun.create({
      data: {
        kind: `cctns-${label}`,
        status: 'running',
        startedAt: new Date(),
        timeFrom,
        timeTo,
        syncType: dType,
        message: `Sync started: ${timeFrom} to ${timeTo} (${dType})`,
      },
    }));
  } catch (err) {
    console.error('[SYNC] Could not connect to database after retries. Skipping sync.', err);
    return null;
  }

  try {
    const complaints = (await fetchCctnsComplaints(timeFrom, timeTo, dType)) as CctnsComplaintRow[];
    result.complaints.fetched = complaints.length;
    const normalized = toNormalizedUnique(complaints);

    if (normalized.length > 0) {
      // Fetch all existing complaints for this batch in one query to optimize performance and prevent redundant DB reads
      const regNums = normalized.map((n) => n.complRegNum);
      const existingComplaints = await prisma.complaint.findMany({
        where: { complRegNum: { in: regNums } },
      });
      const existingMap = new Map(existingComplaints.map((c) => [c.complRegNum, c]));

      await processInBatches(
        normalized,
        50,
        async (data) => {
          try {
            const mapped = await enrichWithMasterIds(data);
            const existing = existingMap.get(data.complRegNum);

            if (!existing) {
              // New complaint, insert it
              await prisma.complaint.create({ data: mapped });
              result.complaints.upserted++;
            } else {
              // Existing complaint, check if fields actually changed
              if (!areComplaintsEqual(existing, mapped)) {
                await prisma.complaint.update({
                  where: { complRegNum: data.complRegNum },
                  data: mapped,
                });
                result.complaints.upserted++;
              }
            }
          } catch (error) {
            result.complaints.errors++;
            console.error('[SYNC] Error saving complaint:', error);
          }
        },
        async () => {
          // Write live progress updates directly to DB so the Sync History table updates dynamically
          await prisma.syncRun.update({
            where: { id: syncRun.id },
            data: {
              fetchedCount: result.complaints.fetched,
              upsertedCount: result.complaints.upserted,
              errorCount: result.complaints.errors,
            },
          }).catch(() => undefined);
        }
      );
    }

  } catch (error) {
    result.complaints.errors++;
    console.error(`[SYNC] Failed to sync complaints: ${error}`);
    
    // Mark as error if majority failed or crashed
    if (result.complaints.fetched > 0 && result.complaints.upserted === 0) {
      result.syncFailed = true;
    }
  } finally {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: result.complaints.errors > 0 ? 'partial' : 'success',
        endedAt: new Date(),
        fetchedCount: result.complaints.fetched,
        upsertedCount: result.complaints.upserted,
        errorCount: result.complaints.errors,
      },
    }).catch(() => undefined);
  }

  return result;
};

export const runCctnsSync = async (
  options: { fromDate?: string; toDate?: string; label?: string; days?: number; dType?: 'P' | 'F' } = {}
): Promise<CctnsSyncResult | null> => {
  if (isSyncing) {
    console.log('[SYNC] Already syncing, skipping...');
    return null;
  }

  isSyncing = true;
  try {
    return await runCctnsSyncInternal(options);
  } finally {
    isSyncing = false;
  }
};

/**
 * Run a full rolling sync in monthly chunks.
 * Instead of fetching a hardcoded 365 days, this queries the DB for the
 * oldest pending complaint and syncs from that date up to today.
 * This catches status changes on old complaints efficiently.
 */
export const runCctnsFullRollingSync = async (): Promise<void> => {
  const CHUNK_DAYS = 30;

  // Find the oldest pending complaint
  const oldestPending = await prisma.complaint.findFirst({
    where: { statusGroup: 'pending', complRegDt: { not: null } },
    orderBy: { complRegDt: 'asc' },
    select: { complRegDt: true },
  });

  const end = new Date();
  const start = new Date();

  if (oldestPending?.complRegDt) {
    start.setTime(oldestPending.complRegDt.getTime());
    // Add a 1-day buffer just to be safe
    start.setDate(start.getDate() - 1);
  } else {
    // Fallback to 30 days if no pending complaints exist
    start.setDate(end.getDate() - 30);
  }

  // Sanity check
  if (start > end) {
    start.setTime(end.getTime());
    start.setDate(start.getDate() - 1);
  }

  console.log(`[SYNC] Starting full rolling sync from oldest pending date: ${formatDateStr(start)} → ${formatDateStr(end)} in ${CHUNK_DAYS}-day chunks`);

  let chunkStart = new Date(start);
  let chunkIndex = 0;

  while (chunkStart < end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkStart.getDate() + CHUNK_DAYS);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    chunkIndex++;
    // Wait for any in-progress sync to finish before each chunk
    while (isSyncing) {
      await new Promise(r => setTimeout(r, 5000));
    }

    await runCctnsSync({
      fromDate: formatDateStr(chunkStart),
      toDate:   formatDateStr(chunkEnd),
      label:    `rolling-chunk-${chunkIndex}`,
    });

    // Advance to next chunk — use exact CHUNK_DAYS (no +1 gap).
    // The API date filter is inclusive on both ends, so the last day of this chunk
    // will be the first day of the next chunk. Upsert handles any duplicates safely.
    chunkStart.setDate(chunkStart.getDate() + CHUNK_DAYS);

    // Small pause between chunks to avoid hammering the CCTNS API
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`[SYNC] Full rolling sync complete — ${chunkIndex} chunks processed`);
  clearCache(); // Bust dashboard cache so next load reflects newly synced data
};





let intervalHandle: NodeJS.Timeout | null = null;
let rollingIntervalHandle: NodeJS.Timeout | null = null;

const hasRunRecently = async (kindPattern: string, hours: number): Promise<boolean> => {
  try {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentRun = await prisma.syncRun.findFirst({
      where: {
        kind: { startsWith: kindPattern },
        startedAt: { gte: cutoff },
        status: { in: ['success', 'running', 'partial'] }
      }
    });
    return !!recentRun;
  } catch (err) {
    console.error(`[SYNC] Could not check recent runs for ${kindPattern}:`, err);
    return false;
  }
};

/**
 * runCctnsAutoSync()
 * Performs automatic syncing.
 * - If the database has no complaints (is new), fetches historic complaints (last 30 days) using optimized DType=P.
 * - If complaints already exist, performs a quick partial fetch (last 1 day) using DType=P.
 */
let isAutoSyncing = false;

/**
 * runCctnsAutoSync()
 * Performs real-time automatic syncing from the oldest pending complaint's registration date to today.
 * To optimize performance and ensure robust operation without timeouts:
 * - We find the oldest pending complaint in the DB and define the start date.
 * - We sync from that start date up to today in 90-day chunks.
 * - We use dType: 'P' (Partial Sync) for the chunks, which is extremely optimized and fast.
 * - If a complaint is already in the database and hasn't changed, we perform ZERO writes, keeping DB I/O minimal.
 */
export const runCctnsAutoSync = async (): Promise<void> => {
  if (isAutoSyncing || isSyncing) {
    console.log('[AUTOSYNC] A sync is already in progress, skipping auto-sync iteration.');
    return;
  }

  isAutoSyncing = true;

  // Initialize progress tracking state
  activeBackgroundSync.status = 'running';
  activeBackgroundSync.progress = 'Starting auto-sync...';
  activeBackgroundSync.progressPercentage = 1;
  activeBackgroundSync.fetched = 0;
  activeBackgroundSync.upserted = 0;
  activeBackgroundSync.errors = 0;
  activeBackgroundSync.startedAt = new Date();

  try {
    // Find the oldest pending complaint in the database
    const oldestPending = await prisma.complaint.findFirst({
      where: { statusGroup: 'pending', complRegDt: { not: null } },
      orderBy: { complRegDt: 'asc' },
      select: { complRegDt: true },
    });

    const end = new Date();
    const start = new Date();

    if (oldestPending?.complRegDt) {
      start.setTime(oldestPending.complRegDt.getTime());
      // Add a 1-day buffer
      start.setDate(start.getDate() - 1);
    } else {
      // Fallback to 30 days if no pending complaints exist
      start.setDate(end.getDate() - 30);
    }

    // Sanity check
    if (start > end) {
      start.setTime(end.getTime());
      start.setDate(start.getDate() - 1);
    }

    console.log(`[AUTOSYNC] Starting real-time auto-sync from oldest pending date: ${formatDateStr(start)} → ${formatDateStr(end)} using DType=P`);

    const CHUNK_DAYS = 90;
    let chunkStart = new Date(start);
    let chunkIndex = 0;

    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 3600 * 24) + 1);
    const totalChunks = Math.ceil(totalDays / CHUNK_DAYS);

    let totalFetched = 0;
    let totalUpserted = 0;
    let totalErrors = 0;

    while (chunkStart < end) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkStart.getDate() + CHUNK_DAYS);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());

      chunkIndex++;

      // Pause briefly between chunks to prevent concurrent DB pool stress
      if (chunkIndex > 1) {
        await new Promise(r => setTimeout(r, 1000));
      }

      console.log(`[AUTOSYNC] Processing chunk ${chunkIndex} of ${totalChunks}: ${formatDateStr(chunkStart)} → ${formatDateStr(chunkEnd)}`);
      activeBackgroundSync.progress = `Syncing chunk ${chunkIndex} of ${totalChunks} (${formatDateStr(chunkStart)} - ${formatDateStr(chunkEnd)})`;
      activeBackgroundSync.progressPercentage = Math.min(99, Math.round((chunkIndex / totalChunks) * 100));

      // Run sync for this chunk using runCctnsSyncInternal
      const syncResult = await runCctnsSyncInternal({
        fromDate: formatDateStr(chunkStart),
        toDate:   formatDateStr(chunkEnd),
        dType:    'P',
        label:    `auto-chunk-${chunkIndex}`,
      });

      if (syncResult) {
        totalFetched += syncResult.complaints.fetched;
        totalUpserted += syncResult.complaints.upserted;
        totalErrors += syncResult.complaints.errors;

        // Update active sync stats dynamically
        activeBackgroundSync.fetched = totalFetched;
        activeBackgroundSync.upserted = totalUpserted;
        activeBackgroundSync.errors = totalErrors;
      }

      // Advance chunk start date - use exact CHUNK_DAYS to ensure no gaps
      chunkStart.setDate(chunkStart.getDate() + CHUNK_DAYS);
    }

    console.log(`[AUTOSYNC] Real-time auto-sync completed: processed ${chunkIndex} chunks. Total Fetched: ${totalFetched}, Total Saved/Updated (Actual Modifications): ${totalUpserted}, Errors: ${totalErrors}`);

    // Bust dashboard cache
    clearCache();
  } catch (error: any) {
    console.error('[AUTOSYNC] Real-time auto-sync failed:', error?.message || String(error));
  } finally {
    isAutoSyncing = false;
    activeBackgroundSync.status = 'idle';
    activeBackgroundSync.progressPercentage = 0;
  }
};

export const cleanOrphanedSyncRuns = async (): Promise<void> => {
  console.log('[SYNC] Cleaning up orphaned "running" sync runs from database on server startup...');
  try {
    const updated = await prisma.syncRun.updateMany({
      where: { status: 'running' },
      data: {
        status: 'error',
        message: 'Sync run was interrupted (server was restarted or process was terminated)',
        endedAt: new Date(),
      },
    });
    if (updated.count > 0) {
      console.log(`[SYNC] Successfully marked ${updated.count} orphaned running sync runs as interrupted/error.`);
    }
  } catch (err: any) {
    console.error('[SYNC] Failed to clean up orphaned running sync runs:', err?.message || String(err));
  }
};

export const startCctnsBackgroundSync = () => {
  console.log('[SYNC] Background auto-sync is currently paused/disabled by configuration.');
  
  // Clean up any orphaned running syncs from database on startup
  cleanOrphanedSyncRuns().catch((e) => console.error('[SYNC] Startup cleanup failed:', e));
};


