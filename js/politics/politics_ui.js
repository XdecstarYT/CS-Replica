/* politics/politics_ui.js — the Government hub UI.
 *
 * A single tabbed panel (Overview, Parliament, Elections, Laws, Budget, News)
 * plus a political-event modal and an animated election-night overlay. Renders
 * lazily: only the active tab is built, and only while the panel is open.
 */

class PoliticsUI {
  constructor(game) {
    this.game = game;
    this.gov = game.gov;
    this.tab = 'overview';
    this._seenElectionWeek = this.gov.lastElection ? this.gov.lastElection.week : -1;
    this.el = {
      panel: document.getElementById('gov-panel'),
      tabs: document.getElementById('gov-tabs'),
      body: document.getElementById('gov-body'),
      approval: document.getElementById('gov-approval'),
      eventModal: document.getElementById('gov-event'),
      electionOverlay: document.getElementById('gov-election'),
    };
    this.tabs = [
      ['overview', '📊 Overview'], ['parliament', '🏛 Parliament'], ['elections', '🗳 Elections'],
      ['laws', '📜 Laws'], ['budget', '💰 Budget'], ['news', '📰 News'],
    ];
    this._buildTabs();
    document.getElementById('btn-gov').addEventListener('click', () => this.toggle());
    document.getElementById('gov-close').addEventListener('click', () => this.close());
    this.el.body.addEventListener('click', (e) => this._onBodyClick(e));
  }

  // ── shell ──
  _buildTabs() {
    this.el.tabs.innerHTML = this.tabs.map(([id, label]) =>
      `<button class="gov-tab${id === this.tab ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('');
    this.el.tabs.querySelectorAll('.gov-tab').forEach(b =>
      b.addEventListener('click', () => { this.tab = b.dataset.tab; this._buildTabs(); this.render(); }));
  }

  toggle() { this.el.panel.classList.contains('hidden') ? this.open() : this.close(); }
  open() {
    if (this.game.ui) this.game.ui.hideServicePicker();
    ['ai-panel', 'stats-panel', 'menu-panel'].forEach(id => {
      const e = document.getElementById(id); if (e) e.classList.add('hidden');
    });
    this.el.panel.classList.remove('hidden');
    this.render();
  }
  close() { this.el.panel.classList.add('hidden'); }
  isOpen() { return !this.el.panel.classList.contains('hidden'); }

  // ── periodic update (called each sim week) ──
  update() {
    this.el.approval.textContent = Math.round(this.gov.approval) + '%';
    this.el.approval.style.color = this.gov.approval >= 55 ? 'var(--good)' : this.gov.approval >= 40 ? 'var(--warn)' : 'var(--bad)';
    // surface a fresh election
    if (this.gov.lastElection && this.gov.lastElection.week !== this._seenElectionWeek) {
      this._seenElectionWeek = this.gov.lastElection.week;
      this.showElectionNight(this.gov.lastElection);
    }
    // surface a pending political event
    if (this.gov.pendingEvent && this.el.eventModal.classList.contains('hidden')) this.showEvent(this.gov.pendingEvent);
    if (this.isOpen()) this.render();
  }

  // ── rendering ──
  render() {
    if (!this.isOpen()) return;
    const r = {
      overview: () => this._overview(), parliament: () => this._parliament(), elections: () => this._elections(),
      laws: () => this._laws(), budget: () => this._budget(), news: () => this._news(),
    }[this.tab];
    this.el.body.innerHTML = r ? r() : '';
  }

  _bar(pct, color) {
    return `<div class="gov-track"><div class="gov-fill" style="width:${Math.round(polClamp(pct,0,100))}%;background:${color}"></div></div>`;
  }
  _pollRows(shares) {
    return PARTIES.map(p => {
      const v = (shares[p.id] || 0) * 100;
      return `<div class="poll-row"><span class="poll-name" style="color:${p.color}">${p.short}</span>${this._bar(v, p.color)}<span class="poll-pct">${v.toFixed(1)}%</span></div>`;
    }).filter((_, i) => (shares[PARTIES[i].id] || 0) > 0.005).join('');
  }
  _money(v) { return (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString(); }

  _overview() {
    const g = this.gov, d = g.drivers;
    const ruling = PARTY_BY_ID[g.rulingParty];
    const coalition = g.coalition.map(id => `<span class="chip" style="border-color:${PARTY_BY_ID[id].color};color:${PARTY_BY_ID[id].color}">${PARTY_BY_ID[id].short}</span>`).join(' ');
    const rel = Object.keys(g.relations).map(k =>
      `<div class="rel-row"><span>${g.relMeta[k].flag} ${g.relMeta[k].name}</span>${this._bar(g.relations[k], g.relations[k] > 55 ? 'var(--good)' : g.relations[k] < 40 ? 'var(--bad)' : 'var(--warn)')}<span>${Math.round(g.relations[k])}</span></div>`).join('');
    const concern = (label, val, invert) => {
      const pct = (invert ? 1 - val : val) * 100;
      return `<div class="poll-row"><span class="poll-name">${label}</span>${this._bar(pct, pct > 60 ? 'var(--good)' : pct > 35 ? 'var(--warn)' : 'var(--bad)')}<span class="poll-pct">${Math.round(pct)}</span></div>`;
    };
    return `
      <div class="gov-cards">
        <div class="gov-card"><div class="gc-label">Governing</div><div class="gc-big" style="color:${ruling.color}">${ruling.short}</div><div class="gc-sub">${ruling.name}</div></div>
        <div class="gov-card"><div class="gc-label">Approval</div><div class="gc-big">${Math.round(g.approval)}%</div>${this._bar(g.approval, g.approval>50?'var(--good)':'var(--bad)')}</div>
        <div class="gov-card"><div class="gc-label">Stability</div><div class="gc-big">${Math.round(g.stability)}%</div>${this._bar(g.stability, g.stability>50?'var(--good)':'var(--bad)')}</div>
        <div class="gov-card"><div class="gc-label">Capital</div><div class="gc-big">${g.politicalCapital}</div><div class="gc-sub">political capital</div></div>
      </div>
      <div class="gov-section"><h4>Coalition &amp; mandate</h4><div>${coalition} — ${g.coalitionSeats()}/${g.config.seats} seats ${g.hasMajority() ? '<span class="chip good">majority</span>' : '<span class="chip warn">minority</span>'}</div>
      ${g.unrest ? '<div class="gov-warn">⚠ Civic unrest — protests likely. Address public concerns.</div>' : ''}</div>
      <div class="gov-section"><h4>Public concerns</h4>
        ${concern('Cost of living', d.housing)}
        ${concern('Jobs', 1 - d.unemployment)}
        ${concern('Safety', 1 - d.crime)}
        ${concern('Environment', 1 - d.pollution)}
        ${concern('Healthcare', d.health)}
        ${concern('Education', d.education)}
      </div>
      <div class="gov-section"><h4>Live polling</h4>${this._pollRows(g._popularVote())}</div>
      <div class="gov-section"><h4>Foreign relations</h4>${rel}</div>
    `;
  }

  _parliament() {
    const g = this.gov;
    // seat bar
    const seatBar = PARTIES.filter(p => g.partyState[p.id].seats > 0).map(p =>
      `<div class="seat-seg" style="flex:${g.partyState[p.id].seats};background:${p.color}" title="${p.name}: ${g.partyState[p.id].seats}"></div>`).join('');
    const legend = PARTIES.filter(p => g.partyState[p.id].seats > 0).map(p =>
      `<span class="chip" style="border-color:${p.color};color:${p.color}">${p.short} ${g.partyState[p.id].seats}</span>`).join(' ');
    const pending = g.bills.filter(b => b.status === 'pending');
    const billHtml = pending.length ? pending.map(b => {
      const law = LAW_BY_ID[b.lawId];
      const proj = g.projectVotes(b);
      const chips = PARTIES.filter(p => g.partyState[p.id].seats > 0).map(p => {
        const v = proj.byParty[p.id].vote;
        const cls = v === 'yes' ? 'good' : v === 'no' ? 'bad' : 'muted';
        const lob = b.lobbied[p.id] ? ' 🤝' : '';
        return `<button class="vote-chip ${cls}" data-act="lobby" data-bill="${b.id}" data-party="${p.id}" title="Lobby ${p.name} (2 capital)">${p.short} ${v}${lob}</button>`;
      }).join('');
      const pass = proj.yes > proj.no;
      return `<div class="bill">
        <div class="bill-head"><b>${b.repeal ? 'Repeal: ' : ''}${law.name}</b><span class="chip ${pass?'good':'bad'}">${proj.yes}–${proj.no} (need ${proj.needed})</span></div>
        <div class="bill-desc">${law.desc}</div>
        <div class="vote-chips">${chips}</div>
        <div class="bill-actions"><button class="gov-btn primary" data-act="vote" data-bill="${b.id}">Hold vote</button>
        <span class="muted">Lobbying costs 2 political capital (you have ${g.politicalCapital}).</span></div>
      </div>`;
    }).join('') : '<div class="muted" style="padding:8px">No bills on the floor. Propose one from the Laws tab.</div>';
    const decided = g.bills.filter(b => b.status !== 'pending').slice(0, 4).map(b => {
      const law = LAW_BY_ID[b.lawId];
      return `<div class="bill-mini"><span class="chip ${b.status==='passed'?'good':'bad'}">${b.status}</span> ${b.repeal?'Repeal ':''}${law.name}</div>`;
    }).join('');
    return `
      <div class="gov-section"><h4>City Council — ${g.config.seats} seats</h4>
        <div class="seat-bar">${seatBar}</div>
        <div class="legend">${legend}</div>
      </div>
      <div class="gov-section"><h4>Bills on the floor</h4>${billHtml}</div>
      ${decided ? `<div class="gov-section"><h4>Recent votes</h4>${decided}</div>` : ''}
    `;
  }

  _elections() {
    const g = this.gov;
    const wks = g.weeksToElection();
    const yrs = (wks / g.config.weeksPerYear);
    const last = g.lastElection;
    let mapHtml = '<div class="muted" style="padding:8px">No election held yet.</div>';
    if (last) {
      mapHtml = '<div class="emap">' + last.districts.map(dd => {
        const col = dd.winner ? PARTY_BY_ID[dd.winner].color : '#1b2740';
        return `<div class="ecell" style="background:${col};opacity:${dd.pop>0?0.95:0.25}" title="${dd.winner?PARTY_BY_ID[dd.winner].name:'no voters'}"></div>`;
      }).join('') + '</div>';
    }
    return `
      <div class="gov-section"><h4>Next election</h4>
        <div class="countdown">${yrs.toFixed(1)} yrs <span class="muted">(${wks} weeks)</span></div>
        <button class="gov-btn primary" data-act="callElection">Call snap election now</button>
      </div>
      <div class="gov-section"><h4>Current polling</h4>${this._pollRows(g._popularVote())}</div>
      <div class="gov-section"><h4>Electoral map ${last ? `(Year ${last.year})` : ''}</h4>${mapHtml}
        ${last ? `<div class="muted">Turnout ${Math.round(last.turnout*100)}% • Winner: <b style="color:${PARTY_BY_ID[last.ruling].color}">${PARTY_BY_ID[last.ruling].name}</b></div>` : ''}
      </div>
    `;
  }

  _laws() {
    const g = this.gov;
    let html = '';
    for (const cat of LAW_CATEGORIES) {
      const laws = LAWS.filter(l => l.cat === cat);
      html += `<div class="law-cat"><h4>${cat}</h4>` + laws.map(l => {
        const active = g.activeLaws.has(l.id);
        const verb = active ? 'Repeal' : 'Propose';
        return `<div class="law-row ${active ? 'active' : ''}">
          <div class="law-info"><b>${l.name}</b> ${active ? '<span class="chip good">active</span>' : ''}<div class="law-desc">${l.desc}</div></div>
          <button class="gov-btn small" data-act="propose" data-law="${l.id}" data-repeal="${active ? 1 : 0}">${verb}</button>
        </div>`;
      }).join('') + '</div>';
    }
    return html;
  }

  _budget() {
    const g = this.gov; const b = g._computeBudget();
    const row = (k, v) => `<div class="bud-row"><span>${k}</span><b>${this._money(v)}/wk</b></div>`;
    return `
      <div class="gov-cards">
        <div class="gov-card"><div class="gc-label">Credit rating</div><div class="gc-big">${b.creditRating}</div></div>
        <div class="gov-card"><div class="gc-label">Net / wk</div><div class="gc-big" style="color:${b.net>=0?'var(--good)':'var(--bad)'}">${this._money(b.net)}</div></div>
        <div class="gov-card"><div class="gc-label">Debt</div><div class="gc-big">${this._money(b.debt)}</div></div>
        <div class="gov-card"><div class="gc-label">Interest</div><div class="gc-big">${(b.interestRate*100).toFixed(1)}%</div></div>
      </div>
      <div class="gov-section"><h4>Revenue</h4>
        ${row('Income tax', b.revenue.income)}${row('Property tax', b.revenue.property)}${row('Sales tax', b.revenue.sales)}${row('Corporate tax', b.revenue.corporate)}${row('Fees &amp; vice', b.revenue.fees)}
        <div class="bud-row total"><span>Total revenue</span><b>${this._money(b.revenue.total)}/wk</b></div>
      </div>
      <div class="gov-section"><h4>Expenditure</h4>
        ${row('Services', b.expense.services)}${row('Roads', b.expense.roads)}${row('Policy upkeep', b.expense.policy)}${row('Debt interest', b.expense.debt)}
        <div class="bud-row total"><span>Total expenditure</span><b>${this._money(b.expense.total)}/wk</b></div>
      </div>
      <div class="gov-section"><h4>Treasury operations</h4>
        <div class="bud-ops">
          <button class="gov-btn" data-act="bond">Issue bond +$20k</button>
          <button class="gov-btn" data-act="loan">Take loan +$10k</button>
          <button class="gov-btn" data-act="repay">Repay debt $10k</button>
        </div>
        <div class="muted">Inflation ${(b.inflation*100).toFixed(1)}% • Bonds ${this._money(b.bonds)} • Loans ${this._money(b.loans)}</div>
      </div>
    `;
  }

  _news() {
    const g = this.gov;
    if (!g.news.length) return '<div class="muted" style="padding:8px">No news yet.</div>';
    const srcColor = { Breaking: 'var(--bad)', TV: 'var(--accent)', Newspaper: 'var(--text)', Radio: 'var(--warn)', Online: 'var(--muted)' };
    return '<div class="newsfeed">' + g.news.map(n => {
      const dot = n.party ? `<span class="news-dot" style="background:${PARTY_BY_ID[n.party].color}"></span>` : '';
      return `<div class="news-item"><span class="news-src" style="color:${srcColor[n.source]||'var(--muted)'}">${n.source}</span>${dot}<span class="news-text">${n.text}</span><span class="news-wk">Yr ${n.year}</span></div>`;
    }).join('') + '</div>';
  }

  // ── body click delegation ──
  _onBodyClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, g = this.gov;
    if (act === 'propose') {
      const bill = g.introduceBill(btn.dataset.law, btn.dataset.repeal === '1');
      if (bill) { this.tab = 'parliament'; this._buildTabs(); this.game.ui.toast('Bill introduced — head to Parliament to whip votes.'); }
      else this.game.ui.toast('That law is already in that state.');
    } else if (act === 'vote') {
      const bill = g.voteBill(btn.dataset.bill);
      if (bill) this.game.ui.toast(`Bill ${bill.status}: ${LAW_BY_ID[bill.lawId].name}`);
    } else if (act === 'lobby') {
      if (g.lobby(btn.dataset.bill, btn.dataset.party)) this.game.ui.toast(`Lobbied ${PARTY_BY_ID[btn.dataset.party].short}.`);
      else this.game.ui.toast('Not enough political capital.');
    } else if (act === 'callElection') {
      g.runElection(); this.game.ui.toast('Snap election called!');
    } else if (act === 'bond') { g.issueBond(20000); }
    else if (act === 'loan') { g.takeLoan(10000); }
    else if (act === 'repay') { g.repayDebt(10000); }
    this.render();
  }

  // ── political event modal ──
  showEvent(ev) {
    const m = this.el.eventModal;
    m.innerHTML = `<div class="overlay-card gov-event-card">
      <div class="ev-cat">${ev.cat}</div>
      <h2>${ev.title}</h2>
      <p class="ev-blurb">${ev.blurb}</p>
      <div class="ev-choices">${ev.choices.map((c, i) =>
        `<button class="ev-choice" data-choice="${i}"><b>${c.label}</b><span>${c.desc}</span></button>`).join('')}</div>
    </div>`;
    m.classList.remove('hidden');
    m.querySelectorAll('.ev-choice').forEach(b => b.addEventListener('click', () => {
      this.gov.resolveEvent(parseInt(b.dataset.choice, 10));
      m.classList.add('hidden');
      if (this.isOpen()) this.render();
    }));
  }

  // ── animated election night ──
  showElectionNight(result) {
    const o = this.el.electionOverlay;
    const rows = PARTIES.filter(p => (result.popular[p.id] || 0) > 0.005).sort((a, b) => result.popular[b.id] - result.popular[a.id]);
    o.innerHTML = `<div class="overlay-card election-card">
      <h1>🗳 Election Night — Year ${result.year}</h1>
      <p class="subtitle">Turnout ${Math.round(result.turnout * 100)}% · ${this.game.gov.config.seats} council seats</p>
      <div class="enight-rows">${rows.map(p => `
        <div class="enight-row">
          <span class="poll-name" style="color:${p.color}">${p.short}</span>
          <div class="gov-track"><div class="gov-fill enight-fill" data-w="${(result.popular[p.id]*100).toFixed(1)}" style="width:0%;background:${p.color}"></div></div>
          <span class="enight-seats">${result.seats[p.id]} <small>seats</small></span>
        </div>`).join('')}</div>
      <div class="enight-result">Winner: <b style="color:${PARTY_BY_ID[result.ruling].color}">${PARTY_BY_ID[result.ruling].name}</b>${result.coalition.length>1?` (coalition of ${result.coalition.length})`:''}</div>
      <button class="big-btn" id="enight-close">Continue</button>
    </div>`;
    o.classList.remove('hidden');
    // animate bars
    requestAnimationFrame(() => requestAnimationFrame(() => {
      o.querySelectorAll('.enight-fill').forEach(f => { f.style.width = f.dataset.w + '%'; });
    }));
    document.getElementById('enight-close').addEventListener('click', () => o.classList.add('hidden'));
  }

  reset() {
    this.gov = this.game.gov;
    this._seenElectionWeek = this.gov.lastElection ? this.gov.lastElection.week : -1;
    if (this.isOpen()) this.render();
  }
}
