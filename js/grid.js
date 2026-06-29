/* grid.js — the city map data model and terrain generation. */

class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.type = new Uint8Array(n);     // TILE.*
    this.level = new Uint8Array(n);    // target building level (0..3) for zoned tiles
    this.built = new Uint8Array(n);    // physically constructed level (lags `level` while building)
    this.service = new Array(n).fill(null); // service id string on SERVICE tiles
    this.pop = new Uint16Array(n);     // residents/jobs occupying this tile
    // per-tile cached coverage flags (recomputed by simulation)
    this.power = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.land = new Float32Array(n);   // land value 0..1
    this.generate();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  generate() {
    // Simple terrain: grass everywhere, a meandering river, a couple lakes.
    for (let i = 0; i < this.type.length; i++) this.type[i] = TILE.GRASS;

    // River: a sine-ish band crossing the map.
    const cx = this.w * 0.5;
    for (let y = 0; y < this.h; y++) {
      const rx = Math.round(cx + Math.sin(y / 7) * 6 + Math.sin(y / 3) * 2);
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx;
        if (this.inBounds(x, y)) this.type[this.idx(x, y)] = TILE.WATER;
      }
    }
    // A lake.
    this._blob(this.w * 0.78, this.h * 0.28, 5, TILE.WATER);
    this._blob(this.w * 0.2, this.h * 0.72, 4, TILE.WATER);
  }

  _blob(cx, cy, r, t) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r + Math.sin(x + y) * 0.6) this.type[this.idx(x, y)] = t;
      }
    }
  }

  isBuildable(x, y) {
    if (!this.inBounds(x, y)) return false;
    return this.type[this.idx(x, y)] !== TILE.WATER;
  }

  hasRoadAdjacent(x, y) {
    const d = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of d) {
      const nx = x + dx, ny = y + dy;
      if (this.inBounds(nx, ny) && this.type[this.idx(nx, ny)] === TILE.ROAD) return true;
    }
    return false;
  }

  serialize() {
    return {
      w: this.w, h: this.h,
      type: Array.from(this.type),
      level: Array.from(this.level),
      built: Array.from(this.built),
      service: this.service,
      pop: Array.from(this.pop),
    };
  }

  static deserialize(data) {
    const g = Object.create(Grid.prototype);
    g.w = data.w; g.h = data.h;
    const n = g.w * g.h;
    g.type = Uint8Array.from(data.type);
    g.level = Uint8Array.from(data.level);
    // Older saves predate staged construction: treat existing buildings as already built.
    g.built = data.built ? Uint8Array.from(data.built) : Uint8Array.from(data.level);
    g.service = data.service || new Array(n).fill(null);
    g.pop = Uint16Array.from(data.pop);
    g.power = new Uint8Array(n);
    g.water = new Uint8Array(n);
    g.land = new Float32Array(n);
    return g;
  }
}
