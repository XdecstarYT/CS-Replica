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
