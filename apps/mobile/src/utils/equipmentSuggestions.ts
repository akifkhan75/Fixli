/** Suggested tools by catalog category name. Workers can also add their own. */
const BY_CATEGORY: Record<string, string[]> = {
  ELECTRICAL: [
    'Drill machine',
    'LT (line tester)',
    'Multimeter',
    'Wire stripper',
    'Pliers',
    'Screwdriver set',
    'Insulation tape',
    'Cable cutter',
  ],
  PLUMBING: [
    'Pipe wrench',
    'Plunger',
    'Pipe cutter',
    'Teflon tape',
    'Basin wrench',
    'Snake / auger',
    'Adjustable spanner',
  ],
  PAINTING: [
    'Spray paint gun',
    'Paint roller',
    'Paint brushes',
    'Ladder',
    'Drop sheets',
    'Sandpaper',
    'Putty knife',
  ],
  CARPENTRY: [
    'Drill machine',
    'Circular saw',
    'Hammer',
    'Chisel set',
    'Measuring tape',
    'Spirit level',
    'Clamps',
  ],
  HVAC: [
    'Gauge manifold',
    'Vacuum pump',
    'Multimeter',
    'Flaring tool',
    'Allen key set',
    'Leak detector',
  ],
  APPLIANCE_REPAIR: [
    'Multimeter',
    'Screwdriver set',
    'Pliers',
    'Soldering iron',
    'Nut driver set',
  ],
  CLEANING: [
    'Vacuum cleaner',
    'Pressure washer',
    'Mop & bucket',
    'Extension pole',
    'Steam cleaner',
  ],
  GENERAL_HANDYMAN: [
    'Drill machine',
    'Hammer',
    'Screwdriver set',
    'Pliers',
    'Measuring tape',
    'Spirit level',
    'Ladder',
  ],
  LOCKSMITH: [
    'Lock pick set',
    'Key cutting machine',
    'Drill machine',
    'Tension wrench',
  ],
  INSTALLATION: [
    'Drill machine',
    'Spirit level',
    'Measuring tape',
    'Screwdriver set',
    'Hammer drill',
  ],
  CONSTRUCTION: [
    'Drill machine',
    'Angle grinder',
    'Spirit level',
    'Measuring tape',
    'Wheelbarrow',
  ],
  RENOVATION: [
    'Drill machine',
    'Hammer',
    'Crowbar',
    'Paint roller',
    'Spirit level',
  ],
  MASONRY: [
    'Trowel',
    'Spirit level',
    'Mason hammer',
    'Mixer',
    'Measuring tape',
  ],
  FLOORING: [
    'Tile cutter',
    'Notched trowel',
    'Spirit level',
    'Rubber mallet',
    'Spacer set',
  ],
  WELDING: [
    'Welding machine',
    'Welding helmet',
    'Angle grinder',
    'Clamps',
    'Wire brush',
  ],
  ROOFING: [
    'Ladder',
    'Hammer',
    'Sealant gun',
    'Measuring tape',
    'Safety harness',
  ],
  SOLAR: [
    'Multimeter',
    'Drill machine',
    'Crimping tool',
    'Spirit level',
    'Cable cutter',
  ],
  INTERIOR: [
    'Drill machine',
    'Screwdriver set',
    'Spirit level',
    'Measuring tape',
    'Glass cutter',
  ],
};

const COMMON = ['Drill machine', 'Screwdriver set', 'Pliers', 'Measuring tape', 'Ladder', 'Hammer'];

/** Unique suggestions for the worker's selected skill categories. */
export function equipmentSuggestionsFor(categoryNames: string[]): string[] {
  const set = new Set<string>();
  for (const name of categoryNames) {
    for (const tool of BY_CATEGORY[name] ?? []) set.add(tool);
  }
  if (!set.size) for (const tool of COMMON) set.add(tool);
  return [...set];
}

export function normalizeEquipment(items: string[], max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const v = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
