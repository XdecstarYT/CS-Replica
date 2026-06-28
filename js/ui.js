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
    document.getElementById('start-btn').addEventListener('click', () => this.el.help.classList.add('hidden'));
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
    if (show) this._refreshMenuStats();
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
  }

  toast(msg) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
}
