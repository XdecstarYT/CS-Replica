/* simulation.js — the city economy: coverage, demand, growth, budget. */

class Simulation {
  constructor(grid) {
    this.grid = grid;
    this.money = CONFIG.START_MONEY;
    this.week = 0;
    this.population = 0;
    this.jobsC = 0;   // commercial jobs filled
    this.jobsI = 0;   // industrial jobs filled
    this.demand = { res: 0.6, com: 0.4, ind: 0.5 };
    this.happiness = 0.5;
    this.lastBalance = 0;
    this.taxRate = 1.0;   // 0.5 .. 1.5 (multiplier on the base per-capita tax)
  }

  // Spread a circular coverage field from every service of the given keys.
  computeCoverage() {
    const g = this.grid;
    g.power.fill(0);
    g.water.fill(0);
    const n = g.w * g.h;
    const fields = { safety: new Float32Array(n),
                     health: new Float32Array(n),
                     education: new Float32Array(n),
                     happy: new Float32Array(n),
                     pollution: new Float32Array(n) };
    this.fields = fields;
    if (!g.land || g.land.length !== n) g.land = new Float32Array(n);

    let powerCap = 0, waterCap = 0;

    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] !== TILE.SERVICE) continue;
      const svc = SERVICE_BY_ID[g.service[i]];
      if (!svc) continue;
      const sx = i % g.w, sy = (i / g.w) | 0;
      powerCap += svc.power || 0;
      waterCap += svc.water || 0;
      this._stamp(sx, sy, svc.range, (idx, falloff) => {
        if (svc.power) g.power[idx] = 1;
        if (svc.water) g.water[idx] = 1;
        if (svc.safety) fields.safety[idx] += falloff;
        if (svc.health) fields.health[idx] += falloff;
        if (svc.education) fields.education[idx] += falloff;
        if (svc.happy) fields.happy[idx] += falloff;
      });
      // Dirty utilities (coal power) pollute their surroundings.
      if (svc.pollution) this._stamp(sx, sy, svc.range, (idx, fo) => { fields.pollution[idx] += fo * (svc.pollution / 40); });
    }

    // Industry and traffic jams generate pollution that drifts over nearby tiles.
    const built = g.built || g.level;
    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] === TILE.ZONE_IND && built[i] > 0) {
        const sx = i % g.w, sy = (i / g.w) | 0;
        const intensity = 0.10 + built[i] * 0.06;
        this._stamp(sx, sy, 3, (idx, fo) => { fields.pollution[idx] += fo * intensity; });
      }
    }
    if (g.congestion) {
      for (let i = 0; i < g.type.length; i++) if (g.type[i] === TILE.ROAD) fields.pollution[i] += g.congestion[i] * 0.30;
    }
    for (let i = 0; i < n; i++) if (fields.pollution[i] > 1) fields.pollution[i] = 1;

    this.powerCap = powerCap;
    this.waterCap = waterCap;
  }

  _stamp(cx, cy, r, fn) {
    const g = this.grid;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!g.inBounds(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        fn(g.idx(x, y), 1 - d / r);
      }
    }
  }

  step() {
    const g = this.grid;
    this.computeCoverage();

    // Total demand pressure influences how aggressively zones grow.
    let res = 0, com = 0, ind = 0;     // occupied counts
    let resCap = 0, comCap = 0, indCap = 0;
    let powered = 0, total = 0;
    let happinessSum = 0, happinessN = 0;
    let propBase = 0, pollSum = 0, pollN = 0;   // property-tax base + pollution avg

    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      const isZone = t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND;
      if (!isZone) continue;
      const x = i % g.w, y = (i / g.w) | 0;
      total++;

      const hasRoad = g.hasRoadAdjacent(x, y);
      const hasPower = g.power[i] === 1;
      const hasWater = g.water[i] === 1;
      if (hasPower) powered++;

      // local quality of life
      const f = this.fields;
      const services = (f.safety[i] + f.health[i] + f.education[i] + f.happy[i]) / 4;
      const utilities = (hasPower ? 0.5 : 0) + (hasWater ? 0.5 : 0);
      let quality = utilities * 0.6 + services * 0.4;
      if (!hasRoad) quality = 0;

      // Pollution depresses desirability — homes hate it, offices dislike it,
      // industry barely notices. Land value blends amenities, utilities & clean air.
      const poll = f.pollution[i];
      const pollHit = t === TILE.ZONE_RES ? 0.55 : t === TILE.ZONE_COM ? 0.30 : 0.10;
      quality = Math.max(0, quality * (1 - poll * pollHit));
      g.land[i] = clamp01(0.20 + services * 0.5 + utilities * 0.2 - poll * 0.5);
      pollSum += poll; pollN++;

      // Demand-driven growth target for this tile.
      const dem = t === TILE.ZONE_RES ? this.demand.res
                : t === TILE.ZONE_COM ? this.demand.com
                : this.demand.ind;

      // Tiles climb toward a target level set by local quality and demand.
      // Reaching the megatower tier (level 4) needs both strong amenities AND
      // strong demand — only thriving districts densify that far.
      const maxLv = (typeof MAX_LEVEL !== 'undefined') ? MAX_LEVEL : 3;
      const wantLevel = hasRoad && (hasPower || hasWater)
        ? Math.min(maxLv, Math.floor(quality * 3.2 + dem * 2.0))
        : 0;

      // Ease the building level toward its target (higher tiers rise slower).
      const riseChance = (0.5 + dem * 0.4) / (1 + g.level[i] * 0.35);
      if (g.level[i] < wantLevel && Math.random() < riseChance) g.level[i]++;
      else if (g.level[i] > wantLevel && Math.random() < 0.25) g.level[i]--;

      // Capacity comes from the *constructed* level — population only moves in
      // once the building (or its next storey) has actually finished building.
      const builtLevel = g.built ? g.built[i] : g.level[i];
      const cap = (BUILDING_LEVELS[t][builtLevel] || { cap: 0 }).cap;
      // occupancy eases toward capacity scaled by quality, policy + economy growth.
      const pmG = this.policyMods ? (this.policyMods.growthMult ?? 1) : 1;
      const ecG = this.econMods   ? (this.econMods.growthMult ?? 1)   : 1;
      const enG = this.envMods    ? (this.envMods.growthMult ?? 1)    : 1;
      const trG = this.trafficMods ? (this.trafficMods.growthMult ?? 1) : 1;
      const gm = pmG * ecG * enG * trG;
      const target = Math.min(cap, Math.round(cap * (0.4 + quality * 0.6) * gm));
      if (g.pop[i] < target) g.pop[i] += Math.ceil((target - g.pop[i]) * 0.3);
      else g.pop[i] = target;

      if (t === TILE.ZONE_RES) { res += g.pop[i]; resCap += cap; }
      else if (t === TILE.ZONE_COM) { com += g.pop[i]; comCap += cap; }
      else { ind += g.pop[i]; indCap += cap; }

      propBase += g.pop[i] * g.land[i];
      if (g.pop[i] > 0) { happinessSum += quality; happinessN++; }
    }
    this.avgPollution = pollN ? pollSum / pollN : 0;
    this.avgLandValue = total ? (propBase / Math.max(1, res + com + ind)) : 0;

    this.population = res;
    this.jobsC = com;
    this.jobsI = ind;
    this.happiness = happinessN ? happinessSum / happinessN : 0.5;
    // Additive happiness nudges from politics, economy and weather (neutral by default).
    let happyAdd = 0;
    if (this.policyMods) happyAdd += (this.policyMods.happyAdd || 0);
    if (this.econMods)   happyAdd += (this.econMods.happyAdd   || 0);
    if (this.envMods)    happyAdd += (this.envMods.happyAdd    || 0);
    if (this.trafficMods) happyAdd += (this.trafficMods.happyAdd || 0);
    if (happyAdd) this.happiness = clamp01(this.happiness + happyAdd);

    // ---- Demand model (RCI) ----
    // Residential demand rises when there are jobs relative to residents.
    // High taxes discourage move-ins; low taxes encourage them.
    const jobs = com + ind;
    const workforce = res * 0.55;
    const taxPenalty = (this.taxRate - 1) * 0.35;
    this.demand.res = clamp01(0.35 + (jobs - workforce) / Math.max(40, res + 40) + this.happiness * 0.2 - taxPenalty);
    // Commercial demand needs shoppers (residents) and goods (industry).
    this.demand.com = clamp01(0.25 + res / Math.max(60, comCap + 60) * 0.8 - com / Math.max(40, comCap + 40) * 0.5);
    // Industrial demand needs workers and downstream commerce.
    this.demand.ind = clamp01(0.3 + (res + com) / Math.max(80, indCap + 80) * 0.7 - ind / Math.max(40, indCap + 40) * 0.5);

    // ---- Budget ----
    const citizensServed = res + com + ind;
    const pm = this.policyMods || {};
    const em = this.econMods || {};
    const en = this.envMods || {};
    // Property tax scales with land value: well-served, low-pollution districts
    // are worth more and pay more — a real incentive to build clean, green cities.
    const property = propBase * 0.6 * this.taxRate * (pm.taxMult ?? 1);
    const tax = citizensServed * TAX_PER_CAPITA * this.taxRate * (0.6 + this.happiness * 0.6)
              * (pm.taxMult ?? 1) * (em.taxMult ?? 1) + property + (pm.revenueAdd || 0);
    let upkeep = 0;
    let roadCount = 0;
    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] === TILE.ROAD) roadCount++;
      if (g.type[i] === TILE.SERVICE) {
        const svc = SERVICE_BY_ID[g.service[i]];
        if (svc) upkeep += svc.upkeep;
      }
    }
    upkeep += roadCount * UPKEEP_PER_ROAD;
    upkeep += (pm.upkeepAdd || 0);   // policy upkeep / debt servicing (can be negative = savings)
    upkeep += (en.upkeepAdd || 0);   // weather heating/cooling load
    this.lastBalance = Math.round(tax - upkeep);
    this.money += this.lastBalance;
    this.week++;

    return {
      bankrupt: this.money < -2000,
    };
  }

  serialize() {
    return {
      money: this.money, week: this.week,
      population: this.population, jobsC: this.jobsC, jobsI: this.jobsI,
      demand: this.demand, happiness: this.happiness,
      taxRate: this.taxRate,
    };
  }

  load(data) {
    Object.assign(this, data);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
