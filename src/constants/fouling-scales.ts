export type FoulingScale = 'LOF' | 'FR';

export interface FoulingScaleLevel {
  value: number;
  label: string;
  description: string;
  category?: string;
}

/**
 * Level of Fouling (LoF) — NZ CRMS biosecurity scale.
 * Ranks 0–5 measuring macrofouling presence on submerged surfaces.
 */
export const LOF_SCALE: FoulingScaleLevel[] = [
  { value: 0, label: 'Rank: 0', description: '0% No slime layer. No macrofouling. Only clean surfaces.' },
  { value: 1, label: 'Rank: 1', description: '0% Slime Layer on some or all surfaces. No macrofouling.' },
  { value: 2, label: 'Rank: 2', description: '1-5% of visible surfaces - Macrofouling present in small patches or a few isolated individuals or small colonies.' },
  { value: 3, label: 'Rank: 3', description: '6-15% of visible surfaces - Considerable macrofouling on surfaces.' },
  { value: 4, label: 'Rank: 4', description: '16-40% of visible surfaces - Extensive macrofouling present but more than half of surfaces without biofouling.' },
  { value: 5, label: 'Rank: 5', description: '41-100% of visible surfaces - Very heavy macrofouling present covering substantial portions of visible surfaces.' },
];

/**
 * Fouling Rating (FR) — RAN/USN naval scale.
 * FR 0–100 in increments of 10; soft fouling (0–30), hard fouling (40–90), composite (100).
 */
export const FR_SCALE: FoulingScaleLevel[] = [
  { value: 0,   label: 'FR: 0',   category: 'SOFT', description: 'A clean, foul-free surface; red and/or black AF paint or a bare metal surface.' },
  { value: 10,  label: 'FR: 10',  category: 'SOFT', description: 'Light shades of red and green (incipient slime). Bare metal and painted surfaces are visible beneath the fouling.' },
  { value: 20,  label: 'FR: 20',  category: 'SOFT', description: 'Slime as dark green patches with yellow or brown colored areas (advanced slime). Bare metal and painted surfaces may be obscured by the fouling.' },
  { value: 30,  label: 'FR: 30',  category: 'SOFT', description: 'Grass as filaments up to 3 inches in length, projections up to 1/4 inch in height; or a flat network of filaments; or soft non-calcareous fouling projecting up to 1/4 inch in height. Cannot be easily wiped off by hand.' },
  { value: 40,  label: 'FR: 40',  category: 'HARD', description: 'Calcareous fouling in the form of tubeworms less than 1/4 inch in diameter or height.' },
  { value: 50,  label: 'FR: 50',  category: 'HARD', description: 'Calcareous fouling in the form of barnacles less than 1/4 inch in diameter or height.' },
  { value: 60,  label: 'FR: 60',  category: 'HARD', description: 'Combination of tubeworms and barnacles, less than 1/4 inch in diameter or height.' },
  { value: 70,  label: 'FR: 70',  category: 'HARD', description: 'Combination of tubeworms and barnacles, greater than 1/4 inch in diameter or height.' },
  { value: 80,  label: 'FR: 80',  category: 'HARD', description: 'Tubeworms closely packed together and growing upright away from surface. Barnacles growing one on top of another, 1/4 inch or less in height. Calcareous shells appear clean or white in colour.' },
  { value: 90,  label: 'FR: 90',  category: 'HARD', description: 'Dense growth of tubeworms with barnacles, 1/4 inch or greater in height; Calcareous shells brown in colour (oysters and mussels); or with slime or grass overlay.' },
  { value: 100, label: 'FR: 100', category: 'COMPOSITE', description: 'All forms of fouling present, Soft and Hard, particularly soft sedentary animals without calcareous covering (tunicates) growing over various forms of hard growth.' },
];

export function getScaleLevels(scale: FoulingScale): FoulingScaleLevel[] {
  return scale === 'LOF' ? LOF_SCALE : FR_SCALE;
}

export function formatFoulingValue(value: number, scale: FoulingScale): string {
  if (scale === 'LOF') return `Rank: ${value}`;
  return `FR: ${value}`;
}

export function getFoulingScaleRange(scale: FoulingScale): { min: number; max: number; step: number } {
  if (scale === 'LOF') return { min: 0, max: 5, step: 1 };
  return { min: 0, max: 100, step: 10 };
}
