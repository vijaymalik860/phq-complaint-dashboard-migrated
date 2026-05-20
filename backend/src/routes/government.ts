import { FastifyInstance } from 'fastify';
import { sendSuccess, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../config/database.js';
import https from 'https';
import http from 'http';

interface GovernmentDropdownPayload {
  Result?: Array<Record<string, unknown>>;
  DropDownDTO?: Array<Record<string, unknown>>;
}

interface NormalizedGovItem {
  id: bigint;
  name: string;
}

const DISTRICT_API =
  process.env.HARYANA_DISTRICT_API ||
  'https://api.haryanapolice.gov.in/eSaralServices/api/common/district';
const POLICE_STATION_API =
  process.env.HARYANA_POLICE_STATION_API ||
  'https://api.haryanapolice.gov.in/eSaralServices/api/common/GetPSByDistrict';
const OFFICE_API =
  process.env.HARYANA_OFFICE_API ||
  'https://api.haryanapolice.gov.in/eSaralServices/api/common/GetAllOffices';
const HARYANA_STATE_CODE = (process.env.HARYANA_STATE_CODE || '13').trim();

const isRefreshValue = (value: unknown) =>
  String(value ?? '').trim().toLowerCase() === 'true' || String(value ?? '').trim() === '1';

const toId = (value: unknown): bigint | null => {
  const raw = String(value ?? '').trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
};

const normalizeItems = (items: Array<{ id: unknown; name: unknown }>): NormalizedGovItem[] => {
  const map = new Map<string, NormalizedGovItem>();
  for (const item of items) {
    const id = toId(item.id);
    const name = String(item.name ?? '').trim();
    if (!id || !name) continue;
    map.set(id.toString(), { id, name });
  }
  return Array.from(map.values());
};

const parseJsonPayload = (rawText: string): NormalizedGovItem[] | null => {
  let parsed: GovernmentDropdownPayload;
  try {
    parsed = JSON.parse(rawText) as GovernmentDropdownPayload;
  } catch {
    return null;
  }
  const source = Array.isArray(parsed.Result)
    ? parsed.Result
    : Array.isArray(parsed.DropDownDTO)
      ? parsed.DropDownDTO
      : [];
  return normalizeItems(
    source.map((row) => ({
      id: row.ID ?? row.Id ?? row.id,
      name: row.Name ?? row.NAME ?? row.name,
    }))
  );
};

const parseXmlPayload = (rawText: string): NormalizedGovItem[] => {
  const xml = rawText
    .replace(/<d2p1:/g, '<')
    .replace(/<\/d2p1:/g, '</')
    .replace(/<d3p1:/g, '<')
    .replace(/<\/d3p1:/g, '</');
  const ids = Array.from(xml.matchAll(/<ID>(.*?)<\/ID>/g), (m) => m[1]);
  const names = Array.from(xml.matchAll(/<Name>(.*?)<\/Name>/g), (m) => m[1]);
  return normalizeItems(ids.map((id, i) => ({ id, name: names[i] || '' })));
};

const httpGet = (url: string): Promise<string> => new Promise((resolve, reject) => {
  const mod = url.startsWith('https') ? https : http;
  const req = mod.get(url, {
    rejectUnauthorized: false,          // Haryana govt API uses self-signed / chain-invalid cert
    headers: { Accept: 'application/json, text/plain, application/xml;q=0.9, */*;q=0.8' },
  }, (res) => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => { raw += chunk; });
    res.on('end', () => resolve(raw.trim().replace(/^\uFEFF/, '')));
  });
  req.setTimeout(300_000, () => req.destroy(new Error(`Govt API timeout (5 min): ${url}`)));
  req.on('error', reject);
});

const fetchGovernmentItems = async (url: string): Promise<NormalizedGovItem[]> => {
  const rawText = await httpGet(url);
  return parseJsonPayload(rawText) ?? parseXmlPayload(rawText);
};

export const syncDistricts = async () => {
  const rows = await fetchGovernmentItems(DISTRICT_API);
  for (const d of rows) {
    await prisma.district.upsert({
      where: { id: d.id },
      update: { name: d.name },
      create: { id: d.id, name: d.name },
    });
  }
  return rows;
};

export const syncPoliceStationsByDistrict = async (districtId: bigint) => {
  const rows = await fetchGovernmentItems(
    `${POLICE_STATION_API}?state=${HARYANA_STATE_CODE}&district=${districtId.toString()}`
  );
  const district = await prisma.district.findUnique({ where: { id: districtId } });
  for (const ps of rows) {
    await prisma.policeStation.upsert({
      where: { id: ps.id },
      update: { name: ps.name, districtId, districtName: district?.name || null },
      create: { id: ps.id, name: ps.name, districtId, districtName: district?.name || null },
    });
  }
  return rows.length;
};

export const syncOffices = async () => {
  const rows = await fetchGovernmentItems(OFFICE_API);
  for (const office of rows) {
    await prisma.office.upsert({
      where: { id: office.id },
      update: { name: office.name },
      create: { id: office.id, name: office.name },
    });
  }
  return rows;
};

const processInBatches = async <T>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<void>
) => {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map((item) => worker(item)));
  }
};

export const governmentRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/gov/districts', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { refresh } = request.query as { refresh?: string };
      const local = await prisma.district.findMany({ orderBy: { name: 'asc' } });
      if (local.length > 0 && !isRefreshValue(refresh)) {
        return sendSuccess(
          reply,
          local.map((d) => ({ id: d.id.toString(), name: d.name }))
        );
      }
      await syncDistricts();
      const districts = await prisma.district.findMany({ orderBy: { name: 'asc' } });
      return sendSuccess(reply, districts.map((d) => ({ id: d.id.toString(), name: d.name })));
    } catch (error) {
      console.error('District sync error:', error);
      return sendError(reply, 'Failed to sync districts');
    }
  });

  fastify.get('/gov/police-stations', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { districtId, districtIds, refresh } = request.query as {
        districtId?: string;
        districtIds?: string;
        refresh?: string;
      };

      const districtIdList = String(districtIds || districtId || '')
        .split(',')
        .map((value) => toId(value))
        .filter((value): value is bigint => !!value);

      const localCount = await prisma.policeStation.count();
      if (localCount === 0 || isRefreshValue(refresh)) {
        const districts = await prisma.district.findMany({ select: { id: true } });
        await processInBatches(districts, 5, async (district) => {
          await syncPoliceStationsByDistrict(district.id);
        });
      }

      const where = districtIdList.length > 0 ? { districtId: { in: districtIdList } } : undefined;
      const stations = await prisma.policeStation.findMany({
        where,
        orderBy: [{ districtName: 'asc' }, { name: 'asc' }],
      });
      return sendSuccess(
        reply,
        stations.map((ps) => ({
          id: ps.id.toString(),
          name: ps.name,
          districtId: ps.districtId?.toString() || null,
          districtName: ps.districtName || null,
        }))
      );
    } catch (error) {
      console.error('Police station sync error:', error);
      return sendError(reply, 'Failed to sync police stations');
    }
  });

  fastify.get('/gov/offices', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { refresh } = request.query as { refresh?: string };
      const local = await prisma.office.findMany({ orderBy: { name: 'asc' } });
      if (local.length > 0 && !isRefreshValue(refresh)) {
        return sendSuccess(reply, local.map((o) => ({ id: o.id.toString(), name: o.name })));
      }
      await syncOffices();
      const offices = await prisma.office.findMany({ orderBy: { name: 'asc' } });
      return sendSuccess(reply, offices.map((o) => ({ id: o.id.toString(), name: o.name })));
    } catch (error) {
      console.error('Office sync error:', error);
      return sendError(reply, 'Failed to sync offices');
    }
  });

  fastify.get('/gov/sync-all', {
    preHandler: [authenticate],
  }, async (_request, reply) => {
    try {
      const districts = await syncDistricts();
      let policeStations = 0;
      let policeStationErrors = 0;
      await processInBatches(districts, 5, async (district) => {
        try {
          policeStations += await syncPoliceStationsByDistrict(district.id);
        } catch (error) {
          policeStationErrors++;
          console.error(`Police station sync failed for district ${district.id.toString()}:`, error);
        }
      });
      const offices = await syncOffices();
      return sendSuccess(reply, {
        message: 'Sync completed',
        districts: districts.length,
        policeStations,
        policeStationErrors,
        offices: offices.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Sync all error:', error);
      return sendError(reply, `Sync failed: ${msg}`);
    }
  });

  /**
   * POST /api/gov/bulk-seed
   *
   * Accepts pre-fetched master data (districts, policeStations, offices)
   * and upserts them to the database. Used by the seed script which can
   * reach the govt API but not the DB directly (port 5432 blocked locally).
   *
   * Body: { districts: [{id, name}], policeStations: [{id, name, districtId, districtName}], offices: [{id, name}] }
   */
  fastify.post('/gov/bulk-seed', async (request, reply) => {
    try {
      const body = request.body as {
        districts?: Array<{ id: string; name: string }>;
        policeStations?: Array<{ id: string; name: string; districtId: string; districtName: string }>;
        offices?: Array<{ id: string; name: string }>;
      };

      let districtsCount = 0;
      let psCount = 0;
      let officesCount = 0;

      // Upsert Districts
      for (const d of (body.districts ?? [])) {
        const id = toId(d.id);
        if (!id || !d.name) continue;
        await prisma.district.upsert({
          where:  { id },
          update: { name: d.name },
          create: { id, name: d.name },
        });
        districtsCount++;
      }

      // Upsert Police Stations
      for (const ps of (body.policeStations ?? [])) {
        const id = toId(ps.id);
        const districtId = toId(ps.districtId);
        if (!id || !ps.name) continue;
        await prisma.policeStation.upsert({
          where:  { id },
          update: { name: ps.name, districtId: districtId ?? undefined, districtName: ps.districtName ?? null },
          create: { id, name: ps.name, districtId: districtId ?? undefined, districtName: ps.districtName ?? null },
        });
        psCount++;
      }

      // Upsert Offices
      for (const o of (body.offices ?? [])) {
        const id = toId(o.id);
        if (!id || !o.name) continue;
        await prisma.office.upsert({
          where:  { id },
          update: { name: o.name },
          create: { id, name: o.name },
        });
        officesCount++;
      }

      return sendSuccess(reply, {
        message: 'Bulk seed complete',
        districts:      districtsCount,
        policeStations: psCount,
        offices:        officesCount,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Bulk seed error:', error);
      return sendError(reply, `Bulk seed failed: ${msg}`);
    }
  });
};
