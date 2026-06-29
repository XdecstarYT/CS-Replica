/* traffic.js — congestion-aware traffic with accidents & emergency response.
 *
 * Little vehicles wander the road graph (already lane-offset to the right by the
 * renderer). On top of that they now build a per-tile CONGESTION field, slow to
 * a crawl in jams, and occasionally CRASH — more likely where it's congested or
 * wet. A crash BLOCKS its tile, vehicles REROUTE around it, and an EMERGENCY
 * vehicle is dispatched to clear it. Average congestion feeds back into the city
 * (a happiness drag) and a green→red heatmap overlay.
 *
 * Original implementation. Public API unchanged: constructor(grid), setGrid,
 * refreshRoads, sync(targetCount), update(dt), plus .vehicles for the renderer.
 */

class Traffic {
  constructor(grid) {
    this.grid = grid;
    this.vehicles = [];
    this.roadTiles = [];   // cached [x,y] of every road tile
    this.palette = ['#e2e8f0', '#fca5a5', '#fcd34d', '#93c5fd', '#86efac', '#f0abfc'];
    this.blocked = new Set();     // tile indices blocked by an accident
    this.accidents = [];          // { i, x, y, timer, clearing }
    this.avgCongestion = 0;
    this.weatherSys = null;       // set by Game (for wet-road accident risk)
    this._accAccum = 0;
    this._allocFields();
  }

  _allocFields() {
    const n = this.grid.w * this.grid.h;
    this.congestion = new Float32Array(n);
    this._counts = new Float32Array(n);
    this.grid.congestion = this.congestion;   // exposed for overlay + other systems
  }

  setGrid(grid) {
    this.grid = grid;
    this.vehicles.length = 0; this.roadTiles.length = 0;
    this.blocked.clear(); this.accidents.length = 0; this._accAccum = 0;
    this._allocFields();
  }

  refreshRoads() {
    const g = this.grid, out = this.roadTiles;
    out.length = 0;
    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] === TILE.ROAD) out.push([i % g.w, (i / g.w) | 0]);
    }
  }

  _roadNeighbors(x, y, avoidBlocked) {
    const g = this.grid, out = [];
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of d) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny)) continue;
      const ni = g.idx(nx, ny);
      if (g.type[ni] !== TILE.ROAD) continue;
      if (avoidBlocked && this.blocked.has(ni)) continue;
      out.push([nx, ny]);
    }
    return out;
  }

  _randomRoadTile() {
    if (!this.roadTiles.length) return null;
    return this.roadTiles[(Math.random() * this.roadTiles.length) | 0];
  }

  _spawn(opts) {
    const start = this._randomRoadTile();
    if (!start) return false;
    const nbs = this._roadNeighbors(start[0], start[1], true);
    if (!nbs.length) return false;
    const next = nbs[(Math.random() * nbs.length) | 0];
    const v = {
      x: start[0], y: start[1], nx: next[0], ny: next[1], px: start[0], py: start[1],
      t: 0, speed: 1.6 + Math.random() * 1.4,
      color: this.palette[(Math.random() * this.palette.length) | 0],
    };
    if (opts && opts.emergency) { v.emergency = true; v.target = opts.target; v.speed = 3.4; }
    this.vehicles.push(v);
    return true;
  }

  // Civilian vehicle count tracks population; emergency units are kept separate.
  sync(targetCount) {
    this.refreshRoads();
    if (!this.roadTiles.length) { this.vehicles.length = 0; return; }
    const want = Math.max(0, Math.min(140, targetCount | 0));
    const civ = this.vehicles.filter(v => !v.emergency).length;
    let guard = want + 8;
    while (this.vehicles.filter(v => !v.emergency).length < want && guard-- > 0) { if (!this._spawn()) break; }
    if (civ > want) {
      // trim civilians from the front, keep emergency units
      let toRemove = civ - want;
      for (let k = 0; k < this.vehicles.length && toRemove > 0; k++) {
        if (!this.vehicles[k].emergency) { this.vehicles.splice(k, 1); k--; toRemove--; }
      }
    }
  }

  _wetness() {
    const w = this.weatherSys;
    if (!w) return 0;
    if (w.current === 'rain' || w.current === 'snow' || w.current === 'storm') return 0.5 + (w.intensity || 0.5) * 0.5;
    if (w.current === 'fog') return 0.3;
    return 0;
  }

  // Build the per-tile congestion field from current vehicle positions.
  _updateCongestion() {
    const g = this.grid, counts = this._counts, cong = this.congestion;
    counts.fill(0);
    for (const v of this.vehicles) {
      if (v.emergency) continue;
      const i = g.idx(v.x, v.y);
      counts[i] += 1;
      // a vehicle straddling two tiles also loads the one it's entering
      const ni = g.idx(v.nx, v.ny);
      counts[ni] += v.t;
    }
    let sum = 0, n = 0;
    for (const [x, y] of this.roadTiles) {
      const i = g.idx(x, y);
      let target = Math.min(1, counts[i] * 0.55);
      if (this.blocked.has(i)) target = 1;                // a blocked tile is maximally jammed
      cong[i] += (target - cong[i]) * 0.12;
      sum += cong[i]; n++;
    }
    this.avgCongestion = n ? sum / n : 0;
  }

  _maybeAccident(dtSec) {
    this._accAccum += dtSec;
    if (this._accAccum < 2) return;                       // check ~ every 2s
    this._accAccum = 0;
    if (this.accidents.length >= 3) return;
    const wet = this._wetness();
    const risk = this.avgCongestion * 0.05 + wet * 0.04 + 0.004;
    if (Math.random() > risk) return;
    // crash on a busy tile (bias toward the most congested)
    let pick = null, best = -1;
    for (let s = 0; s < 14; s++) {
      const rt = this._randomRoadTile(); if (!rt) break;
      const i = this.grid.idx(rt[0], rt[1]);
      if (this.blocked.has(i)) continue;
      const score = this.congestion[i] + Math.random() * 0.2;
      if (score > best) { best = score; pick = rt; }
    }
    if (!pick) return;
    const i = this.grid.idx(pick[0], pick[1]);
    this.blocked.add(i);
    this.accidents.push({ i, x: pick[0], y: pick[1], timer: 16, clearing: false });
    this._spawn({ emergency: true, target: { x: pick[0], y: pick[1] } });
  }

  _advanceAccidents(dtSec) {
    for (let k = this.accidents.length - 1; k >= 0; k--) {
      const a = this.accidents[k];
      a.timer -= dtSec * (a.clearing ? 3 : 1);            // emergency crew speeds clearance
      if (a.timer <= 0) {
        this.blocked.delete(a.i);
        this.accidents.splice(k, 1);
        // retire the emergency unit assigned here
        for (let j = this.vehicles.length - 1; j >= 0; j--) {
          const v = this.vehicles[j];
          if (v.emergency && v.target && v.target.x === a.x && v.target.y === a.y) this.vehicles.splice(j, 1);
        }
      }
    }
  }

  _accidentAt(x, y) {
    const i = this.grid.idx(x, y);
    return this.accidents.find(a => a.i === i) || null;
  }

  // Pick the next tile for a vehicle arriving at (x,y) coming from (px,py).
  _chooseNext(v) {
    const nbs = this._roadNeighbors(v.x, v.y, true);
    if (!nbs.length) return null;
    if (v.emergency && v.target) {
      // greedy toward the incident; clears it once adjacent
      const tx = v.target.x, ty = v.target.y;
      if (Math.abs(v.x - tx) + Math.abs(v.y - ty) <= 1) {
        const a = this._accidentAt(tx, ty); if (a) a.clearing = true;
      }
      let best = nbs[0], bestD = Infinity;
      for (const nb of nbs) {
        const d = Math.abs(nb[0] - tx) + Math.abs(nb[1] - ty);
        if (d < bestD) { bestD = d; best = nb; }
      }
      return best;
    }
    const fwd = nbs.filter(n => !(n[0] === v.px && n[1] === v.py));
    const pool = fwd.length ? fwd : nbs;
    return pool[(Math.random() * pool.length) | 0];
  }

  update(dt) {
    const g = this.grid;
    const step = dt / 1000;

    for (let k = this.vehicles.length - 1; k >= 0; k--) {
      const v = this.vehicles[k];
      const here = g.idx(v.x, v.y), next = g.idx(v.nx, v.ny);
      // road removed under the vehicle? despawn.
      if (g.type[here] !== TILE.ROAD || g.type[next] !== TILE.ROAD) { this.vehicles.splice(k, 1); continue; }
      // heading into a freshly-blocked tile? re-pick (civilians reroute).
      if (!v.emergency && this.blocked.has(next) && v.t < 0.5) {
        const alt = this._chooseNext(v);
        if (alt) { v.nx = alt[0]; v.ny = alt[1]; }
        else { continue; }                                // boxed in — idle this frame
      }
      // congestion slows everyone (stop-and-go); emergency units bull through.
      const cong = this.congestion[next];
      const slow = v.emergency ? 1 : (1 - cong * 0.7);
      v.t += v.speed * step * Math.max(0.12, slow);

      while (v.t >= 1) {
        v.t -= 1;
        v.px = v.x; v.py = v.y; v.x = v.nx; v.y = v.ny;
        const nxt = this._chooseNext(v);
        if (!nxt) { this.vehicles.splice(k, 1); break; }
        v.nx = nxt[0]; v.ny = nxt[1];
      }
    }

    this._updateCongestion();
    this._advanceAccidents(step);
    this._maybeAccident(step);
  }
}
