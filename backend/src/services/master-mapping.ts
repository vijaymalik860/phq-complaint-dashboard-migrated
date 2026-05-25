import { prisma } from '../config/database.js';

type NullableString = string | null | undefined;

type MappingInput = {
  districtMasterId?: bigint | null;
  policeStationMasterId?: bigint | null;
  officeMasterId?: bigint | null;
  districtName?: NullableString;
  addressDistrict?: NullableString;
  transferDistrictCd?: NullableString;
  submitPsCd?: NullableString;
  transferPsCd?: NullableString;
  addressPs?: NullableString;
  submitOfficeCd?: NullableString;
  branch?: NullableString;
};

export type ResolvedMasterIds = {
  districtMasterId: bigint | null;
  policeStationMasterId: bigint | null;
  officeMasterId: bigint | null;
};

const toId = (value: unknown): bigint | null => {
  const raw = String(value ?? '').trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
};

const normalizeName = (value: NullableString): string => {
  const text = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
};

const firstPresent = (...values: NullableString[]): string | null => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
};

const loadDistrictLookups = async () => {
  const districts = await prisma.district.findMany({
    select: { id: true, name: true },
  });
  const byName = new Map<string, bigint>();
  const byId = new Set<string>();
  for (const district of districts) {
    byName.set(normalizeName(district.name), district.id);
    byId.add(district.id.toString());
  }
  return { byName, byId };
};

const loadPoliceStationLookups = async () => {
  const stations = await prisma.policeStation.findMany({
    select: { id: true, name: true, districtId: true },
  });
  const byName = new Map<string, bigint>();
  const byId = new Set<string>();
  const stationDistrictMap = new Map<string, bigint>();
  for (const station of stations) {
    byName.set(normalizeName(station.name), station.id);
    byId.add(station.id.toString());
    if (station.districtId) {
      stationDistrictMap.set(station.id.toString(), station.districtId);
    }
  }
  return { byName, byId, stationDistrictMap };
};

const loadOfficeLookups = async () => {
  const offices = await prisma.office.findMany({
    select: { id: true, name: true, districtId: true },
  });
  const byName = new Map<string, bigint>();
  const byId = new Set<string>();
  const officeDistrictMap = new Map<string, bigint>();
  for (const office of offices) {
    byName.set(normalizeName(office.name), office.id);
    byId.add(office.id.toString());
    if (office.districtId) {
      officeDistrictMap.set(office.id.toString(), office.districtId);
    }
  }
  return { byName, byId, officeDistrictMap };
};

const resolveDistrictId = (
  input: MappingInput,
  districtByName: Map<string, bigint>,
  districtIdSet: Set<string>
): bigint | null => {
  const existing = input.districtMasterId ?? null;
  if (existing) return existing;

  const byCode = toId(firstPresent(input.transferDistrictCd));
  if (byCode && districtIdSet.has(byCode.toString())) return byCode;

  const districtName = firstPresent(input.districtName, input.addressDistrict);
  if (!districtName) return null;
  return districtByName.get(normalizeName(districtName)) ?? null;
};

const resolvePoliceStationId = (
  input: MappingInput,
  stationByName: Map<string, bigint>,
  stationIdSet: Set<string>
): bigint | null => {
  const existing = input.policeStationMasterId ?? null;
  if (existing) return existing;

  // Use the submitting PS code (SUBMIT_PS_CD) as the primary identifier.
  // This is the operational PS that actually handled the complaint.
  // We do NOT fall back to addressPs (complainant's home address PS) as that
  // represents where the complainant lives, not which PS handled the complaint.
  const byCode = toId(firstPresent(input.submitPsCd));
  if (byCode && stationIdSet.has(byCode.toString())) return byCode;

  // Fallback to transferPsCd (Transfer PS Code) if submitPsCd is unmapped/not resolved
  const byTransferCode = toId(firstPresent(input.transferPsCd));
  if (byTransferCode && stationIdSet.has(byTransferCode.toString())) return byTransferCode;

  return null;
};

const resolveOfficeId = (
  input: MappingInput,
  officeByName: Map<string, bigint>,
  officeIdSet: Set<string>
): bigint | null => {
  const existing = input.officeMasterId ?? null;
  if (existing) return existing;

  const byCode = toId(firstPresent(input.submitOfficeCd));
  if (byCode && officeIdSet.has(byCode.toString())) return byCode;

  const officeName = firstPresent(input.branch);
  if (!officeName) return null;
  return officeByName.get(normalizeName(officeName)) ?? null;
};

export type MasterLookups = {
  districtByName: Map<string, bigint>;
  districtIdSet: Set<string>;
  stationByName: Map<string, bigint>;
  stationIdSet: Set<string>;
  officeByName: Map<string, bigint>;
  officeIdSet: Set<string>;
  stationDistrictMap: Map<string, bigint>;
  officeDistrictMap: Map<string, bigint>;
};

export const loadAllLookups = async (): Promise<MasterLookups> => {
  const [districtLookups, stationLookups, officeLookups] = await Promise.all([
    loadDistrictLookups(),
    loadPoliceStationLookups(),
    loadOfficeLookups(),
  ]);
  return {
    districtByName: districtLookups.byName,
    districtIdSet: districtLookups.byId,
    stationByName: stationLookups.byName,
    stationIdSet: stationLookups.byId,
    officeByName: officeLookups.byName,
    officeIdSet: officeLookups.byId,
    stationDistrictMap: stationLookups.stationDistrictMap,
    officeDistrictMap: officeLookups.officeDistrictMap,
  };
};

export const resolveMasterIds = async (
  input: MappingInput,
  lookups?: MasterLookups
): Promise<ResolvedMasterIds> => {
  const resolvedLookups = lookups ?? (await loadAllLookups());

  const policeStationMasterId = resolvePoliceStationId(input, resolvedLookups.stationByName, resolvedLookups.stationIdSet);
  const officeMasterId = resolveOfficeId(input, resolvedLookups.officeByName, resolvedLookups.officeIdSet);

  // Hierarchical district resolution:
  // 1. Police Station's true operational district
  // 2. Fallback to normal text/existing match (Do NOT map offices under districts)
  let districtMasterId: bigint | null = null;
  if (policeStationMasterId) {
    districtMasterId = resolvedLookups.stationDistrictMap.get(policeStationMasterId.toString()) ?? null;
  }
  if (!districtMasterId) {
    districtMasterId = resolveDistrictId(input, resolvedLookups.districtByName, resolvedLookups.districtIdSet);
  }

  return {
    districtMasterId,
    policeStationMasterId,
    officeMasterId,
  };
};

export const enrichWithMasterIds = async <T extends MappingInput>(input: T) => {
  const resolved = await resolveMasterIds(input);
  return {
    ...input,
    districtMasterId: resolved.districtMasterId,
    policeStationMasterId: resolved.policeStationMasterId,
    officeMasterId: resolved.officeMasterId,
  };
};

export const getDistrictNameByIdMap = async () => {
  const districts = await prisma.district.findMany({
    select: { id: true, name: true },
  });
  const map = new Map<string, string>();
  for (const district of districts) {
    map.set(district.id.toString(), district.name);
  }
  return map;
};

export const getPoliceStationNameByIdMap = async () => {
  const stations = await prisma.policeStation.findMany({
    select: { id: true, name: true },
  });
  const map = new Map<string, string>();
  for (const station of stations) {
    map.set(station.id.toString(), station.name);
  }
  return map;
};

export const getOfficeNameByIdMap = async () => {
  const offices = await prisma.office.findMany({
    select: { id: true, name: true },
  });
  const map = new Map<string, string>();
  for (const office of offices) {
    map.set(office.id.toString(), office.name);
  }
  return map;
};

export const remapComplaintMasterIds = async () => {
  const batchSize = 10000;
  let lastId = 0;
  let totalMapped = 0;
  let totalUnmapped = 0;
  let totalUpdated = 0;
  let processed = 0;

  const lookups = await loadAllLookups();
  console.log('Master lookups loaded.');

  while (true) {
    const complaints = await prisma.complaint.findMany({
      where: { id: { gt: lastId } },
      select: {
        id: true,
        districtMasterId: true,
        policeStationMasterId: true,
        officeMasterId: true,
        districtName: true,
        addressDistrict: true,
        transferDistrictCd: true,
        submitPsCd: true,
        transferPsCd: true,
        addressPs: true,
        submitOfficeCd: true,
        branch: true,
      },
      take: batchSize,
      orderBy: { id: 'asc' },
    });

    if (complaints.length === 0) break;

    const updatePromises = [];
    for (const complaint of complaints) {
      const resolved = await resolveMasterIds(complaint, lookups);
      
      const hasChanged = 
        resolved.districtMasterId !== complaint.districtMasterId ||
        resolved.policeStationMasterId !== complaint.policeStationMasterId ||
        resolved.officeMasterId !== complaint.officeMasterId;

      if (hasChanged) {
        updatePromises.push(
          prisma.complaint.update({
            where: { id: complaint.id },
            data: resolved,
          })
        );
        totalUpdated++;
      }

      if (resolved.districtMasterId || resolved.policeStationMasterId || resolved.officeMasterId) {
        totalMapped++;
      } else {
        totalUnmapped++;
      }
      
      lastId = complaint.id;
    }

    if (updatePromises.length > 0) {
      // Run updates in sub-batches of 100 concurrently to avoid overloading Prisma connection pool
      for (let i = 0; i < updatePromises.length; i += 100) {
        await Promise.all(updatePromises.slice(i, i + 100));
      }
    }

    processed += complaints.length;
    console.log(`Processed ${processed} complaints... (Updated: ${totalUpdated})`);
  }

  return {
    total: processed,
    mapped: totalMapped,
    unmapped: totalUnmapped,
    updated: totalUpdated,
  };
};
