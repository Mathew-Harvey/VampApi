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

export const SUB_COMPONENT_TEMPLATES: Record<string, SubComponentTemplate[]> = {
  PROPELLER: [
    {
      templateName: 'Fixed Pitch (4 Blade)',
      subComponents: [
        { name: 'Blade 1', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 2', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 3', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 4', material: 'Nickel Aluminium Bronze' },
        { name: 'Hub', material: 'Nickel Aluminium Bronze' },
        { name: 'Shaft Seal', material: 'Stainless Steel' },
      ],
    },
    {
      templateName: 'Fixed Pitch (5 Blade)',
      subComponents: [
        { name: 'Blade 1', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 2', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 3', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 4', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 5', material: 'Nickel Aluminium Bronze' },
        { name: 'Hub', material: 'Nickel Aluminium Bronze' },
        { name: 'Shaft Seal', material: 'Stainless Steel' },
      ],
    },
    {
      templateName: 'Controllable Pitch (4 Blade)',
      subComponents: [
        { name: 'Blade 1', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 2', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 3', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 4', material: 'Nickel Aluminium Bronze' },
        { name: 'Hub Assembly', material: 'Nickel Aluminium Bronze' },
        { name: 'Pitch Control Mechanism', material: 'Stainless Steel' },
        { name: 'Shaft Seal', material: 'Stainless Steel' },
      ],
    },
    {
      templateName: 'Fixed Pitch (3 Blade)',
      subComponents: [
        { name: 'Blade 1', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 2', material: 'Nickel Aluminium Bronze' },
        { name: 'Blade 3', material: 'Nickel Aluminium Bronze' },
        { name: 'Hub', material: 'Nickel Aluminium Bronze' },
        { name: 'Shaft Seal', material: 'Stainless Steel' },
      ],
    },
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
    {
      templateName: 'Bow Thruster (Tunnel)',
      subComponents: [
        { name: 'Tunnel', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Propeller', material: 'Nickel Aluminium Bronze' },
        { name: 'Grid / Grating (Port)', material: 'Mild Steel' },
        { name: 'Grid / Grating (Starboard)', material: 'Mild Steel' },
        { name: 'Seal Assembly', material: 'Stainless Steel' },
      ],
    },
    {
      templateName: 'Stern Thruster (Tunnel)',
      subComponents: [
        { name: 'Tunnel', material: 'Mild Steel', coatingType: 'Anti-fouling' },
        { name: 'Propeller', material: 'Nickel Aluminium Bronze' },
        { name: 'Grid / Grating (Port)', material: 'Mild Steel' },
        { name: 'Grid / Grating (Starboard)', material: 'Mild Steel' },
        { name: 'Seal Assembly', material: 'Stainless Steel' },
      ],
    },
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
    {
      templateName: 'High Sea Chest',
      subComponents: [
        { name: 'External Grating', material: 'Mild Steel' },
        { name: 'Internal Grating', material: 'Mild Steel' },
        { name: 'Sea Chest Body', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
        { name: 'MGPS Anode', material: 'Copper' },
        { name: 'Isolation Valve', material: 'Bronze' },
      ],
    },
    {
      templateName: 'Low Sea Chest',
      subComponents: [
        { name: 'External Grating', material: 'Mild Steel' },
        { name: 'Internal Grating', material: 'Mild Steel' },
        { name: 'Sea Chest Body', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
        { name: 'MGPS Anode', material: 'Copper' },
        { name: 'Isolation Valve', material: 'Bronze' },
      ],
    },
    {
      templateName: 'Emergency Sea Chest',
      subComponents: [
        { name: 'External Grating', material: 'Mild Steel' },
        { name: 'Sea Chest Body', material: 'Mild Steel', coatingType: 'Anti-corrosive' },
        { name: 'Isolation Valve', material: 'Bronze' },
      ],
    },
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
    {
      templateName: 'Standard Anode Set',
      subComponents: [
        { name: 'Hull Anode 1 (Bow Port)', material: 'Zinc' },
        { name: 'Hull Anode 2 (Bow Starboard)', material: 'Zinc' },
        { name: 'Hull Anode 3 (Midship Port)', material: 'Zinc' },
        { name: 'Hull Anode 4 (Midship Starboard)', material: 'Zinc' },
        { name: 'Hull Anode 5 (Stern Port)', material: 'Zinc' },
        { name: 'Hull Anode 6 (Stern Starboard)', material: 'Zinc' },
        { name: 'Rudder Anode', material: 'Zinc' },
        { name: 'Propeller Shaft Anode', material: 'Zinc' },
      ],
    },
    {
      templateName: 'Aluminium Anode Set',
      subComponents: [
        { name: 'Hull Anode 1 (Bow Port)', material: 'Aluminium' },
        { name: 'Hull Anode 2 (Bow Starboard)', material: 'Aluminium' },
        { name: 'Hull Anode 3 (Midship Port)', material: 'Aluminium' },
        { name: 'Hull Anode 4 (Midship Starboard)', material: 'Aluminium' },
        { name: 'Hull Anode 5 (Stern Port)', material: 'Aluminium' },
        { name: 'Hull Anode 6 (Stern Starboard)', material: 'Aluminium' },
        { name: 'Rudder Anode', material: 'Aluminium' },
        { name: 'Propeller Shaft Anode', material: 'Aluminium' },
      ],
    },
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
