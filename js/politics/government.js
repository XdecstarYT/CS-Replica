/* politics/government.js — the Politics & Government simulation engine.
 *
 * Reads the existing city simulation, models the electorate statistically
 * (demographic cohorts × grid districts → scales to any population), runs
 * elections, a parliament with bills, a detailed budget, party AI, media,
 * events, protests and foreign relations. Feeds back ONLY through additive,
 * default-neutral hooks (game.sim.policyMods) so existing systems are intact.
 */

function polClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

class Government {
  constructor(game) {
    this.game = game;
    this.config = { electionYears: 4, weeksPerYear: 52, seats: 31, eventEveryWeeks: 26 };
    this.reset();
  }

  reset() {
    this.partyState = {};
    PARTIES.forEach(p => { this.partyState[p.id] = { polling: p.base, seats: 0, popMod: 0 }; });
    this.rulingParty = null;
    this.coalition = [];
    this.approval = 50;
    this.stability = 70;
    this.politicalCapital = 6;
    this.activeLaws = new Set();
    this.bills = [];
    this.news = [];
    this.lastElection = null;
    this.nextElectionWeek = this.config.electionYears * this.config.weeksPerYear;
    this.media = { bias: 0 };          // -100 hostile .. +100 favourable
    this.relations = { eastland: 55, westmark: 50, northvale: 62, southreach: 46 };
    this.relMeta = {
      eastland: { name: 'Eastland Federation', flag: '🟦' },
      westmark: { name: 'Westmark Republic', flag: '🟥' },
      northvale: { name: 'Northvale Union', flag: '🟩' },
      southreach: { name: 'Southreach Coast', flag: '🟨' },
    };
    this.debt = 0; this.bonds = 0; this.loans = 0;
    this.creditRating = 'AA'; this.interestRate = 0.04; this.inflation = 0.02;
    this.drivers = {};
    this.effects = { taxMult: 1, growthMult: 1, happyAdd: 0, upkeepAdd: 0, revenueAdd: 0, crime: 0, pollution: 0 };
    this.tempHappy = 0;
    this.budget = null;
    this.pendingEvent = null;
    this.eventCooldown = 12;
    this.unrest = false;
    this._lastWeek = -1;

    // ── Political-ecosystem layer (lobbying, corruption, protests, delay) ──
    this.lawProgress = {};        // lawId -> 0..1 implementation factor (effects ramp in)
    this.corruption = 0;          // 0..100 — rises with shady deals, risks scandals
    this.scandals = [];           // recent scandal records
    this.protest = null;          // { cause, weeksLeft, severity } while active
    this.pendingDeal = null;      // a lobby's standing offer to the mayor
    this.dealCooldown = 10;
    this.lobby = {};
    LOBBY_GROUPS.forEach(gp => { this.lobby[gp.id] = { satisfaction: 50, influence: gp.influence }; });

    // ── Ideology, bureaucracy & mayoral pledges ──
    this.ideology = { growthMult: 1, happyAdd: 0, construction: 1 };
    this.departments = {
      planning:  { eff: 0.6, name: 'Urban Planning', icon: '📐' },
      transport: { eff: 0.6, name: 'Transport Authority', icon: '🚦' },
      finance:   { eff: 0.6, name: 'Finance Dept', icon: '🏦' },
      emergency: { eff: 0.6, name: 'Emergency Services', icon: '🚑' },
    };
    this.promises = [];
    this._promiseBaseTax = 1; this._promiseBaseDebt = 0; this._promiseBasePop = 0;

    this._computeDrivers();
    this._recomputeEffects();
    this._allocateSeats(this._popularVote());
    this._formGovernment();
    this._computeBudget();
    this._setPromises();
  }

  year() { return Math.floor(this.game.sim.week / this.config.weeksPerYear) + 1; }
  weeksToElection() { return Math.max(0, this.nextElectionWeek - this.game.sim.week); }

  // ───────────────────────── City political drivers ─────────────────────────
  _computeDrivers() {
    const sim = this.game.sim, g = this.game.grid, f = sim.fields;
    let occ = 0, safe = 0, health = 0, edu = 0, amen = 0, indCount = 0, resCount = 0;
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t === TILE.ZONE_IND) indCount++;
      if (t === TILE.ZONE_RES) resCount++;
      const isZone = t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND;
      if (!isZone || g.pop[i] === 0) continue;
      occ++;
      if (f) { safe += f.safety[i]; health += f.health[i]; edu += f.education[i]; amen += f.happy[i]; }
    }
    const denom = Math.max(1, occ);
    const safety = safe / denom, healthCov = health / denom, eduCov = edu / denom, amenities = amen / denom;
    const jobs = sim.jobsC + sim.jobsI;
    const workforce = Math.max(1, sim.population * 0.5);
    const unemployment = polClamp(1 - jobs / workforce, 0, 1);
    const pollution = polClamp(indCount / Math.max(8, resCount + indCount) * 1.4 + this.effects.pollution, 0, 1);
    const housing = polClamp(1 - (sim.demand.res * 0.6 + (sim.taxRate - 1) * 0.3), 0, 1);
    this.drivers = {
      pop: sim.population, happy: sim.happiness, taxRate: sim.taxRate, unemployment,
      crime: polClamp(1 - safety + this.effects.crime, 0, 1),
      pollution, health: healthCov, education: eduCov, amenities, housing,
      budget: sim.lastBalance, jobs,
    };
  }

  // The "median voter" ideology the city currently wants, derived from drivers.
  _desiredVector() {
    const d = this.drivers;
    const D = {
      econ: polClamp((d.taxRate - 1) * 0.8 - d.unemployment * 0.6 - (1 - (d.health + d.education + d.amenities) / 3) * 0.4, -1, 1),
      env: polClamp(d.pollution * 0.9 - 0.15, -1, 1),
      auth: polClamp(d.crime * 0.9 - 0.25, -1, 1),
      social: polClamp(d.crime * 0.3 - (1 - d.happy) * 0.1, -1, 1),
      nat: polClamp(d.unemployment * 0.35 - 0.1, -1, 1),
    };
    return D;
  }

  _cohortWeights() {
    const d = this.drivers;
    // Re-weight cohorts from city composition (kept normalised).
    const raw = {
      working: 0.30 + d.unemployment * 0.10,
      affluent: 0.18 + (1 - d.taxRate + 1) * 0.04 + d.happy * 0.05,
      young: 0.20 + d.education * 0.08,
      seniors: 0.18 + (1 - d.happy) * 0.04,
      business: 0.14 + (1 - d.unemployment) * 0.05,
    };
    let s = 0; for (const k in raw) s += raw[k];
    for (const k in raw) raw[k] /= s;
    return raw;
  }

  _appeal(party, desire) {
    let a = party.base + this.partyState[party.id].popMod * 0.01;
    a += 0.85 * (polSimilarity(party.vec, desire) + 1) / 2;
    if (this.rulingParty === party.id) a += (this.approval - 50) / 120 + this.media.bias / 400;
    else a -= this.media.bias / 900;
    return Math.max(0.001, a);
  }

  // Citywide vote shares {partyId: 0..1}.
  _popularVote() {
    const D = this._desiredVector();
    const cw = this._cohortWeights();
    const tally = {}; PARTIES.forEach(p => tally[p.id] = 0);
    for (const c of VOTER_COHORTS) {
      const cd = {};
      for (const k of POL_AXES) cd[k] = 0.6 * D[k] + 0.4 * (c.lean[k] || 0);
      const ap = {}; let sum = 0;
      for (const p of PARTIES) { ap[p.id] = this._appeal(p, cd); sum += ap[p.id]; }
      for (const p of PARTIES) tally[p.id] += cw[c.id] * ap[p.id] / sum;
    }
    return tally;
  }

  // ───────────────────────── Districts (electoral map) ─────────────────────────
  _districtVotes() {
    const g = this.game.grid, f = this.game.sim.fields;
    const N = 4, cw = Math.ceil(g.w / N), ch = Math.ceil(g.h / N);
    const cells = [];
    for (let r = 0; r < N; r++) for (let cI = 0; cI < N; cI++)
      cells.push({ row: r, col: cI, pop: 0, safe: 0, occ: 0, ind: 0 });
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y), t = g.type[i];
      const cell = cells[Math.min(N - 1, (y / ch) | 0) * N + Math.min(N - 1, (x / cw) | 0)];
      if (t === TILE.ZONE_IND) cell.ind++;
      if (g.pop[i] > 0) { cell.pop += g.pop[i]; cell.occ++; if (f) cell.safe += f.safety[i]; }
    }
    const D = this._desiredVector();
    const out = [];
    for (const cell of cells) {
      if (cell.pop <= 0) { out.push({ ...cell, winner: null, shares: null }); continue; }
      const localSafety = cell.occ ? cell.safe / cell.occ : 0.5;
      const local = {
        econ: polClamp(D.econ + (0.4 - localSafety) * 0.2, -1, 1),
        env: polClamp(D.env + cell.ind / Math.max(4, cell.occ) * 0.4, -1, 1),
        auth: polClamp(D.auth + (0.5 - localSafety) * 0.5, -1, 1),
        social: D.social, nat: D.nat,
      };
      const ap = {}; let sum = 0;
      for (const p of PARTIES) { ap[p.id] = this._appeal(p, local); sum += ap[p.id]; }
      let best = null, bestv = -1; const shares = {};
      for (const p of PARTIES) { const s = ap[p.id] / sum; shares[p.id] = s; if (s > bestv) { bestv = s; best = p.id; } }
      out.push({ row: cell.row, col: cell.col, pop: cell.pop, winner: best, shares });
    }
    return out;
  }

  // ───────────────────────── Seats & government formation ─────────────────────────
  _allocateSeats(popular) {
    const seats = this.config.seats;
    const threshold = 0.05;
    const eligible = PARTIES.filter(p => popular[p.id] >= threshold);
    let total = eligible.reduce((s, p) => s + popular[p.id], 0) || 1;
    const alloc = {}; let assigned = 0; const rema = [];
    for (const p of PARTIES) this.partyState[p.id].seats = 0;
    for (const p of eligible) {
      const exact = popular[p.id] / total * seats;
      alloc[p.id] = Math.floor(exact);
      rema.push({ id: p.id, frac: exact - Math.floor(exact) });
      assigned += alloc[p.id];
    }
    rema.sort((a, b) => b.frac - a.frac);
    let k = 0;
    while (assigned < seats && rema.length) { alloc[rema[k % rema.length].id]++; assigned++; k++; }
    for (const id in alloc) this.partyState[id].seats = alloc[id];
    return alloc;
  }

  _formGovernment() {
    const ranked = PARTIES.map(p => ({ id: p.id, seats: this.partyState[p.id].seats }))
      .filter(p => p.seats > 0).sort((a, b) => b.seats - a.seats);
    const majority = Math.floor(this.config.seats / 2) + 1;
    if (!ranked.length) { this.rulingParty = 'ind'; this.coalition = ['ind']; return; }
    if (ranked[0].seats >= majority) { this.rulingParty = ranked[0].id; this.coalition = [ranked[0].id]; return; }
    // Coalition: largest party invites ideologically nearest partners until majority.
    const lead = ranked[0].id;
    const leadVec = PARTY_BY_ID[lead].vec;
    const partners = ranked.slice(1)
      .sort((a, b) => polSimilarity(PARTY_BY_ID[b.id].vec, leadVec) - polSimilarity(PARTY_BY_ID[a.id].vec, leadVec));
    const coalition = [lead]; let sum = ranked[0].seats;
    for (const p of partners) {
      if (sum >= majority) break;
      if (polSimilarity(PARTY_BY_ID[p.id].vec, leadVec) < -0.2) continue; // won't partner with opposites
      coalition.push(p.id); sum += p.seats;
    }
    this.rulingParty = lead;
    this.coalition = coalition;
  }

  coalitionSeats() { return this.coalition.reduce((s, id) => s + this.partyState[id].seats, 0); }
  hasMajority() { return this.coalitionSeats() >= Math.floor(this.config.seats / 2) + 1; }

  // ───────────────────────── Elections ─────────────────────────
  runElection() {
    this._settlePromises();                 // judge the outgoing term's pledges
    const popular = this._popularVote();
    const districts = this._districtVotes();
    this._allocateSeats(popular);
    const prevRuling = this.rulingParty;
    this._formGovernment();
    const turnout = polClamp(0.45 + this.approval / 320 + this.game.sim.happiness * 0.2, 0.30, 0.93);
    this.lastElection = {
      popular, districts, turnout, year: this.year(), week: this.game.sim.week,
      seats: Object.fromEntries(PARTIES.map(p => [p.id, this.partyState[p.id].seats])),
      ruling: this.rulingParty, coalition: this.coalition.slice(),
    };
    this.nextElectionWeek = this.game.sim.week + this.config.electionYears * this.config.weeksPerYear;
    this.politicalCapital = Math.min(12, this.politicalCapital + 3);
    this.approval = polClamp(50 + (this.approval - 50) * 0.4, 35, 65);
    this._setPromises();                    // new government makes new pledges
    const winName = PARTY_BY_ID[this.rulingParty].name;
    this._pushNews(prevRuling === this.rulingParty
      ? `${winName} re-elected to lead the council.`
      : `${winName} wins the election, ousting the incumbent.`,
      'TV', this.rulingParty);
    if (!this.hasMajority()) this._pushNews(`No majority — ${winName} forms a coalition of ${this.coalition.length} parties.`, 'Newspaper', 'ind');
    return this.lastElection;
  }

  // ───────────────────────── Parliament / bills ─────────────────────────
  partyStance(partyId, law, repeal) {
    let s = polSimilarity(PARTY_BY_ID[partyId].vec, law.vec);
    if (repeal) s = -s;
    return s;
  }

  // Net pressure (−/+) that the external lobbies exert on a given law.
  _lobbyPressure(lawId) {
    let p = 0;
    for (const gp of LOBBY_GROUPS) {
      const st = this.lobby[gp.id]; if (!st) continue;
      const w = (st.satisfaction / 100) * st.influence * 0.16;
      if (gp.favors.includes(lawId)) p += w;
      if (gp.opposes.includes(lawId)) p -= w;
    }
    return p;
  }

  projectVotes(bill) {
    const law = LAW_BY_ID[bill.lawId];
    let yes = 0, no = 0; const byParty = {};
    let lobbyP = this._lobbyPressure(bill.lawId);
    if (bill.repeal) lobbyP = -lobbyP;                                   // lobbies resist repeal of laws they like
    for (const p of PARTIES) {
      const seats = this.partyState[p.id].seats;
      if (seats === 0) { byParty[p.id] = { seats, support: 0, vote: 'abstain' }; continue; }
      let support = this.partyStance(p.id, law, bill.repeal);
      if (this.coalition.includes(p.id)) support += 0.18;               // government discipline
      support += (bill.lobbied[p.id] || 0);                              // player lobbying
      support += lobbyP;                                                 // external lobby pressure
      const vote = support > 0.06 ? 'yes' : support < -0.06 ? 'no' : 'abstain';
      if (vote === 'yes') yes += seats; else if (vote === 'no') no += seats;
      byParty[p.id] = { seats, support, vote };
    }
    return { yes, no, byParty, needed: Math.floor(this.config.seats / 2) + 1 };
  }

  introduceBill(lawId, repeal) {
    const law = LAW_BY_ID[lawId];
    if (!law) return null;
    const active = this.activeLaws.has(lawId);
    repeal = repeal !== undefined ? repeal : active;
    if (!repeal && active) return null;
    if (repeal && !active) return null;
    const bill = { id: 'b' + Date.now() + Math.floor(Math.random() * 999), lawId, repeal, status: 'pending', lobbied: {} };
    this.bills.unshift(bill);
    this._pushNews(`Bill introduced: ${repeal ? 'Repeal ' : ''}${law.name}.`, 'Online', this.rulingParty);
    return bill;
  }

  lobby(billId, partyId) {
    const bill = this.bills.find(b => b.id === billId);
    if (!bill || bill.status !== 'pending') return false;
    if (this.politicalCapital < 2) return false;
    this.politicalCapital -= 2;
    bill.lobbied[partyId] = (bill.lobbied[partyId] || 0) + 0.22;
    return true;
  }

  voteBill(billId) {
    const bill = this.bills.find(b => b.id === billId);
    if (!bill || bill.status !== 'pending') return null;
    const proj = this.projectVotes(bill);
    const passed = proj.yes > proj.no;
    bill.status = passed ? 'passed' : 'rejected';
    bill.result = proj;
    const law = LAW_BY_ID[bill.lawId];
    if (passed) {
      if (bill.repeal) { this.activeLaws.delete(bill.lawId); delete this.lawProgress[bill.lawId]; }
      else { this.activeLaws.add(bill.lawId); this.lawProgress[bill.lawId] = bill.fastTrack ? 0.5 : 0; } // begins phasing in
      if (law.fx.approval) this.approval = polClamp(this.approval + law.fx.approval, 0, 100);
      this._recomputeEffects();
      this._pushNews(`PASSED: ${bill.repeal ? 'Repeal of ' : ''}${law.name} — implementation begins.`, 'TV', this.rulingParty);
    } else {
      this._pushNews(`REJECTED: ${bill.repeal ? 'Repeal of ' : ''}${law.name} (${proj.yes}–${proj.no}).`, 'Newspaper', null);
    }
    // keep recent history of decided bills small
    this.bills = this.bills.filter(b => b.status === 'pending').concat(this.bills.filter(b => b.status !== 'pending').slice(0, 6));
    return bill;
  }

  // ───────────────────────── Policy effects → sim hooks ─────────────────────────
  _recomputeEffects() {
    const e = { taxMult: 1, growthMult: 1, happyAdd: 0, upkeepAdd: 0, revenueAdd: 0, crime: 0, pollution: 0 };
    for (const id of this.activeLaws) {
      const fx = LAW_BY_ID[id].fx;
      // Laws phase in: their effects scale with implementation progress (0..1),
      // so a passed law reshapes the city gradually, not instantly.
      const prog = this.lawProgress[id] != null ? this.lawProgress[id] : 1;
      if (fx.taxMult) e.taxMult *= 1 + (fx.taxMult - 1) * prog;
      if (fx.growthMult) e.growthMult *= 1 + (fx.growthMult - 1) * prog;
      if (fx.happyAdd) e.happyAdd += fx.happyAdd * prog;
      if (fx.upkeepAdd) e.upkeepAdd += fx.upkeepAdd * prog;
      if (fx.revenueAdd) e.revenueAdd += fx.revenueAdd * prog;
      if (fx.crime) e.crime += fx.crime * prog;
      if (fx.pollution) e.pollution += fx.pollution * prog;
    }
    // Debt servicing folds into weekly upkeep.
    e.upkeepAdd += (this.debt + this.loans) * this.interestRate / this.config.weeksPerYear;
    // Active protests physically drag on the city: growth stalls, mood dips.
    let protestHappy = 0;
    if (this.protest && this.protest.weeksLeft > 0) {
      e.growthMult *= 1 - 0.12 * this.protest.severity;
      protestHappy = -0.06 * this.protest.severity;
    }
    // The ruling coalition's ideology tilts the whole city, not just its laws.
    this._recomputeIdeology();
    // An efficient Finance Dept collects tax better; a captured one leaks it.
    const fin = this.departments ? this.departments.finance.eff : 0.6;
    e.taxMult *= 0.94 + fin * 0.10;
    this.effects = e;
    // Push additive, default-neutral modifiers the simulation already reads.
    this.game.sim.policyMods = {
      taxMult: e.taxMult,
      growthMult: e.growthMult * this.ideology.growthMult,
      happyAdd: e.happyAdd + this.tempHappy + protestHappy + this.ideology.happyAdd,
      upkeepAdd: e.upkeepAdd,
      revenueAdd: e.revenueAdd,
    };
  }

  // Average ideology vector of the governing coalition.
  _coalitionVec() {
    const v = { econ: 0, env: 0, auth: 0, social: 0, nat: 0 };
    const ids = (this.coalition && this.coalition.length) ? this.coalition : [this.rulingParty];
    let n = 0;
    for (const id of ids) { const p = PARTY_BY_ID[id]; if (!p) continue; for (const k of POL_AXES) v[k] += p.vec[k] || 0; n++; }
    if (n) for (const k of POL_AXES) v[k] /= n;
    return v;
  }

  // Translate that ideology into city-wide behavioural tilts (5.2): a growth-
  // first government builds faster but greener ones rein it in, etc.
  _recomputeIdeology() {
    const v = this._coalitionVec();
    this.ideology = {
      growthMult: polClamp(1 + v.econ * 0.05 - v.env * 0.04, 0.85, 1.15),
      happyAdd: v.env * 0.02 - v.auth * 0.02,
      construction: polClamp(1 + v.econ * 0.06 - v.env * 0.05, 0.8, 1.2),
    };
  }

  // Bureaucratic throughput on construction & permitting (read by Construction).
  constructionFactor() {
    const planning = this.departments ? this.departments.planning.eff : 0.6;
    return (0.6 + planning * 0.6) * (this.ideology ? this.ideology.construction : 1);
  }

  // Departments drift toward an efficiency set by approval, funding & graft (5.5).
  _tickDepartments() {
    if (!this.departments) return;
    const net = this.budget ? this.budget.net : 0;
    const fund = net >= 0 ? 0.06 : -0.06;
    const base = 0.55 + (this.approval - 50) / 200 - this.corruption / 300 + fund;
    for (const k in this.departments) {
      let t = base;
      if (k === 'emergency') t += (this.stability - 50) / 300;
      if (k === 'finance' && this.creditRating === 'AAA') t += 0.05;
      this.departments[k].eff += (polClamp(t, 0.2, 1) - this.departments[k].eff) * 0.1;
    }
  }

  // ── Mayoral pledges (5.1): each election the new government commits to terms
  // that become binding; breaking one costs approval and makes news. ──
  _setPromises() {
    const v = this._coalitionVec();
    this._promiseBaseTax = this.game.sim.taxRate;
    this._promiseBaseDebt = this.debt;
    this._promiseBasePop = this.game.sim.population;
    const pool = [];
    pool.push(v.econ >= 0
      ? { id: 'lowtax', label: 'Keep taxes low', broken: false }
      : { id: 'services', label: 'Protect public services', broken: false });
    pool.push({ id: 'nodebt', label: 'No big new borrowing', broken: false });
    pool.push(v.env > 0.2
      ? { id: 'green', label: 'Pass a green law this term', broken: false, term: true }
      : { id: 'growth', label: 'Grow the city this term', broken: false, term: true });
    this.promises = pool;
  }

  _promiseViolated(p) {
    const sim = this.game.sim;
    if (p.id === 'lowtax') return sim.taxRate > this._promiseBaseTax + 0.12;
    if (p.id === 'services') return this.effects.upkeepAdd < -150;       // gutted spending
    if (p.id === 'nodebt') return this.debt > this._promiseBaseDebt + 15000;
    return false;
  }

  _checkPromises() {
    for (const p of this.promises) {
      if (p.broken || p.term) continue;
      if (this._promiseViolated(p)) {
        p.broken = true;
        this.approval = polClamp(this.approval - 5, 0, 100);
        this.media.bias = polClamp(this.media.bias - 12, -100, 100);
        this._pushNews(`Broken promise: the mayor pledged to "${p.label}".`, 'Breaking', null);
      }
    }
  }

  // Settle end-of-term ("term") pledges at the next election.
  _settlePromises() {
    const envLaws = ['emissions', 'green_energy', 'transit', 'building_codes'];
    for (const p of this.promises) {
      if (!p.term || p.broken) continue;
      let kept = true;
      if (p.id === 'green') kept = envLaws.some(id => this.activeLaws.has(id));
      if (p.id === 'growth') kept = this.game.sim.population >= this._promiseBasePop * 0.95;
      if (kept) { this.approval = polClamp(this.approval + 4, 0, 100); }
      else { this.approval = polClamp(this.approval - 6, 0, 100); this._pushNews(`Unkept pledge: "${p.label}".`, 'Newspaper', null); }
    }
  }

  // ───────────────────────── Budget / treasury ─────────────────────────
  _computeBudget() {
    const sim = this.game.sim, d = this.drivers;
    const pop = sim.population, jobs = sim.jobsC + sim.jobsI;
    const tm = this.effects.taxMult;
    const income = Math.round(pop * 1.4 * sim.taxRate * tm * (0.6 + sim.happiness * 0.6));
    const property = Math.round(pop * 0.5 * sim.taxRate);
    const sales = Math.round(jobs * 0.6);
    const corporate = Math.round(sim.jobsC * 0.4 + sim.jobsI * 0.3);
    const fees = Math.round(this.effects.revenueAdd);
    const revenue = income + property + sales + corporate + fees;
    let services = 0, roads = 0;
    const g = this.game.grid;
    for (let i = 0; i < g.type.length; i++) {
      if (g.type[i] === TILE.SERVICE) { const s = SERVICE_BY_ID[g.service[i]]; if (s) services += s.upkeep; }
      else if (g.type[i] === TILE.ROAD) roads++;
    }
    const policyUpkeep = Math.round(this.effects.upkeepAdd);
    const debtInterest = Math.round((this.debt + this.loans) * this.interestRate / this.config.weeksPerYear);
    const expense = services + Math.round(roads * 0.05) + Math.max(0, policyUpkeep);
    const net = revenue - expense;
    // Credit rating from debt-to-revenue ratio.
    const annualRev = Math.max(1, revenue * this.config.weeksPerYear);
    const ratio = (this.debt + this.loans) / annualRev;
    this.creditRating = ratio < 0.3 ? 'AAA' : ratio < 0.6 ? 'AA' : ratio < 1.0 ? 'A' : ratio < 1.6 ? 'BBB' : ratio < 2.4 ? 'BB' : 'B';
    this.interestRate = 0.03 + ratio * 0.04 + this.inflation;
    this.budget = {
      revenue: { income, property, sales, corporate, fees, total: revenue },
      expense: { services, roads: Math.round(roads * 0.05), policy: Math.max(0, policyUpkeep), debt: debtInterest, total: expense },
      net, debt: this.debt, bonds: this.bonds, loans: this.loans,
      creditRating: this.creditRating, interestRate: this.interestRate, inflation: this.inflation,
    };
    return this.budget;
  }

  issueBond(amount) {
    amount = amount || 20000;
    this.game.sim.money += amount; this.bonds += amount; this.debt += amount;
    this._recomputeEffects(); this._computeBudget();
    this._pushNews(`City issues $${amount.toLocaleString()} in municipal bonds.`, 'Online', null);
  }
  takeLoan(amount) {
    amount = amount || 10000;
    this.game.sim.money += amount; this.loans += amount; this.debt += amount;
    this._recomputeEffects(); this._computeBudget();
    this._pushNews(`City takes a $${amount.toLocaleString()} loan.`, 'Online', null);
  }
  repayDebt(amount) {
    amount = Math.min(amount || 10000, this.debt, Math.max(0, this.game.sim.money));
    if (amount <= 0) return;
    this.game.sim.money -= amount; this.debt -= amount;
    this.loans = Math.max(0, this.loans - amount); if (this.loans < 0) this.loans = 0;
    this.bonds = Math.max(0, this.debt - this.loans);
    this._recomputeEffects(); this._computeBudget();
    this._pushNews(`City repays $${amount.toLocaleString()} of debt.`, 'Online', null);
  }

  // ───────────────────────── Approval / stability / media ─────────────────────────
  _updateApproval() {
    const sim = this.game.sim, d = this.drivers;
    const rulingVec = PARTY_BY_ID[this.rulingParty].vec;
    const align = (polSimilarity(rulingVec, this._desiredVector()) + 1) / 2;     // 0..1
    const budgetHealth = sim.money > 0 ? (sim.lastBalance >= 0 ? 1 : 0.6) : 0.25;
    const perf = sim.happiness * 0.45 + (1 - d.crime) * 0.15 + (1 - d.unemployment) * 0.15
               + budgetHealth * 0.15 + (1 - d.pollution) * 0.10;
    let target = (perf * 0.6 + align * 0.4) * 100 + this.media.bias * 0.08;
    target = polClamp(target, 3, 97);
    this.approval += (target - this.approval) * 0.12;
    this.media.bias *= 0.92;                         // bias decays toward neutral
    this.tempHappy *= 0.90;                          // event happiness decays
    const order = (1 - d.crime) * 100;
    const stabTarget = this.approval * 0.6 + order * 0.4;
    this.stability += (stabTarget - this.stability) * 0.10;
    this.unrest = this.approval < 35 || this.stability < 38;
  }

  // ───────────────────────── Party AI ─────────────────────────
  _partyAI() {
    const D = this._desiredVector();
    for (const p of PARTIES) {
      // Parties drift their standing toward how well they match the public mood,
      // tempered by incumbency (the governing bloc owns the city's results).
      const fit = (polSimilarity(p.vec, D) + 1) / 2;
      let target = fit * 6 - 3;
      if (this.coalition.includes(p.id)) target += (this.approval - 50) / 12;
      else target += (50 - this.approval) / 30;     // opposition gains when govt unpopular
      this.partyState[p.id].popMod += (target - this.partyState[p.id].popMod) * 0.15;
      // ease polling toward live vote share
    }
    const pv = this._popularVote();
    for (const p of PARTIES) this.partyState[p.id].polling += (pv[p.id] - this.partyState[p.id].polling) * 0.2;

    // Opposition occasionally proposes a populist bill if the player is idle.
    if (this.bills.filter(b => b.status === 'pending').length === 0 && Math.random() < 0.04) {
      const candidates = LAWS.filter(l => !this.activeLaws.has(l.id))
        .map(l => ({ l, fit: polSimilarity(PARTY_BY_ID[this.rulingParty].vec, l.vec) }))
        .sort((a, b) => b.fit - a.fit);
      if (candidates.length) this.introduceBill(candidates[0].l.id, false);
    }
  }

  // ───────────────────────── International relations ─────────────────────────
  _updateRelations() {
    for (const k in this.relations) {
      this.relations[k] += (50 - this.relations[k]) * 0.01;   // drift toward neutral
      this.relations[k] = polClamp(this.relations[k], 0, 100);
    }
    if (Math.random() < 0.02) {
      const keys = Object.keys(this.relations);
      const k = keys[(Math.random() * keys.length) | 0];
      if (this.relations[k] > 70 && Math.random() < 0.5) {
        const grant = 4000 + Math.floor(Math.random() * 6000);
        this.game.sim.money += grant;
        this._pushNews(`${this.relMeta[k].name} sends a $${grant.toLocaleString()} development grant.`, 'Newspaper', null);
      } else if (this.relations[k] < 30) {
        this._pushNews(`Tensions rise with ${this.relMeta[k].name}.`, 'TV', null);
      }
    }
  }

  // ───────────────────────── Events ─────────────────────────
  _maybeEvent() {
    if (this.pendingEvent || this.eventCooldown > 0) return;
    if (Math.random() > 0.5) return;
    const avail = POL_EVENTS.filter(e => !e.when || e.when(this));
    if (!avail.length) return;
    let total = avail.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    let chosen = avail[0];
    for (const e of avail) { r -= e.weight; if (r <= 0) { chosen = e; break; } }
    this.pendingEvent = chosen;
    this.eventCooldown = this.config.eventEveryWeeks;
  }

  resolveEvent(choiceIndex) {
    const ev = this.pendingEvent;
    if (!ev) return;
    const ch = ev.choices[choiceIndex] || ev.choices[0];
    const fx = ch.effects || {};
    if (fx.money) this.game.sim.money += fx.money;
    if (fx.approval) this.approval = polClamp(this.approval + fx.approval, 0, 100);
    if (fx.stability) this.stability = polClamp(this.stability + fx.stability, 0, 100);
    if (fx.happyAddTmp) this.tempHappy += fx.happyAddTmp;
    if (fx.media) this.media.bias = polClamp(this.media.bias + fx.media * 6, -100, 100);
    if (fx.popularity) for (const id in fx.popularity) if (this.partyState[id]) this.partyState[id].popMod += fx.popularity[id];
    if (fx.relations) for (const id in fx.relations) if (this.relations[id] != null) this.relations[id] = polClamp(this.relations[id] + fx.relations[id], 0, 100);
    if (fx.enact && !this.activeLaws.has(fx.enact)) this.activeLaws.add(fx.enact);
    if (fx.repeal && this.activeLaws.has(fx.repeal)) this.activeLaws.delete(fx.repeal);
    if (fx.news) this._pushNews(fx.news, 'Breaking', null);
    this._recomputeEffects();
    this.pendingEvent = null;
  }

  // ───────────────────────── Protests ─────────────────────────
  startProtest(cause, severity) {
    severity = polClamp(severity ?? 0.5, 0.2, 1);
    this.protest = { cause, severity, weeksLeft: 3 + Math.round(severity * 4) };
    this.stability = polClamp(this.stability - 4 * severity * 5, 0, 100);
    this.approval = polClamp(this.approval - 2, 0, 100);
    this._recomputeEffects();
    this._pushNews(`Protesters flood the streets over ${cause} — the city grinds.`, 'Breaking', null);
  }

  _maybeProtest() {
    if (this.protest && this.protest.weeksLeft > 0) return;     // one at a time
    if (!this.unrest) return;
    if (Math.random() < 0.12) {
      const causes = ['housing costs', 'unemployment', 'service cuts', 'pollution', 'the cost of living'];
      const cause = causes[(Math.random() * causes.length) | 0];
      const severity = polClamp((50 - this.approval) / 50 + (50 - this.stability) / 80, 0.3, 1);
      this.startProtest(cause, severity);
    }
  }

  // ───────────────────────── Lobbying, corruption, propagation ─────────────────────────
  _tickPolitics() {
    // 1) Laws phase in over time — faster if the city is well-run and the
    //    Urban Planning dept is efficient; bureaucratic decay slows it (5.5).
    const planning = this.departments ? this.departments.planning.eff : 0.6;
    const ramp = (0.12 + (this.approval - 50) / 1000) * (0.5 + planning * 0.7);
    for (const id of this.activeLaws) {
      const p = this.lawProgress[id];
      if (p != null && p < 1) this.lawProgress[id] = Math.min(1, p + Math.max(0.03, ramp));
    }

    // 2) Lobby groups react to which of their priorities are law.
    for (const gp of LOBBY_GROUPS) {
      const st = this.lobby[gp.id]; if (!st) continue;
      let s = 50;
      for (const id of gp.favors) if (this.activeLaws.has(id)) s += 15 * (this.lawProgress[id] ?? 1);
      for (const id of gp.opposes) if (this.activeLaws.has(id)) s -= 17 * (this.lawProgress[id] ?? 1);
      st.satisfaction += (polClamp(s, 0, 100) - st.satisfaction) * 0.25;
    }

    // 3) Lobbies occasionally push their agenda through the chamber themselves.
    if (this.bills.filter(b => b.status === 'pending').length === 0 && Math.random() < 0.05) {
      const gp = LOBBY_GROUPS[(Math.random() * LOBBY_GROUPS.length) | 0];
      const want = gp.favors.filter(id => !this.activeLaws.has(id));
      if (want.length) {
        const lawId = want[(Math.random() * want.length) | 0];
        const bill = this.introduceBill(lawId, false);
        if (bill) this._pushNews(`${gp.name} lobby pushes for ${LAW_BY_ID[lawId].name}.`, 'Online', null);
      }
    }

    // 4) A lobby may offer the mayor a back-room deal.
    if (this.dealCooldown > 0) this.dealCooldown--;
    if (!this.pendingDeal && this.dealCooldown === 0 && Math.random() < 0.10) this._offerDeal();

    // 5) Corruption slowly fades; the higher it is, the likelier a scandal breaks.
    this.corruption = polClamp(this.corruption * 0.985, 0, 100);
    const risk = (this.corruption / 100) * 0.09;
    if (this.corruption > 18 && Math.random() < risk) this._breakScandal();
  }

  _offerDeal() {
    // Prefer a group whose top favoured law is not yet enacted.
    const pool = LOBBY_GROUPS.filter(gp => gp.favors.some(id => !this.activeLaws.has(id)));
    if (!pool.length) return;
    const gp = pool[(Math.random() * pool.length) | 0];
    const want = gp.favors.filter(id => !this.activeLaws.has(id));
    const lawId = want[(Math.random() * want.length) | 0];
    this.pendingDeal = {
      group: gp.id, lawId,
      money: gp.donation.money, capital: gp.donation.capital, graft: gp.graft,
    };
  }

  acceptDeal() {
    const dl = this.pendingDeal; if (!dl) return false;
    const gp = LOBBY_BY_ID[dl.group];
    this.game.sim.money += dl.money;
    this.politicalCapital = Math.min(14, this.politicalCapital + dl.capital);
    this.corruption = polClamp(this.corruption + dl.graft, 0, 100);
    if (this.lobby[dl.group]) this.lobby[dl.group].satisfaction = polClamp(this.lobby[dl.group].satisfaction + 18, 0, 100);
    // Their bill arrives pre-whipped and on the fast track.
    const bill = this.introduceBill(dl.lawId, false);
    if (bill) { bill.fastTrack = true; for (const p of PARTIES) bill.lobbied[p.id] = (bill.lobbied[p.id] || 0) + 0.2; }
    this._pushNews(`${gp.name} quietly donate $${dl.money.toLocaleString()} to City Hall.`, 'Online', null);
    this.dealCooldown = 16;
    this.pendingDeal = null;
    this._recomputeEffects();
    return true;
  }

  declineDeal() {
    const dl = this.pendingDeal; if (!dl) return false;
    if (this.lobby[dl.group]) this.lobby[dl.group].satisfaction = polClamp(this.lobby[dl.group].satisfaction - 12, 0, 100);
    this.politicalCapital = Math.min(14, this.politicalCapital + 1);   // integrity earns a little goodwill
    this.dealCooldown = 12;
    this.pendingDeal = null;
    return true;
  }

  _breakScandal() {
    const kinds = ['kickbacks on a construction contract', 'a rezoning bribe', 'misused infrastructure funds', 'a no-bid contract scandal'];
    const what = kinds[(Math.random() * kinds.length) | 0];
    const hit = 5 + this.corruption * 0.12;
    this.approval = polClamp(this.approval - hit, 0, 100);
    this.stability = polClamp(this.stability - hit * 0.8, 0, 100);
    this.politicalCapital = Math.max(0, this.politicalCapital - 2);
    this.media.bias = polClamp(this.media.bias - 30, -100, 100);
    this.corruption = polClamp(this.corruption - 14, 0, 100);          // exposure clears some rot
    this.scandals.unshift({ what, week: this.game.sim.week, year: this.year() });
    if (this.scandals.length > 8) this.scandals.pop();
    this._pushNews(`SCANDAL: City Hall rocked by ${what}.`, 'Breaking', null);
    if (Math.random() < 0.6) this.startProtest('corruption at City Hall', polClamp(0.4 + this.corruption / 120, 0.3, 1));
  }

  // ───────────────────────── News feed ─────────────────────────
  _pushNews(text, source, partyId) {
    this.news.unshift({ text, source: source || 'Online', party: partyId || null, week: this.game.sim.week, year: this.year() });
    if (this.news.length > 40) this.news.pop();
  }

  // ───────────────────────── Main weekly tick ─────────────────────────
  tick() {
    const week = this.game.sim.week;
    if (week === this._lastWeek) return;
    this._lastWeek = week;

    this._computeDrivers();
    this._tickDepartments();                                  // bureaucratic efficiency drift
    this._tickPolitics();                                     // propagation, lobbying, corruption
    this._checkPromises();                                    // binding mayoral pledges
    if (this.protest && this.protest.weeksLeft > 0) {         // wind down an active protest
      this.protest.weeksLeft--;
      if (this.protest.weeksLeft <= 0) { this._pushNews('Protests subside; the streets clear.', 'Newspaper', null); this.protest = null; }
    }
    this._recomputeEffects();
    this._updateApproval();
    this._partyAI();
    this._updateRelations();
    this._computeBudget();
    if (this.eventCooldown > 0) this.eventCooldown--;
    this._maybeEvent();
    this._maybeProtest();

    if (week >= this.nextElectionWeek) this.runElection();
  }

  rulingName() { return this.rulingParty ? PARTY_BY_ID[this.rulingParty].name : '—'; }

  // ───────────────────────── Persistence ─────────────────────────
  serialize() {
    return {
      partyState: this.partyState, rulingParty: this.rulingParty, coalition: this.coalition,
      approval: this.approval, stability: this.stability, politicalCapital: this.politicalCapital,
      activeLaws: [...this.activeLaws], nextElectionWeek: this.nextElectionWeek,
      media: this.media, relations: this.relations, debt: this.debt, bonds: this.bonds, loans: this.loans,
      news: this.news.slice(0, 20), lastElection: this.lastElection, eventCooldown: this.eventCooldown,
      lawProgress: this.lawProgress, corruption: this.corruption, scandals: this.scandals.slice(0, 8),
      protest: this.protest, lobby: this.lobby, dealCooldown: this.dealCooldown,
      departments: this.departments, promises: this.promises,
      promiseBase: { tax: this._promiseBaseTax, debt: this._promiseBaseDebt, pop: this._promiseBasePop },
    };
  }

  load(data) {
    if (!data) return;
    Object.assign(this.partyState, data.partyState || {});
    this.rulingParty = data.rulingParty || this.rulingParty;
    this.coalition = data.coalition || this.coalition;
    this.approval = data.approval ?? this.approval;
    this.stability = data.stability ?? this.stability;
    this.politicalCapital = data.politicalCapital ?? this.politicalCapital;
    this.activeLaws = new Set(data.activeLaws || []);
    this.nextElectionWeek = data.nextElectionWeek ?? this.nextElectionWeek;
    this.media = data.media || this.media;
    this.relations = data.relations || this.relations;
    this.debt = data.debt || 0; this.bonds = data.bonds || 0; this.loans = data.loans || 0;
    this.news = data.news || [];
    this.lastElection = data.lastElection || null;
    this.eventCooldown = data.eventCooldown ?? this.eventCooldown;
    // Political-ecosystem state. Older saves: treat active laws as fully phased in.
    this.lawProgress = data.lawProgress || {};
    for (const id of this.activeLaws) if (this.lawProgress[id] == null) this.lawProgress[id] = 1;
    this.corruption = data.corruption ?? 0;
    this.scandals = data.scandals || [];
    this.protest = data.protest || null;
    this.dealCooldown = data.dealCooldown ?? this.dealCooldown;
    if (data.lobby) for (const id in data.lobby) if (this.lobby[id]) Object.assign(this.lobby[id], data.lobby[id]);
    if (data.departments) for (const id in data.departments) if (this.departments[id]) this.departments[id].eff = data.departments[id].eff ?? this.departments[id].eff;
    if (data.promises) this.promises = data.promises;
    if (data.promiseBase) { this._promiseBaseTax = data.promiseBase.tax; this._promiseBaseDebt = data.promiseBase.debt; this._promiseBasePop = data.promiseBase.pop; }
    this._computeDrivers();
    this._recomputeEffects();
    this._computeBudget();
  }
}

if (typeof module !== 'undefined') module.exports = { Government };
