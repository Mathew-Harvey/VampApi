/** Shared vessel-type inference used by both the Rise-X importer and the
 *  one-off repair script. Kept in its own module so that importing it from
 *  the repair script does not trigger the importer's top-level main(). */

/** Map a free-text Rise-X vessel "type" string (e.g. "Container Ship",
 *  "Oil Products Tanker", "Offshore Subsea Construction and Maintenance Vessel")
 *  onto a VAMP vesselType enum key (as declared in
 *  VampWeb/src/constants/vessel-types.ts). Falls back to a name-based guess,
 *  then OTHER. */
export function inferVesselType(
  rawType: string | null | undefined,
  vesselName: string | null | undefined,
  isRan: boolean,
): string {
  const t = (rawType || '').toLowerCase();
  const n = (vesselName || '').toLowerCase();

  // Explicit naval classes first (applies to RAN / allied navy vessels).
  if (t.includes('submarine') || n.includes('submarine')) return 'NAVAL_SUBMARINE';
  if (t.includes('frigate')) return 'NAVAL_FRIGATE';
  if (t.includes('destroyer')) return 'NAVAL_DESTROYER';
  if (t.includes('patrol')) return 'NAVAL_PATROL';
  if (t.includes('landing') || t.includes('lhd') || t.includes('lpd')) return 'NAVAL_LANDING_SHIP';
  if (
    t.includes('replenish') ||
    t.includes('auxiliary') ||
    t.includes('oiler') ||
    t.includes('aor')
  ) return 'NAVAL_AUXILIARY';

  // Commercial / offshore classifications.
  if (t.includes('container')) return 'CONTAINER_SHIP';
  if (t.includes('bulk')) return 'BULK_CARRIER';
  if (
    t.includes('tanker') ||
    t.includes('product carrier') ||
    t.includes('chemical carrier') ||
    t.includes('lng') ||
    t.includes('lpg')
  ) return 'TANKER';
  if (
    t.includes('passenger') ||
    t.includes('cruise') ||
    t.includes('ferry') ||
    t.includes('yacht')
  ) return 'PASSENGER_VESSEL';
  if (t.includes('tug')) return 'TUG';
  if (t.includes('fishing') || t.includes('trawler')) return 'FISHING_VESSEL';
  if (t.includes('research') || t.includes('survey') || t.includes('scientific')) return 'RESEARCH_VESSEL';
  if (
    t.includes('beacon') ||
    t.includes('buoy') ||
    t.includes('nav aid') ||
    t.includes('navigation aid')
  ) return 'NAVIGATION_AID';
  if (
    t.includes('offshore') ||
    t.includes('subsea') ||
    t.includes('drill') ||
    t.includes('supply') ||
    t.includes('psv') ||
    t.includes('ahts') ||
    t.includes('construction vessel')
  ) return 'OFFSHORE_VESSEL';
  if (
    t.includes('heavy load') ||
    t.includes('heavy lift') ||
    t.includes('ro-ro') ||
    t.includes('roro') ||
    t.includes('general cargo') ||
    t.includes('cargo')
  ) return 'CARGO_SHIP';

  // Name-based heuristics for vessels missing a type string.
  if (n.includes('svitzer') || n.startsWith('tug ')) return 'TUG';
  if (n.startsWith('hmas ') || n.startsWith('hmnzs ') || n.startsWith('usns ') || n.startsWith('hms ')) {
    return 'NAVAL_FRIGATE';
  }

  // RAN fallback – at least land on a naval-shaped model.
  if (isRan) return 'NAVAL_FRIGATE';

  return 'OTHER';
}
