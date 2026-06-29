/* stats.js — the Statistics Centre.
 *
 * A professional, data-driven analytics layer. A registry of live metrics
 * (each with a category, label, colour, formatter and a pure getter) is sampled
 * every simulation week into rolling time-series. The StatsUI renders a
 * categorised dashboard of live sparkline cards with current value + trend,
 * and tapping a card opens a full-size historical chart. The metric registry
 * is intentionally extensible — adding a graph is one line.
 */

const STAT_CATEGORIES = [
  ['population', '👥 Population'],
  ['economy',    '💹 Economy'],
  ['markets',    '📊 Markets'],
  ['labor',      '💼 Labour'],
  ['budget',     '💰 Budget'],
  ['society',    '🙂 Society'],
  ['environment','🌍 Environment'],
  ['infra',      '🏗 Infrastructure'],
  ['politics',   '🏛 Politics'],
  ['tourism',    '🧳 Tourism'],
];

// Numeric credit-rating map for charting.
const CREDIT_NUM = { AAA: 100, AA: 88, A: 76, BBB: 64, BB: 50, B: 36, CCC: 20 };

// Each metric: { id, cat, label, color, fmt, get(c) } where c is the sample ctx.
const STAT_METRICS = [
  // ── Population ──
  { id: 'population', cat: 'population', label: 'Population', color: '#38bdf8', fmt: 'int', get: c => c.sim.population },
  { id: 'popGrowth',  cat: 'population', label: 'Pop. Growth /wk', color: '#4ade80', fmt: 'signed', get: c => c.sim.population - c.prevPop },
  { id: 'households',  cat: 'population', label: 'Households', color: '#60a5fa', fmt: 'int', get: c => Math.round(c.sim.population / 2.4) },
  { id: 'birthRate',  cat: 'population', label: 'Births /wk', color: '#86efac', fmt: 'int', get: c => Math.round(c.sim.population * 0.00035 * (0.6 + c.sim.happiness)) },
  { id: 'deathRate',  cat: 'population', label: 'Deaths /wk', color: '#fca5a5', fmt: 'int', get: c => Math.round(c.sim.population * 0.00022 * (1.4 - c.sim.happiness * 0.5)) },
  { id: 'migration',  cat: 'population', label: 'Net Migration', color: '#a78bfa', fmt: 'signed', get: c => (c.sim.population - c.prevPop) - Math.round(c.sim.population * 0.00013) },
  { id: 'workforce',  cat: 'population', label: 'Workforce', color: '#22d3ee', fmt: 'int', get: c => Math.round(c.sim.population * 0.55) },
  { id: 'dependency', cat: 'population', label: 'Dependency %', color: '#f0abfc', fmt: 'pct100', get: c => 45 },

  // ── Economy ──
  { id: 'gdp',        cat: 'economy', label: 'GDP Index', color: '#4ade80', fmt: 'int', get: c => c.eco.gdp },
  { id: 'gdpGrowth',  cat: 'economy', label: 'GDP Growth %', color: '#34d399', fmt: 'pctf', get: c => c.eco.gdpGrowth * 100 },
  { id: 'gdpPerCap',  cat: 'economy', label: 'GDP per Capita', color: '#10b981', fmt: 'int', get: c => Math.round(c.eco.gdp * 1000 / Math.max(1, c.sim.population) * 100) },
  { id: 'productivity',cat: 'economy', label: 'Productivity', color: '#a3e635', fmt: 'dec2', get: c => c.eco.productivity },
  { id: 'inflation',  cat: 'economy', label: 'Inflation %', color: '#fbbf24', fmt: 'pctf', get: c => c.eco.inflation * 100 },
  { id: 'interest',   cat: 'economy', label: 'Interest Rate %', color: '#fb923c', fmt: 'pctf', get: c => c.eco.interestRate * 100 },
  { id: 'bizHealth',  cat: 'economy', label: 'Business Health', color: '#2dd4bf', fmt: 'pct100', get: c => c.eco.businessHealth },
  { id: 'indOutput',  cat: 'economy', label: 'Industrial Output', color: '#facc15', fmt: 'int', get: c => c.eco.industrialOutput },
  { id: 'comDemand',  cat: 'economy', label: 'Commercial Demand', color: '#38bdf8', fmt: 'pct100', get: c => c.eco.commercialDemand },
  { id: 'foreignInv', cat: 'economy', label: 'Foreign Investment', color: '#818cf8', fmt: 'pct100', get: c => c.eco.foreignInvest },
  { id: 'currency',   cat: 'economy', label: 'Currency Value', color: '#c084fc', fmt: 'dec2', get: c => c.eco.currency },
  { id: 'confidence', cat: 'economy', label: 'Confidence', color: '#fde047', fmt: 'pct100', get: c => c.eco.confidence },

  // ── Markets ──
  { id: 'stock',      cat: 'markets', label: 'Stock Index', color: '#4ade80', fmt: 'int', get: c => c.eco.stock },
  { id: 'bondYield',  cat: 'markets', label: 'Bond Yield %', color: '#fb923c', fmt: 'pctf', get: c => c.eco.bondYield * 100 },
  { id: 'housing',    cat: 'markets', label: 'Housing Index', color: '#f472b6', fmt: 'int', get: c => c.eco.housingIndex },
  { id: 'afford',     cat: 'markets', label: 'Affordability', color: '#22d3ee', fmt: 'pct100', get: c => Math.max(0, 160 - c.eco.housingIndex / 3) },

  // ── Labour ──
  { id: 'employed',   cat: 'labor', label: 'Employed', color: '#4ade80', fmt: 'int', get: c => c.sim.jobsC + c.sim.jobsI },
  { id: 'unemploy',   cat: 'labor', label: 'Unemployment %', color: '#f87171', fmt: 'pctf', get: c => c.eco.unemployment * 100 },
  { id: 'employRate', cat: 'labor', label: 'Employment %', color: '#34d399', fmt: 'pctf', get: c => c.eco.employment * 100 },
  { id: 'jobsCom',    cat: 'labor', label: 'Commercial Jobs', color: '#38bdf8', fmt: 'int', get: c => c.sim.jobsC },
  { id: 'jobsInd',    cat: 'labor', label: 'Industrial Jobs', color: '#fbbf24', fmt: 'int', get: c => c.sim.jobsI },
  { id: 'firms',      cat: 'labor', label: 'Active Firms', color: '#a78bfa', fmt: 'int', get: c => c.eco.firms.active },
  { id: 'hiring',     cat: 'labor', label: 'Firms Hiring', color: '#86efac', fmt: 'int', get: c => c.eco.firms.hiring },
  { id: 'layoffs',    cat: 'labor', label: 'Layoffs', color: '#fca5a5', fmt: 'int', get: c => c.eco.firms.layoffs },
  { id: 'bankrupt',   cat: 'labor', label: 'Bankruptcies', color: '#ef4444', fmt: 'int', get: c => c.eco.firms.bankruptcies },

  // ── Budget ──
  { id: 'treasury',   cat: 'budget', label: 'Treasury', color: '#4ade80', fmt: 'money', get: c => c.sim.money },
  { id: 'balance',    cat: 'budget', label: 'Weekly Balance', color: '#fbbf24', fmt: 'moneySigned', get: c => c.sim.lastBalance },
  { id: 'revenue',    cat: 'budget', label: 'Revenue /wk', color: '#34d399', fmt: 'money', get: c => c.gov && c.gov.budget ? c.gov.budget.revenue.total : 0 },
  { id: 'expenses',   cat: 'budget', label: 'Expenses /wk', color: '#f87171', fmt: 'money', get: c => c.gov && c.gov.budget ? c.gov.budget.expense.total : 0 },
  { id: 'debt',       cat: 'budget', label: 'City Debt', color: '#fb7185', fmt: 'money', get: c => c.gov ? c.gov.debt : 0 },
  { id: 'debtPerCap', cat: 'budget', label: 'Debt per Capita', color: '#f472b6', fmt: 'money', get: c => Math.round((c.gov ? c.gov.debt : 0) / Math.max(1, c.sim.population)) },
  { id: 'taxRate',    cat: 'budget', label: 'Tax Rate %', color: '#c084fc', fmt: 'pct100', get: c => (c.sim.taxRate || 1) * 100 },
  { id: 'credit',     cat: 'budget', label: 'Credit Score', color: '#38bdf8', fmt: 'int', get: c => c.gov ? (CREDIT_NUM[c.gov.creditRating] || 60) : 60 },

  // ── Society ──
  { id: 'happiness',  cat: 'society', label: 'Happiness %', color: '#4ade80', fmt: 'pct100', get: c => c.sim.happiness * 100 },
  { id: 'approval',   cat: 'society', label: 'Govt Approval %', color: '#c084fc', fmt: 'pct100', get: c => c.gov ? c.gov.approval : 50 },
  { id: 'stability',  cat: 'society', label: 'Stability %', color: '#38bdf8', fmt: 'pct100', get: c => c.gov ? c.gov.stability : 70 },
  { id: 'crime',      cat: 'society', label: 'Crime Risk %', color: '#f87171', fmt: 'pct100', get: c => c.gov && c.gov.drivers ? c.gov.drivers.crime * 100 : 0 },
  { id: 'education',  cat: 'society', label: 'Education %', color: '#a78bfa', fmt: 'pct100', get: c => c.gov && c.gov.drivers ? c.gov.drivers.education * 100 : 0 },
  { id: 'health',     cat: 'society', label: 'Healthcare %', color: '#fb7185', fmt: 'pct100', get: c => c.gov && c.gov.drivers ? c.gov.drivers.health * 100 : 0 },
  { id: 'amenities',  cat: 'society', label: 'Amenities %', color: '#34d399', fmt: 'pct100', get: c => c.gov && c.gov.drivers ? c.gov.drivers.amenities * 100 : 0 },

  // ── Environment ──
  { id: 'pollution',  cat: 'environment', label: 'Pollution %', color: '#a3a3a3', fmt: 'pct100', get: c => c.gov && c.gov.drivers ? c.gov.drivers.pollution * 100 : 0 },
  { id: 'airQuality', cat: 'environment', label: 'Air Quality %', color: '#86efac', fmt: 'pct100', get: c => 100 - (c.gov && c.gov.drivers ? c.gov.drivers.pollution * 100 : 0) },
  { id: 'temp',       cat: 'environment', label: 'Temperature °C', color: '#fbbf24', fmt: 'int', get: c => c.weather ? c.weather.temperature : 15 },
  { id: 'green',      cat: 'environment', label: 'Green Spaces', color: '#4ade80', fmt: 'int', get: c => c.grid_parks },

  // ── Infrastructure ──
  { id: 'roads',      cat: 'infra', label: 'Road Tiles', color: '#94a3b8', fmt: 'int', get: c => c.grid_roads },
  { id: 'powerCap',   cat: 'infra', label: 'Power Capacity', color: '#facc15', fmt: 'int', get: c => c.sim.powerCap || 0 },
  { id: 'waterCap',   cat: 'infra', label: 'Water Capacity', color: '#38bdf8', fmt: 'int', get: c => c.sim.waterCap || 0 },
  { id: 'powerCov',   cat: 'infra', label: 'Power Coverage %', color: '#fde047', fmt: 'pct100', get: c => c.grid_zoned ? (1 - c.grid_unpowered / c.grid_zoned) * 100 : 100 },
  { id: 'waterCov',   cat: 'infra', label: 'Water Coverage %', color: '#22d3ee', fmt: 'pct100', get: c => c.grid_zoned ? (1 - c.grid_unwatered / c.grid_zoned) * 100 : 100 },
  { id: 'services',   cat: 'infra', label: 'Service Buildings', color: '#a78bfa', fmt: 'int', get: c => c.grid_services },
  { id: 'zoned',      cat: 'infra', label: 'Zoned Tiles', color: '#60a5fa', fmt: 'int', get: c => c.grid_zoned },
  { id: 'built',      cat: 'infra', label: 'Buildings Built', color: '#4ade80', fmt: 'int', get: c => c.grid_built },

  // ── Politics ──
  { id: 'rulingSeats',cat: 'politics', label: 'Govt Seats', color: '#c084fc', fmt: 'int', get: c => c.gov ? c.gov.coalitionSeats() : 0 },
  { id: 'capital',    cat: 'politics', label: 'Political Capital', color: '#f0abfc', fmt: 'int', get: c => c.gov ? c.gov.politicalCapital : 0 },
  { id: 'media',      cat: 'politics', label: 'Media Bias', color: '#38bdf8', fmt: 'signed', get: c => c.gov ? Math.round(c.gov.media.bias) : 0 },
  { id: 'relations',  cat: 'politics', label: 'Foreign Relations', color: '#34d399', fmt: 'pct100', get: c => c.relAvg },
  { id: 'laws',       cat: 'politics', label: 'Active Laws', color: '#a78bfa', fmt: 'int', get: c => c.gov ? c.gov.activeLaws.size : 0 },

  // ── Tourism ──
  { id: 'tourism',    cat: 'tourism', label: 'Tourism Index', color: '#fbbf24', fmt: 'pct100', get: c => c.tourismIdx },
  { id: 'tourists',   cat: 'tourism', label: 'Weekly Tourists', color: '#38bdf8', fmt: 'int', get: c => c.tourists },
  { id: 'tourRevenue',cat: 'tourism', label: 'Tourism Revenue', color: '#4ade80', fmt: 'money', get: c => Math.round(c.tourists * 12) },
];

const STAT_BY_ID = Object.fromEntries(STAT_METRICS.map(m => [m.id, m]));

class Stats {
  constructor(game) {
    this.game = game;
    this.maxPoints = 240;
    this.reset();
  }

  reset() {
    this.series = {};
    for (const m of STAT_METRICS) this.series[m.id] = [];
    this.weeks = [];
    this.prevPop = 0;
    this.prevGdp = 100;
    this._lastWeek = -1;
  }

  _gridScan() {
    const g = this.game.grid;
    let roads = 0, services = 0, parks = 0, zoned = 0, built = 0, unpowered = 0, unwatered = 0;
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t === TILE.ROAD) { roads++; continue; }
      if (t === TILE.SERVICE) { services++; if (g.service[i] === 'park') parks++; continue; }
      const isZone = t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND;
      if (!isZone) continue;
      zoned++;
      if (g.level[i] > 0) built++;
      if (!g.power[i]) unpowered++;
      if (!g.water[i]) unwatered++;
    }
    return { roads, services, parks, zoned, built, unpowered, unwatered };
  }

  sample() {
    const week = this.game.sim.week;
    if (week === this._lastWeek) return;
    this._lastWeek = week;

    const gov = this.game.gov, weather = this.game.weather, eco = this.game.economy;
    const gs = this._gridScan();
    const relAvg = gov && gov.relations
      ? Object.values(gov.relations).reduce((a, b) => a + b, 0) / Object.keys(gov.relations).length : 50;

    // Tourism (lightweight model): attractions + amenities + cleanliness + weather.
    const attractions = gs.parks + (gov && gov.activeLaws ? 0 : 0);
    const cleanliness = 1 - (gov && gov.drivers ? gov.drivers.pollution : 0);
    const wTour = weather ? (this.game.sim.envMods && this.game.sim.envMods.tourism || 1) : 1;
    const tourismIdx = ecoClampS(20 + attractions * 6 + (this.game.sim.happiness * 30) + cleanliness * 20 * wTour, 0, 100);
    const tourists = Math.round(tourismIdx * this.game.sim.population * 0.002 + attractions * 5);

    const c = {
      game: this.game, sim: this.game.sim, eco, weather, gov, grid: this.game.grid,
      prevPop: this.prevPop, prevGdp: this.prevGdp, relAvg,
      grid_roads: gs.roads, grid_services: gs.services, grid_parks: gs.parks,
      grid_zoned: gs.zoned, grid_built: gs.built, grid_unpowered: gs.unpowered, grid_unwatered: gs.unwatered,
      tourismIdx, tourists,
    };

    for (const m of STAT_METRICS) {
      let v = 0;
      try { v = m.get(c); } catch (e) { v = 0; }
      if (!isFinite(v)) v = 0;
      const arr = this.series[m.id];
      arr.push(v);
      if (arr.length > this.maxPoints) arr.shift();
    }
    this.weeks.push(week);
    if (this.weeks.length > this.maxPoints) this.weeks.shift();

    this.prevPop = this.game.sim.population;
    this.prevGdp = eco ? eco.gdp : 100;
    this._tourismIdx = tourismIdx;
    this._tourists = tourists;
  }

  latest(id) { const a = this.series[id]; return a && a.length ? a[a.length - 1] : 0; }
  trend(id) {
    const a = this.series[id];
    if (!a || a.length < 2) return 0;
    return a[a.length - 1] - a[Math.max(0, a.length - 6)];
  }

  serialize() {
    // Persist a downsampled tail to keep saves small.
    const out = {};
    for (const id in this.series) out[id] = this.series[id].slice(-80);
    return { series: out, weeks: this.weeks.slice(-80), prevPop: this.prevPop, prevGdp: this.prevGdp };
  }
  load(d) {
    if (!d || !d.series) return;
    for (const m of STAT_METRICS) this.series[m.id] = Array.isArray(d.series[m.id]) ? d.series[m.id].slice() : [];
    this.weeks = Array.isArray(d.weeks) ? d.weeks.slice() : [];
    this.prevPop = d.prevPop || 0;
    this.prevGdp = d.prevGdp || 100;
  }
}

function ecoClampS(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ── value formatting ──
function fmtStat(v, kind) {
  switch (kind) {
    case 'int': return Math.round(v).toLocaleString();
    case 'signed': return (v >= 0 ? '+' : '') + Math.round(v).toLocaleString();
    case 'money': return '$' + Math.round(v).toLocaleString();
    case 'moneySigned': return (v >= 0 ? '+$' : '-$') + Math.abs(Math.round(v)).toLocaleString();
    case 'pct100': return Math.round(v) + '%';
    case 'pctf': return v.toFixed(1) + '%';
    case 'dec2': return v.toFixed(2);
    default: return String(Math.round(v));
  }
}

if (typeof module !== 'undefined') module.exports = { Stats, STAT_METRICS, STAT_CATEGORIES };
