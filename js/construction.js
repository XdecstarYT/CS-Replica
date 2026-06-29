/* construction.js — multi-stage construction system.
 *
 * Buildings no longer pop into existence: when the simulation raises a tile's
 * target level, a construction *project* is opened and the structure is raised
 * over several in-game weeks through discrete visual stages (site prep →
 * foundation → frame → facade → finish). Capacity only comes online once the
 * project completes, so growth genuinely takes time.
 *
 * Progress speed closes a feedback loop with the rest of the city:
 *   • Weather   — rain slows work, storms pause the cranes  (sim.envMods)
 *   • Economy   — booms accelerate, recessions/depressions slow it (economy)
 *   • Budget    — overdraft slows work; deep debt stalls sites  (sim.money)
 *
 * The manager is deliberately data-only; the renderer reads project state to
 * decide whether to draw a finished building or a live construction site.
 */

const CONSTRUCTION_STAGES = [0, 0.20, 0.42, 0.70, 0.90]; // visual stage thresholds

class Construction {
  constructor(game) {
    this.game = game;
    this.grid = game.grid;
    this.projects = new Map();   // tileIndex -> { target, from, stage }
  }

  setGrid(grid) { this.grid = grid; this.projects.clear(); }

  projectAt(i) { return this.projects.get(i); }
  isActive(i) { const p = this.projects.get(i); return !!(p && p.stage < 1); }
  get activeCount() { return this.projects.size; }

  // Map a 0..1 progress value to a discrete stage index (for re-render gating).
  stageIndex(stage) {
    let s = 0;
    for (let k = 0; k < CONSTRUCTION_STAGES.length; k++) if (stage >= CONSTRUCTION_STAGES[k]) s = k;
    return s;
  }

  _isZone(t) { return t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND; }

  // Global multiplier on construction speed from weather + economy + budget.
  speedFactor() {
    const g = this.game;
    // Weather: rain/snow slow work; a storm halts the cranes entirely.
    let wf = (g.sim && g.sim.envMods && g.sim.envMods.constructionSpeed) || 1;
    if (g.weather && g.weather.current === 'storm') wf = 0;
    // Economy: confidence-driven build pace.
    let ef = 1;
    if (g.economy && g.economy.phase) {
      ef = { depression: 0.45, recession: 0.7, recovery: 0.9, expansion: 1.12, boom: 1.25, peak: 1.05 }[g.economy.phase] ?? 1;
    }
    // Budget: cities in the red build slower; deep debt stalls everything.
    const money = g.sim ? g.sim.money : 0;
    const bf = money < -1500 ? 0.15 : money < -200 ? 0.55 : money < 0 ? 0.8 : 1;
    // Governance: planning-dept throughput + ruling ideology (growth-first builds
    // faster, green/austere governments slow permitting).
    const gov = (g.gov && g.gov.constructionFactor) ? g.gov.constructionFactor() : 1;
    return wf * ef * bf * gov;
  }

  // Per-week progress increment for one project (taller targets take longer).
  _tileSpeed(i, p) {
    const base = 0.24;
    const lvlFactor = 1 / (0.7 + p.target * 0.55);
    const jitter = 0.85 + (((i * 2654435761) >>> 0) % 1000) / 1000 * 0.3; // 0.85..1.15
    return base * lvlFactor * jitter * this.speedFactor();
  }

  // Called once per simulation week (after sim.step has set target levels).
  tick() {
    const g = this.grid;
    if (!g.built) return;

    // 1) Reconcile targets → open/close/cancel projects.
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (!this._isZone(t)) { if (this.projects.has(i)) this.projects.delete(i); continue; }
      const target = g.level[i], built = g.built[i];
      if (target > built) {
        const p = this.projects.get(i);
        if (!p || p.target !== target) this.projects.set(i, { target, from: built, stage: 0 });
      } else if (target < built) {
        // downgrade / demolition: apply immediately, no site
        g.built[i] = target;
        if (this.projects.has(i)) this.projects.delete(i);
      } else if (this.projects.has(i)) {
        this.projects.delete(i);
      }
    }

    // 2) Advance active projects; complete when stage reaches 1.
    for (const [i, p] of this.projects) {
      p.stage = Math.min(1, p.stage + this._tileSpeed(i, p));
      if (p.stage >= 1) { g.built[i] = p.target; this.projects.delete(i); }
    }
  }

  serialize() {
    const out = [];
    for (const [i, p] of this.projects) out.push([i, p.target, p.from, +p.stage.toFixed(3)]);
    return out;
  }

  load(data) {
    this.projects.clear();
    if (!Array.isArray(data)) return;
    for (const [i, target, from, stage] of data) this.projects.set(i, { target, from, stage });
  }
}
