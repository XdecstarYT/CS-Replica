/* citizens.js — AI pedestrian movement simulation. */

class Citizens {
  constructor(grid) {
    this.grid = grid;
    this.citizens = [];
    this.roadTiles = [];
  }

  setGrid(grid) {
    this.grid = grid;
    this.citizens = [];
    this.roadTiles = [];
  }

  refreshRoads() {
    this.roadTiles = [];
    const g = this.grid;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.type[g.idx(x, y)] === TILE.ROAD) this.roadTiles.push({ x, y });
      }
    }
  }

  sync(population) {
    this.refreshRoads();
    if (!this.roadTiles.length) { this.citizens = []; return; }
    const target = Math.min(48, Math.floor(population / 10));
    while (this.citizens.length > target) this.citizens.pop();
    while (this.citizens.length < target) this._spawn();
  }

  _spawn() {
    const tile = this.roadTiles[Math.floor(Math.random() * this.roadTiles.length)];
    this.citizens.push({
      x: tile.x, y: tile.y,
      nx: tile.x, ny: tile.y,
      t: Math.random(),
      speed: 0.22 + Math.random() * 0.28,
      sidewalkSide: Math.random() < 0.5 ? 1 : -1,
    });
  }

  update(dt) {
    const g = this.grid;
    const s = dt / 1000;
    for (const c of this.citizens) {
      c.t += c.speed * s;
      if (c.t >= 1) {
        c.t -= 1;
        c.x = c.nx; c.y = c.ny;
        const opts = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx, dy]) => {
          const nx = c.x + dx, ny = c.y + dy;
          return g.inBounds(nx, ny) && g.type[g.idx(nx, ny)] === TILE.ROAD;
        });
        if (opts.length) {
          const [dx, dy] = opts[Math.floor(Math.random() * opts.length)];
          c.nx = c.x + dx; c.ny = c.y + dy;
        }
      }
    }
  }
}
