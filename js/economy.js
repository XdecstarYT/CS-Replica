/* economy.js — Dynamic macro-economic simulation.
 *
 * Sits ABOVE the existing treasury/budget (which the Government owns). It models
 * the city's economy as a living macro system: GDP, inflation, a central-bank
 * interest rate, employment, consumer confidence, a housing market, industrial
 * production, a stock-market index, bond yields, currency value, foreign
 * investment, business health — all driven by an endogenous business cycle
 * (expansion → peak → recession → trough → recovery) with stochastic shocks.
 *
 * It reads the simulation + government, and feeds back ONLY through additive,
 * default-neutral hooks the simulation already merges (game.sim.econMods), plus
 * one clean cross-link: it sets gov.inflation so debt servicing tracks the
 * macro economy. Nothing existing is rewritten.
 */

function ecoClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function ecoLerp(a, b, t) { return a + (b - a) * t; }

const ECO_PHASES = {
  expansion: { label: 'Expansion', icon: '📈', color: '#4ade80' },
  peak:      { label: 'Peak',      icon: '🔥', color: '#fbbf24' },
  recession: { label: 'Recession', icon: '📉', color: '#f87171' },
  trough:    { label: 'Trough',    icon: '🕳', color: '#a78bfa' },
  recovery:  { label: 'Recovery',  icon: '🌱', color: '#38bdf8' },
  depression:{ label: 'Depression',icon: '💀', color: '#fb7185' },
};

class Economy {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.week = 0;
    // Core indices (100 = baseline health)
    this.gdp = 100;              // current GDP index
    this.gdpReal = 100;          // inflation-adjusted
    this.gdpGrowth = 0.02;       // annualised, fractional
    this.productivity = 1.0;     // output per worker, drifts up slowly
    this.inflation = 0.02;       // annual
    this.interestRate = 0.04;    // central-bank policy rate
    this.unemployment = 0.06;
    this.employment = 0.94;
    this.confidence = 60;        // consumer/business confidence 0..100
    this.housingIndex = 100;     // home price index
    this.commercialDemand = 50;  // 0..100
    this.industrialOutput = 100; // production index
    this.foreignInvest = 50;     // 0..100 inflow pressure
    this.currency = 1.00;        // exchange value
    this.businessHealth = 65;    // 0..100 aggregate firm health

    // Markets
    this.stock = 1000;           // stock-market index
    this.stockHist = [1000];
    this.bondYield = 0.045;

    // Business cycle
    this.phase = 'expansion';
    this.cycle = 0.15;           // 0..1 position around the cycle
    this.cycleSpeed = 0.012;     // base advance per week
    this.shock = 0;              // transient shock to growth
    this.weeksInPhase = 0;

    // Aggregate firm dynamics
    this.firms = { active: 0, hiring: 0, layoffs: 0, bankruptcies: 0, expansions: 0, newFirms: 0 };

    this.news = [];
    this._lastWeek = -1;
    this._publishMods();
  }

  phaseInfo() { return ECO_PHASES[this.phase]; }

  // ── helpers reading the city ──
  _cityStats() {
    const sim = this.game.sim;
    const pop = Math.max(0, sim.population);
    const jobs = sim.jobsC + sim.jobsI;
    const workforce = Math.max(1, pop * 0.55);
    const taxRate = sim.taxRate || 1;
    const gov = this.game.gov;
    const debt = gov ? (gov.debt || 0) : 0;
    const relAvg = gov && gov.relations
      ? Object.values(gov.relations).reduce((a, b) => a + b, 0) / Object.keys(gov.relations).length
      : 50;
    return { pop, jobs, workforce, taxRate, debt, relAvg, happiness: sim.happiness, demand: sim.demand };
  }

  // ── advance the business cycle ──
  _advanceCycle(c) {
    // Speed varies: recoveries are slow, peaks tip over faster; confidence
    // accelerates expansions, fear deepens recessions.
    let speed = this.cycleSpeed;
    if (this.phase === 'expansion') speed *= 0.8 + this.confidence / 200;
    if (this.phase === 'recession') speed *= 1.1 + (60 - this.confidence) / 160;
    if (this.phase === 'recovery')  speed *= 0.7;
    this.cycle = (this.cycle + speed) % 1;
    this.weeksInPhase++;

    // Map cycle position → phase, with hysteresis & shocks.
    const x = this.cycle;
    let next;
    if (x < 0.35) next = 'expansion';
    else if (x < 0.45) next = 'peak';
    else if (x < 0.70) next = 'recession';
    else if (x < 0.80) next = 'trough';
    else next = 'recovery';

    // Severe, prolonged downturns can tip into depression.
    if (next === 'recession' && this.shock < -0.04 && this.confidence < 28) next = 'depression';

    if (next !== this.phase) {
      this.phase = next;
      this.weeksInPhase = 0;
      this._announcePhase(next);
    }
  }

  _announcePhase(p) {
    const m = {
      expansion: 'The economy enters a period of expansion — hiring picks up.',
      peak: 'Growth peaks; markets are exuberant but overheating.',
      recession: 'Analysts declare a recession. Firms tighten spending.',
      trough: 'The downturn bottoms out. Confidence is fragile.',
      recovery: 'Green shoots: the economy begins to recover.',
      depression: 'A deep depression grips the city. Severe job losses expected.',
    }[p];
    if (m) this._pushNews(m, p === 'recession' || p === 'depression' ? 'bad' : p === 'recovery' || p === 'expansion' ? 'good' : 'neutral');
  }

  // ── random macro shocks ──
  _maybeShock() {
    this.shock *= 0.85; // decay
    if (Math.random() < 0.03) {
      const events = [
        { t: 'A tech boom lifts productivity citywide.', s: +0.05, k: 'good', prod: 0.02 },
        { t: 'Global supply-chain snarls raise input costs.', s: -0.03, k: 'bad', infl: 0.01 },
        { t: 'An export deal boosts industrial orders.', s: +0.04, k: 'good' },
        { t: 'Energy prices spike, squeezing margins.', s: -0.035, k: 'bad', infl: 0.015 },
        { t: 'Foreign capital floods local markets.', s: +0.03, k: 'good', fi: 12 },
        { t: 'A credit crunch tightens lending.', s: -0.05, k: 'bad' },
        { t: 'Consumer spending surprises to the upside.', s: +0.03, k: 'good', conf: 6 },
        { t: 'Market jitters spook investors.', s: -0.025, k: 'bad', conf: -8 },
      ];
      const e = events[(Math.random() * events.length) | 0];
      this.shock += e.s;
      if (e.prod) this.productivity += e.prod;
      if (e.infl) this.inflation = ecoClamp(this.inflation + e.infl, -0.02, 0.25);
      if (e.fi) this.foreignInvest = ecoClamp(this.foreignInvest + e.fi, 0, 100);
      if (e.conf) this.confidence = ecoClamp(this.confidence + e.conf, 0, 100);
      this._pushNews(e.t, e.k);
    }
  }

  // ── aggregate firm behaviour (statistical, not per-entity) ──
  _updateFirms(cs, cycleFactor) {
    const totalBiz = Math.round(cs.jobs / 6) + 1; // ~one firm per 6 jobs
    this.firms.active = totalBiz;
    // Health driven by demand, confidence, cycle, taxes, interest.
    const demandPull = (cs.demand.com * 0.5 + cs.demand.ind * 0.5) * 100;
    const taxDrag = (cs.taxRate - 1) * 30;
    const rateDrag = (this.interestRate - 0.04) * 120;
    const healthTarget = ecoClamp(
      35 + cycleFactor * 30 + this.confidence * 0.25 + demandPull * 0.15 - taxDrag - rateDrag, 0, 100);
    this.businessHealth = ecoLerp(this.businessHealth, healthTarget, 0.18);

    // Translate health into flows.
    const h = this.businessHealth;
    this.firms.hiring       = Math.max(0, Math.round(totalBiz * ecoClamp((h - 50) / 100, 0, 0.5)));
    this.firms.layoffs      = Math.max(0, Math.round(totalBiz * ecoClamp((45 - h) / 100, 0, 0.5)));
    this.firms.expansions   = Math.max(0, Math.round(totalBiz * ecoClamp((h - 60) / 140, 0, 0.3)));
    this.firms.bankruptcies = Math.max(0, Math.round(totalBiz * ecoClamp((35 - h) / 130, 0, 0.3)));
    this.firms.newFirms     = Math.max(0, Math.round(totalBiz * ecoClamp((h - 55) / 120, 0, 0.25)));

    // Occasional headline
    if (Math.random() < 0.06) {
      if (h > 70 && this.firms.expansions > 0)
        this._pushNews(`${this.firms.expansions} local firms announce expansions.`, 'good');
      else if (h < 35 && this.firms.bankruptcies > 0)
        this._pushNews(`${this.firms.bankruptcies} businesses file for bankruptcy.`, 'bad');
    }
  }

  // ── main weekly tick ──
  tick() {
    const week = this.game.sim.week;
    if (week === this._lastWeek) return;
    this._lastWeek = week;
    this.week = week;

    const cs = this._cityStats();
    this._maybeShock();
    this._advanceCycle(cs);

    // Cycle factor: -1 (deep recession) .. +1 (strong expansion)
    const phaseBias = { expansion: 0.7, peak: 1.0, recession: -0.7, trough: -1.0, recovery: 0.2, depression: -1.4 }[this.phase];
    const cycleFactor = ecoClamp(phaseBias + this.shock * 6, -1.5, 1.2);

    // Productivity drifts up slowly with education/AI services.
    const eduBoost = (cs.jobs > 0 && this.game.sim.fields) ? 0.0006 : 0.0003;
    this.productivity = ecoClamp(this.productivity + eduBoost, 0.8, 2.5);

    // Employment: cycle pushes hiring/firing around the structural level.
    const structural = ecoClamp(1 - cs.jobs / cs.workforce, 0.02, 0.6);
    const cyclicalUnemp = ecoClamp(0.05 - cycleFactor * 0.06, -0.02, 0.18);
    const unempTarget = ecoClamp(structural * 0.6 + cyclicalUnemp + 0.02, 0.01, 0.65);
    this.unemployment = ecoLerp(this.unemployment, unempTarget, 0.25);
    this.employment = 1 - this.unemployment;

    // GDP: workforce × productivity × employment × cycle, indexed.
    const output = (cs.jobs + cs.pop * 0.3) * this.productivity * this.employment;
    const gdpTarget = 100 + output * 0.06 + cycleFactor * 14;
    this.gdp = ecoLerp(this.gdp, Math.max(1, gdpTarget), 0.2);
    const prevReal = this.gdpReal;
    this.gdpReal = this.gdp / (1 + Math.max(0, this.inflation));
    this.gdpGrowth = ecoClamp((this.gdpReal - prevReal) / Math.max(1, prevReal) * 52, -0.5, 0.6);

    // Inflation: Phillips-curve-ish — heat + money supply, mean-reverting to 2%.
    const heat = ecoClamp((this.employment - 0.94) * 2 + cycleFactor * 0.04, -0.05, 0.08);
    const moneyPressure = ecoClamp(cs.debt / 200000, 0, 0.04);
    const inflTarget = 0.02 + heat + moneyPressure;
    this.inflation = ecoClamp(ecoLerp(this.inflation, inflTarget, 0.2), -0.03, 0.25);

    // Central-bank interest rate: Taylor rule.
    const rateTarget = ecoClamp(0.02 + 1.5 * (this.inflation - 0.02) + 0.5 * this.gdpGrowth + 0.025, 0.005, 0.20);
    this.interestRate = ecoLerp(this.interestRate, rateTarget, 0.15);

    // Consumer & business confidence.
    const confTarget = ecoClamp(
      50 + cycleFactor * 22 + (cs.happiness - 0.5) * 40 - this.unemployment * 60
      + (this.stock / 1000 - 1) * 20 - (this.inflation - 0.02) * 120, 0, 100);
    this.confidence = ecoLerp(this.confidence, confTarget, 0.15);

    // Housing market: demand + cheap credit push prices; supply (built res) cools.
    const hTarget = ecoClamp(
      80 + cs.demand.res * 60 + (0.06 - this.interestRate) * 200 + cycleFactor * 10, 30, 400);
    this.housingIndex = ecoLerp(this.housingIndex, hTarget, 0.1);

    // Commercial demand & industrial output indices.
    this.commercialDemand = ecoLerp(this.commercialDemand, ecoClamp(cs.demand.com * 100 * (0.7 + this.confidence / 200), 0, 100), 0.2);
    this.industrialOutput = ecoLerp(this.industrialOutput, ecoClamp(80 + cs.demand.ind * 50 + cycleFactor * 20, 10, 250), 0.15);

    // Currency value: strong with surpluses, good relations, low inflation.
    const curTarget = ecoClamp(1 + (cs.relAvg - 50) / 200 - (this.inflation - 0.02) * 2 + cycleFactor * 0.05, 0.5, 1.8);
    this.currency = ecoLerp(this.currency, curTarget, 0.08);

    // Foreign investment pressure.
    const fiTarget = ecoClamp(40 + (cs.relAvg - 50) * 0.6 + cycleFactor * 15 + (1 - cs.taxRate) * 20 + this.currency * 10, 0, 100);
    this.foreignInvest = ecoLerp(this.foreignInvest, fiTarget, 0.1);

    // Firms.
    this._updateFirms(cs, cycleFactor);

    // Stock market: drift from growth/confidence + volatility, crashes in recession.
    const drift = this.gdpGrowth * 0.06 + (this.confidence - 50) / 4000 + cycleFactor * 0.002;
    let vol = 0.012 + (this.phase === 'recession' || this.phase === 'depression' ? 0.03 : 0.008);
    let ret = drift + (Math.random() - 0.5) * vol * 2;
    if ((this.phase === 'recession' || this.phase === 'depression') && Math.random() < 0.05) {
      ret -= 0.06; this._pushNews('Stocks tumble in heavy selling.', 'bad');
    }
    ret = ecoClamp(ret, -0.12, 0.12);          // keep weekly moves sane
    this.stock = Math.max(50, this.stock * (1 + ret));
    this.stockHist.push(this.stock);
    if (this.stockHist.length > 260) this.stockHist.shift();

    // Bond yield tracks policy rate + credit risk.
    const gov = this.game.gov;
    const creditRisk = gov ? ({ AAA: 0, AA: 0.005, A: 0.012, BBB: 0.025, BB: 0.045, B: 0.08 }[gov.creditRating] || 0.02) : 0.01;
    this.bondYield = this.interestRate + 0.005 + creditRisk;

    // Cross-link: let the government's debt servicing track macro inflation.
    if (gov) gov.inflation = this.inflation;

    this._publishMods(cycleFactor);
  }

  // ── feed the simulation through additive, neutral hooks ──
  _publishMods(cycleFactor) {
    const cf = cycleFactor === undefined ? 0 : cycleFactor;
    // Booms grow the city faster & lift tax take; recessions slow it.
    const growthMult = ecoClamp(1 + cf * 0.18 + (this.confidence - 50) / 400, 0.55, 1.4);
    const taxMult    = ecoClamp(1 + (this.gdp - 100) / 600 - (this.unemployment - 0.06) * 0.8, 0.6, 1.5);
    const happyAdd   = ecoClamp((this.confidence - 50) / 600 - (this.unemployment - 0.06) * 0.5 - Math.max(0, this.inflation - 0.05) * 0.6, -0.12, 0.08);
    this.game.sim.econMods = { growthMult, taxMult, happyAdd };
  }

  _pushNews(text, kind) {
    this.news.unshift({ text, kind: kind || 'neutral', week: this.week });
    if (this.news.length > 30) this.news.pop();
  }

  // ── headline summary for HUD/AI ──
  summary() {
    return {
      phase: this.phase, phaseInfo: this.phaseInfo(),
      gdp: this.gdp, gdpGrowth: this.gdpGrowth,
      inflation: this.inflation, interestRate: this.interestRate,
      unemployment: this.unemployment, confidence: this.confidence,
      stock: this.stock, housingIndex: this.housingIndex,
      currency: this.currency, businessHealth: this.businessHealth,
    };
  }

  serialize() {
    return {
      week: this.week, gdp: this.gdp, gdpReal: this.gdpReal, gdpGrowth: this.gdpGrowth,
      productivity: this.productivity, inflation: this.inflation, interestRate: this.interestRate,
      unemployment: this.unemployment, confidence: this.confidence, housingIndex: this.housingIndex,
      commercialDemand: this.commercialDemand, industrialOutput: this.industrialOutput,
      foreignInvest: this.foreignInvest, currency: this.currency, businessHealth: this.businessHealth,
      stock: this.stock, stockHist: this.stockHist.slice(-120), bondYield: this.bondYield,
      phase: this.phase, cycle: this.cycle, shock: this.shock, weeksInPhase: this.weeksInPhase,
      news: this.news.slice(0, 15),
    };
  }

  load(d) {
    if (!d) return;
    Object.assign(this, d);
    if (!Array.isArray(this.stockHist) || !this.stockHist.length) this.stockHist = [this.stock || 1000];
    if (!Array.isArray(this.news)) this.news = [];
    this._publishMods(0);
  }
}

if (typeof module !== 'undefined') module.exports = { Economy, ECO_PHASES };
