/* traffic.js — lightweight cosmetic traffic: little vehicles that wander the
 * road network. Purely visual life for the city; it does not feed the economy.
 * Original implementation. */

class Traffic {
  constructor(grid) {
    this.grid = grid;
    this.vehicles = [];
    this.roadTiles = [];   // cached [x,y] of every road tile
    this.palette = ['#e2e8f0', '#fca5a5', '#fcd34d', '#93c5fd', '#86efac', '#f0abfc'];
  }

  setGrid(grid) { this.grid = grid; this.vehicles.length = 0; this.roadTiles.length = 0; }

  // Rebuild the cached list of road tiles (call when roads may have changed).
  refreshRoads() {
    const g = this.grid;
    const out = this.roadTiles;
    out.length = 0;
    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] === TILE.ROAD) out.push([i % g.w, (i / g.w) | 0]);
    }
  }

  _roadNeighbors(x, y) {
    const g = this.grid, out = [];
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of d) {
      const nx = x + dx, ny = y + dy;
      if (g.inBounds(nx, ny) && g.type[g.idx(nx, ny)] === TILE.ROAD) out.push([nx, ny]);
    }
    return out;
  }

  _randomRoadTile() {
    if (!this.roadTiles.length) return null;
    return this.roadTiles[(Math.random() * this.roadTiles.length) | 0];
  }

  _spawn() {
    const start = this._randomRoadTile();
    if (!start) return false;
    const nbs = this._roadNeighbors(start[0], start[1]);
    if (!nbs.length) return false;
    const next = nbs[(Math.random() * nbs.length) | 0];
    this.vehicles.push({
      x: start[0], y: start[1],
      nx: next[0], ny: next[1],
      px: start[0], py: start[1],
      t: 0,
      speed: 1.6 + Math.random() * 1.4,
      color: this.palette[(Math.random() * this.palette.length) | 0],
    });
    return true;
  }

  // target count scales with population, capped for performance.
  sync(targetCount) {
    this.refreshRoads();
    if (!this.roadTiles.length) { this.vehicles.length = 0; return; }
    const want = Math.max(0, Math.min(140, targetCount | 0));
    let guard = want + 8;
    while (this.vehicles.length < want && guard-- > 0) { if (!this._spawn()) break; }
    if (this.vehicles.length > want) this.vehicles.length = want;
  }

  update(dt) {
    const g = this.grid;
    const step = dt / 1000;
    for (let k = this.vehicles.length - 1; k >= 0; k--) {
      const v = this.vehicles[k];
      // road removed under the vehicle? despawn.
      if (g.type[g.idx(v.x, v.y)] !== TILE.ROAD || g.type[g.idx(v.nx, v.ny)] !== TILE.ROAD) {
        this.vehicles.splice(k, 1);
        continue;
      }
      v.t += v.speed * step;
      while (v.t >= 1) {
        v.t -= 1;
        v.px = v.x; v.py = v.y;
        v.x = v.nx; v.y = v.ny;
        let nbs = this._roadNeighbors(v.x, v.y);
        // prefer not to immediately U-turn
        const fwd = nbs.filter(n => !(n[0] === v.px && n[1] === v.py));
        const pool = fwd.length ? fwd : nbs;
        if (!pool.length) { this.vehicles.splice(k, 1); v._dead = true; break; }
        const n = pool[(Math.random() * pool.length) | 0];
        v.nx = n[0]; v.ny = n[1];
      }
    }
  }
}
