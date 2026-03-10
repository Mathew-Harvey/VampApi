export interface InspectionField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'rating' | 'text' | 'textarea' | 'boolean';
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  defaultValue?: unknown;
}

export interface ComponentField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'textarea';
  options?: string[];
  required?: boolean;
}

export interface CategoryFieldConfig {
  label: string;
  inspectionFields: InspectionField[];
  componentFields: ComponentField[];
}

// ── Shared field fragments ──────────────────────────────────────────────

const conditionField = (options: string[]): InspectionField => ({
  key: 'condition', label: 'Condition', type: 'select', options,
});

const STANDARD_CONDITION = ['Good', 'Fair', 'Poor', 'Critical'];

const foulingFields: InspectionField[] = [
  { key: 'foulingRating', label: 'Fouling Rating', type: 'rating', min: 0, max: 5 },
  { key: 'foulingType', label: 'Fouling Type', type: 'select', options: ['None', 'Slime', 'Algae', 'Soft (Weed)', 'Hard (Barnacles)', 'Calcareous', 'Mixed'] },
  { key: 'coverage', label: 'Coverage %', type: 'number', min: 0, max: 100, unit: '%' },
];

const coatingField: InspectionField = {
  key: 'coatingCondition', label: 'Coating Condition', type: 'select',
  options: ['Intact', 'Minor Damage', 'Moderate Damage', 'Severe Damage', 'Failed'],
};

const corrosionFields: InspectionField[] = [
  { key: 'corrosionType', label: 'Corrosion Type', type: 'select', options: ['None', 'Surface', 'Pitting', 'Galvanic', 'Crevice'] },
  { key: 'corrosionSeverity', label: 'Corrosion Severity', type: 'select', options: ['None', 'Minor', 'Moderate', 'Severe'] },
];

const tailFields: InspectionField[] = [
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'recommendation', label: 'Recommendation', type: 'textarea' },
  { key: 'actionRequired', label: 'Action Required', type: 'boolean' },
];

// ── Per-category configuration ──────────────────────────────────────────

export const CATEGORY_FIELD_CONFIG: Record<string, CategoryFieldConfig> = {
  HULL: {
    label: 'Hull Section',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      ...foulingFields,
      coatingField,
      ...corrosionFields,
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'coatingType', label: 'Coating Type', type: 'select', options: ['Anti-fouling', 'Anti-corrosive', 'Silicone Foul-Release', 'Epoxy', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  ANODES: {
    label: 'Anode',
    inspectionFields: [
      conditionField(['Good', 'Fair', 'Poor', 'Depleted', 'Missing']),
      { key: 'measurementValue', label: 'Wastage %', type: 'number', min: 0, max: 100, unit: '%' },
      { key: 'measurementUnit', label: 'Unit', type: 'text', defaultValue: '%' },
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Zinc', 'Aluminium', 'Magnesium', 'Titanium MMO', 'Silver/Silver Chloride'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  PROPELLER: {
    label: 'Propeller',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      { key: 'coatingCondition', label: 'Surface Finish', type: 'select', options: ['Polished', 'Light Fouling', 'Roughened', 'Damaged'] },
      { key: 'corrosionType', label: 'Damage Type', type: 'select', options: ['None', 'Cavitation', 'Erosion', 'Impact', 'Grooving', 'Bent'] },
      { key: 'corrosionSeverity', label: 'Damage Severity', type: 'select', options: ['None', 'Minor', 'Moderate', 'Severe'] },
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Nickel Aluminium Bronze', 'Manganese Bronze', 'Stainless Steel', 'Composite'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  RUDDER: {
    label: 'Rudder',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      ...foulingFields,
      coatingField,
      { key: 'measurementValue', label: 'Clearance (mm)', type: 'number', min: 0, unit: 'mm' },
      ...corrosionFields,
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Mild Steel', 'Forged Steel', 'Cast Steel', 'Stainless Steel', 'Composite'] },
      { key: 'coatingType', label: 'Coating Type', type: 'select', options: ['Anti-fouling', 'Anti-corrosive', 'Epoxy', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  THRUSTER: {
    label: 'Thruster',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      ...foulingFields,
      coatingField,
      ...corrosionFields,
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Nickel Aluminium Bronze', 'Mild Steel', 'Stainless Steel'] },
      { key: 'coatingType', label: 'Coating Type', type: 'select', options: ['Anti-fouling', 'Anti-corrosive', 'Epoxy', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  SEA_CHEST: {
    label: 'Sea Chest',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      ...foulingFields,
      coatingField,
      ...corrosionFields,
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Mild Steel', 'Bronze', 'Stainless Steel', 'Copper'] },
      { key: 'coatingType', label: 'Coating Type', type: 'select', options: ['Anti-corrosive', 'Anti-fouling', 'Epoxy', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  KEEL: {
    label: 'Keel',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      ...foulingFields,
      coatingField,
      ...corrosionFields,
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Mild Steel', 'Cast Iron'] },
      { key: 'coatingType', label: 'Coating Type', type: 'select', options: ['Anti-fouling', 'Anti-corrosive', 'Epoxy', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },

  INTAKE: {
    label: 'Intake / Transducer',
    inspectionFields: [
      conditionField(STANDARD_CONDITION),
      ...foulingFields,
      coatingField,
      ...corrosionFields,
      ...tailFields,
    ],
    componentFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'material', label: 'Material', type: 'select', options: ['Mild Steel', 'Stainless Steel', 'Bronze'] },
      { key: 'coatingType', label: 'Coating Type', type: 'select', options: ['Anti-corrosive', 'Anti-fouling', 'Epoxy', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
};

const DEFAULT_CONFIG: CategoryFieldConfig = {
  label: 'Component',
  inspectionFields: [
    conditionField(STANDARD_CONDITION),
    ...foulingFields,
    coatingField,
    ...corrosionFields,
    ...tailFields,
  ],
  componentFields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'coatingType', label: 'Coating Type', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
  ],
};

export function getCategoryConfig(category: string): CategoryFieldConfig {
  return CATEGORY_FIELD_CONFIG[category] ?? DEFAULT_CONFIG;
}
