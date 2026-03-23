/**
 * Paint Deterioration Rating (PDR) Scale
 * Industry-standard numeric scale (0–100) for assessing anti-fouling
 * and anti-corrosive coating condition on submerged vessel surfaces.
 */

export interface PdrScaleLevel {
  value: number;
  label: string;
  description: string;
  category: 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
}

export const PDR_SCALE: PdrScaleLevel[] = [
  {
    value: 0,
    label: 'PDR: 0',
    category: 'GOOD',
    description: 'No anti-foul (AF) coating applied.',
  },
  {
    value: 10,
    label: 'PDR: 10',
    category: 'GOOD',
    description: 'Anti-Foul (AF) Paint intact.',
  },
  {
    value: 20,
    label: 'PDR: 20',
    category: 'GOOD',
    description: 'AF paint missing from edges, corners, seams, welds, rivet or bolt heads to expose anti corrosion (AC) paint (undercoat).',
  },
  {
    value: 30,
    label: 'PDR: 30',
    category: 'FAIR',
    description: 'AF paint missing from slightly curved or flat areas to expose underlying AC paint; visible brush swirl marks within the outermost layer.',
  },
  {
    value: 40,
    label: 'PDR: 40',
    category: 'FAIR',
    description: 'AF paint missing from intact blisters to expose AC paint or an AF coating with visible brush swirl marks exposing the next underlying layer.',
  },
  {
    value: 50,
    label: 'PDR: 50',
    category: 'POOR',
    description: 'AF blisters ruptured to expose intact AC paint.',
  },
  {
    value: 60,
    label: 'PDR: 60',
    category: 'POOR',
    description: 'AF/AC paint missing or peeling to expose steel substrate, no corrosion present.',
  },
  {
    value: 70,
    label: 'PDR: 70',
    category: 'CRITICAL',
    description: 'AF/AC paint removed from edges, corners, seams, welds, rivet or bolt heads to expose steel substrate with corrosion present.',
  },
  {
    value: 80,
    label: 'PDR: 80',
    category: 'CRITICAL',
    description: 'Ruptured AF/AC blisters on slightly curved or flat surfaces with corrosion or corrosion stains present.',
  },
  {
    value: 90,
    label: 'PDR: 90',
    category: 'CRITICAL',
    description: 'Area corrosion of steel substrate with no AF/AC paint cover due to peeling or abrasion damage.',
  },
  {
    value: 100,
    label: 'PDR: 100',
    category: 'CRITICAL',
    description: 'Area corrosion showing visible surface evidence of pitting, scaling, and roughening of steel substrate.',
  },
];

export function getPdrLevel(value: number): PdrScaleLevel | undefined {
  return PDR_SCALE.find((l) => l.value === value);
}

export function formatPdrValue(value: number): string {
  const level = getPdrLevel(value);
  if (level) return `${level.label} | ${level.description}`;
  return `PDR: ${value}`;
}

export function formatPdrLabel(value: number): string {
  return `PDR: ${value}`;
}

export function getPdrScaleRange(): { min: number; max: number; step: number } {
  return { min: 0, max: 100, step: 10 };
}
