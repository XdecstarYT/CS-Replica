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

  // Grow the map outward (east + south), preserving every existing tile at its
  // original (x,y). All typed arrays are reallocated; index math changes because
  // the width changes, so callers must re-point any index-keyed caches.
  expand(addW, addH) {
    addW = addW | 0; addH = addH | 0;
    if (addW <= 0 && addH <= 0) return false;
    const ow = this.w, oh = this.h;
    const nw = ow + addW, nh = oh + addH;
    const n = nw * nh;
    const type = new Uint8Array(n).fill(TILE.GRASS);
    const level = new Uint8Array(n);
    const built = new Uint8Array(n);
    const service = new Array(n).fill(null);
    const pop = new Uint16Array(n);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const oi = y * ow + x, ni = y * nw + x;
        type[ni] = this.type[oi];
        level[ni] = this.level[oi];
        built[ni] = this.built ? this.built[oi] : this.level[oi];
        service[ni] = this.service[oi];
        pop[ni] = this.pop[oi];
      }
    }
    this.w = nw; this.h = nh;
    this.type = type; this.level = level; this.built = built;
    this.service = service; this.pop = pop;
    this.power = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.land = new Float32Array(n);
    this._extendTerrain(ow, oh);
    return { ow, oh, nw, nh };
  }

  // Scatter a little natural terrain (a lake) into the freshly added land so
  // new districts aren't a featureless plain. Only grass tiles are converted,
  // so nothing the player already built can be clobbered.
  _extendTerrain(ow, oh) {
    const lakes = [];
    if (this.w > ow) lakes.push([ow + (this.w - ow) * 0.55, this.h * 0.4, 4]);
    if (this.h > oh) lakes.push([this.w * 0.3, oh + (this.h - oh) * 0.55, 4]);
    for (const [cx, cy, r] of lakes) {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (!this.inBounds(x, y)) continue;
          if (x < ow && y < oh) continue;                    // never touch original area
          const i = this.idx(x, y);
          if (this.type[i] !== TILE.GRASS) continue;          // only fill empty grass
          if (Math.hypot(x - cx, y - cy) <= r + Math.sin(x + y) * 0.6) this.type[i] = TILE.WATER;
        }
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
