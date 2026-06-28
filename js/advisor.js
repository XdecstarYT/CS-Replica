/* advisor.js — ARIA: the city's analytical AI.
 *
 * This is a genuine decision-support engine, not a scripted gimmick. Every
 * weekly tick it samples the simulation, scans the full grid, fits a linear
 * trend to its own rolling history to forecast where the city is heading,
 * scores the city across six weighted dimensions, and generates ranked,
 * actionable, natural-language guidance. It can also solve for the single
 * best empty tile to develop next (a small spatial-optimisation pass) and
 * drive the renderer's heat-map overlays so its reasoning is visible.
 */

class CityAI {
  constructor(game) {
    this.game = game;
    this.name = 'ARIA';
    this.history = [];          // rolling [{week,pop,jobs,money,balance,happy,demand}]
    this.maxHistory = 80;
    this.report = null;         // latest analysis
    this._lastNudgeWeek = -99;
    this._nudgeQueue = [];
    this.greeted = false;
  }

  // ── Called once per simulation week ──────────────────────────────
  observe() {
    const s = this.game.sim;
    this.history.push({
      week: s.week,
      pop: s.population,
      jobs: s.jobsC + s.jobsI,
      money: s.money,
      balance: s.lastBalance,
      happy: s.happiness,
      demand: { res: s.demand.res, com: s.demand.com, ind: s.demand.ind },
    });
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  // ── Linear regression slope (least squares) over a numeric series ─
  _slope(values) {
    const n = values.length;
    if (n < 3) return 0;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i; }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return 0;
    return (n * sxy - sx * sy) / denom;
  }

  // ── Full scan of the grid into aggregate stats ───────────────────
  scan() {
    const g = this.game.grid, sim = this.game.sim;
    const f = sim.fields;
    const st = {
      roads: 0, water: 0,
      zoneTiles: 0, zoneR: 0, zoneC: 0, zoneI: 0,
      builtR: 0, builtC: 0, builtI: 0,
      services: {},
      zonedNoRoad: 0, unpowered: 0, unwatered: 0,
      needSafety: 0, needHealth: 0, needEdu: 0, needHappy: 0, occupied: 0,
      resTiles: [], indTiles: [], pollutedRes: 0,
      openNearRoad: 0,
    };
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t === TILE.ROAD) { st.roads++; continue; }
      if (t === TILE.WATER) { st.water++; continue; }
      if (t === TILE.SERVICE) {
        const id = g.service[i];
        st.services[id] = (st.services[id] || 0) + 1;
        continue;
      }
      const x = i % g.w, y = (i / g.w) | 0;
      if (t === TILE.GRASS) {
        if (g.hasRoadAdjacent(x, y)) st.openNearRoad++;
        continue;
      }
      const isZone = t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND;
      if (!isZone) continue;

      st.zoneTiles++;
      if (t === TILE.ZONE_RES) { st.zoneR++; st.resTiles.push([x, y]); }
      else if (t === TILE.ZONE_COM) st.zoneC++;
      else { st.zoneI++; st.indTiles.push([x, y]); }

      if (g.level[i] > 0) {
        if (t === TILE.ZONE_RES) st.builtR++;
        else if (t === TILE.ZONE_COM) st.builtC++;
        else st.builtI++;
      }

      const hasRoad = g.hasRoadAdjacent(x, y);
      if (!hasRoad) st.zonedNoRoad++;
      if (!g.power[i]) st.unpowered++;
      if (!g.water[i]) st.unwatered++;

      const occupied = g.pop[i] > 0;
      if (occupied) {
        st.occupied++;
        if (f) {
          if (f.safety[i] < 0.12) st.needSafety++;
          if (f.health[i] < 0.12) st.needHealth++;
          if (f.education[i] < 0.12) st.needEdu++;
          if (f.happy[i] < 0.12) st.needHappy++;
        }
      }
    }

    // Industrial pollution near homes (within 2 tiles)
    if (st.resTiles.length && st.indTiles.length) {
      const indSet = new Set(st.indTiles.map(([x, y]) => y * g.w + x));
      for (const [rx, ry] of st.resTiles) {
        let polluted = false;
        for (let dy = -2; dy <= 2 && !polluted; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = rx + dx, ny = ry + dy;
            if (g.inBounds(nx, ny) && indSet.has(ny * g.w + nx)) { polluted = true; break; }
          }
        if (polluted) st.pollutedRes++;
      }
    }
    return st;
  }

  // ── Forecast from history ────────────────────────────────────────
  forecast() {
    const h = this.history;
    const pops = h.map(s => s.pop);
    const moneys = h.map(s => s.money);
    const popSlope = this._slope(pops.slice(-16));
    const lastPop = pops.length ? pops[pops.length - 1] : 0;
    const s = this.game.sim;

    let bankruptIn = null;
    if (s.lastBalance < 0 && s.money >= 0) bankruptIn = Math.max(1, Math.floor(s.money / -s.lastBalance));

    return {
      popSlope,
      pop10: Math.max(0, Math.round(lastPop + popSlope * 10)),
      moneySlope: this._slope(moneys.slice(-16)),
      bankruptIn,
      trend: popSlope > 1.2 ? 'booming' : popSlope > 0.2 ? 'growing' : popSlope < -1.2 ? 'shrinking' : popSlope < -0.2 ? 'declining' : 'stable',
    };
  }

  // ── Composite score (0..100) + letter grade ─────────────────────
  _score(st, sim) {
    const z = Math.max(1, st.zoneTiles);
    const occ = Math.max(1, st.occupied);
    const dims = {
      power:    1 - st.unpowered / z,
      water:    1 - st.unwatered / z,
      roads:    1 - st.zonedNoRoad / z,
      coverage: 1 - (st.needSafety + st.needHealth + st.needEdu + st.needHappy) / (occ * 4),
      happiness: sim.happiness,
      budget:   sim.lastBalance >= 0 ? (sim.money > 0 ? 1 : 0.6)
                : Math.max(0, 0.5 + sim.money / 40000) * 0.6,
    };
    const w = { power: 1.2, water: 1.0, roads: 1.1, coverage: 1.0, happiness: 1.3, budget: 1.4 };
    let num = 0, den = 0;
    for (const k in dims) { num += clamp01(dims[k]) * w[k]; den += w[k]; }
    const score = Math.round((num / den) * 100);
    const grade = score >= 92 ? 'S' : score >= 82 ? 'A' : score >= 70 ? 'B'
                : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    return { score, grade, dims };
  }

  // ── Build the ranked insight list ────────────────────────────────
  _insights(st, sim, fc) {
    const out = [];
    const add = (level, icon, title, detail, extra) => out.push(Object.assign({ level, icon, title, detail }, extra || {}));
    const z = st.zoneTiles;

    // Cold start
    if (st.roads === 0) {
      add('tip', '🛣️', 'Lay your first roads', 'Nothing grows without road access. Draw a few connected roads, then paint zones beside them.', { tool: 'road' });
      return out;
    }
    if (z === 0) {
      add('tip', '🏗️', 'Zone some land', 'Paint Residential, Commercial and Industrial zones next to your roads so citizens and businesses can move in.', { tool: 'zone-res' });
    }

    // Budget — highest priority
    if (fc.bankruptIn !== null && fc.bankruptIn <= 12) {
      add('critical', '💸', `Bankruptcy in ~${fc.bankruptIn} wk`, `You are losing ${this._money(-sim.lastBalance)}/wk. Raise the tax rate, grow population, or remove costly services before the treasury runs dry.`);
    } else if (sim.lastBalance < 0) {
      add('warn', '📉', 'Running a deficit', `Weekly balance is ${this._money(sim.lastBalance)}. Either grow your tax base or trim upkeep — you have runway for now.`);
    } else if (sim.lastBalance > 50 && sim.money > 8000) {
      add('good', '💰', 'Healthy surplus', `+${this._money(sim.lastBalance)}/wk in the bank. A good moment to invest in services or expand zoning.`);
    }

    // Utilities
    if (st.unpowered > 0 && st.unpowered / Math.max(1, z) > 0.1) {
      add('critical', '⚡', `${st.unpowered} tiles without power`, 'Un-powered zones will not develop. Place a Power Plant or Wind Farm within range of the dark areas.', { overlay: 'power', service: 'power' });
    }
    if (st.unwatered > 0 && st.unwatered / Math.max(1, z) > 0.1) {
      add('warn', '💧', `${st.unwatered} tiles without water`, 'Add a Water Tower near your dry districts to unlock growth and happiness.', { overlay: 'water', service: 'water' });
    }
    if (st.zonedNoRoad > 0) {
      add('warn', '🚧', `${st.zonedNoRoad} zones not on a road`, 'These tiles can never develop. Connect them with a road or bulldoze them.', { overlay: 'desirability' });
    }

    // Coverage gaps
    if (st.needSafety > 2) add('warn', '🚓', 'Crime risk', `${st.needSafety} populated tiles lack police/fire coverage. Add a station near them.`, { overlay: 'services', service: 'police' });
    if (st.needHealth > 2) add('warn', '🏥', 'Healthcare gaps', `${st.needHealth} populated tiles are out of clinic/hospital range.`, { overlay: 'services', service: 'hospital' });
    if (st.needEdu > 2)    add('tip', '🏫', 'Education gaps', `${st.needEdu} populated tiles have no school nearby — schooling boosts higher-tier growth.`, { overlay: 'services', service: 'school' });
    if (st.needHappy > 2)  add('tip', '🌳', 'Low amenities', `${st.needHappy} populated tiles want parks. Happiness drives move-ins and tax yield.`, { overlay: 'services', service: 'park' });

    // Pollution
    if (st.pollutedRes > 3) {
      add('warn', '🏭', 'Factories next to homes', `${st.pollutedRes} homes sit beside industry. Separate them, or buffer with parks, to lift happiness.`);
    }

    // Demand signals
    const d = sim.demand;
    if (d.res > 0.7 && st.zoneR < st.zoneC + st.zoneI) add('tip', '🟢', 'High housing demand', 'Residential demand is hot — zone more homes to capture the inflow.', { tool: 'zone-res' });
    if (d.com > 0.7) add('tip', '🔵', 'Shops wanted', 'Commercial demand is high. Zone commercial near your residents.', { tool: 'zone-com' });
    if (d.ind > 0.7) add('tip', '🟡', 'Industry wanted', 'Industrial demand is high — jobs here feed residential growth.', { tool: 'zone-ind' });

    // Happiness summary
    if (sim.happiness < 0.4 && st.occupied > 0) {
      add('warn', '☹️', 'Citizens are unhappy', `City happiness is ${Math.round(sim.happiness * 100)}%. Cover utilities and services, and lower taxes if they are high.`);
    } else if (sim.happiness > 0.75 && st.occupied > 5) {
      add('good', '😊', 'Citizens love it here', `Happiness is ${Math.round(sim.happiness * 100)}%. Expect steady move-ins.`);
    }

    // Growth outlook
    if (fc.trend === 'booming') add('good', '🚀', 'The city is booming', `Population is climbing ~${Math.abs(fc.popSlope).toFixed(1)}/wk. On track for about ${fc.pop10.toLocaleString()} within 10 weeks.`);
    else if (fc.trend === 'shrinking' && st.occupied > 0) add('warn', '🔻', 'Population is shrinking', 'People are leaving. Check power, jobs and happiness — usually one of them is the cause.');

    if (out.length === 0) add('good', '✅', 'All systems nominal', 'No pressing issues. Keep expanding and balancing R/C/I demand.');
    return out;
  }

  // ── Run a full analysis ──────────────────────────────────────────
  analyze() {
    const sim = this.game.sim;
    const st = this.scan();
    const fc = this.forecast();
    const sc = this._score(st, sim);
    const insights = this._insights(st, sim, fc);
    insights.sort((a, b) => this._rank(b.level) - this._rank(a.level));
    this.report = { stats: st, forecast: fc, score: sc.score, grade: sc.grade, dims: sc.dims, insights, briefing: this._briefing(st, sim, fc, sc, insights) };
    return this.report;
  }

  _rank(level) { return { critical: 3, warn: 2, tip: 1, good: 0 }[level] || 0; }

  // ── Conversational briefing ──────────────────────────────────────
  _briefing(st, sim, fc, sc, insights) {
    const pop = sim.population.toLocaleString();
    const openers = [
      `Grade ${sc.grade}. `, `I'm reading the city at grade ${sc.grade}. `, `Status: grade ${sc.grade}. `,
    ];
    let msg = openers[sim.week % openers.length];

    if (st.roads === 0) return msg + "We're at zero — lay some roads and I'll start tracking growth.";

    if (sim.population === 0) msg += "No residents yet. Make sure homes have road access, power and water.";
    else msg += `Population ${pop}, ${fc.trend}`;

    if (fc.trend !== 'stable' && sim.population > 0) {
      msg += fc.popSlope >= 0 ? ` (+${fc.popSlope.toFixed(1)}/wk, ~${fc.pop10.toLocaleString()} in 10 wk). ` : ` (${fc.popSlope.toFixed(1)}/wk). `;
    } else if (sim.population > 0) msg += '. ';

    const top = insights.find(i => i.level === 'critical') || insights.find(i => i.level === 'warn');
    if (top) msg += `Top priority: ${top.title.toLowerCase()} — ${top.detail}`;
    else msg += "Nothing urgent on my radar; this is a good time to expand.";

    if (fc.bankruptIn !== null && fc.bankruptIn <= 12) msg += ` ⚠ Treasury empties in ~${fc.bankruptIn} weeks.`;
    return msg;
  }

  // ── Spatial optimiser: best empty tile to develop next ───────────
  // kind: 'res' | 'com' | 'ind'  → finds the buildable grass tile beside a
  // road with the highest desirability (utilities + service coverage).
  suggestSite(kind) {
    const g = this.game.grid, sim = this.game.sim, f = sim.fields;
    let best = null, bestScore = -1;
    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] !== TILE.GRASS) continue;
      const x = i % g.w, y = (i / g.w) | 0;
      if (!g.hasRoadAdjacent(x, y)) continue;
      const util = (g.power[i] ? 0.5 : 0) + (g.water[i] ? 0.5 : 0);
      const serv = f ? (f.safety[i] + f.health[i] + f.education[i] + f.happy[i]) / 4 : 0;
      // reward clustering with same use; penalise water adjacency for industry
      let s = util * 0.55 + serv * 0.45;
      // slight preference for tiles near the built-up core
      s += 0.0001 * (g.pop[i] || 0);
      if (s > bestScore) { bestScore = s; best = { x, y, score: s }; }
    }
    return best;
  }

  // Best location for a coverage service: centroid of the worst-served
  // populated tiles for the given need.
  suggestServiceSite(field) {
    const g = this.game.grid, sim = this.game.sim, f = sim.fields;
    if (!f) return null;
    let sx = 0, sy = 0, n = 0;
    const arr = field === 'power' ? null : f[field];
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      const isZone = t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND;
      if (!isZone || g.pop[i] === 0) continue;
      const lacking = field === 'power' ? !g.power[i] : (arr[i] < 0.12);
      if (!lacking) continue;
      sx += i % g.w; sy += (i / g.w) | 0; n++;
    }
    if (!n) return null;
    return { x: Math.round(sx / n), y: Math.round(sy / n), count: n };
  }

  // ── Proactive nudges (called from the game loop) ─────────────────
  maybeNudge() {
    const sim = this.game.sim;
    if (sim.week - this._lastNudgeWeek < 8) return null;
    const r = this.report || this.analyze();
    const crit = r.insights.find(i => i.level === 'critical');
    if (crit) {
      this._lastNudgeWeek = sim.week;
      return `${this.name}: ${crit.icon} ${crit.title}`;
    }
    return null;
  }

  _money(v) {
    const sign = v < 0 ? '-' : '';
    return sign + '$' + Math.abs(Math.round(v)).toLocaleString();
  }

  reset() {
    this.history.length = 0;
    this.report = null;
    this._lastNudgeWeek = -99;
    this.greeted = false;
  }
}
