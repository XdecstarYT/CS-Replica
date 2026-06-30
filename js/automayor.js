/* automayor.js — the autonomous government city-builder (Observer Mode).
 *
 * When the player chooses to *observe* rather than govern, the elected
 * administration builds the city itself. Each simulation week the AutoMayor
 * spends a slice of the treasury to extend roads, zone land, wire up utilities
 * and place civic services — and it does so in the STYLE of whoever is in
 * power. A growth/business coalition lays down industry and commercial cores
 * aggressively; a green coalition favours parks, housing and restraint; an
 * authoritarian one over-invests in police and fire.
 *
 * It only ever uses the same primitive operations the player has (place road,
 * zone tile, build service) and respects the budget, so the city it produces is
 * a genuine product of the simulation, not a script.
 */

function amClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

class AutoMayor {
  constructor(game) {
    this.game = game;
    this._lastWeek = -1;
    this._seeded = false;
    this.actionsLog = [];        // recent decisions, surfaced in the observer HUD
  }

  reset() { this._lastWeek = -1; this._seeded = false; this.actionsLog.length = 0; }

  _log(msg) {
    this.actionsLog.unshift({ week: this.game.sim.week, msg });
    if (this.actionsLog.length > 12) this.actionsLog.pop();
  }

  // Ideology of the ruling coalition → concrete building biases.
  _prefs() {
    const gov = this.game.gov;
    const v = (gov && gov._coalitionVec) ? gov._coalitionVec() : { econ: 0, env: 0, auth: 0, social: 0, nat: 0 };
    return {
      vec: v,
      ind:    amClamp(0.55 + v.econ * 0.45 - v.env * 0.40, 0.22, 1.1),
      com:    amClamp(0.70 + v.econ * 0.30 - v.env * 0.10, 0.25, 1.1),
      res:    amClamp(0.80 - v.econ * 0.10 + v.env * 0.20 + v.social * 0.1, 0.40, 1.2),
      park:   amClamp(0.40 + v.env * 0.65 + v.social * 0.20, 0.10, 1.1),
      safety: amClamp(0.45 + v.auth * 0.55, 0.10, 1.1),
      edu:    amClamp(0.45 + v.social * 0.4 - v.auth * 0.1, 0.15, 1.0),
      reserve: Math.round(4000 + (0.5 - v.econ * 0.3) * 6000),   // cautious govts hold more cash
    };
  }

  // ── Geometry helpers ──
  _center() {
    // Centre of the currently developed area (roads/zones), else map centre.
    const g = this.game.grid; let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t === TILE.ROAD || t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND || t === TILE.SERVICE) {
        sx += i % g.w; sy += (i / g.w) | 0; n++;
      }
    }
    if (!n) return { x: (g.w / 2) | 0, y: (g.h / 2) | 0 };
    return { x: Math.round(sx / n), y: Math.round(sy / n) };
  }

  _canRoad(x, y) {
    const g = this.game.grid;
    if (!g.inBounds(x, y)) return false;
    const i = g.idx(x, y);
    return g.type[i] === TILE.GRASS;
  }

  _placeRoad(x, y) {
    const g = this.game.grid, i = g.idx(x, y);
    if (g.type[i] !== TILE.GRASS) return false;
    if (this.game.sim.money < 50) return false;
    this.game.sim.money -= 50;
    g.type[i] = TILE.ROAD;
    this.game.renderer.updateTile(x, y);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = y + dz;
      if (g.inBounds(nx, nz) && g.type[g.idx(nx, nz)] === TILE.ROAD) this.game.renderer.updateTile(nx, nz);
    }
    return true;
  }

  _placeZone(x, y, zoneTile) {
    const g = this.game.grid, i = g.idx(x, y);
    if (g.type[i] !== TILE.GRASS) return false;
    if (this.game.sim.money < 20) return false;
    this.game.sim.money -= 20;
    g.type[i] = zoneTile; g.level[i] = 0; g.pop[i] = 0;
    this.game.renderer.updateTile(x, y);
    return true;
  }

  _placeService(x, y, svc) {
    const g = this.game.grid, i = g.idx(x, y);
    if (g.type[i] !== TILE.GRASS) return false;
    if (this.game.sim.money < svc.cost) return false;
    this.game.sim.money -= svc.cost;
    g.type[i] = TILE.SERVICE; g.service[i] = svc.id;
    this.game.renderer.updateTile(x, y);
    return true;
  }

  // ── Weekly governance step ──
  tick(budget) {
    const g = this.game, sim = g.sim;
    if (sim.week === this._lastWeek) return;
    this._lastWeek = sim.week;

    const prefs = this._prefs();
    // Spend only a slice of the treasury above the ideology-set reserve.
    let spend = Math.max(0, sim.money - prefs.reserve) * 0.6;
    if (!this._seeded) { this._seed(); this._seeded = true; }
    if (spend < 60) return;

    this._ensureUtilities(prefs);
    this._extendRoads(prefs);
    this._zoneLand(prefs);
    this._placeServices(prefs);
  }

  // Lay an initial road cross so the city has something to grow from.
  _seed() {
    const g = this.game.grid;
    const c = this._center();
    let roads = 0;
    for (let i = 0; i < g.type.length; i++) if (g.type[i] === TILE.ROAD) roads++;
    if (roads > 0) return;
    for (let d = -5; d <= 5; d++) { this._placeRoad(c.x + d, c.y); this._placeRoad(c.x, c.y + d); }
    this._log('Founded the city: first roads laid.');
  }

  // Build power/water if a meaningful share of zones is unserved.
  _ensureUtilities(prefs) {
    const g = this.game.grid, sim = this.game.sim;
    let zones = 0, unpowered = 0, unwatered = 0;
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t !== TILE.ZONE_RES && t !== TILE.ZONE_COM && t !== TILE.ZONE_IND) continue;
      zones++;
      if (!g.power[i]) unpowered++;
      if (!g.water[i]) unwatered++;
    }
    if (zones === 0) return;
    if (unpowered / zones > 0.35) {
      // Prefer clean wind power for green coalitions, cheaper plant otherwise.
      const id = prefs.vec.env > 0.15 ? 'wind' : 'power';
      const svc = SERVICE_BY_ID[id];
      if (sim.money >= svc.cost && this._placeNearDevelopment(svc, 0.45)) this._log(`Built a ${svc.name} for the grid.`);
    } else if (unwatered / zones > 0.35) {
      const svc = SERVICE_BY_ID['water'];
      if (sim.money >= svc.cost && this._placeNearDevelopment(svc, 0.45)) this._log('Built a Water Tower.');
    }
  }

  // Extend the arterial grid: add a handful of lattice road tiles per week,
  // biased to stay connected to the existing network.
  _extendRoads(prefs) {
    const g = this.game.grid;
    const c = this._center();
    // Grow radius with population so the network keeps pace with demand.
    const reach = amClamp(7 + Math.sqrt(this.game.sim.population) * 0.5, 8, Math.max(g.w, g.h));
    let placed = 0;
    const want = 3 + (prefs.vec.econ > 0.2 ? 2 : 0);     // growth govts build faster
    let guard = 120;
    while (placed < want && guard-- > 0) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * reach;
      let x = Math.round(c.x + Math.cos(ang) * r);
      let y = Math.round(c.y + Math.sin(ang) * r);
      // snap to a 4-tile lattice so roads form blocks, not noise
      x = Math.round(x / 4) * 4 + ((y / 4 | 0) % 2);        // slight offset for variety
      if (!this._canRoad(x, y)) continue;
      // only build if it touches the existing network (keeps it connected)
      if (!g.hasRoadAdjacent(x, y) && !this._nearRoad(x, y, 2)) continue;
      if (this._placeRoad(x, y)) {
        placed++;
        // occasionally stub a perpendicular tile to seed a block edge
        if (Math.random() < 0.5) this._placeRoad(x + (Math.random() < 0.5 ? 1 : -1), y);
      }
    }
  }

  _nearRoad(x, y, rad) {
    const g = this.game.grid;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const nx = x + dx, ny = y + dy;
      if (g.inBounds(nx, ny) && g.type[g.idx(nx, ny)] === TILE.ROAD) return true;
    }
    return false;
  }

  // Zone grass tiles next to roads. RCI choice weighted by live demand AND the
  // ruling ideology; commercial hugs the centre, industry pushes to the rim.
  _zoneLand(prefs) {
    const g = this.game.grid, sim = this.game.sim, c = this._center();
    const maxDist = Math.max(g.w, g.h) * 0.5;
    // Current zone mix — used to keep a balanced, functioning economy. If a
    // sector is badly under-represented the AI tilts toward it (industry in
    // particular tends to lose every central tile contest otherwise).
    let nR = 0, nC = 0, nI = 0;
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t === TILE.ZONE_RES) nR++; else if (t === TILE.ZONE_COM) nC++; else if (t === TILE.ZONE_IND) nI++;
    }
    const tot = Math.max(1, nR + nC + nI);
    const indShort = (nI / tot) < 0.15 ? 1.9 : 1;            // boost when industry is scarce
    const comShort = (nC / tot) < 0.12 ? 1.3 : 1;
    let zoned = 0;
    const want = 6 + (prefs.vec.econ > 0.2 ? 3 : 0);
    let guard = 240;
    while (zoned < want && guard-- > 0) {
      const rt = this._randomRoadTile(); if (!rt) break;
      // pick a grass neighbour of this road
      const nbs = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = rt[0] + dx, ny = rt[1] + dy;
        if (g.inBounds(nx, ny) && g.type[g.idx(nx, ny)] === TILE.GRASS) nbs.push([nx, ny]);
      }
      if (!nbs.length) continue;
      const [x, y] = nbs[(Math.random() * nbs.length) | 0];
      const dist = Math.hypot(x - c.x, y - c.y) / maxDist;   // 0 centre .. 1 rim
      // demand-weighted scores tilted by ideology and location
      const sR = sim.demand.res * prefs.res * (0.6 + dist * 0.6);
      const sC = sim.demand.com * prefs.com * (1.05 - dist * 0.5) * comShort;
      // Industry favours the rim but stays viable centrally; a scarce-industry
      // nudge keeps the economy productive even under a green administration.
      const sI = sim.demand.ind * prefs.ind * (0.8 + dist * 0.6) * indShort;
      let zoneTile = TILE.ZONE_RES, best = sR;
      if (sC > best) { best = sC; zoneTile = TILE.ZONE_COM; }
      if (sI > best) { best = sI; zoneTile = TILE.ZONE_IND; }
      if (best < 0.12) continue;                              // no real demand → skip
      if (this._placeZone(x, y, zoneTile)) zoned++;
    }
    if (zoned > 0 && Math.random() < 0.15) {
      const lead = prefs.vec.econ > 0.2 ? 'business district' : prefs.vec.env > 0.2 ? 'green neighbourhoods' : 'new housing';
      this._log(`Zoned ${zoned} blocks — focus on ${lead}.`);
    }
  }

  _randomRoadTile() {
    const g = this.game.grid;
    // sample a few random tiles, return first road found
    for (let s = 0; s < 40; s++) {
      const i = (Math.random() * g.type.length) | 0;
      if (g.type[i] === TILE.ROAD) return [i % g.w, (i / g.w) | 0];
    }
    return null;
  }

  // Place civic services where the city is weakest, throttled to ~one per few
  // weeks and prioritised by ideology.
  _placeServices(prefs) {
    const sim = this.game.sim, f = sim.fields;
    if (!f) return;
    if (this.game.sim.week % 3 !== 0) return;               // throttle
    const g = this.game.grid;
    // average coverage over occupied tiles
    let occ = 0, safe = 0, health = 0, edu = 0, happy = 0;
    for (let i = 0; i < g.type.length; i++) {
      if (g.pop[i] > 0) { occ++; safe += f.safety[i]; health += f.health[i]; edu += f.education[i]; happy += f.happy[i]; }
    }
    if (occ < 4) return;
    const cov = { safety: safe / occ, health: health / occ, education: edu / occ, happy: happy / occ };
    // weakest weighted by ideology
    const cand = [
      { id: 'police', score: (0.5 - cov.safety) * prefs.safety },
      { id: 'fire',   score: (0.45 - cov.safety) * prefs.safety * 0.8 },
      { id: 'health', score: (0.5 - cov.health) * 0.9 },
      { id: 'school', score: (0.5 - cov.education) * prefs.edu },
      { id: 'park',   score: (0.55 - cov.happy) * prefs.park },
    ].sort((a, b) => b.score - a.score);
    const pick = cand[0];
    if (pick.score <= 0.04) return;
    const svc = SERVICE_BY_ID[pick.id];
    if (sim.money < svc.cost + prefs.reserve * 0.5) return;
    if (this._placeNearDevelopment(svc, 0.5)) this._log(`Opened a ${svc.name} to lift the city.`);
  }

  // Find a grass tile near developed land (ideally road-adjacent) and build svc.
  _placeNearDevelopment(svc, roadPref) {
    const g = this.game.grid, c = this._center();
    let best = null, bestScore = -Infinity;
    for (let s = 0; s < 60; s++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * Math.max(g.w, g.h) * 0.4;
      const x = Math.round(c.x + Math.cos(ang) * r), y = Math.round(c.y + Math.sin(ang) * r);
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (g.type[i] !== TILE.GRASS) continue;
      let score = -Math.hypot(x - c.x, y - c.y) * 0.1;
      if (g.hasRoadAdjacent(x, y)) score += roadPref * 5;
      if (score > bestScore) { bestScore = score; best = [x, y]; }
    }
    if (!best) return false;
    return this._placeService(best[0], best[1], svc);
  }
}

if (typeof module !== 'undefined') module.exports = { AutoMayor };
