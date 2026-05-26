/**
 * Haryana Police Range → District name mapping.
 *
 * ⚠️  District names must exactly match what's stored in the `District` table
 *     (i.e. what appears in the portal's filter dropdown).
 *     If a name doesn't match the DB it will silently produce no filter.
 */

export const RANGE_DISTRICT_MAP: Record<string, string[]> = {
  ambala: ['Ambala', 'Kurukshetra', 'Yamuna Nagar', 'Panchkula', 'GRP Ambala Cantt'],
  karnal: ['Karnal', 'Kaithal', 'Panipat'],
  rohtak: ['Rohtak', 'Jhajjar', 'Sonipat', 'Charkhi Dadri'],
  hisar:  ['Hisar', 'Sirsa', 'Fatehabad', 'Jind', 'Hansi', 'Dabwali'],
  south:  ['Rewari', 'Mahendragarh', 'Palwal', 'Nuh'],
};

export const RANGE_LABELS: Record<string, string> = {
  ambala: 'Ambala Range',
  karnal: 'Karnal Range',
  rohtak: 'Rohtak Range',
  hisar:  'Hisar Range',
  south:  'South Range',
};

/** All defined range keys */
export const RANGE_IDS = Object.keys(RANGE_DISTRICT_MAP) as (keyof typeof RANGE_DISTRICT_MAP)[];

/**
 * Given a rangeId key and the full district list from the API,
 * returns the district IDs (as strings) whose names match the range mapping.
 */
export function resolveRangeDistrictIds(
  rangeId: string,
  allDistricts: Array<{ id: string; name: string }>
): string[] {
  const names = RANGE_DISTRICT_MAP[rangeId];
  if (!names || names.length === 0) return [];

  const nameSet = new Set(names.map((n) => n.trim().toLowerCase()));
  return allDistricts
    .filter((d) => nameSet.has(d.name.trim().toLowerCase()))
    .map((d) => d.id);
}
