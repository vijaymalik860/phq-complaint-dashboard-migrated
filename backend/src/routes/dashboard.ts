import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';
import { sendSuccess, sendCached, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { buildPrismaWhereClause, buildRawWhereClause } from '../utils/filters.js';
import { cached } from '../utils/cache.js';
import {
  getDistrictNameByIdMap,
} from '../services/master-mapping.js';

const UNMAPPED = 'Unmapped';

const withAnd = (baseWhere: any, extraWhere: any) => ({
  AND: [baseWhere, extraWhere].filter(Boolean),
});

const getDistrictLabel = (id: bigint | null, map: Map<string, string>) => {
  if (!id) return UNMAPPED;
  return map.get(id.toString()) || UNMAPPED;
};


export const dashboardRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/dashboard/summary', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const baseWhere = buildPrismaWhereClause(request.query);
    const totalReceived = await prisma.complaint.count({ where: baseWhere });
    const totalDisposed = await prisma.complaint.count({ where: withAnd(baseWhere, { statusGroup: 'disposed' }) });
    const totalPending = await prisma.complaint.count({ where: withAnd(baseWhere, { statusGroup: 'pending' }) });
    // Complaints where CCTNS API provided no recognizable status value
    const totalUnknown = await prisma.complaint.count({ where: withAnd(baseWhere, { statusGroup: 'unknown' }) });
    const disposedMissingDateCount = await prisma.complaint.count({
      where: withAnd(baseWhere, { statusGroup: 'disposed', isDisposedMissingDate: true }),
    });

    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const pending15 = await prisma.complaint.count({
      where: withAnd(baseWhere, { statusGroup: 'pending', complRegDt: { lte: fifteenDaysAgo, gt: oneMonthAgo } }),
    });
    const pendingOver1 = await prisma.complaint.count({
      where: withAnd(baseWhere, { statusGroup: 'pending', complRegDt: { lte: oneMonthAgo, gt: twoMonthsAgo } }),
    });
    const pendingOver2 = await prisma.complaint.count({
      where: withAnd(baseWhere, { statusGroup: 'pending', complRegDt: { lte: twoMonthsAgo } }),
    });

    // SQL AVG instead of findMany+loop — transfers 1 row instead of 80,000
    // Apply same global filters as the disposal matrix
    const filterWhereAvg = buildRawWhereClause(request.query);
    const avgResult = await prisma.$queryRaw<[{ avg_days: number }]>`
      SELECT COALESCE(
        AVG(GREATEST(0, EXTRACT(EPOCH FROM ("disposalDate" - "complRegDt")) / 86400)),
        0
      ) AS avg_days
      FROM "Complaint"
      WHERE "statusGroup" = 'disposed'
        AND "isDisposedMissingDate" = false
        AND "complRegDt" IS NOT NULL
        AND "disposalDate" IS NOT NULL
        AND "disposalDate" >= "complRegDt"
        AND ${filterWhereAvg}
    `;
    const avgDisposalTime = Math.round(Number(avgResult[0]?.avg_days ?? 0));

    // Calculate Avg Pending Time (similar to Avg Disposal Time)
    const avgPendingResult = await prisma.$queryRaw<[{ avg_days: number }]>`
      SELECT COALESCE(
        AVG(GREATEST(0, EXTRACT(EPOCH FROM (NOW() - "complRegDt")) / 86400)),
        0
      ) AS avg_days
      FROM "Complaint"
      WHERE "statusGroup" = 'pending'
        AND "complRegDt" IS NOT NULL
        AND ${filterWhereAvg}
    `;
    const avgPendingTime = Math.round(Number(avgPendingResult[0]?.avg_days ?? 0));

    // Calculate Oldest Pending Complaint Date
    const oldestPendingResult = await prisma.complaint.aggregate({
      where: withAnd(baseWhere, { statusGroup: 'pending', complRegDt: { not: null } }),
      _min: { complRegDt: true },
    });
    const oldestPendingDate = oldestPendingResult._min.complRegDt;

    // Last successful sync time — shown in the dashboard header (PR #4)
    const lastSuccessfulSync = await prisma.syncRun.findFirst({
      where: { status: { in: ['success', 'partial'] }, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true, message: true },
    });

    // Last failed sync attempt
    const lastFailedSync = await prisma.syncRun.findFirst({
      where: { status: { in: ['error'] }, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true, message: true },
    });

    // Count of recent failed syncs (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failedSyncCount = await prisma.syncRun.count({
      where: {
        status: 'error',
        startedAt: { gte: sevenDaysAgo },
      },
    });

    const lastSyncTime = lastSuccessfulSync?.endedAt ?? null;
    const lastFailedSyncTime = lastFailedSync?.endedAt ?? null;

    // Get DB date range
    const globalDates = await prisma.complaint.aggregate({
      _min: { complRegDt: true },
      _max: { complRegDt: true },
    });

    return sendCached(reply, {
      totalReceived,
      totalDisposed,
      totalPending,
      totalUnknown,
      disposedMissingDateCount,
      pendingOverFifteenDays: pending15,
      pendingOverOneMonth: pendingOver1,
      pendingOverTwoMonths: pendingOver2,
      avgDisposalTime,
      avgPendingTime,
      oldestPendingDate,
      lastSyncTime,
      lastFailedSyncTime,
      failedSyncCount,
      dbMinDate: globalDates._min.complRegDt,
      dbMaxDate: globalDates._max.complRegDt,
    });
  });

  fastify.get('/dashboard/district-wise', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const q = JSON.stringify(request.query);
    const data = await cached(`district-wise:${q}`, 5 * 60 * 1000, async () => {
      const filterWhere = buildRawWhereClause(request.query);
      const [districtMapById, rows] = await Promise.all([
        getDistrictNameByIdMap(),
        prisma.$queryRaw<Array<{
          districtMasterId: bigint | null;
          total: bigint; pending: bigint; disposed: bigint; unknown: bigint; missingDates: bigint;
        }>>`
          SELECT 
            "districtMasterId",
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE "statusGroup" = 'pending') as pending,
            COUNT(*) FILTER (WHERE "statusGroup" = 'disposed') as disposed,
            COUNT(*) FILTER (WHERE "statusGroup" = 'unknown') as unknown,
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = true) as "missingDates"
          FROM "Complaint"
          WHERE ${filterWhere}
          GROUP BY "districtMasterId"
        `,
      ]);
      
      return rows.map(r => {
        const total = Number(r.total);
        const pending = Number(r.pending);
        const disposed = Number(r.disposed);
        const unknown = Number(r.unknown);
        return {
          district: getDistrictLabel(r.districtMasterId, districtMapById),
          total,
          pending,
          disposed,
          unknown,
          missingDates: Number(r.missingDates),
          pending_pct: total > 0 ? (pending / total) * 100 : 0,
          disposed_pct: total > 0 ? (disposed / total) * 100 : 0,
          unknown_pct: total > 0 ? (unknown / total) * 100 : 0,
        };
      });
    });
    return sendCached(reply, data);
  });

  fastify.get('/dashboard/duration-wise', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const q = JSON.stringify(request.query);
    const data = await cached(`duration-wise:${q}`, 5 * 60 * 1000, async () => {
      const rq = request.query as Record<string, string>;
      const fromDate = rq.fromDate || rq.from_date;
      const toDate   = rq.toDate   || rq.to_date;

      let useDayGranularity = false;
      if (fromDate && toDate) {
        const diffDays = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24);
        useDayGranularity = diffDays <= 31;
      }

      const filterWhere = buildRawWhereClause(request.query);
      let rows: any[];

      if (useDayGranularity) {
        rows = await prisma.$queryRaw`
          SELECT
            DATE_TRUNC('day', "complRegDt") as "dateVal",
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE "statusGroup" = 'pending') as pending,
            COUNT(*) FILTER (WHERE "statusGroup" = 'disposed') as disposed,
            COUNT(*) FILTER (WHERE "statusGroup" = 'unknown') as unknown
          FROM "Complaint"
          WHERE "complRegDt" IS NOT NULL
            AND ${filterWhere}
          GROUP BY DATE_TRUNC('day', "complRegDt")
          ORDER BY DATE_TRUNC('day', "complRegDt") ASC
        `;
      } else {
        rows = await prisma.$queryRaw`
          SELECT
            DATE_TRUNC('month', "complRegDt") as "dateVal",
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE "statusGroup" = 'pending') as pending,
            COUNT(*) FILTER (WHERE "statusGroup" = 'disposed') as disposed,
            COUNT(*) FILTER (WHERE "statusGroup" = 'unknown') as unknown
          FROM "Complaint"
          WHERE "complRegDt" IS NOT NULL
            AND ${filterWhere}
          GROUP BY DATE_TRUNC('month', "complRegDt")
          ORDER BY DATE_TRUNC('month', "complRegDt") ASC
        `;
      }

      return rows.map((r: any) => {
        const d = new Date(r.dateVal);
        const duration = useDayGranularity
          ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`;
        
        return {
          duration,
          total: Number(r.total),
          pending: Number(r.pending),
          disposed: Number(r.disposed),
          unknown: Number(r.unknown),
          granularity: useDayGranularity ? 'day' : 'month',
        };
      });
    });
    return sendCached(reply, data);
  });

  fastify.get('/dashboard/date-wise', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { fromDate, toDate } = request.query as Record<string, string>;
    if (!fromDate || !toDate) return sendError(reply, 'fromDate and toDate are required');

    const [districtMapById, grouped] = await Promise.all([
      getDistrictNameByIdMap(),
      prisma.complaint.groupBy({
        by: ['districtMasterId', 'statusGroup'],
        where: {
          ...buildPrismaWhereClause(request.query),
          complRegDt: { gte: new Date(fromDate), lte: new Date(toDate) },
        },
        _count: { _all: true },
      }),
    ]);

    const districtMap = new Map<string, { total: number; pending: number; disposed: number }>();
    for (const g of grouped) {
      const district = getDistrictLabel(g.districtMasterId, districtMapById);
      const stats = districtMap.get(district) || { total: 0, pending: 0, disposed: 0 };
      const count = g._count._all;
      stats.total += count;
      if (g.statusGroup === 'pending') stats.pending += count;
      if (g.statusGroup === 'disposed') stats.disposed += count;
      districtMap.set(district, stats);
    }

    return sendSuccess(
      reply,
      Array.from(districtMap.entries()).map(([district, stats]) => ({
        district,
        totalComplaints: stats.total,
        pending: stats.pending,
        disposed: stats.disposed,
      }))
    );
  });

  fastify.get('/dashboard/month-wise', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const filterWhere = buildRawWhereClause(request.query);
    const rows = await prisma.$queryRaw<Array<{ month: string, total: bigint, pending: bigint }>>`
      SELECT 
        to_char("complRegDt" AT TIME ZONE 'UTC', 'YYYY-MM') as month,
        COUNT(*) as total,
        SUM(CASE WHEN "statusGroup" = 'pending' THEN 1 ELSE 0 END) as pending
      FROM "Complaint"
      WHERE ${filterWhere}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return sendSuccess(
      reply,
      rows.filter(r => r.month).map(row => ({
        month: row.month,
        year: Number(row.month.split('-')[0]),
        monthNum: Number(row.month.split('-')[1]),
        total: Number(row.total),
        pending: Number(row.pending),
      }))
    );
  });

  fastify.get('/dashboard/ageing-matrix', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const q = JSON.stringify(request.query);
    const data = await cached(`ageing-matrix:${q}`, 5 * 60 * 1000, async () => {
      // Build dynamic filter clause so ALL global filters (classOfIncident, districtIds, etc.) are respected
      const filterWhere = buildRawWhereClause(request.query);
      const rows = await prisma.$queryRaw<Array<{
        districtMasterId: bigint | null;
        pending: bigint;
        missingDates: bigint;
        u7: bigint; u15: bigint; u30: bigint; o30: bigint; o60: bigint;
      }>>`
        SELECT
          "districtMasterId",
          COUNT(*) as pending,
          COUNT(*) FILTER (WHERE "complRegDt" IS NULL) AS "missingDates",
          COUNT(*) FILTER (WHERE "complRegDt" IS NOT NULL AND NOW() - "complRegDt" < INTERVAL '7 days')   AS u7,
          COUNT(*) FILTER (WHERE "complRegDt" IS NOT NULL AND NOW() - "complRegDt" >= INTERVAL '7 days'  AND NOW() - "complRegDt" < INTERVAL '15 days') AS u15,
          COUNT(*) FILTER (WHERE "complRegDt" IS NOT NULL AND NOW() - "complRegDt" >= INTERVAL '15 days' AND NOW() - "complRegDt" < INTERVAL '30 days') AS u30,
          COUNT(*) FILTER (WHERE "complRegDt" IS NOT NULL AND NOW() - "complRegDt" >= INTERVAL '30 days' AND NOW() - "complRegDt" < INTERVAL '60 days') AS o30,
          COUNT(*) FILTER (WHERE "complRegDt" IS NOT NULL AND NOW() - "complRegDt" >= INTERVAL '60 days')                                               AS o60
        FROM "Complaint"
        WHERE "statusGroup" = 'pending'

          AND ${filterWhere}
        GROUP BY "districtMasterId"
      `;
      const districtMapById = await getDistrictNameByIdMap();
      return rows.map(r => ({
        district: r.districtMasterId ? (districtMapById.get(r.districtMasterId.toString()) || UNMAPPED) : UNMAPPED,
        pending: Number(r.pending),
        missingDates: Number(r.missingDates),
        u7:  Number(r.u7),
        u15: Number(r.u15),
        u30: Number(r.u30),
        o30: Number(r.o30),
        o60: Number(r.o60),
      }));
    });
    return sendCached(reply, data);
  });

  fastify.get('/dashboard/disposal-matrix', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const q = JSON.stringify(request.query);
    const data = await cached(`disposal-matrix:${q}`, 5 * 60 * 1000, async () => {
      // Build dynamic filter clause so ALL global filters are respected
      const filterWhere = buildRawWhereClause(request.query);
      const [rows] = await Promise.all([
        prisma.$queryRaw<Array<{
          districtMasterId: bigint | null;
          disposed: bigint;
          missingDates: bigint;
          u7: bigint; u15: bigint; u30: bigint; o30: bigint; o60: bigint;
        }>>`
          SELECT
            "districtMasterId",
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = false) as disposed,
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = true) as "missingDates",
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = false AND "disposalDate" >= "complRegDt" AND "disposalDate" - "complRegDt" < INTERVAL '7 days')   AS u7,
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = false AND "disposalDate" >= "complRegDt" AND "disposalDate" - "complRegDt" < INTERVAL '15 days')  AS u15,
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = false AND "disposalDate" >= "complRegDt" AND "disposalDate" - "complRegDt" < INTERVAL '30 days')  AS u30,
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = false AND "disposalDate" >= "complRegDt" AND "disposalDate" - "complRegDt" < INTERVAL '60 days')  AS o30,
            COUNT(*) FILTER (WHERE "isDisposedMissingDate" = false AND "disposalDate" >= "complRegDt" AND "disposalDate" - "complRegDt" >= INTERVAL '60 days') AS o60
          FROM "Complaint"
          WHERE "statusGroup" = 'disposed'
            AND ${filterWhere}
          GROUP BY "districtMasterId"
        `,
      ]);
      const districtMapById = await getDistrictNameByIdMap();
      return {
        rows: rows.map(r => ({
          district: r.districtMasterId ? (districtMapById.get(r.districtMasterId.toString()) || UNMAPPED) : UNMAPPED,
          total: Number(r.disposed),
          missingDates: Number(r.missingDates),
          u7:  Number(r.u7),
          u15: Number(r.u15),
          u30: Number(r.u30),
          o30: Number(r.o30),
          o60: Number(r.o60),
        })),
      };
    });
    return sendCached(reply, data);
  });

  fastify.get<{ Params: { district: string } }>('/dashboard/district-analysis/:district', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const q = JSON.stringify({ ...(request.query as any), district: request.params.district });
    const data = await cached(`district-analysis:${q}`, 5 * 60 * 1000, async () => {
        const districtParam = decodeURIComponent(request.params.district || '').trim();
        const baseWhere = buildPrismaWhereClause(request.query);

        let districtFilter: any;
        let resolvedDistrictId: bigint | null = null;
        if (!districtParam || districtParam.toLowerCase() === UNMAPPED.toLowerCase()) {
          districtFilter = { districtMasterId: null };
        } else {
          const district = await prisma.district.findFirst({ where: { name: { equals: districtParam, mode: 'insensitive' } } });
          if (!district) {
            return { district: districtParam, policeStations: [], categories: [] };
          }
          resolvedDistrictId = district.id;
          districtFilter = { districtMasterId: district.id };
        }

        // Build a PS name map scoped STRICTLY to this district only.
        // Key insight: if a complaint's policeStationMasterId points to a PS from
        // another district (e.g. QILLA under Rohtak appearing in Hisar), it will NOT
        // be found here and will be grouped as 'Unmapped' — preventing cross-district leakage.
        const stationMapById = await (async () => {
          const stations = await prisma.policeStation.findMany({
            where: resolvedDistrictId != null
              ? { districtId: resolvedDistrictId }
              : {},
            select: { id: true, name: true },
          });
          const map = new Map<string, string>();
          for (const s of stations) map.set(s.id.toString(), s.name);
          return map;
        })();

        const complaints = await prisma.complaint.findMany({
          where: withAnd(baseWhere, districtFilter),
          select: {
            policeStationMasterId: true,
            submitPsCd: true,         // submitting PS code (primary operational field)
            statusGroup: true,
            complRegDt: true,
            disposalDate: true,
            isDisposedMissingDate: true,
            classOfIncident: true,
          },
        });

    const now = Date.now();
    const psMap = new Map<string, {
      psIds: Set<bigint>;
      total: number; pending: number; disposed: number; unknown: number; missingDates: number; pendingMissingDates: number;
      u7: number; u15: number; u30: number; o30: number; o60: number;
      du7: number; du15: number; du30: number; do30: number; do60: number; totalDisposalDays: number;
    }>();
    const categoryMap = new Map<string, { total: number; pending: number; disposed: number; unknown: number; missingDates: number }>();

    let totalPendingDays = 0;
    let pendingCountWithDate = 0;
    let oldestPendingTime: number | null = null;

    for (const comp of complaints) {
      // Strict district-scoped PS resolution:
      // 1. policeStationMasterId → name from THIS district's PS map only
      //    (cross-district IDs like QILLA-under-Rohtak won't resolve → Unmapped)
      // 2. submitPsCd as numeric ID → try THIS district's PS map
      // 3. Unmapped
      let ps: string = UNMAPPED;
      if (comp.policeStationMasterId) {
        ps = stationMapById.get(comp.policeStationMasterId.toString()) || UNMAPPED;
      } else if (comp.submitPsCd) {
        // submitPsCd is a numeric code — try it as a PS master ID within this district
        const parsed = parseInt(comp.submitPsCd, 10);
        if (!isNaN(parsed)) {
          ps = stationMapById.get(String(parsed)) || UNMAPPED;
        }
      }
      const category = comp.classOfIncident || UNMAPPED;
      const stats = psMap.get(ps) || {
        psIds: new Set<bigint>(),
        total: 0, pending: 0, disposed: 0, unknown: 0, missingDates: 0, pendingMissingDates: 0,
        u7: 0, u15: 0, u30: 0, o30: 0, o60: 0,
        du7: 0, du15: 0, du30: 0, do30: 0, do60: 0,
        totalDisposalDays: 0,
      };
      if (comp.policeStationMasterId != null) {
        stats.psIds.add(comp.policeStationMasterId);
      }
      const catStats = categoryMap.get(category) || { total: 0, pending: 0, disposed: 0, unknown: 0, missingDates: 0 };

      stats.total++;
      catStats.total++;

      if (comp.statusGroup === 'pending') {
        stats.pending++;
        catStats.pending++;
        if (comp.complRegDt) {
          const compTime = comp.complRegDt.getTime();
          const days = (now - compTime) / (1000 * 60 * 60 * 24);
          if (days < 7) stats.u7++;
          else if (days < 15) stats.u15++;
          else if (days < 30) stats.u30++;
          else if (days < 60) stats.o30++;  // 1-2 Months
          else stats.o60++;                 // Over 2 Months

          totalPendingDays += days;
          pendingCountWithDate++;
          if (oldestPendingTime === null || compTime < oldestPendingTime) {
            oldestPendingTime = compTime;
          }
        } else {
          stats.pendingMissingDates++;
        }
      } else if (comp.statusGroup === 'disposed') {
        stats.disposed++;
        catStats.disposed++;
        if (comp.isDisposedMissingDate) {
          stats.missingDates++;
          catStats.missingDates++;
        } else {
          if (comp.complRegDt && comp.disposalDate) {
            const rawDays = (comp.disposalDate.getTime() - comp.complRegDt.getTime()) / (1000 * 60 * 60 * 24);
            if (rawDays >= 0) {
              stats.totalDisposalDays += rawDays;
              if (rawDays < 7) stats.du7++;
              if (rawDays < 15) stats.du15++;
              if (rawDays < 30) stats.du30++;
              if (rawDays < 60) stats.do30++;
              if (rawDays >= 60) stats.do60++;
            }
          }
        }
      } else if (comp.statusGroup === 'unknown') {
        stats.unknown++;
        catStats.unknown++;
      }

      psMap.set(ps, stats);
      categoryMap.set(category, catStats);
    }

    const policeStations = Array.from(psMap.entries()).map(([ps, stats]) => ({
      ps,
      psId: stats.psIds.size > 0 ? Array.from(stats.psIds).join(',') : null,
      total: stats.total,
      pending: stats.pending,
      pendingMissingDates: stats.pendingMissingDates,
      disposed: stats.disposed,
      unknown: stats.unknown,      // status not found in record
      missingDates: stats.missingDates,
      u7: stats.u7,
      u15: stats.u15,
      u30: stats.u30,
      o30: stats.o30,
      o60: stats.o60,
      du7: stats.du7,
      du15: stats.du15,
      du30: stats.du30,
      do30: stats.do30,
      do60: stats.do60,
      avgDisposalDays: stats.disposed - stats.missingDates > 0
        ? Math.round(stats.totalDisposalDays / (stats.disposed - stats.missingDates))
        : null,
    }));

    const categories = Array.from(categoryMap.entries()).map(([category, stats]) => ({ category, ...stats }));

    const avgPendingTime = pendingCountWithDate > 0 ? Math.round(totalPendingDays / pendingCountWithDate) : 0;
    const oldestPendingDate = oldestPendingTime !== null ? new Date(oldestPendingTime) : null;

    return {
      district: districtParam || UNMAPPED,
      policeStations,
      categories,
      avgPendingTime,
      oldestPendingDate: oldestPendingDate ? oldestPendingDate.toISOString() : null,
    };
    });

    return sendCached(reply, data);
  });

  fastify.get('/dashboard/category-wise', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const q = JSON.stringify(request.query);
    const data = await cached(`category-wise:${q}`, 5 * 60 * 1000, async () => {
      const filterWhere = buildRawWhereClause(request.query);
      const rows = await prisma.$queryRaw<Array<{
        category: string;
        total: bigint; pending: bigint; disposed: bigint; unknown: bigint; missingDates: bigint;
      }>>`
        SELECT 
          COALESCE(NULLIF(TRIM("classOfIncident"), ''), 'Unmapped') as category,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE "statusGroup" = 'pending') as pending,
          COUNT(*) FILTER (WHERE "statusGroup" = 'disposed') as disposed,
          COUNT(*) FILTER (WHERE "statusGroup" = 'unknown') as unknown,
          COUNT(*) FILTER (WHERE "isDisposedMissingDate" = true) as "missingDates"
        FROM "Complaint"
        WHERE ${filterWhere}
        GROUP BY COALESCE(NULLIF(TRIM("classOfIncident"), ''), 'Unmapped')
        ORDER BY total DESC
      `;
      return rows.map(r => {
        const total = Number(r.total);
        const pending = Number(r.pending);
        const disposed = Number(r.disposed);
        const unknown = Number(r.unknown);
        return {
          category: r.category,
          total,
          pending,
          disposed,
          unknown,
          missingDates: Number(r.missingDates),
          pending_pct: total > 0 ? (pending / total) * 100 : 0,
          disposed_pct: total > 0 ? (disposed / total) * 100 : 0,
          unknown_pct: total > 0 ? (unknown / total) * 100 : 0,
        };
      });
    });
    return sendCached(reply, data);
  });
};
