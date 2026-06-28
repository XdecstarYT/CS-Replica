/* render.js — draws the city to the canvas with a top-down view. */

class Renderer {
  constructor(canvas, grid) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.grid = grid;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // camera
    this.zoom = 0.7;
    this.camX = grid.w * CONFIG.TILE * 0.5;
    this.camY = grid.h * CONFIG.TILE * 0.5;
    this.overlay = null; // 'power' | 'land' | null
    this.traffic = null;       // optional Traffic instance
    this.timeOfDay = 0.35;     // 0..1, advances over a ~day cycle
    this.nightFactor = 0;      // 0 (day) .. 1 (deep night), derived each frame
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.vw = w; this.vh = h;
  }

  screenToWorld(sx, sy) {
    const wx = (sx - this.vw / 2) / this.zoom + this.camX;
    const wy = (sy - this.vh / 2) / this.zoom + this.camY;
    return { x: wx, y: wy };
  }

  screenToTile(sx, sy) {
    const { x, y } = this.screenToWorld(sx, sy);
    return { tx: Math.floor(x / CONFIG.TILE), ty: Math.floor(y / CONFIG.TILE) };
  }

  clampCamera() {
    const wpx = this.grid.w * CONFIG.TILE;
    const hpx = this.grid.h * CONFIG.TILE;
    this.camX = Math.max(0, Math.min(wpx, this.camX));
    this.camY = Math.max(0, Math.min(hpx, this.camY));
    this.zoom = Math.max(CONFIG.MIN_ZOOM, Math.min(CONFIG.MAX_ZOOM, this.zoom));
  }

  // 0 at midday, 1 at deep night, smooth between.
  _computeNight() {
    // timeOfDay 0..1; treat 0.25 as noon, 0.75 as midnight.
    const n = (1 - Math.cos((this.timeOfDay - 0.25) * Math.PI * 2)) / 2;
    this.nightFactor = n;
    return n;
  }

  draw(hover, tool) {
    const ctx = this.ctx, g = this.grid, T = CONFIG.TILE;
    this._computeNight();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#16324a';
    ctx.fillRect(0, 0, this.vw, this.vh);

    ctx.save();
    ctx.translate(this.vw / 2, this.vh / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    // Visible tile bounds (culling)
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.vw, this.vh);
    const x0 = Math.max(0, Math.floor(tl.x / T) - 1);
    const y0 = Math.max(0, Math.floor(tl.y / T) - 1);
    const x1 = Math.min(g.w - 1, Math.ceil(br.x / T) + 1);
    const y1 = Math.min(g.h - 1, Math.ceil(br.y / T) + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this._drawTile(ctx, g, x, y, T);
      }
    }

    // Vehicles
    if (this.traffic && this.zoom > 0.45) this._drawVehicles(ctx, T);

    // Overlay shading
    if (this.overlay) this._drawOverlay(ctx, g, x0, y0, x1, y1, T);

    // Hover highlight
    if (hover && g.inBounds(hover.tx, hover.ty)) {
      const valid = this._hoverValid(hover, tool);
      ctx.fillStyle = valid ? 'rgba(56,189,248,0.35)' : 'rgba(248,113,113,0.4)';
      ctx.fillRect(hover.tx * T, hover.ty * T, T, T);
      ctx.strokeStyle = valid ? '#38bdf8' : '#f87171';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(hover.tx * T, hover.ty * T, T, T);
    }

    ctx.restore();

    // Day/night tint in screen space (over the whole world).
    const n = this.nightFactor;
    if (n > 0.02) {
      ctx.fillStyle = `rgba(8,14,38,${(n * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, this.vw, this.vh);
    }
  }

  _drawVehicles(ctx, T) {
    const g = this.grid;
    const s = Math.max(3, T * 0.16);
    for (const v of this.traffic.vehicles) {
      const dx = v.nx - v.x, dy = v.ny - v.y;
      // interpolate centre-of-tile position
      const wx = (v.x + dx * v.t + 0.5) * T;
      const wy = (v.y + dy * v.t + 0.5) * T;
      // offset to the right of travel direction so cars keep a lane
      const ox = -dy * T * 0.16, oy = dx * T * 0.16;
      ctx.fillStyle = v.color;
      ctx.fillRect(wx + ox - s / 2, wy + oy - s / 2, s, s);
      // headlight glow at night
      if (this.nightFactor > 0.5) {
        ctx.fillStyle = `rgba(255,240,180,${((this.nightFactor - 0.5) * 0.7).toFixed(3)})`;
        ctx.fillRect(wx + ox - s * 0.6, wy + oy - s * 0.6, s * 1.2, s * 1.2);
      }
    }
  }

  _hoverValid(hover, tool) {
    const g = this.grid;
    if (tool === 'road') return g.isBuildable(hover.tx, hover.ty);
    if (tool && tool.startsWith('zone')) return g.isBuildable(hover.tx, hover.ty);
    if (tool === 'service') return g.isBuildable(hover.tx, hover.ty);
    return true;
  }

  _drawTile(ctx, g, x, y, T) {
    const i = g.idx(x, y);
    const t = g.type[i];
    const px = x * T, py = y * T;

    // base terrain
    if (t === TILE.WATER) {
      ctx.fillStyle = '#1d4e6b';
      ctx.fillRect(px, py, T, T);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(px, py + (((x + y) % 2) ? T * 0.5 : 0), T, T * 0.18);
      return;
    }
    // grass base
    ctx.fillStyle = (x + y) % 2 ? '#2f5d3a' : '#326240';
    ctx.fillRect(px, py, T, T);

    if (t === TILE.ROAD) {
      this._drawRoad(ctx, g, x, y, T);
      return;
    }

    if (t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND) {
      this._drawZone(ctx, g, i, t, px, py, T);
      return;
    }

    if (t === TILE.SERVICE) {
      const svc = SERVICE_BY_ID[g.service[i]];
      ctx.fillStyle = svc ? svc.color : '#888';
      this._roundRect(ctx, px + 3, py + 3, T - 6, T - 6, 4);
      ctx.fill();
      if (this.zoom > 0.5) {
        ctx.font = `${T * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(svc ? svc.ico : '?', px + T / 2, py + T / 2 + 1);
      }
      return;
    }
  }

  _drawZone(ctx, g, i, t, px, py, T) {
    const lvl = g.level[i];
    const zoneColor = t === TILE.ZONE_RES ? '#1f3d27'
                    : t === TILE.ZONE_COM ? '#1a3148'
                    : '#3a3216';
    // empty zone marker
    ctx.fillStyle = zoneColor;
    ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
    ctx.strokeStyle = t === TILE.ZONE_RES ? 'rgba(74,222,128,0.4)'
                    : t === TILE.ZONE_COM ? 'rgba(96,165,250,0.4)'
                    : 'rgba(251,191,36,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1.5, py + 1.5, T - 3, T - 3);

    if (lvl <= 0) return;

    // grown building: a footprint that gets taller/bigger with level
    const fill = t === TILE.ZONE_RES ? '#4ade80'
               : t === TILE.ZONE_COM ? '#60a5fa'
               : '#fbbf24';
    const pad = T * (0.30 - lvl * 0.06);
    const h = T * (0.35 + lvl * 0.18);
    const bx = px + pad, by = py + (T - h) - pad * 0.3;
    const bw = T - pad * 2, bh = h;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx + 2, by + 2, bw, bh);
    ctx.fillStyle = fill;
    ctx.fillRect(bx, by, bw, bh);
    // roof shade
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(bx, by, bw, bh * 0.22);
    // windows for higher levels (warm glow at night)
    if (this.zoom > 0.6 && lvl >= 2) {
      ctx.fillStyle = this.nightFactor > 0.45
        ? `rgba(255,214,120,${(0.45 + this.nightFactor * 0.45).toFixed(3)})`
        : 'rgba(255,255,255,0.55)';
      const cols = lvl >= 3 ? 3 : 2;
      const rows = lvl >= 3 ? 3 : 2;
      const ww = bw / (cols * 2 + 1);
      const wh = bh / (rows * 2 + 1);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          ctx.fillRect(bx + ww * (c * 2 + 1), by + wh * (r * 2 + 1) + bh * 0.2, ww, wh);
    }
  }

  _drawRoad(ctx, g, x, y, T) {
    const px = x * T, py = y * T;
    ctx.fillStyle = '#3a3f4b';
    ctx.fillRect(px, py, T, T);
    // connections
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    ctx.strokeStyle = '#d7c84a';
    ctx.lineWidth = Math.max(1, T * 0.05);
    ctx.setLineDash([T * 0.18, T * 0.14]);
    ctx.beginPath();
    let connected = false;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (g.inBounds(nx, ny) && g.type[g.idx(nx, ny)] === TILE.ROAD) {
        connected = true;
        ctx.moveTo(px + T / 2, py + T / 2);
        ctx.lineTo(px + T / 2 + dx * T / 2, py + T / 2 + dy * T / 2);
      }
    }
    if (!connected) { ctx.moveTo(px + T * 0.3, py + T / 2); ctx.lineTo(px + T * 0.7, py + T / 2); }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawOverlay(ctx, g, x0, y0, x1, y1, T) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = g.idx(x, y);
        let c = null;
        if (this.overlay === 'power') {
          c = g.power[i] ? 'rgba(250,204,21,0.28)' : 'rgba(0,0,0,0.35)';
        } else if (this.overlay === 'water') {
          c = g.water[i] ? 'rgba(56,189,248,0.28)' : 'rgba(0,0,0,0.35)';
        }
        if (c) { ctx.fillStyle = c; ctx.fillRect(x * T, y * T, T, T); }
      }
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
