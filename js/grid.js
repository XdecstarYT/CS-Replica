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
    this.resource = new Uint8Array(n); // RESOURCE.* natural deposit under the tile
    this.generate();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  generate() {
    // Grass everywhere, with water kept to the EDGES so the centre — where the
    // camera starts and players build first — is always clear, buildable land.
    for (let i = 0; i < this.type.length; i++) this.type[i] = TILE.GRASS;
    const W = this.w, H = this.h;

    // A coastal river hugging one side (offset well away from centre) that
    // wanders only within the outer ~22% of the map.
    const edge = Math.max(3, Math.round(W * 0.14));
    for (let y = 0; y < H; y++) {
      const rx = Math.round(edge + Math.sin(y / 8) * 3 + Math.sin(y / 3) * 1.2);
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx;
        if (this.inBounds(x, y) && x < W * 0.24) this.type[this.idx(x, y)] = TILE.WATER;
      }
    }
    // Corner lakes only.
    this._blob(W * 0.88, H * 0.14, 4, TILE.WATER);
    this._blob(W * 0.90, H * 0.86, 4, TILE.WATER);

    this._genResources();
  }

  // Scatter natural-resource deposits across grass tiles as a few clustered
  // fields per type. Deposits sit under the terrain and never block building.
  _genResources() {
    if (!this.resource) this.resource = new Uint8Array(this.w * this.h);
    this.resource.fill(RESOURCE.NONE);
    const kinds = [RESOURCE.ORE, RESOURCE.OIL, RESOURCE.FOREST, RESOURCE.FARM, RESOURCE.COAL];
    const fields = Math.max(6, Math.round((this.w * this.h) / 500));
    for (let f = 0; f < fields; f++) {
      const kind = kinds[(Math.random() * kinds.length) | 0];
      const cx = 2 + Math.random() * (this.w - 4);
      const cy = 2 + Math.random() * (this.h - 4);
      const r = 2 + Math.random() * 3;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (!this.inBounds(x, y)) continue;
          const i = this.idx(x, y);
          if (this.type[i] === TILE.WATER) continue;
          if (Math.hypot(x - cx, y - cy) <= r * (0.7 + Math.random() * 0.4)) this.resource[i] = kind;
        }
      }
    }
  }

  // Best resource at/near a tile (radius 1) → { kind, meta } or null.
  resourceNear(x, y) {
    let best = RESOURCE.NONE;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const r = this.resource[this.idx(nx, ny)];
      if (r && (dx === 0 && dy === 0 ? true : best === RESOURCE.NONE)) best = r;
    }
    return best;
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
    const resource = new Uint8Array(n);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const oi = y * ow + x, ni = y * nw + x;
        type[ni] = this.type[oi];
        level[ni] = this.level[oi];
        built[ni] = this.built ? this.built[oi] : this.level[oi];
        service[ni] = this.service[oi];
        pop[ni] = this.pop[oi];
        if (this.resource) resource[ni] = this.resource[oi];
      }
    }
    this.w = nw; this.h = nh;
    this.type = type; this.level = level; this.built = built;
    this.service = service; this.pop = pop; this.resource = resource;
    this.power = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.land = new Float32Array(n);
    this._extendTerrain(ow, oh);
    this._seedResourcesIn(ow, oh);
    return { ow, oh, nw, nh };
  }

  // Seed fresh resource fields into newly-added land only.
  _seedResourcesIn(ow, oh) {
    const kinds = [RESOURCE.ORE, RESOURCE.OIL, RESOURCE.FOREST, RESOURCE.FARM, RESOURCE.COAL];
    const newFields = Math.max(3, Math.round(((this.w * this.h) - (ow * oh)) / 500));
    for (let f = 0; f < newFields; f++) {
      const kind = kinds[(Math.random() * kinds.length) | 0];
      const cx = Math.random() * this.w, cy = Math.random() * this.h;
      const r = 2 + Math.random() * 3;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!this.inBounds(x, y) || (x < ow && y < oh)) continue;   // new land only
        const i = this.idx(x, y);
        if (this.type[i] === TILE.WATER) continue;
        if (Math.hypot(x - cx, y - cy) <= r * (0.7 + Math.random() * 0.4)) this.resource[i] = kind;
      }
    }
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
      resource: this.resource ? Array.from(this.resource) : null,
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
    g.resource = data.resource ? Uint8Array.from(data.resource) : new Uint8Array(n);
    // Old saves have no resources: generate a fresh deposit map for them.
    if (!data.resource) g._genResources();
    return g;
  }
}
