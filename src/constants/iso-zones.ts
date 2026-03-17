/**
 * ISO 6319:2026 Annex D — Ship Zone Mapping
 *
 * Defines the minimum 9 hull zones plus common niche area zones
 * for biofouling inspection reporting per ISO 6319:2026.
 */

export interface IsoZone {
  id: string;
  label: string;
  description: string;
  type: 'hull' | 'niche';
}

/**
 * The 9 minimum hull zones per ISO 6319:2026 Annex D.
 */
export const ISO_HULL_ZONES: IsoZone[] = [
  { id: 'BOOT_TOP_PORT', label: 'Boot Top (Port)', description: 'Boot top area on the port side', type: 'hull' },
  { id: 'BOOT_TOP_STBD', label: 'Boot Top (Starboard)', description: 'Boot top area on the starboard side', type: 'hull' },
  { id: 'VERTICAL_SIDE_PORT', label: 'Vertical Side (Port)', description: 'Vertical hull side on the port side below the boot top', type: 'hull' },
  { id: 'VERTICAL_SIDE_STBD', label: 'Vertical Side (Starboard)', description: 'Vertical hull side on the starboard side below the boot top', type: 'hull' },
  { id: 'FLAT_BOTTOM_FWD', label: 'Flat Bottom (Forward)', description: 'Flat bottom of the hull in the forward section', type: 'hull' },
  { id: 'FLAT_BOTTOM_MID', label: 'Flat Bottom (Midships)', description: 'Flat bottom of the hull in the midships section', type: 'hull' },
  { id: 'FLAT_BOTTOM_AFT', label: 'Flat Bottom (Aft)', description: 'Flat bottom of the hull in the aft section', type: 'hull' },
  { id: 'BILGE_KEEL_PORT', label: 'Bilge Keel (Port)', description: 'Bilge keel area on the port side', type: 'hull' },
  { id: 'BILGE_KEEL_STBD', label: 'Bilge Keel (Starboard)', description: 'Bilge keel area on the starboard side', type: 'hull' },
];

/**
 * Common niche area zones per ISO 6319:2026.
 */
export const ISO_NICHE_ZONES: IsoZone[] = [
  { id: 'NICHE_SEA_CHEST', label: 'Sea Chest(s)', description: 'Sea chest intake areas', type: 'niche' },
  { id: 'NICHE_BOW_THRUSTER', label: 'Bow Thruster', description: 'Bow thruster tunnel and grating', type: 'niche' },
  { id: 'NICHE_STERN_THRUSTER', label: 'Stern Thruster', description: 'Stern thruster tunnel and grating', type: 'niche' },
  { id: 'NICHE_PROPELLER', label: 'Propeller(s)', description: 'Propeller blades and hub', type: 'niche' },
  { id: 'NICHE_RUDDER', label: 'Rudder(s)', description: 'Rudder surfaces and hinge areas', type: 'niche' },
  { id: 'NICHE_KEEL', label: 'Keel / Skeg', description: 'Keel and skeg structures', type: 'niche' },
  { id: 'NICHE_ANODES', label: 'Anodes (ICCP/Sacrificial)', description: 'Cathodic protection anodes', type: 'niche' },
  { id: 'NICHE_ANCHOR', label: 'Anchor / Chain Locker', description: 'Anchor recesses and chain locker openings', type: 'niche' },
  { id: 'NICHE_ECHOSOUNDER', label: 'Echo Sounder Transducer', description: 'Echo sounder transducer wells', type: 'niche' },
  { id: 'NICHE_MGPS', label: 'MGPS', description: 'Marine Growth Protection System components', type: 'niche' },
  { id: 'NICHE_INTAKE_DISCHARGE', label: 'Intake / Discharge Grates', description: 'Cooling water and ballast intake/discharge grates', type: 'niche' },
  { id: 'NICHE_STABILISER', label: 'Stabiliser Fins', description: 'Stabiliser fin recesses and surfaces', type: 'niche' },
  { id: 'NICHE_DRY_DOCK_BLOCKS', label: 'Dry-dock Block Areas', description: 'Areas typically covered by dry-dock blocks', type: 'niche' },
];

/** All ISO zones combined. */
export const ISO_ZONES: IsoZone[] = [...ISO_HULL_ZONES, ...ISO_NICHE_ZONES];

/** Lookup an ISO zone by ID. */
export function getIsoZone(id: string): IsoZone | undefined {
  return ISO_ZONES.find((z) => z.id === id);
}

/** Get all ISO zone IDs. */
export function getIsoZoneIds(): string[] {
  return ISO_ZONES.map((z) => z.id);
}

/**
 * Smart pre-population: given a GA section/component name and category,
 * suggest the most likely ISO zone ID.
 */
export function suggestIsoZone(name: string, category?: string): string | null {
  const n = (name || '').toLowerCase();
  const c = (category || '').toLowerCase();

  // Niche area categories
  if (c === 'sea_chest' || n.includes('sea chest')) return 'NICHE_SEA_CHEST';
  if (c === 'propeller' || n.includes('propeller') || n.includes('prop')) return 'NICHE_PROPELLER';
  if (c === 'rudder' || n.includes('rudder')) return 'NICHE_RUDDER';
  if (c === 'thruster') {
    if (n.includes('stern') || n.includes('aft')) return 'NICHE_STERN_THRUSTER';
    return 'NICHE_BOW_THRUSTER';
  }
  if (n.includes('bow thruster')) return 'NICHE_BOW_THRUSTER';
  if (n.includes('stern thruster')) return 'NICHE_STERN_THRUSTER';
  if (c === 'keel' || n.includes('keel') || n.includes('skeg')) return 'NICHE_KEEL';
  if (c === 'anodes' || n.includes('anode') || n.includes('iccp')) return 'NICHE_ANODES';
  if (n.includes('anchor') || n.includes('chain locker')) return 'NICHE_ANCHOR';
  if (n.includes('echo sounder') || n.includes('transducer')) return 'NICHE_ECHOSOUNDER';
  if (n.includes('mgps') || n.includes('marine growth protection')) return 'NICHE_MGPS';
  if (n.includes('stabiliser') || n.includes('stabilizer')) return 'NICHE_STABILISER';
  if (n.includes('intake') || n.includes('discharge grate')) return 'NICHE_INTAKE_DISCHARGE';
  if (n.includes('dry dock') || n.includes('drydock') || n.includes('dock block')) return 'NICHE_DRY_DOCK_BLOCKS';

  // Hull zones
  if (n.includes('boot top')) {
    if (n.includes('port')) return 'BOOT_TOP_PORT';
    if (n.includes('starboard') || n.includes('stbd')) return 'BOOT_TOP_STBD';
    return 'BOOT_TOP_PORT'; // default port if unspecified
  }
  if (n.includes('vertical side') || n.includes('topsides')) {
    if (n.includes('port')) return 'VERTICAL_SIDE_PORT';
    if (n.includes('starboard') || n.includes('stbd')) return 'VERTICAL_SIDE_STBD';
    return 'VERTICAL_SIDE_PORT';
  }
  if (n.includes('flat bottom') || n.includes('hull bottom')) {
    if (n.includes('fwd') || n.includes('forward') || n.includes('fore')) return 'FLAT_BOTTOM_FWD';
    if (n.includes('aft') || n.includes('stern')) return 'FLAT_BOTTOM_AFT';
    return 'FLAT_BOTTOM_MID';
  }
  if (n.includes('bilge keel') || n.includes('bilge')) {
    if (n.includes('port')) return 'BILGE_KEEL_PORT';
    if (n.includes('starboard') || n.includes('stbd')) return 'BILGE_KEEL_STBD';
    return 'BILGE_KEEL_PORT';
  }

  // Hull category defaults to flat bottom midships
  if (c === 'hull') return 'FLAT_BOTTOM_MID';

  return null;
}

/**
 * ISO 6319:2026 Table B.1 — Water Visibility Conditions
 */
export const ISO_VISIBILITY_CONDITIONS = [
  { value: 'EXCELLENT', label: 'Excellent', description: 'Visibility > 5m, clear water, good lighting' },
  { value: 'GOOD', label: 'Good', description: 'Visibility 2–5m, minor turbidity' },
  { value: 'FAIR', label: 'Fair', description: 'Visibility 1–2m, moderate turbidity affecting assessment accuracy' },
  { value: 'POOR', label: 'Poor', description: 'Visibility < 1m, severe turbidity, assessment reliability reduced' },
] as const;

export type IsoVisibility = typeof ISO_VISIBILITY_CONDITIONS[number]['value'];

/**
 * ISO 6319:2026 Table A.3 — Anti-Fouling Coating (AFC) Failure Modes
 */
export const ISO_AFC_CONDITIONS = [
  { code: 'AFC-0', label: 'No Defects', description: 'Coating intact, no visible damage or deterioration' },
  { code: 'AFC-1', label: 'Chalking', description: 'Surface chalking or powdering of the coating' },
  { code: 'AFC-2', label: 'Cracking', description: 'Cracks visible in the coating film' },
  { code: 'AFC-3', label: 'Flaking / Peeling', description: 'Coating detaching from the substrate in flakes or sheets' },
  { code: 'AFC-4', label: 'Blistering', description: 'Raised areas (blisters) in the coating film' },
  { code: 'AFC-5', label: 'Mechanical Damage', description: 'Impact, abrasion, or scoring damage to the coating' },
  { code: 'AFC-6', label: 'Weld Seam Breakdown', description: 'Coating failure along weld lines or seams' },
  { code: 'AFC-7', label: 'Edge Breakdown', description: 'Coating failure at edges, corners, or protrusions' },
  { code: 'AFC-8', label: 'Total Loss', description: 'Complete loss of anti-fouling coating, bare substrate exposed' },
] as const;

/**
 * ISO 6319:2026 Table A.4 — MGPS Condition
 */
export const ISO_MGPS_CONDITIONS = [
  { code: 'MGPS-0', label: 'Operating Normally', description: 'MGPS functioning as designed, no issues observed' },
  { code: 'MGPS-1', label: 'Partially Effective', description: 'MGPS operating but with reduced effectiveness' },
  { code: 'MGPS-2', label: 'Anode Depleted', description: 'Sacrificial anode(s) significantly depleted or consumed' },
  { code: 'MGPS-3', label: 'Inoperative', description: 'MGPS not functioning or disconnected' },
  { code: 'MGPS-4', label: 'Not Fitted', description: 'No MGPS installed on this vessel' },
] as const;
