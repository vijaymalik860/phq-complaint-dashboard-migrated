/**
 * seed-master-data.js
 * ────────────────────────────────────────────────────────────────────────────
 * One-time script to populate District, PoliceStation, and Office tables.
 *
 * Writes directly to the database via Prisma — no running backend required.
 * Automatically run by install.bat during server setup.
 * ────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const STATE_CODE = process.env.HARYANA_STATE_CODE || '13';
const PS_BATCH_SIZE = 3;

const BASE = process.env.HARYANA_POLICE_API_BASE || 'https://api.haryanapolice.gov.in/eSaralServices/api/common';
const DISTRICT_API = process.env.HARYANA_DISTRICT_API || `${BASE}/district`;
const PS_API = process.env.HARYANA_POLICE_STATION_API || `${BASE}/GetPSByDistrict`;
const OFFICE_API = process.env.HARYANA_OFFICE_API || `${BASE}/GetAllOffices`;

// ── Helpers ────────────────────────────────────────────────────────────────

const toId = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  return BigInt(raw);
};

const parseJsonPayload = (rawText) => {
  let parsed;
  try { parsed = JSON.parse(rawText); } catch { return null; }
  const source = Array.isArray(parsed.Result)
    ? parsed.Result
    : Array.isArray(parsed.DropDownDTO)
      ? parsed.DropDownDTO
      : [];
  const items = [];
  for (const row of source) {
    const id = toId(row.ID ?? row.Id ?? row.id);
    const name = String(row.Name ?? row.NAME ?? row.name ?? '').trim();
    if (id && name) items.push({ id, name });
  }
  return items;
};

const parseXmlPayload = (rawText) => {
  const xml = rawText.replace(/<d2p1:/g, '<').replace(/<\/d2p1:/g, '</').replace(/<d3p1:/g, '<').replace(/<\/d3p1:/g, '</');
  const ids = Array.from(xml.matchAll(/<ID>(.*?)<\/ID>/g), (m) => m[1]);
  const names = Array.from(xml.matchAll(/<Name>(.*?)<\/Name>/g), (m) => m[1]);
  const items = [];
  for (let i = 0; i < ids.length; i++) {
    const id = toId(ids[i]);
    const name = (names[i] || '').trim();
    if (id && name) items.push({ id, name });
  }
  return items;
};

// ── HTTP helper (native https to bypass govt API SSL cert issues) ──────────

const https = require('https');
const http = require('http');

const httpGet = (url) => new Promise((resolve, reject) => {
  const mod = url.startsWith('https') ? https : http;
  const req = mod.get(url, {
    rejectUnauthorized: false,
    headers: {
      Accept: 'application/json, text/plain, application/xml;q=0.9, */*;q=0.8',
    },
  }, (res) => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { raw += chunk; });
    res.on('end', () => resolve(raw.trim().replace(/^\uFEFF/, '')));
  });
  req.setTimeout(300_000, () => {
    req.destroy(new Error(`Timeout after 5 min: ${url}`));
  });
  req.on('error', reject);
});

const fetchGovtItems = async (url) => {
  console.log(`  \u2192 GET ${url}`);
  const rawText = await httpGet(url);
  return parseJsonPayload(rawText) ?? parseXmlPayload(rawText) ?? [];
};

// ── Database write helpers ─────────────────────────────────────────────────

const saveDistricts = async (districts) => {
  let count = 0;
  for (const d of districts) {
    await prisma.district.upsert({
      where: { id: d.id },
      update: { name: d.name },
      create: { id: d.id, name: d.name },
    });
    count++;
  }
  return count;
};

const savePoliceStations = async (policeStations) => {
  let count = 0;
  for (const ps of policeStations) {
    await prisma.policeStation.upsert({
      where: { id: ps.id },
      update: {
        name: ps.name,
        districtId: ps.districtId ?? undefined,
        districtName: ps.districtName ?? null,
      },
      create: {
        id: ps.id,
        name: ps.name,
        districtId: ps.districtId ?? undefined,
        districtName: ps.districtName ?? null,
      },
    });
    count++;
  }
  return count;
};

const saveOffices = async (offices) => {
  let count = 0;
  for (const o of offices) {
    await prisma.office.upsert({
      where: { id: o.id },
      update: { name: o.name },
      create: { id: o.id, name: o.name },
    });
    count++;
  }
  return count;
};

// ── Step 1: Collect all data from Govt API ─────────────────────────────────

const collectAllData = async () => {
  // Districts
  console.log('\n[1/3] Fetching Districts from Govt API...');
  const districts = await fetchGovtItems(DISTRICT_API);
  console.log(`      \u2705 ${districts.length} districts fetched`);

  // Police Stations (per district, in batches)
  console.log('\n[2/3] Fetching Police Stations from Govt API...');
  const policeStations = [];
  for (let i = 0; i < districts.length; i += PS_BATCH_SIZE) {
    const batch = districts.slice(i, i + PS_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (district) => {
      try {
        const url = `${PS_API}?state=${STATE_CODE}&district=${district.id}`;
        const items = await fetchGovtItems(url);
        console.log(`      District "${district.name}": ${items.length} PS`);
        return items.map(ps => ({ ...ps, districtId: district.id, districtName: district.name }));
      } catch (err) {
        console.warn(`  \u26a0\ufe0f  PS fetch failed for district "${district.name}": ${err.message}`);
        return [];
      }
    }));
    policeStations.push(...results.flat());
  }
  console.log(`      \u2705 ${policeStations.length} police stations fetched`);

  // Offices
  console.log('\n[3/3] Fetching Offices from Govt API...');
  const offices = await fetchGovtItems(OFFICE_API);
  console.log(`      \u2705 ${offices.length} offices fetched`);

  return { districts, policeStations, offices };
};

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(' PHQ Dashboard \u2014 Master Data Seed Script');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(` District API : ${DISTRICT_API}`);
  console.log(` PS API       : ${PS_API}`);
  console.log(` Office API   : ${OFFICE_API}`);
  console.log(` State code   : ${STATE_CODE}`);
  console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  const t0 = Date.now();

  // Fetch all data from govt API
  const data = await collectAllData();

  // Save directly to DB via Prisma
  console.log('\n[SAVING] Writing to database...');
  const districtsCount = await saveDistricts(data.districts);
  const psCount = await savePoliceStations(data.policeStations);
  const officesCount = await saveOffices(data.offices);

  await prisma.$disconnect();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(` \u2705 Seed complete in ${elapsed}s`);
  console.log(` Districts:       ${districtsCount}`);
  console.log(` Police Stations: ${psCount}`);
  console.log(` Offices:         ${officesCount}`);
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n\u274c Seed failed:', err.message);
    process.exit(1);
  });
