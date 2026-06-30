/* achievements.js — milestones the city can unlock.
 *
 * Each achievement has a test(game) predicate checked once per simulation week.
 * Unlocking fires a toast and is persisted. Purely observational — it never
 * alters the simulation, so it can't break anything.
 */

const ACHIEVEMENTS = [
  // Population
  { id: 'pop_village', icon: '🏡', name: 'Village', desc: 'Reach 100 residents.', test: g => g.sim.population >= 100 },
  { id: 'pop_town', icon: '🏘️', name: 'Small Town', desc: 'Reach 1,000 residents.', test: g => g.sim.population >= 1000 },
  { id: 'pop_city', icon: '🏙️', name: 'City', desc: 'Reach 5,000 residents.', test: g => g.sim.population >= 5000 },
  { id: 'pop_metro', icon: '🌆', name: 'Metropolis', desc: 'Reach 25,000 residents.', test: g => g.sim.population >= 25000 },
  { id: 'pop_mega', icon: '🌃', name: 'Megacity', desc: 'Reach 100,000 residents.', test: g => g.sim.population >= 100000 },
  { id: 'pop_giga', icon: '🏙️', name: 'Gigacity', desc: 'Reach 250,000 residents.', test: g => g.sim.population >= 250000 },
  // Economy
  { id: 'money_100k', icon: '💵', name: 'In the Black', desc: 'Hold $100,000.', test: g => g.sim.money >= 100000 },
  { id: 'money_500k', icon: '💰', name: 'Well Funded', desc: 'Hold $500,000.', test: g => g.sim.money >= 500000 },
  { id: 'money_1m', icon: '🤑', name: 'Millionaire City', desc: 'Hold $1,000,000.', test: g => g.sim.money >= 1000000 },
  { id: 'money_10m', icon: '🏦', name: 'Fiscal Titan', desc: 'Hold $10,000,000.', test: g => g.sim.money >= 10000000 },
  { id: 'surplus', icon: '📈', name: 'Surplus', desc: 'Earn +$5,000 in a week.', test: g => g.sim.lastBalance >= 5000 },
  { id: 'boom', icon: '🚀', name: 'Boom Times', desc: 'Reach an economic boom.', test: g => g.economy && (g.economy.phase === 'boom' || g.economy.phase === 'peak') },
  // Jobs & balance
  { id: 'jobs_1k', icon: '💼', name: 'Job Creator', desc: 'Provide 1,000 jobs.', test: g => (g.sim.jobsC + g.sim.jobsI) >= 1000 },
  { id: 'jobs_10k', icon: '🏭', name: 'Economic Engine', desc: 'Provide 10,000 jobs.', test: g => (g.sim.jobsC + g.sim.jobsI) >= 10000 },
  { id: 'balanced', icon: '⚖️', name: 'Balanced Economy', desc: '5k+ pop with jobs ≥ 60% of workforce.', test: g => g.sim.population >= 5000 && (g.sim.jobsC + g.sim.jobsI) >= g.sim.population * 0.33 },
  // Happiness & environment
  { id: 'happy', icon: '😀', name: 'Happy City', desc: 'Citywide happiness above 80%.', test: g => g.sim.happiness >= 0.8 },
  { id: 'ecstatic', icon: '🥳', name: 'Utopia', desc: 'Happiness above 90% with 10k+ pop.', test: g => g.sim.happiness >= 0.9 && g.sim.population >= 10000 },
  { id: 'clean', icon: '🌿', name: 'Clean Air', desc: 'Avg pollution below 5% with 5k+ pop.', test: g => g.sim.population >= 5000 && (g.sim.avgPollution || 0) < 0.05 },
  { id: 'green_city', icon: '♻️', name: 'Green City', desc: 'Build 5 parks or gardens.', test: g => g._count(['park', 'botanical', 'fountain']) >= 5 },
  { id: 'prime_land', icon: '🏷️', name: 'Prime Real Estate', desc: 'Average land value above 0.75.', test: g => (g.sim.avgLandValue || 0) > 0.75 },
  // Infrastructure
  { id: 'roads_50', icon: '🛣️', name: 'Road Network', desc: 'Build 50 roads.', test: g => g._countRoads() >= 50 },
  { id: 'roads_300', icon: '🚧', name: 'Grid Master', desc: 'Build 300 roads.', test: g => g._countRoads() >= 300 },
  { id: 'powered', icon: '⚡', name: 'Lights On', desc: 'Build a power source.', test: g => g._count(['power', 'wind', 'solar', 'hydro', 'nuclear', 'gasplant', 'coalplant', 'geothermal']) >= 1 },
  { id: 'watered', icon: '💧', name: 'Running Water', desc: 'Build a water source.', test: g => g._count(['water', 'reservoir', 'watertreat', 'desalination']) >= 1 },
  { id: 'services_10', icon: '🏛️', name: 'Public Servant', desc: 'Build 10 civic services.', test: g => g._countServices() >= 10 },
  { id: 'services_30', icon: '🏤', name: 'Full Service', desc: 'Build 30 civic services.', test: g => g._countServices() >= 30 },
  { id: 'skyline', icon: '🌇', name: 'Skyline', desc: 'Raise a level-4 megatower.', test: g => g._hasLevel(4) },
  { id: 'airport', icon: '✈️', name: 'Global Hub', desc: 'Build an airport.', test: g => g._count(['airport']) >= 1 },
  { id: 'transit_city', icon: '🚇', name: 'Transit City', desc: 'Build a metro and a bus depot.', test: g => g._count(['metro']) >= 1 && g._count(['busdepot']) >= 1 },
  // Politics
  { id: 'first_election', icon: '🗳️', name: 'Democracy', desc: 'Hold your first election.', test: g => !!(g.gov && g.gov.lastElection) },
  { id: 'laws_5', icon: '📜', name: 'Lawmaker', desc: 'Have 5 active laws.', test: g => g.gov && g.gov.activeLaws.size >= 5 },
  { id: 'laws_15', icon: '⚖️', name: 'Reformer', desc: 'Have 15 active laws.', test: g => g.gov && g.gov.activeLaws.size >= 15 },
  { id: 'popular', icon: '⭐', name: 'Landslide', desc: 'Approval above 70%.', test: g => g.gov && g.gov.approval >= 70 },
  { id: 'coalition', icon: '🤝', name: 'Coalition', desc: 'Govern with a multi-party coalition.', test: g => g.gov && g.gov.coalition && g.gov.coalition.length >= 2 },
  { id: 'diplomat', icon: '🌍', name: 'Diplomat', desc: 'Sign a foreign treaty.', test: g => g.gov && g.gov.treaties && Object.keys(g.gov.treaties).length >= 1 },
  { id: 'clean_gov', icon: '🛡️', name: 'Clean Government', desc: 'Establish the Integrity Commission.', test: g => g.gov && g.gov.watchdog && g.gov.watchdog.active },
  // Longevity
  { id: 'year1', icon: '📅', name: 'One Year In', desc: 'Survive 52 weeks.', test: g => g.sim.week >= 52 },
  { id: 'year5', icon: '🎖️', name: 'Five-Year Plan', desc: 'Survive 260 weeks.', test: g => g.sim.week >= 260 },
  { id: 'decade', icon: '🏅', name: 'A Decade', desc: 'Survive 520 weeks.', test: g => g.sim.week >= 520 },
];

class Achievements {
  constructor(game) { this.game = game; this.unlocked = new Set(); this._lastWeek = -1; }
  reset() { this.unlocked = new Set(); this._lastWeek = -1; }

  // grid-scanning helpers used by tests (bound to game via the predicate's `g`)
  _count(ids) { const g = this.game.grid, set = new Set(ids); let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === TILE.SERVICE && set.has(g.service[i])) n++; return n; }
  _countServices() { const g = this.game.grid; let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === TILE.SERVICE) n++; return n; }
  _countRoads() { const g = this.game.grid; let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === TILE.ROAD) n++; return n; }
  _hasLevel(lv) { const g = this.game.grid; const a = g.built || g.level; for (let i = 0; i < a.length; i++) if (a[i] >= lv) return true; return false; }

  tick() {
    const wk = this.game.sim.week;
    if (wk === this._lastWeek) return; this._lastWeek = wk;
    // expose helpers on game so predicates can call g._count(...) etc.
    const g = this.game;
    g._count = (ids) => this._count(ids);
    g._countServices = () => this._countServices();
    g._countRoads = () => this._countRoads();
    g._hasLevel = (lv) => this._hasLevel(lv);
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id)) continue;
      let ok = false; try { ok = a.test(g); } catch (e) { ok = false; }
      if (ok) {
        this.unlocked.add(a.id);
        if (this.game.ui && this.game.ui.toast) this.game.ui.toast(`🏆 Achievement: ${a.name}`);
      }
    }
  }

  get count() { return this.unlocked.size; }
  get total() { return ACHIEVEMENTS.length; }
  list() { return ACHIEVEMENTS.map(a => ({ ...a, done: this.unlocked.has(a.id) })); }

  serialize() { return [...this.unlocked]; }
  load(data) { this.unlocked = new Set(Array.isArray(data) ? data : []); }
}

if (typeof module !== 'undefined') module.exports = { Achievements, ACHIEVEMENTS };
