/* stats_ui.js — the Statistics Centre dashboard UI.
 *
 * A categorised, mobile-first analytics dashboard. Renders a grid of live
 * sparkline cards (current value + 6-week trend) for the active category, plus
 * a top "Economy & Weather" summary strip. Tapping a card opens a full-size
 * historical chart. All charts are drawn on retina-aware canvases.
 */

class StatsUI {
  constructor(game) {
    this.game = game;
    this.tab = 'population';
    this.detail = null;     // metric id when viewing a single big chart
    this.el = {
      panel: document.getElementById('stats-panel'),
      tabs:  document.getElementById('stats-tabs'),
      body:  document.getElementById('stats-body'),
      summary: document.getElementById('stats-summary'),
    };
    if (!this.el.panel) return;
    this._buildTabs();
    document.getElementById('btn-stats').addEventListener('click', () => this.toggle());
    document.getElementById('stats-close').addEventListener('click', () => this.close());
    const wbtn = document.getElementById('stat-weather');
    if (wbtn) wbtn.addEventListener('click', () => { this.tab = 'environment'; this._buildTabs(); this.open(); });
    this.el.body.addEventListener('click', (e) => {
      const card = e.target.closest('.stat-card');
      if (card) { this.detail = card.dataset.id; this.render(); return; }
      const back = e.target.closest('#stat-back');
      if (back) { this.detail = null; this.render(); }
    });
  }

  _buildTabs() {
    this.el.tabs.innerHTML = STAT_CATEGORIES.map(([id, label]) =>
      `<button class="gov-tab${id === this.tab ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('');
    this.el.tabs.querySelectorAll('.gov-tab').forEach(b =>
      b.addEventListener('click', () => { this.tab = b.dataset.tab; this.detail = null; this._buildTabs(); this.render(); }));
  }

  toggle() { this.el.panel.classList.contains('hidden') ? this.open() : this.close(); }
  open() {
    if (this.game.ui) this.game.ui.hideServicePicker();
    ['ai-panel', 'gov-panel', 'menu-panel'].forEach(id => {
      const e = document.getElementById(id); if (e) e.classList.add('hidden');
    });
    this.el.panel.classList.remove('hidden');
    this.render();
  }
  close() { this.el.panel.classList.add('hidden'); }
  isOpen() { return this.el.panel && !this.el.panel.classList.contains('hidden'); }

  update() { if (this.isOpen()) this.render(); }

  // ── summary strip (economy phase + key indices + weather) ──
  _renderSummary() {
    const eco = this.game.economy, w = this.game.weather;
    if (!eco) { this.el.summary.innerHTML = ''; return; }
    const s = eco.summary();
    const pi = s.phaseInfo;
    const wi = w ? w.info() : null;
    const arrow = s.gdpGrowth >= 0 ? '▲' : '▼';
    const gcol = s.gdpGrowth >= 0 ? 'var(--good)' : 'var(--bad)';
    this.el.summary.innerHTML =
      `<div class="eco-phase" style="border-color:${pi.color}">` +
        `<span class="eco-phase-ico">${pi.icon}</span>` +
        `<div><div class="eco-phase-name" style="color:${pi.color}">${pi.label}</div>` +
        `<div class="eco-phase-sub">Business cycle</div></div></div>` +
      `<div class="eco-kpis">` +
        `<div class="eco-kpi"><b style="color:${gcol}">${arrow} ${(s.gdpGrowth*100).toFixed(1)}%</b><span>GDP growth</span></div>` +
        `<div class="eco-kpi"><b>${(s.inflation*100).toFixed(1)}%</b><span>Inflation</span></div>` +
        `<div class="eco-kpi"><b>${(s.unemployment*100).toFixed(1)}%</b><span>Unemploy.</span></div>` +
        `<div class="eco-kpi"><b>${Math.round(s.stock).toLocaleString()}</b><span>Stocks</span></div>` +
        (wi ? `<div class="eco-kpi"><b>${wi.weather.icon} ${wi.temperature}°</b><span>${wi.season.name}</span></div>` : '') +
      `</div>`;
  }

  render() {
    if (!this.isOpen()) return;
    this._renderSummary();
    if (this.detail) { this._renderDetail(); return; }

    const metrics = STAT_METRICS.filter(m => m.cat === this.tab);
    this.el.body.innerHTML =
      `<div class="stat-grid">` +
      metrics.map(m => {
        const v = this.game.stats.latest(m.id);
        const tr = this.game.stats.trend(m.id);
        const trCls = tr > 0 ? 'up' : tr < 0 ? 'dn' : '';
        const trTxt = tr === 0 ? '—' : (tr > 0 ? '▲' : '▼') + ' ' + fmtStat(Math.abs(tr), m.fmt).replace(/^[+]/, '');
        return `<div class="stat-card" data-id="${m.id}">` +
          `<div class="stat-card-head"><span class="stat-label">${m.label}</span></div>` +
          `<div class="stat-value">${fmtStat(v, m.fmt)}</div>` +
          `<canvas class="stat-spark" data-id="${m.id}"></canvas>` +
          `<div class="stat-trend ${trCls}">${trTxt}</div>` +
        `</div>`;
      }).join('') +
      `</div>`;

    // draw sparklines
    for (const m of metrics) {
      const cv = this.el.body.querySelector(`canvas[data-id="${m.id}"]`);
      if (cv) this._drawSpark(cv, this.game.stats.series[m.id], m.color);
    }
  }

  _renderDetail() {
    const m = STAT_BY_ID[this.detail];
    if (!m) { this.detail = null; return this.render(); }
    const data = this.game.stats.series[m.id];
    const v = this.game.stats.latest(m.id);
    const tr = this.game.stats.trend(m.id);
    const trCls = tr > 0 ? 'up' : tr < 0 ? 'dn' : '';
    const min = data.length ? Math.min(...data) : 0;
    const max = data.length ? Math.max(...data) : 0;
    const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
    this.el.body.innerHTML =
      `<button class="gov-btn small" id="stat-back">← Back</button>` +
      `<div class="stat-detail-head"><span class="stat-label">${m.label}</span>` +
        `<span class="stat-detail-val" style="color:${m.color}">${fmtStat(v, m.fmt)}</span></div>` +
      `<canvas id="stat-bigchart" class="stat-bigchart"></canvas>` +
      `<div class="stat-detail-stats">` +
        `<div><span>High</span><b>${fmtStat(max, m.fmt)}</b></div>` +
        `<div><span>Low</span><b>${fmtStat(min, m.fmt)}</b></div>` +
        `<div><span>Avg</span><b>${fmtStat(avg, m.fmt)}</b></div>` +
        `<div><span>6wk</span><b class="${trCls}">${(tr>=0?'+':'')}${fmtStat(tr, m.fmt).replace(/^[+]/,'')}</b></div>` +
      `</div>`;
    const cv = document.getElementById('stat-bigchart');
    if (cv) this._drawChart(cv, data, this.game.stats.weeks, m.color, m.fmt);
  }

  // ── canvas helpers (retina aware) ──
  _prep(cv, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 120;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  _drawSpark(cv, data, color) {
    const { ctx, w, h } = this._prep(cv, 34);
    ctx.clearRect(0, 0, w, h);
    if (!data || data.length < 2) return;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const n = data.length;
    const px = i => (i / (n - 1)) * (w - 2) + 1;
    const py = val => h - 3 - ((val - min) / range) * (h - 6);
    // area fill
    ctx.beginPath();
    ctx.moveTo(px(0), h);
    for (let i = 0; i < n; i++) ctx.lineTo(px(i), py(data[i]));
    ctx.lineTo(px(n - 1), h);
    ctx.closePath();
    ctx.fillStyle = this._alpha(color, 0.14);
    ctx.fill();
    // line
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = px(i), y = py(data[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    // end dot
    ctx.beginPath(); ctx.arc(px(n - 1), py(data[n - 1]), 2, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  _drawChart(cv, data, weeks, color, fmt) {
    const { ctx, w, h } = this._prep(cv, 180);
    ctx.clearRect(0, 0, w, h);
    if (!data || data.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '12px -apple-system,sans-serif';
      ctx.fillText('Collecting data…', 10, h / 2); return;
    }
    const padL = 44, padB = 18, padT = 8, padR = 6;
    const cw = w - padL - padR, ch = h - padT - padB;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const n = data.length;
    const px = i => padL + (i / (n - 1)) * cw;
    const py = val => padT + ch - ((val - min) / range) * ch;
    // gridlines + y labels
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '9px -apple-system,sans-serif'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const val = min + (range * g / 4);
      const y = py(val);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(fmtStat(val, fmt).replace(/,/g, ''), 2, y);
    }
    // area
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
    grad.addColorStop(0, this._alpha(color, 0.35));
    grad.addColorStop(1, this._alpha(color, 0.02));
    ctx.beginPath(); ctx.moveTo(px(0), padT + ch);
    for (let i = 0; i < n; i++) ctx.lineTo(px(i), py(data[i]));
    ctx.lineTo(px(n - 1), padT + ch); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // line
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = px(i), y = py(data[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // end dot
    ctx.beginPath(); ctx.arc(px(n - 1), py(data[n - 1]), 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    // x labels (first / last week)
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.textBaseline = 'alphabetic';
    if (weeks && weeks.length) {
      ctx.fillText('Wk ' + weeks[0], padL, h - 5);
      const lbl = 'Wk ' + weeks[weeks.length - 1];
      ctx.fillText(lbl, w - padR - ctx.measureText(lbl).width, h - 5);
    }
  }

  _alpha(hex, a) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}
