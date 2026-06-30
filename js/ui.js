/* ui.js — HUD wiring, panels, toasts, and number formatting. */

class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      money: document.getElementById('money-value'),
      pop: document.getElementById('pop-value'),
      date: document.getElementById('date-value'),
      speed: document.getElementById('speed-value'),
      demandRes: document.getElementById('demand-res'),
      demandCom: document.getElementById('demand-com'),
      demandInd: document.getElementById('demand-ind'),
      toast: document.getElementById('toast'),
      servicePicker: document.getElementById('service-picker'),
      serviceGrid: document.getElementById('service-grid'),
      menuPanel: document.getElementById('menu-panel'),
      menuStats: document.getElementById('menu-stats'),
      help: document.getElementById('help-overlay'),
      taxSlider: document.getElementById('tax-slider'),
      taxReadout: document.getElementById('tax-readout'),
      weatherValue: document.getElementById('weather-value'),
      // Observer mode
      observerBanner: document.getElementById('observer-banner'),
      obsGov: document.getElementById('obs-gov'),
      obsAction: document.getElementById('obs-action'),
      btnMode: document.getElementById('btn-mode'),
      // ARIA AI advisor
      aiBtnGrade: document.getElementById('ai-grade'),
      aiPanel: document.getElementById('ai-panel'),
      aiGradeBadge: document.getElementById('ai-grade-badge'),
      aiScore: document.getElementById('ai-score'),
      aiScoreFill: document.getElementById('ai-score-fill'),
      aiBriefing: document.getElementById('ai-briefing'),
      aiExtras: document.getElementById('ai-extras'),
      aiInsights: document.getElementById('ai-insights'),
    };
    this.toastTimer = null;
    this._buildServicePicker();
    this._wire();
  }

  _wire() {
    // Toolbar
    document.querySelectorAll('.tool').forEach(btn => {
      btn.addEventListener('click', () => this.game.selectTool(btn.dataset.tool, btn));
    });
    // Speed
    document.getElementById('stat-speed').addEventListener('click', () => this.game.cycleSpeed());
    // Menu
    document.getElementById('btn-menu').addEventListener('click', () => this.toggleMenu());
    document.getElementById('menu-close').addEventListener('click', () => this.toggleMenu(false));
    document.getElementById('service-close').addEventListener('click', () => this.hideServicePicker());
    document.getElementById('btn-save').addEventListener('click', () => { this.game.save(); this.toggleMenu(false); });
    document.getElementById('btn-load').addEventListener('click', () => { this.game.load(); this.toggleMenu(false); });
    document.getElementById('btn-new').addEventListener('click', () => { this.game.newCity(); this.toggleMenu(false); });
    document.getElementById('btn-help').addEventListener('click', () => { this.el.help.classList.remove('hidden'); this.toggleMenu(false); });

    // ── Main-menu mode selection ──
    document.getElementById('start-btn').addEventListener('click', () => {
      this.el.help.classList.add('hidden');
      this.game.setMode('mayor');
    });
    document.getElementById('observe-btn').addEventListener('click', () => {
      this.el.help.classList.add('hidden');
      this.game.setMode('observer');
      this.toast('👁️ Observer Mode — the government now runs the city');
    });

    // ── Observer banner: hand control back to the player ──
    document.getElementById('obs-exit').addEventListener('click', () => {
      this.game.setMode('mayor');
      this.toast('You have taken control as Mayor');
    });

    // ── Menu: switch mode + expand map ──
    this.el.btnMode.addEventListener('click', () => {
      const next = this.game.mode === 'observer' ? 'mayor' : 'observer';
      this.game.setMode(next);
      this.toast(next === 'observer' ? '👁️ Observer Mode on' : '🏛️ You are Mayor again');
      this.toggleMenu(false);
    });
    document.getElementById('btn-expand').addEventListener('click', () => {
      this.game.expandMap(16);
      this.toggleMenu(false);
    });
    // Tax policy
    this.el.taxSlider.addEventListener('input', () => {
      const pct = parseInt(this.el.taxSlider.value, 10);
      this.game.sim.taxRate = pct / 100;
      this.el.taxReadout.textContent = pct + '%';
    });

    // ── ARIA AI advisor ──
    document.getElementById('btn-ai').addEventListener('click', () => this.toggleAI());
    document.getElementById('ai-close').addEventListener('click', () => this.toggleAI(false));

    document.getElementById('ai-suggest-res').addEventListener('click', () => this._suggestSite('res', 'zone-res'));
    document.getElementById('ai-suggest-com').addEventListener('click', () => this._suggestSite('com', 'zone-com'));
    document.getElementById('ai-suggest-ind').addEventListener('click', () => this._suggestSite('ind', 'zone-ind'));

    document.querySelectorAll('.ai-ovl').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ai-ovl').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.overlay || null;
        this.game.renderer.setOverlay(mode, this.game.sim);
      });
    });
  }

  // ── AI advisor panel ──
  toggleAI(force) {
    const show = force === undefined ? this.el.aiPanel.classList.contains('hidden') : force;
    this.el.aiPanel.classList.toggle('hidden', !show);
    if (show) {
      this.hideServicePicker();
      ['gov-panel', 'stats-panel', 'menu-panel'].forEach(id => {
        const e = document.getElementById(id); if (e) e.classList.add('hidden');
      });
      this.renderAI();
    }
  }

  renderAI() {
    const ai = this.game.ai;
    if (!ai) return;
    const r = ai.analyze();
    const sim = this.game.sim;

    // Grade + score
    this.el.aiGradeBadge.textContent = r.grade;
    this.el.aiGradeBadge.dataset.grade = r.grade;
    this.el.aiScore.textContent = r.score;
    this.el.aiScoreFill.style.width = r.score + '%';

    // Briefing with stage badge
    const stageLabel = { early: 'Early City', growth: 'Growth', mature: 'Mature City' }[r.stage] || '';
    this.el.aiBriefing.innerHTML = `<span class="ai-stage ${r.stage}">${stageLabel}</span> ${r.briefing}`;

    // ── Dynamic extras ──
    const extras = this.el.aiExtras;
    extras.innerHTML = '';

    // Budget runway
    const fc = r.forecast;
    if (fc.bankruptIn !== null) {
      const danger = fc.bankruptIn <= 8, warn = fc.bankruptIn <= 20;
      const el = document.createElement('div');
      el.className = `ai-runway${danger ? ' danger' : warn ? ' warn' : ''}`;
      el.innerHTML = `⏳ Runway: <b>~${fc.bankruptIn} wk</b> &nbsp;(${this.fmtMoney(sim.money)} at ${this.fmtMoney(sim.lastBalance)}/wk)`;
      extras.appendChild(el);
    } else if (sim.money >= 0) {
      const el = document.createElement('div');
      el.className = 'ai-runway';
      const bal = sim.lastBalance;
      el.innerHTML = `💰 Treasury: <b>${this.fmtMoney(sim.money)}</b> &nbsp;${bal >= 0 ? '+' : ''}${this.fmtMoney(bal)}/wk`;
      extras.appendChild(el);
    }

    // Forecast cards
    const fRow = document.createElement('div');
    fRow.className = 'ai-forecast';
    const popUp = fc.popSlope >= 0, monUp = fc.avgBalance >= 0;
    const avgBal = Math.round(fc.avgBalance);
    fRow.innerHTML =
      `<div class="ai-fc-card ${popUp ? 'up' : 'dn'}">` +
        `<b>${popUp ? '+' : ''}${fc.popSlope.toFixed(1)}/wk</b>Pop trend</div>` +
      `<div class="ai-fc-card">` +
        `<b>${fc.pop10.toLocaleString()}</b>10-wk forecast</div>` +
      `<div class="ai-fc-card ${monUp ? 'up' : 'dn'}">` +
        `<b>${monUp ? '+' : ''}${this.fmtMoney(avgBal).replace(/^-/, '')}</b>Avg balance</div>`;
    extras.appendChild(fRow);

    // Zone ratio bar
    if (r.ratio) {
      const { r: rr, c, i } = r.ratio;
      const rPct = Math.round(rr * 100), cPct = Math.round(c * 100), iPct = Math.round(i * 100);
      const el = document.createElement('div');
      el.className = 'ai-ratio';
      el.innerHTML =
        `<div class="ai-ratio-title">Zone mix — ideal R 50 · C 30 · I 20</div>` +
        `<div class="ai-ratio-bar">` +
          `<div class="ai-ratio-seg r" style="width:${rPct}%">${rPct > 14 ? rPct + '%' : ''}</div>` +
          `<div class="ai-ratio-seg c" style="width:${cPct}%">${cPct > 14 ? cPct + '%' : ''}</div>` +
          `<div class="ai-ratio-seg i" style="width:${iPct}%">${iPct > 14 ? iPct + '%' : ''}</div>` +
        `</div>` +
        `<div class="ai-ratio-legend">` +
          `<span style="color:var(--good)">■ Res ${rPct}%</span>` +
          `<span style="color:var(--accent)">■ Com ${cPct}%</span>` +
          `<span style="color:var(--warn)">■ Ind ${iPct}%</span>` +
        `</div>`;
      extras.appendChild(el);
    }

    // Insights
    const host = this.el.aiInsights;
    host.innerHTML = '';
    for (const ins of r.insights) {
      const card = document.createElement('div');
      card.className = 'ai-insight ' + ins.level;
      card.innerHTML =
        `<div class="ai-ins-ico">${ins.icon}</div>` +
        `<div class="ai-ins-text"><div class="ai-ins-title">${ins.title}</div>` +
        `<div class="ai-ins-detail">${ins.detail}</div></div>`;
      if (ins.overlay || ins.tool || ins.service) {
        card.classList.add('clickable');
        card.addEventListener('click', () => this._applyInsight(ins));
      }
      host.appendChild(card);
    }
  }

  _applyInsight(ins) {
    if (ins.overlay) {
      document.querySelectorAll('.ai-ovl').forEach(b => b.classList.toggle('active', b.dataset.overlay === ins.overlay));
      this.game.renderer.setOverlay(ins.overlay, this.game.sim);
    }
    if (ins.service) {
      this.game.selectedService = ins.service;
      this.game.selectTool('service', document.querySelector('.tool[data-tool="service"]'));
      this.el.serviceGrid.querySelectorAll('.svc-card').forEach(c => c.classList.toggle('selected', c.dataset.id === ins.service));
      const svc = SERVICE_BY_ID[ins.service];
      this.toggleAI(false);
      this.toast(`ARIA: place a ${svc ? svc.name : ins.service} where it's needed`);
    } else if (ins.tool) {
      this.game.selectTool(ins.tool, document.querySelector(`.tool[data-tool="${ins.tool}"]`));
      this.toggleAI(false);
    }
  }

  _suggestSite(kind, tool) {
    const ai = this.game.ai;
    const site = ai.suggestSite(kind);
    if (!site) { this.toast('ARIA: no road-connected land free yet — build more roads'); return; }
    this.game.renderer.markTile(site.x, site.y);
    this.game.selectTool(tool, document.querySelector(`.tool[data-tool="${tool}"]`));
    this.toggleAI(false);
    const label = { res: 'homes', com: 'shops', ind: 'industry' }[kind] || 'zoning';
    this.toast(`ARIA: best spot for ${label} marked — paint it in`);
  }

  _buildServicePicker() {
    this.el.serviceGrid.innerHTML = '';
    SERVICES.forEach(svc => {
      const card = document.createElement('div');
      card.className = 'svc-card';
      card.dataset.id = svc.id;
      card.innerHTML =
        `<div class="svc-ico">${svc.ico}</div>` +
        `<div class="svc-name">${svc.name}</div>` +
        `<div class="svc-cost">$${svc.cost.toLocaleString()}</div>` +
        `<div class="svc-up">-$${svc.upkeep}/wk</div>`;
      card.addEventListener('click', () => {
        this.game.selectedService = svc.id;
        this.el.serviceGrid.querySelectorAll('.svc-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.toast(`Tap the map to place ${svc.name}`);
      });
      this.el.serviceGrid.appendChild(card);
    });
  }

  showServicePicker() { this.el.servicePicker.classList.remove('hidden'); }
  hideServicePicker() { this.el.servicePicker.classList.add('hidden'); }

  toggleMenu(force) {
    const show = force === undefined ? this.el.menuPanel.classList.contains('hidden') : force;
    this.el.menuPanel.classList.toggle('hidden', !show);
    if (show) {
      const pct = Math.round((this.game.sim.taxRate || 1) * 100);
      this.el.taxSlider.value = pct;
      this.el.taxReadout.textContent = pct + '%';
      if (this.el.btnMode) {
        this.el.btnMode.textContent = this.game.mode === 'observer'
          ? '🏛️ Take control (Mayor Mode)'
          : '👁️ Switch to Observer Mode';
      }
      this._refreshMenuStats();
    }
  }

  _refreshMenuStats() {
    const s = this.game.sim;
    this.el.menuStats.innerHTML =
      `Population: <b>${s.population.toLocaleString()}</b><br>` +
      `Commercial jobs: <b>${s.jobsC}</b><br>` +
      `Industrial jobs: <b>${s.jobsI}</b><br>` +
      `Happiness: <b>${Math.round(s.happiness * 100)}%</b><br>` +
      `Power: <b>${s.powerCap || 0}</b> cap<br>` +
      `Weekly balance: <b>${this.fmtMoney(s.lastBalance)}</b><br>` +
      `Week: <b>${s.week}</b>`;
  }

  fmtMoney(v) {
    const sign = v < 0 ? '-' : '';
    return sign + '$' + Math.abs(Math.round(v)).toLocaleString();
  }

  update() {
    const s = this.game.sim;
    this.el.money.textContent = '$' + Math.round(s.money).toLocaleString();
    this.el.money.classList.toggle('neg', s.money < 0);
    this.el.pop.textContent = s.population.toLocaleString();
    this.el.date.textContent = 'Wk ' + s.week;
    this.el.speed.textContent = ['❚❚', '►', '►►', '►►►'][this.game.speedIndex];
    this.el.demandRes.style.height = Math.round(s.demand.res * 100) + '%';
    this.el.demandCom.style.height = Math.round(s.demand.com * 100) + '%';
    this.el.demandInd.style.height = Math.round(s.demand.ind * 100) + '%';
    if (!this.el.menuPanel.classList.contains('hidden')) this._refreshMenuStats();

    // ARIA grade chip in the HUD (uses the AI's most recent report)
    if (this.game.ai && this.game.ai.report) {
      const g = this.game.ai.report.grade;
      this.el.aiBtnGrade.textContent = g;
      this.el.aiBtnGrade.dataset.grade = g;
    }

    // Weather chip
    if (this.el.weatherValue && this.game.weather) {
      const wi = this.game.weather.info();
      this.el.weatherValue.textContent = `${wi.weather.icon} ${wi.temperature}°`;
    }
  }

  // Refresh the observer banner with who's governing and the latest action.
  updateObserver() {
    if (!this.el.observerBanner) return;
    if (this.game.mode !== 'observer') { this.el.observerBanner.classList.add('hidden'); return; }
    this.el.observerBanner.classList.remove('hidden');
    const gov = this.game.gov;
    const party = (gov && gov.rulingParty && typeof PARTY_BY_ID !== 'undefined') ? PARTY_BY_ID[gov.rulingParty] : null;
    if (party && this.el.obsGov) {
      this.el.obsGov.textContent = `${party.name} governing`;
      this.el.obsGov.style.color = party.color || 'var(--text)';
    }
    const log = this.game.automayor && this.game.automayor.actionsLog[0];
    if (this.el.obsAction) this.el.obsAction.textContent = log ? log.msg : 'Planning the next move…';
  }

  toast(msg) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
}
