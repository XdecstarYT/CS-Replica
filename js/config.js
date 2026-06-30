/* config.js — game constants, tile types, and building definitions.
 * Original work: an open city-builder inspired by the genre, not derived
 * from any proprietary game's code or assets. */

const CONFIG = {
  GRID_W: 64,
  GRID_H: 64,
  TILE: 48,                 // base tile size in world px
  MIN_ZOOM: 0.35,
  MAX_ZOOM: 2.5,
  START_MONEY: 50000,
  TICK_MS: 1000,            // one simulation step (1 game week) per second at 1x
  SPEEDS: [0, 1, 2, 4],     // pause, normal, fast, fastest
  AUTOSAVE_KEY: 'metropolis_save_v1',
};

// Tile content categories
const TILE = {
  EMPTY: 0,
  GRASS: 1,
  WATER: 2,
  ROAD: 3,
  ZONE_RES: 4,
  ZONE_COM: 5,
  ZONE_IND: 6,
  BUILDING: 7,   // grown building on a zoned tile (level tracked separately)
  SERVICE: 8,    // a placed service building
};

const ZONE_OF = {
  'zone-res': TILE.ZONE_RES,
  'zone-com': TILE.ZONE_COM,
  'zone-ind': TILE.ZONE_IND,
};

// Service / civic buildings the player can place.
const SERVICES = [
  { id: 'power',   name: 'Power Plant', ico: '⚡', cost: 4000, upkeep: 120, range: 9,  power: 220, water: 0,   pollution: 20, color: '#facc15' },
  { id: 'wind',    name: 'Wind Farm',   ico: '🌬', cost: 6000, upkeep: 80,  range: 8,  power: 120, water: 0,  pollution: 0,  color: '#a5f3fc' },
  { id: 'water',   name: 'Water Tower', ico: '💧', cost: 3000, upkeep: 90,  range: 9,  power: 0,   water: 200, pollution: 0,  color: '#38bdf8' },
  { id: 'police',  name: 'Police',      ico: '🚓', cost: 3500, upkeep: 130, range: 10, safety: 1, color: '#60a5fa' },
  { id: 'fire',    name: 'Fire Dept',   ico: '🚒', cost: 3500, upkeep: 130, range: 10, safety: 1, color: '#ef4444' },
  { id: 'health',  name: 'Clinic',      ico: '🏥', cost: 4000, upkeep: 150, range: 10, health: 1, color: '#f87171' },
  { id: 'hospital', name: 'Hospital',   ico: '🏨', cost: 9000, upkeep: 320, range: 16, health: 2, color: '#ef5350' },
  { id: 'school',  name: 'School',      ico: '🏫', cost: 4500, upkeep: 160, range: 11, education: 1, color: '#c084fc' },
  { id: 'park',       name: 'Park',        ico: '🌳', cost: 1200,  upkeep: 30,  range: 6,  happy: 1, color: '#4ade80' },
  { id: 'datacenter', name: 'Data Center', ico: '🖥', cost: 8000,  upkeep: 280, range: 8,  education: 1, color: '#0a1a50' },
  { id: 'aihub',      name: 'AI Hub',      ico: '🤖', cost: 15000, upkeep: 500, range: 14, happy: 1, education: 1, color: '#0044ff' },

  // ── Education ──
  { id: 'university',  name: 'University',     ico: '🎓', cost: 16000, upkeep: 520, range: 16, education: 2, happy: 1, color: '#7c3aed' },
  { id: 'college',     name: 'Community College', ico: '🏫', cost: 8000, upkeep: 280, range: 13, education: 2, color: '#8b5cf6' },
  { id: 'library',     name: 'Library',       ico: '📚', cost: 3500,  upkeep: 110, range: 10, education: 1, happy: 1, color: '#a78bfa' },
  { id: 'daycare',     name: 'Daycare',       ico: '🧸', cost: 2500,  upkeep: 90,  range: 8,  education: 1, happy: 1, color: '#f9a8d4' },
  { id: 'researchlab', name: 'Research Lab',  ico: '🔬', cost: 12000, upkeep: 420, range: 11, education: 2, color: '#6366f1' },
  { id: 'observatory', name: 'Observatory',   ico: '🔭', cost: 9000,  upkeep: 240, range: 12, education: 1, happy: 1, color: '#312e81' },

  // ── Culture & leisure (many earn tourism revenue) ──
  { id: 'museum',      name: 'Museum',        ico: '🏛️', cost: 9000,  upkeep: 300, range: 12, happy: 1, education: 1, revenue: 90,  color: '#b45309' },
  { id: 'artgallery',  name: 'Art Gallery',   ico: '🖼️', cost: 5000,  upkeep: 160, range: 9,  happy: 1, revenue: 60,  color: '#be185d' },
  { id: 'theater',     name: 'Theater',       ico: '🎭', cost: 6000,  upkeep: 200, range: 10, happy: 1, revenue: 110, color: '#9d174d' },
  { id: 'cinema',      name: 'Cinema',        ico: '🎬', cost: 5500,  upkeep: 180, range: 9,  happy: 1, revenue: 140, color: '#7f1d1d' },
  { id: 'stadium',     name: 'Stadium',       ico: '🏟️', cost: 22000, upkeep: 700, range: 16, happy: 2, revenue: 360, color: '#15803d' },
  { id: 'arena',       name: 'Arena',         ico: '🏀', cost: 18000, upkeep: 600, range: 14, happy: 2, revenue: 300, color: '#166534' },
  { id: 'mall',        name: 'Shopping Mall', ico: '🛍️', cost: 14000, upkeep: 460, range: 13, happy: 1, revenue: 280, color: '#0e7490' },
  { id: 'market',      name: 'Farmers Market',ico: '🥕', cost: 2000,  upkeep: 60,  range: 8,  happy: 1, revenue: 90,  color: '#65a30d' },
  { id: 'zoo',         name: 'Zoo',           ico: '🦁', cost: 13000, upkeep: 440, range: 14, happy: 1, revenue: 220, color: '#a16207' },
  { id: 'aquarium',    name: 'Aquarium',      ico: '🐠', cost: 12000, upkeep: 420, range: 13, happy: 1, revenue: 220, color: '#0891b2' },
  { id: 'amusement',   name: 'Amusement Park',ico: '🎡', cost: 20000, upkeep: 650, range: 15, happy: 2, revenue: 380, color: '#db2777' },
  { id: 'casino',      name: 'Casino',        ico: '🎰', cost: 17000, upkeep: 540, range: 12, happy: 1, revenue: 460, color: '#b91c1c' },
  { id: 'convention',  name: 'Convention Ctr',ico: '🏢', cost: 15000, upkeep: 500, range: 13, happy: 1, revenue: 320, color: '#1e40af' },
  { id: 'botanical',   name: 'Botanical Garden', ico: '🌺', cost: 6000, upkeep: 180, range: 11, happy: 1, color: '#16a34a' },
  { id: 'communityctr',name: 'Community Center', ico: '🏘️', cost: 4000, upkeep: 130, range: 10, happy: 1, color: '#0d9488' },
  { id: 'fountain',    name: 'Plaza Fountain', ico: '⛲', cost: 1500,  upkeep: 40,  range: 6,  happy: 1, color: '#38bdf8' },
  { id: 'gym',         name: 'Sports Gym',    ico: '🏋️', cost: 3500,  upkeep: 120, range: 9,  happy: 1, health: 1, color: '#ea580c' },
  { id: 'cemetery',    name: 'Cemetery',      ico: '🪦', cost: 3000,  upkeep: 80,  range: 8,  happy: 1, color: '#52525b' },

  // ── Health & safety ──
  { id: 'ambulance',   name: 'Ambulance Depot', ico: '🚑', cost: 4000, upkeep: 150, range: 12, health: 1, color: '#ef4444' },
  { id: 'pharmacy',    name: 'Pharmacy',      ico: '💊', cost: 2500,  upkeep: 80,  range: 8,  health: 1, color: '#22c55e' },
  { id: 'dentist',     name: 'Dental Clinic', ico: '🦷', cost: 3000,  upkeep: 100, range: 8,  health: 1, color: '#06b6d4' },
  { id: 'sewage',      name: 'Sewage Plant',  ico: '🚽', cost: 6000,  upkeep: 200, range: 12, health: 1, pollution: 8, color: '#78716c' },
  { id: 'policehq',    name: 'Police HQ',     ico: '🚔', cost: 9000,  upkeep: 320, range: 16, safety: 2, color: '#1d4ed8' },
  { id: 'firehq',      name: 'Fire HQ',       ico: '🚒', cost: 9000,  upkeep: 320, range: 16, safety: 1, color: '#dc2626' },
  { id: 'courthouse',  name: 'Courthouse',    ico: '⚖️', cost: 11000, upkeep: 360, range: 14, safety: 1, happy: 1, color: '#92400e' },
  { id: 'prison',      name: 'Prison',        ico: '🔒', cost: 13000, upkeep: 480, range: 14, safety: 2, color: '#44403c' },

  // ── Power generation ──
  { id: 'solar',       name: 'Solar Farm',    ico: '☀️', cost: 9000,  upkeep: 100, range: 9,  power: 160, pollution: 0,  color: '#f59e0b' },
  { id: 'hydro',       name: 'Hydro Dam',     ico: '🌊', cost: 16000, upkeep: 160, range: 11, power: 320, pollution: 0,  color: '#0ea5e9' },
  { id: 'geothermal',  name: 'Geothermal',    ico: '🌋', cost: 12000, upkeep: 150, range: 10, power: 200, pollution: 2,  color: '#b91c1c' },
  { id: 'nuclear',     name: 'Nuclear Plant', ico: '☢️', cost: 30000, upkeep: 600, range: 13, power: 700, pollution: 6,  color: '#65a30d' },
  { id: 'gasplant',    name: 'Gas Plant',     ico: '🔥', cost: 7000,  upkeep: 180, range: 9,  power: 240, pollution: 16, color: '#f97316' },
  { id: 'coalplant',   name: 'Coal Plant',    ico: '🏭', cost: 6000,  upkeep: 140, range: 9,  power: 300, pollution: 40, color: '#57534e' },
  { id: 'substation',  name: 'Substation',    ico: '🔌', cost: 2500,  upkeep: 60,  range: 11, power: 120, pollution: 0,  color: '#eab308' },

  // ── Water ──
  { id: 'reservoir',   name: 'Reservoir',     ico: '💦', cost: 7000,  upkeep: 120, range: 12, water: 400, color: '#2563eb' },
  { id: 'watertreat',  name: 'Water Treatment', ico: '🚰', cost: 5000, upkeep: 160, range: 10, water: 250, health: 1, color: '#0284c7' },
  { id: 'desalination',name: 'Desalination',  ico: '🌊', cost: 11000, upkeep: 300, range: 11, water: 320, color: '#0369a1' },

  // ── Transport hubs ──
  { id: 'busdepot',    name: 'Bus Depot',     ico: '🚌', cost: 5000,  upkeep: 200, range: 12, happy: 1, color: '#ca8a04' },
  { id: 'metro',       name: 'Metro Station', ico: '🚇', cost: 12000, upkeep: 380, range: 14, happy: 1, color: '#0f766e' },
  { id: 'trainstation',name: 'Train Station', ico: '🚉', cost: 14000, upkeep: 420, range: 14, happy: 1, revenue: 120, color: '#7e22ce' },
  { id: 'airport',     name: 'Airport',       ico: '✈️', cost: 35000, upkeep: 900, range: 18, happy: 2, revenue: 640, pollution: 12, color: '#475569' },
  { id: 'seaport',     name: 'Seaport',       ico: '⚓', cost: 28000, upkeep: 700, range: 15, revenue: 520, pollution: 10, color: '#1e3a8a' },
  { id: 'telecom',     name: 'Telecom Tower', ico: '📡', cost: 8000,  upkeep: 240, range: 18, education: 1, happy: 1, color: '#334155' },
  { id: 'recycling',   name: 'Recycling Center', ico: '♻️', cost: 6000, upkeep: 180, range: 12, health: 1, color: '#16a34a' },
];

const SERVICE_BY_ID = Object.fromEntries(SERVICES.map(s => [s.id, s]));

// Per-level capacities for grown buildings.
// Level 4 = megatower / megablock tier (dense downtown cores). Capacities were
// substantially raised in the population overhaul so a mature metropolis can
// reach hundreds of thousands of residents and jobs.
const BUILDING_LEVELS = {
  [TILE.ZONE_RES]: [{ cap: 0 }, { cap: 20 }, { cap: 52 }, { cap: 120 }, { cap: 240 }],
  [TILE.ZONE_COM]: [{ cap: 0 }, { cap: 14 }, { cap: 40 }, { cap: 95 },  { cap: 195 }],
  [TILE.ZONE_IND]: [{ cap: 0 }, { cap: 16 }, { cap: 46 }, { cap: 92 },  { cap: 180 }],
};

const MAX_LEVEL = 4;   // highest building level a zone can grow to

const TAX_PER_CAPITA = 1.4;          // weekly revenue per employed/housed citizen
const UPKEEP_PER_ROAD = 0.05;        // weekly road maintenance per tile
