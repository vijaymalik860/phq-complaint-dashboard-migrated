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

export const runCctnsSync = async (
  options: { fromDate?: string; toDate?: string; label?: string; days?: number } = {}
): Promise<CctnsSyncResult | null> => {
  if (isSyncing) {
    console.log('[SYNC] Already syncing, skipping...');
    return null;
  }

  isSyncing = true;

  // Use provided days or default to last 1 day (recent registrations) - reduced from 2 to avoid timeout
  const daysToSync = options.days ?? 1;
  const endDate = new Date();
  const defaultStart = new Date();
  defaultStart.setDate(endDate.getDate() - daysToSync);

  const timeFrom = options.fromDate ?? formatDateStr(defaultStart);
  const timeTo   = options.toDate   ?? formatDateStr(endDate);
  const label    = options.label    ?? 'background';

  console.log(`[SYNC] Starting ${label} CCTNS sync: ${timeFrom} → ${timeTo} (${daysToSync} day${daysToSync > 1 ? 's' : ''})`);

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
      },
    }));
  } catch (err) {
    console.error('[SYNC] Could not connect to database after retries. Skipping sync.', err);
    isSyncing = false;
    return null;
  }

  try {
    const complaints = (await fetchCctnsComplaints(timeFrom, timeTo)) as CctnsComplaintRow[];
    result.complaints.fetched = complaints.length;
    const normalized = toNormalizedUnique(complaints);

    await processInBatches(normalized, 100, async (data) => {
      try {
        const mapped = await enrichWithMasterIds(data);
        await prisma.complaint.upsert({
          where: { complRegNum: data.complRegNum },
          update: mapped,
          create: mapped,
        });
        result.complaints.upserted++;
      } catch (error) {
        result.complaints.errors++;
        console.error('[SYNC] Error saving complaint:', error);
      }
    });

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
    isSyncing = false;
  }

  return result;
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

export const startCctnsBackgroundSync = () => {
  if (intervalHandle) return;

  // Wait 15s before first recent sync — gives Neon DB time to wake from idle on cold start
  console.log('[SYNC] Server ready. First recent sync will begin in 15 seconds...');
  setTimeout(async () => {
    try {
      if (await hasRunRecently('cctns-background', 1)) {
        console.log('[SYNC] Background sync ran in the last hour. Skipping startup background sync.');
        return;
      }
      await runCctnsSync({ days: 1 });
    } catch (error) {
      console.error('[SYNC] Initial sync failed:', error);
    }
  }, 15_000);

  // Wait 60s then fire the full rolling sync conditionally
  // Vercel cold starts happen constantly; this guard prevents multiple heavy syncs.
  console.log('[SYNC] Startup rolling sync checks will begin in 60 seconds...');
  setTimeout(async () => {
    try {
      if (await hasRunRecently('cctns-rolling', 12)) {
        console.log('[SYNC] Rolling sync ran in the last 12 hours. Skipping startup rolling sync.');
        return;
      }
      console.log('[SYNC] Starting startup full rolling sync...');
      await runCctnsFullRollingSync();
    } catch (error) {
      console.error('[SYNC] Startup rolling sync failed:', error);
    }
  }, 60_000);

  // Every 6 hours: sync last 1 day only (reduced from 12h/2days to avoid timeout)
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  intervalHandle = setInterval(() => {
    runCctnsSync({ days: 1 }).catch((error) => console.error('[SYNC] Scheduled sync failed:', error));
  }, SIX_HOURS_MS);

  // Every 24 hours: full rolling sync from oldest pending complaint to today.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  rollingIntervalHandle = setInterval(() => {
    console.log('[SYNC] Starting daily full rolling sync...');
    runCctnsFullRollingSync().catch((error) => console.error('[SYNC] Rolling sync failed:', error));
  }, ONE_DAY_MS);
};
