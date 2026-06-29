/* weather.js — Seasons & dynamic weather.
 *
 * A compact, deterministic-ish weather system driven by the simulation's week
 * counter (52 weeks/year, matching the Government calendar). Cycles through four
 * seasons, runs a weighted weather state-machine (clear, cloudy, rain, storm,
 * snow, fog, heatwave, windy) whose probabilities depend on the season, tracks
 * temperature, and exposes effect multipliers that influence power demand,
 * traffic & construction speed, tourism and happiness.
 *
 * Feeds the simulation through the additive, default-neutral hook sim.envMods,
 * and the renderer reads `current`/`intensity` to drive sky, fog and
 * precipitation particles. Nothing existing is rewritten.
 */

const SEASONS = [
  { id: 'spring', name: 'Spring', icon: '🌸', baseTemp: 15, color: '#86efac' },
  { id: 'summer', name: 'Summer', icon: '☀️', baseTemp: 27, color: '#fde047' },
  { id: 'autumn', name: 'Autumn', icon: '🍂', baseTemp: 13, color: '#fb923c' },
  { id: 'winter', name: 'Winter', icon: '❄️', baseTemp: 1,  color: '#bae6fd' },
];

const WEATHER_TYPES = {
  clear:    { name: 'Clear',        icon: '☀️', tempAdj: +2, precip: 0,    fog: 0.0,  cloud: 0.1 },
  cloudy:   { name: 'Cloudy',       icon: '☁️', tempAdj: -1, precip: 0,    fog: 0.0,  cloud: 0.7 },
  rain:     { name: 'Rain',         icon: '🌧', tempAdj: -3, precip: 0.6,  fog: 0.1,  cloud: 0.9 },
  storm:    { name: 'Thunderstorm', icon: '⛈', tempAdj: -4, precip: 1.0,  fog: 0.15, cloud: 1.0 },
  snow:     { name: 'Snow',         icon: '🌨', tempAdj: -6, precip: 0.7,  fog: 0.1,  cloud: 0.9 },
  fog:      { name: 'Fog',          icon: '🌫', tempAdj: -1, precip: 0,    fog: 0.6,  cloud: 0.5 },
  heatwave: { name: 'Heatwave',     icon: '🥵', tempAdj: +8, precip: 0,    fog: 0.0,  cloud: 0.05 },
  windy:    { name: 'Windy',        icon: '💨', tempAdj: -2, precip: 0,    fog: 0.0,  cloud: 0.4 },
};

// Per-season transition weights (how likely each weather is to appear).
const SEASON_WEATHER = {
  spring: { clear: 4, cloudy: 3, rain: 4, storm: 1, fog: 2, windy: 2 },
  summer: { clear: 6, cloudy: 2, rain: 2, storm: 2, heatwave: 2, windy: 1 },
  autumn: { clear: 3, cloudy: 4, rain: 4, storm: 1, fog: 3, windy: 3 },
  winter: { clear: 3, cloudy: 4, snow: 5, fog: 2, windy: 2 },
};

class Weather {
  constructor(game) {
    this.game = game;
    this.weeksPerYear = 52;
    this.reset();
  }

  reset() {
    this.current = 'clear';
    this.intensity = 0.2;        // 0..1 visual + effect strength
    this.targetIntensity = 0.2;
    this.temperature = 15;
    this.season = SEASONS[0];
    this.seasonIndex = 0;
    this._weeksLeft = 1 + (Math.random() * 3 | 0);
    this._lastWeek = -1;
    this.news = [];
    this._publishMods();
  }

  seasonForWeek(week) {
    const woy = ((week % this.weeksPerYear) + this.weeksPerYear) % this.weeksPerYear;
    return Math.floor(woy / (this.weeksPerYear / 4)) % 4;
  }

  _pickWeather() {
    const table = SEASON_WEATHER[this.season.id];
    let total = 0; for (const k in table) total += table[k];
    let r = Math.random() * total;
    for (const k in table) { r -= table[k]; if (r <= 0) return k; }
    return 'clear';
  }

  tick() {
    const week = this.game.sim.week;
    if (week === this._lastWeek) return;
    this._lastWeek = week;

    // Season rollover
    const si = this.seasonForWeek(week);
    if (si !== this.seasonIndex) {
      this.seasonIndex = si;
      this.season = SEASONS[si];
      this._pushNews(`${this.season.icon} ${this.season.name} arrives in the city.`);
    }

    // Weather state machine
    this._weeksLeft--;
    if (this._weeksLeft <= 0) {
      const prev = this.current;
      this.current = this._pickWeather();
      this._weeksLeft = 1 + (Math.random() * 4 | 0);
      this.targetIntensity = 0.35 + Math.random() * 0.6;
      if (this.current !== prev) {
        const w = WEATHER_TYPES[this.current];
        if (['storm', 'snow', 'heatwave', 'fog'].includes(this.current))
          this._pushNews(`${w.icon} ${w.name} ${this.current === 'heatwave' ? 'grips' : 'moves over'} the city.`);
      }
    }
    // ease intensity toward target
    this.intensity += (this.targetIntensity - this.intensity) * 0.4;

    // Temperature: season base + weather adj + small noise
    const w = WEATHER_TYPES[this.current];
    const noise = (Math.random() - 0.5) * 4;
    this.temperature = Math.round(this.season.baseTemp + w.tempAdj + noise);

    this._publishMods();
  }

  // ── effect multipliers ──
  effects() {
    const w = WEATHER_TYPES[this.current];
    const temp = this.temperature;
    // Power demand rises in heat (A/C) and cold (heating).
    const powerDemand = 1 + Math.max(0, (temp - 24) * 0.02) + Math.max(0, (8 - temp) * 0.02);
    // Traffic & construction slow in rain/snow/storm/fog.
    const slow = (w.precip * 0.25 + w.fog * 0.2) * this.intensity;
    const trafficSpeed = ecoClamp ? ecoClamp(1 - slow, 0.5, 1) : Math.max(0.5, 1 - slow);
    const constructionSpeed = Math.max(0.4, 1 - slow * 1.4);
    // Tourism: great in clear/warm, poor in storm/snow.
    let tourism = 1 + (this.current === 'clear' ? 0.2 : 0) + (this.season.id === 'summer' ? 0.15 : 0)
                - (this.current === 'storm' ? 0.3 : 0) - (this.current === 'snow' ? 0.2 : 0);
    tourism = Math.max(0.3, tourism);
    // Happiness: nice weather lifts mood; extremes hurt.
    let happy = 0;
    if (this.current === 'clear') happy += 0.02;
    if (this.current === 'storm' || this.current === 'snow') happy -= 0.03 * this.intensity;
    if (this.current === 'heatwave') happy -= 0.04 * this.intensity;
    if (this.current === 'fog') happy -= 0.01;
    return { powerDemand, trafficSpeed, constructionSpeed, tourism, happyAdd: happy };
  }

  _publishMods() {
    const e = this.effects();
    const pop = this.game.sim.population || 0;
    // Extra utility upkeep from heating/cooling, scaled by population.
    const upkeepAdd = Math.round(Math.max(0, e.powerDemand - 1) * pop * 0.04);
    this.game.sim.envMods = {
      growthMult: 1,           // weather doesn't directly grow the city
      happyAdd: e.happyAdd,
      upkeepAdd,
      trafficSpeed: e.trafficSpeed,
      tourism: e.tourism,
    };
  }

  info() {
    const w = WEATHER_TYPES[this.current];
    return {
      season: this.season, weather: w, current: this.current,
      temperature: this.temperature, intensity: this.intensity,
    };
  }

  _pushNews(text) {
    this.news.unshift({ text, week: this.game.sim.week });
    if (this.news.length > 20) this.news.pop();
  }

  serialize() {
    return {
      current: this.current, intensity: this.intensity, targetIntensity: this.targetIntensity,
      temperature: this.temperature, seasonIndex: this.seasonIndex, _weeksLeft: this._weeksLeft,
    };
  }

  load(d) {
    if (!d) return;
    this.current = d.current || 'clear';
    this.intensity = d.intensity ?? 0.3;
    this.targetIntensity = d.targetIntensity ?? this.intensity;
    this.temperature = d.temperature ?? 15;
    this.seasonIndex = d.seasonIndex ?? 0;
    this.season = SEASONS[this.seasonIndex] || SEASONS[0];
    this._weeksLeft = d._weeksLeft ?? 1;
    this._publishMods();
  }
}

if (typeof module !== 'undefined') module.exports = { Weather, SEASONS, WEATHER_TYPES };
