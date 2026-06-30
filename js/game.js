/* game.js — main controller: wiring, build actions, loops, persistence. */

class Game {
  constructor() {
    this.grid = new Grid(CONFIG.GRID_W, CONFIG.GRID_H);
    this.sim = new Simulation(this.grid);
    this.renderer = new Renderer3D(document.getElementById('city-canvas'), this.grid);
    this.traffic  = new Traffic(this.grid);
    this.citizens = new Citizens(this.grid);
    this.construction = new Construction(this);
    this.ai = new CityAI(this);
    this.gov = new Government(this);
    this.economy = new Economy(this);
    this.weather = new Weather(this);
    this.stats = new Stats(this);
    this.automayor = new AutoMayor(this);
    this.ui = new UI(this);
    this.politicsUI = new PoliticsUI(this);
    this.statsUI = new StatsUI(this);
    this.mode = 'mayor';   // 'mayor' (you build) | 'observer' (government builds)
    this.renderer.weatherSys = this.weather;   // renderer reads weather for sky/precip
    this.renderer.construction = this.construction; // renderer reads build-site state
    this.traffic.weatherSys = this.weather;    // wet roads raise accident risk
    this.dayLength = 90000; // ms per full day/night cycle (real time)

    this.tool = 'select';
    this.selectedService = null;
    this.hover = null;
    this.speedIndex = 1;
    this.lastTick = performance.now();
    this.accum = 0;

    this.input = new InputManager3D(
      this.renderer.canvas,
      this.renderer,
      (tx, ty, start) => this.paint(tx, ty, start),
      (tile) => {
        this.hover = tile;
        if (tile) this.renderer.setHover(tile, this._validPaint(tile.tx, tile.ty));
        else this.renderer.setHover(null);
      }
    );

    if (!this.load(true)) this.ui.toast('New city founded — build roads to begin!');

    this.selectTool('select', document.querySelector('.tool[data-tool="select"]'));
    requestAnimationFrame(t => this.loop(t));

    setInterval(() => this.save(true), 30000);
    window.addEventListener('beforeunload', () => this.save(true));
  }

  selectTool(tool, btn) {
    this.tool = tool;
    this.input.setTool(tool);
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (tool === 'service') this.ui.showServicePicker();
    else this.ui.hideServicePicker();
  }

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % CONFIG.SPEEDS.length;
    this.ui.update();
  }

  _validPaint(tx, ty) {
    const g = this.grid;
    if (!g.inBounds(tx, ty)) return false;
    const t = this.tool;
    const i = g.idx(tx, ty);
    if (t === 'bulldoze') return g.type[i] !== TILE.GRASS && g.type[i] !== TILE.WATER;
    if (t === 'road' || t.startsWith('zone') || t === 'service') return g.isBuildable(tx, ty);
    return true;
  }

  // ---- Build ----
  paint(tx, ty, start) {
    const g = this.grid;
    if (!g.inBounds(tx, ty)) return;
    const i = g.idx(tx, ty);

    if (this.tool === 'road') {
      if (g.type[i] === TILE.WATER) return this._deny('Can\'t build on water');
      if (g.type[i] === TILE.ROAD) return;
      if (!this._charge(50)) return;
      this._clearTile(i);
      g.type[i] = TILE.ROAD;
      this.renderer.updateTile(tx, ty);
      // Refresh neighbours so lane markings update
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = tx+dx, nz = ty+dz;
        if (g.inBounds(nx, nz) && g.type[g.idx(nx, nz)] === TILE.ROAD) this.renderer.updateTile(nx, nz);
      }
    }
    else if (this.tool.startsWith('zone')) {
      const z = ZONE_OF[this.tool];
      if (g.type[i] === TILE.WATER) return this._deny('Can\'t zone water');
      if (g.type[i] === TILE.ROAD || g.type[i] === TILE.SERVICE) return;
      if (g.type[i] === z) return;
      if (!this._charge(20)) return;
      this._clearTile(i);
      g.type[i] = z;
      g.level[i] = 0; g.pop[i] = 0;
      this.renderer.updateTile(tx, ty);
    }
    else if (this.tool === 'service') {
      if (!start) return;
      const svc = SERVICE_BY_ID[this.selectedService];
      if (!svc) return this._deny('Pick a building first');
      if (g.type[i] === TILE.WATER) return this._deny('Can\'t build on water');
      if (!this._charge(svc.cost)) return;
      this._clearTile(i);
      g.type[i] = TILE.SERVICE;
      g.service[i] = svc.id;
      this.renderer.updateTile(tx, ty);
      this.ui.toast(`${svc.name} built`);
    }
    else if (this.tool === 'bulldoze') {
      if (g.type[i] === TILE.WATER || g.type[i] === TILE.GRASS) return;
      const wasRoad = g.type[i] === TILE.ROAD;
      this._clearTile(i);
      g.type[i] = TILE.GRASS;
      this.renderer.updateTile(tx, ty);
      if (wasRoad) {
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = tx+dx, nz = ty+dz;
          if (g.inBounds(nx, nz) && g.type[g.idx(nx, nz)] === TILE.ROAD) this.renderer.updateTile(nx, nz);
        }
      }
    }
  }

  _clearTile(i) {
    this.grid.level[i] = 0;
    if (this.grid.built) this.grid.built[i] = 0;
    this.grid.pop[i] = 0;
    this.grid.service[i] = null;
    if (this.construction) this.construction.projects.delete(i);
    if (this.grid.type[i] !== TILE.WATER) this.grid.type[i] = TILE.GRASS;
  }

  _charge(amount) {
    if (this.sim.money < amount) { this._deny('Not enough money'); return false; }
    this.sim.money -= amount;
    return true;
  }

  _deny(msg) {
    if (this._lastDeny && performance.now() - this._lastDeny < 1500) return;
    this._lastDeny = performance.now();
    this.ui.toast(msg);
  }

  // ---- Loop ----
  loop(t) {
    const dt = t - this.lastTick;
    this.lastTick = t;
    const speed = CONFIG.SPEEDS[this.speedIndex];

    this.renderer.timeOfDay = (this.renderer.timeOfDay + dt / this.dayLength * (0.5 + speed * 0.5)) % 1;
    this.traffic.sync(Math.round(this.sim.population / 12) + (this.sim.jobsC + this.sim.jobsI) / 20);
    this.citizens.sync(this.sim.population);
    // Weather slows traffic & pedestrians (rain/snow/fog).
    const wSpeed = (this.sim.envMods && this.sim.envMods.trafficSpeed) || 1;
    if (speed > 0) this.traffic.update(dt * Math.min(speed, 2) * wSpeed);
    if (speed > 0) this.citizens.update(dt * Math.min(speed, 2) * wSpeed);

    if (speed > 0) {
      this.accum += dt * speed;
      while (this.accum >= CONFIG.TICK_MS) {
        this.accum -= CONFIG.TICK_MS;
        // Traffic congestion feeds back into the city: jams sap happiness & growth.
        const cong = this.traffic.avgCongestion || 0;
        this.sim.trafficMods = { happyAdd: -cong * 0.12, growthMult: 1 - cong * 0.08 };
        const res = this.sim.step();
        this.construction.tick();      // advance staged build projects
        this.renderer.syncBuildings(); // update grown buildings / live sites in 3D

        // ── ARIA: observe, analyse periodically, nudge, refresh overlays ──
        this.ai.observe();
        if (this.sim.week % 3 === 0 || !this.ai.report) this.ai.analyze();
        if (this.renderer.overlayMode) this.renderer.updateOverlay(this.sim);
        if (!this.ui.el.aiPanel.classList.contains('hidden')) this.ui.renderAI();
        const nudge = this.ai.maybeNudge();
        if (nudge) this.ui.toast(nudge);

        // ── Government & politics weekly tick ──
        this.gov.tick();

        // ── Observer mode: the elected government builds the city itself ──
        if (this.mode === 'observer') {
          this.automayor.tick();
          this.ui.updateObserver();
        }

        // ── Economy, weather & statistics weekly tick ──
        this.economy.tick();
        this.weather.tick();
        this.stats.sample();
        if (this.statsUI) this.statsUI.update();

        if (res.bankrupt && !this._warnedBankrupt) {
          this._warnedBankrupt = true;
          this.ui.toast('⚠ City is bankrupt! Cut services or raise population.');
        } else if (!res.bankrupt) {
          this._warnedBankrupt = false;
        }
      }
    }

    this.renderer.draw(this.traffic, this.citizens);
    this.ui.update();
    this.politicsUI.update();
    requestAnimationFrame(tt => this.loop(tt));
  }

  // ---- Persistence ----
  save(silent) {
    try {
      const data = {
        grid: this.grid.serialize(), sim: this.sim.serialize(), gov: this.gov.serialize(),
        economy: this.economy.serialize(), weather: this.weather.serialize(), stats: this.stats.serialize(),
        construction: this.construction.serialize(),
        mode: this.mode,
        v: 3,
      };
      localStorage.setItem(CONFIG.AUTOSAVE_KEY, JSON.stringify(data));
      if (!silent) this.ui.toast('City saved');
    } catch (e) {
      if (!silent) this.ui.toast('Save failed (storage full?)');
    }
  }

  load(silent) {
    try {
      const raw = localStorage.getItem(CONFIG.AUTOSAVE_KEY);
      if (!raw) { if (!silent) this.ui.toast('No saved city'); return false; }
      const data = JSON.parse(raw);
      this.grid = Grid.deserialize(data.grid);
      this.sim = new Simulation(this.grid);
      this.sim.load(data.sim);
      // Restore in-progress construction before the renderer rebuilds the scene,
      // so live build-sites are drawn straight away.
      this.construction.setGrid(this.grid);
      if (data.construction) this.construction.load(data.construction);
      this.renderer.setGrid(this.grid);
      this.traffic.setGrid(this.grid);
      this.citizens.setGrid(this.grid);
      this.ai.reset();
      this.gov.reset();
      if (data.gov) this.gov.load(data.gov);
      this.economy.reset(); if (data.economy) this.economy.load(data.economy);
      this.weather.reset();  if (data.weather) this.weather.load(data.weather);
      this.stats.reset();    if (data.stats) this.stats.load(data.stats);
      this.politicsUI.reset();
      this.automayor.reset();
      // Restore game mode (quietly — don't reset the camera/tool mid-load).
      this.mode = (data.mode === 'observer') ? 'observer' : 'mayor';
      document.body.classList.toggle('observer-mode', this.mode === 'observer');
      const banner = document.getElementById('observer-banner');
      if (banner) banner.classList.toggle('hidden', this.mode !== 'observer');
      if (!silent) this.ui.toast('City loaded');
      return true;
    } catch (e) {
      if (!silent) this.ui.toast('Load failed');
      return false;
    }
  }

  // ---- Game mode (Mayor vs Observer) ----
  setMode(mode) {
    this.mode = (mode === 'observer') ? 'observer' : 'mayor';
    document.body.classList.toggle('observer-mode', this.mode === 'observer');
    const banner = document.getElementById('observer-banner');
    if (banner) banner.classList.toggle('hidden', this.mode !== 'observer');
    if (this.mode === 'observer') {
      this.automayor.reset();
      // Drop any active build tool so taps just pan while spectating.
      this.selectTool('select', document.querySelector('.tool[data-tool="select"]'));
      this.ui.hideServicePicker();
      if (this.speedIndex === 0) { this.speedIndex = 1; this.ui.update(); }   // ensure time runs
      this.ui.updateObserver();
    }
  }

  // ---- Map expansion ----
  // Grow the map outward. Because the grid width changes, every index-keyed
  // cache must be remapped: we snapshot construction projects by (x,y), expand,
  // then re-point all subsystems to the (mutated, same-reference) grid.
  expandMap(add) {
    add = add || 16;
    const cost = 8000;
    if (this.sim.money < cost) { this._deny(`Need $${cost.toLocaleString()} to expand`); return false; }
    if (this.grid.w >= 160) { this._deny('Map is already at maximum size'); return false; }
    this.sim.money -= cost;

    const ow = this.grid.w;
    // Snapshot in-progress construction by world coords (indices are about to shift).
    const projXY = [];
    for (const [i, p] of this.construction.projects) projXY.push([i % ow, (i / ow) | 0, p]);

    const r = this.grid.expand(add, add);
    if (!r) { this.sim.money += cost; return false; }

    // Re-point subsystems. The grid object is the same reference (mutated in
    // place), so sim/gov already see the new dimensions; caches need realloc.
    this.sim.grid = this.grid;
    this.traffic.setGrid(this.grid);
    this.citizens.setGrid(this.grid);
    this.construction.grid = this.grid;
    this.construction.projects.clear();
    for (const [x, y, p] of projXY) this.construction.projects.set(this.grid.idx(x, y), p);
    this.renderer.setGrid(this.grid);
    if (this.renderer.overlayMode) this.renderer.updateOverlay(this.sim);

    this.ui.toast(`City expanded to ${this.grid.w}×${this.grid.h}`);
    return true;
  }

  newCity() {
    this.grid = new Grid(CONFIG.GRID_W, CONFIG.GRID_H);
    this.sim = new Simulation(this.grid);
    this.construction.setGrid(this.grid);
    this.renderer.setGrid(this.grid);
    this.traffic.setGrid(this.grid);
    this.citizens.setGrid(this.grid);
    this.ai.reset();
    this.gov.reset();
    this.economy.reset();
    this.weather.reset();
    this.stats.reset();
    this.politicsUI.reset();
    this.automayor.reset();
    this.renderer.setOverlay(null);
    this.ui.toast('New city founded');
  }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
