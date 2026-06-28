/* game.js — main controller: wiring, build actions, loops, persistence. */

class Game {
  constructor() {
    this.grid = new Grid(CONFIG.GRID_W, CONFIG.GRID_H);
    this.sim = new Simulation(this.grid);
    this.renderer = new Renderer3D(document.getElementById('city-canvas'), this.grid);
    this.traffic  = new Traffic(this.grid);
    this.citizens = new Citizens(this.grid);
    this.ai = new CityAI(this);
    this.gov = new Government(this);
    this.ui = new UI(this);
    this.politicsUI = new PoliticsUI(this);
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
    this.grid.pop[i] = 0;
    this.grid.service[i] = null;
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
    if (speed > 0) this.traffic.update(dt * Math.min(speed, 2));
    if (speed > 0) this.citizens.update(dt * Math.min(speed, 2));

    if (speed > 0) {
      this.accum += dt * speed;
      while (this.accum >= CONFIG.TICK_MS) {
        this.accum -= CONFIG.TICK_MS;
        const res = this.sim.step();
        this.renderer.syncBuildings(); // update grown buildings in 3D

        // ── ARIA: observe, analyse periodically, nudge, refresh overlays ──
        this.ai.observe();
        if (this.sim.week % 3 === 0 || !this.ai.report) this.ai.analyze();
        if (this.renderer.overlayMode) this.renderer.updateOverlay(this.sim);
        if (!this.ui.el.aiPanel.classList.contains('hidden')) this.ui.renderAI();
        const nudge = this.ai.maybeNudge();
        if (nudge) this.ui.toast(nudge);

        // ── Government & politics weekly tick ──
        this.gov.tick();

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
      const data = { grid: this.grid.serialize(), sim: this.sim.serialize(), gov: this.gov.serialize(), v: 1 };
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
      this.renderer.setGrid(this.grid);
      this.traffic.setGrid(this.grid);
      this.citizens.setGrid(this.grid);
      this.ai.reset();
      this.gov.reset();
      if (data.gov) this.gov.load(data.gov);
      this.politicsUI.reset();
      if (!silent) this.ui.toast('City loaded');
      return true;
    } catch (e) {
      if (!silent) this.ui.toast('Load failed');
      return false;
    }
  }

  newCity() {
    this.grid = new Grid(CONFIG.GRID_W, CONFIG.GRID_H);
    this.sim = new Simulation(this.grid);
    this.renderer.setGrid(this.grid);
    this.traffic.setGrid(this.grid);
    this.citizens.setGrid(this.grid);
    this.ai.reset();
    this.gov.reset();
    this.politicsUI.reset();
    this.renderer.setOverlay(null);
    this.ui.toast('New city founded');
  }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
