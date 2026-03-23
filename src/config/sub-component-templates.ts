interface SubComponentDef {
  name: string;
  description?: string;
  material?: string;
  coatingType?: string;
}

interface SubComponentTemplate {
  templateName: string;
  subComponents: SubComponentDef[];
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function blades(count: number, material = 'Nickel Aluminium Bronze'): SubComponentDef[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Blade ${i + 1}`, material }));
}

function propellerTemplate(
  name: string,
  bladeCount: number,
  extras: SubComponentDef[] = [],
): SubComponentTemplate {
  return {
    templateName: name,
    subComponents: [...blades(bladeCount), ...extras],
  };
}

function anodeSet(material: string, name: string): SubComponentTemplate {
  const positions = [
    'Bow Port',
    'Bow Starboard',
    'Midship Port',
    'Midship Starboard',
    'Stern Port',
    'Stern Starboard',
  ];
  return {
    templateName: name,
    subComponents: [
      ...positions.map((pos, i) => ({ name: `Hull Anode ${i + 1} (${pos})`, material })),
      { name: 'Rudder Anode', material },
      { name: 'Propeller Shaft Anode', material },
    ],
  };
}

function tunnelThruster(location: 'Bow' | 'Stern'): SubComponentTemplate {
  return {
    templateName: `${location} Thruster (Tunnel)`,
    subComponents: [
      { name: 'Tunnel', material: 'Mild Steel', coatingType: 'Anti-fouling' },
      { name: 'Propeller', material: 'Nickel Aluminium Bronze' },
      { name: 'Grid / Grating (Port)', material: 'Mild Steel' },
      { name: 'Grid / Grating (Starboard)', material: 'Mild Steel' },
      { name: 'Seal Assembly', material: 'Stainless Steel' },
    ],
  };
}

function seaChest(
  name: string,
  subComponents: SubComponentDef[],
): SubComponentTemplate {
  return { templateName: name, subComponents };
}

// Shared sub-component lists used by multiple sea-chest templates
const seaChestCommon: SubComponentDef[] = [
  { name: 'External Grating', material: 'Mild Steel' },
  { name: 'Internal Grating', material: 'Mild Steel' },
  { name: 'Sea Chest Body', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
  { name: 'MGPS Anode', material: 'Copper' },
  { name: 'Isolation Valve', material: 'Bronze' },
];

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

export const SUB_COMPONENT_TEMPLATES: Record<string, SubComponentTemplate[]> = {
  PROPELLER: [
    propellerTemplate('Fixed Pitch (4 Blade)', 4, [
      { name: 'Hub', material: 'Nickel Aluminium Bronze' },
      { name: 'Shaft Seal', material: 'Stainless Steel' },
    ]),
    propellerTemplate('Fixed Pitch (5 Blade)', 5, [
      { name: 'Hub', material: 'Nickel Aluminium Bronze' },
      { name: 'Shaft Seal', material: 'Stainless Steel' },
    ]),
    propellerTemplate('Controllable Pitch (4 Blade)', 4, [
      { name: 'Hub Assembly', material: 'Nickel Aluminium Bronze' },
      { name: 'Pitch Control Mechanism', material: 'Stainless Steel' },
      { name: 'Shaft Seal', material: 'Stainless Steel' },
    ]),
    propellerTemplate('Fixed Pitch (3 Blade)', 3, [
      { name: 'Hub', material: 'Nickel Aluminium Bronze' },
      { name: 'Shaft Seal', material: 'Stainless Steel' },
    ]),
  ],

  RUDDER: [
    {
      templateName: 'Spade Rudder',
      subComponents: [
        { name: 'Rudder Blade', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Rudder Stock', material: 'Forged Steel' },
        { name: 'Pintle', material: 'Stainless Steel' },
        { name: 'Bearing', material: 'Composite' },
      ],
    },
    {
      templateName: 'Semi-balanced Rudder',
      subComponents: [
        { name: 'Rudder Blade', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Rudder Stock', material: 'Forged Steel' },
        { name: 'Upper Pintle', material: 'Stainless Steel' },
        { name: 'Lower Pintle', material: 'Stainless Steel' },
        { name: 'Skeg', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Upper Bearing', material: 'Composite' },
        { name: 'Lower Bearing', material: 'Composite' },
      ],
    },
    {
      templateName: 'Balanced Rudder',
      subComponents: [
        { name: 'Rudder Blade', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Rudder Stock', material: 'Forged Steel' },
        { name: 'Horn', material: 'Cast Steel' },
        { name: 'Upper Bearing', material: 'Composite' },
        { name: 'Lower Bearing', material: 'Composite' },
      ],
    },
  ],

  THRUSTER: [
    tunnelThruster('Bow'),
    tunnelThruster('Stern'),
    {
      templateName: 'Azimuth Thruster',
      subComponents: [
        { name: 'Propeller', material: 'Nickel Aluminium Bronze' },
        { name: 'Nozzle', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Steering Housing', material: 'Cast Steel' },
        { name: 'Seal Assembly', material: 'Stainless Steel' },
        { name: 'Anode', material: 'Zinc' },
      ],
    },
  ],

  SEA_CHEST: [
    seaChest('High Sea Chest', seaChestCommon),
    seaChest('Low Sea Chest', seaChestCommon),
    seaChest('Emergency Sea Chest', [
      { name: 'External Grating', material: 'Mild Steel' },
      { name: 'Sea Chest Body', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
      { name: 'Isolation Valve', material: 'Bronze' },
    ]),
  ],

  HULL: [
    {
      templateName: 'Standard Hull Zones',
      subComponents: [
        { name: 'Flat Bottom', coatingType: 'Anti-fouling' },
        { name: 'Vertical Side (Port)', coatingType: 'Anti-fouling' },
        { name: 'Vertical Side (Starboard)', coatingType: 'Anti-fouling' },
        { name: 'Boot Top (Port)', coatingType: 'Anti-fouling' },
        { name: 'Boot Top (Starboard)', coatingType: 'Anti-fouling' },
        { name: 'Bilge Keel (Port)', coatingType: 'Anti-fouling' },
        { name: 'Bilge Keel (Starboard)', coatingType: 'Anti-fouling' },
        { name: 'Bow Section', coatingType: 'Anti-fouling' },
        { name: 'Stern Section', coatingType: 'Anti-fouling' },
      ],
    },
    {
      templateName: 'Simplified Hull (3 Zones)',
      subComponents: [
        { name: 'Forward Hull', coatingType: 'Anti-fouling' },
        { name: 'Midship Hull', coatingType: 'Anti-fouling' },
        { name: 'Aft Hull', coatingType: 'Anti-fouling' },
      ],
    },
    {
      templateName: 'Port / Starboard Split',
      subComponents: [
        { name: 'Bottom (Port)', coatingType: 'Anti-fouling' },
        { name: 'Bottom (Starboard)', coatingType: 'Anti-fouling' },
        { name: 'Topside (Port)', coatingType: 'Anti-fouling' },
        { name: 'Topside (Starboard)', coatingType: 'Anti-fouling' },
        { name: 'Bow', coatingType: 'Anti-fouling' },
        { name: 'Stern', coatingType: 'Anti-fouling' },
      ],
    },
  ],

  KEEL: [
    {
      templateName: 'Standard Keel',
      subComponents: [
        { name: 'Keel Plate', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Keel Bar', material: 'Mild Steel' },
        { name: 'Bilge Keel (Port)', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Bilge Keel (Starboard)', material: 'Mild Steel', coatingType: 'Anti-fouling' },
      ],
    },
    {
      templateName: 'Flat Plate Keel',
      subComponents: [
        { name: 'Forward Keel Section', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Midship Keel Section', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Aft Keel Section', material: 'Mild Steel', coatingType: 'Anti-fouling' },
      ],
    },
  ],

  ANODES: [
    anodeSet('Zinc', 'Standard Anode Set'),
    anodeSet('Aluminium', 'Aluminium Anode Set'),
    {
      templateName: 'ICCP System',
      subComponents: [
        { name: 'Reference Electrode (Port)', material: 'Silver/Silver Chloride' },
        { name: 'Reference Electrode (Starboard)', material: 'Silver/Silver Chloride' },
        { name: 'Anode (Port Forward)', material: 'Titanium MMO' },
        { name: 'Anode (Port Aft)', material: 'Titanium MMO' },
        { name: 'Anode (Starboard Forward)', material: 'Titanium MMO' },
        { name: 'Anode (Starboard Aft)', material: 'Titanium MMO' },
      ],
    },
  ],

  INTAKE: [
    {
      templateName: 'Standard Intake',
      subComponents: [
        { name: 'Intake Grating', material: 'Mild Steel' },
        { name: 'Intake Chamber', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
        { name: 'Strainer', material: 'Stainless Steel' },
      ],
    },
    {
      templateName: 'Transducer Set',
      subComponents: [
        { name: 'Echo Sounder Transducer', material: 'Bronze', description: 'Depth sounding transducer' },
        { name: 'Speed Log Transducer', material: 'Bronze', description: 'Doppler / EM log sensor' },
        { name: 'Transducer Cofferdams', material: 'Mild Steel' },
      ],
    },
    {
      templateName: 'Intake + Transducers',
      subComponents: [
        { name: 'Intake Grating', material: 'Mild Steel' },
        { name: 'Intake Chamber', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
        { name: 'Strainer', material: 'Stainless Steel' },
        { name: 'Echo Sounder Transducer', material: 'Bronze' },
        { name: 'Speed Log Transducer', material: 'Bronze' },
        { name: 'Transducer Cofferdams', material: 'Mild Steel' },
      ],
    },
  ],
};
