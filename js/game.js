/* game.js — main controller: wiring, build actions, loops, persistence. */

class Game {
  constructor() {
    this.grid = new Grid(CONFIG.GRID_W, CONFIG.GRID_H);
    this.sim = new Simulation(this.grid);
    this.renderer = new Renderer(document.getElementById('city-canvas'), this.grid);
    this.traffic = new Traffic(this.grid);
    this.renderer.traffic = this.traffic;
    this.ui = new UI(this);
    this.dayLength = 90000; // ms for a full day/night cycle (real time)

    this.tool = 'select';
    this.selectedService = null;
    this.hover = null;
    this.speedIndex = 1; // start at normal speed
    this.lastTick = performance.now();
    this.accum = 0;

    this.input = new InputManager(
      this.renderer.canvas,
      this.renderer,
      (tx, ty, start) => this.paint(tx, ty, start),
      (tile) => { this.hover = tile; }
    );

    // try autoload
    if (!this.load(true)) this.ui.toast('New city founded — build roads to begin!');

    this.selectTool('select', document.querySelector('.tool[data-tool="select"]'));
    requestAnimationFrame(t => this.loop(t));

    // autosave every 30s
    setInterval(() => this.save(true), 30000);
    window.addEventListener('beforeunload', () => this.save(true));
  }

  selectTool(tool, btn) {
    this.tool = tool;
    this.input.setTool(tool);
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (tool === 'service') { this.ui.showServicePicker(); }
    else { this.ui.hideServicePicker(); }
  }

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % CONFIG.SPEEDS.length;
    this.ui.update();
  }

  // ---- Build actions ----
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
    }
    else if (this.tool === 'service') {
      if (!start) return; // single placement per tap, not drag
      const svc = SERVICE_BY_ID[this.selectedService];
      if (!svc) return this._deny('Pick a building first');
      if (g.type[i] === TILE.WATER) return this._deny('Can\'t build on water');
      if (!this._charge(svc.cost)) return;
      this._clearTile(i);
      g.type[i] = TILE.SERVICE;
      g.service[i] = svc.id;
      this.ui.toast(`${svc.name} built`);
    }
    else if (this.tool === 'bulldoze') {
      if (g.type[i] === TILE.WATER || g.type[i] === TILE.GRASS) return;
      this._clearTile(i);
      g.type[i] = TILE.GRASS;
    }
  }

  _clearTile(i) {
    this.grid.level[i] = 0;
    this.grid.pop[i] = 0;
    this.grid.service[i] = null;
    if (this.grid.type[i] === TILE.WATER) return;
    this.grid.type[i] = TILE.GRASS;
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

  // ---- Main loop ----
  loop(t) {
    const dt = t - this.lastTick;
    this.lastTick = t;
    const speed = CONFIG.SPEEDS[this.speedIndex];

    // Day/night clock advances in real time (so the city feels alive even
    // when the simulation is paused), faster at higher game speeds.
    this.renderer.timeOfDay = (this.renderer.timeOfDay + dt / this.dayLength * (0.5 + speed * 0.5)) % 1;
    // Keep traffic populated relative to city size and animate it.
    this.traffic.sync(Math.round(this.sim.population / 12) + (this.sim.jobsC + this.sim.jobsI) / 20);
    if (speed > 0) this.traffic.update(dt * Math.min(speed, 2));
    if (speed > 0) {
      this.accum += dt * speed;
      while (this.accum >= CONFIG.TICK_MS) {
        this.accum -= CONFIG.TICK_MS;
        const res = this.sim.step();
        if (res.bankrupt && !this._warnedBankrupt) {
          this._warnedBankrupt = true;
          this.ui.toast('⚠ City is bankrupt! Cut services or raise population.');
        } else if (!res.bankrupt) {
          this._warnedBankrupt = false;
        }
      }
    }
    this.renderer.draw(this.hover, this.tool);
    this.ui.update();
    requestAnimationFrame(tt => this.loop(tt));
  }

  // ---- Persistence ----
  save(silent) {
    try {
      const data = { grid: this.grid.serialize(), sim: this.sim.serialize(), v: 1 };
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
      this.renderer.grid = this.grid;
      this.traffic.setGrid(this.grid);
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
    this.renderer.grid = this.grid;
    this.traffic.setGrid(this.grid);
    this.renderer.camX = this.grid.w * CONFIG.TILE * 0.5;
    this.renderer.camY = this.grid.h * CONFIG.TILE * 0.5;
    this.ui.toast('New city founded');
  }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
