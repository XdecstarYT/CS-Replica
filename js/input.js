/* input.js — unified pointer/touch handling: pan, pinch-zoom, tap & drag-paint. */

class InputManager {
  constructor(canvas, renderer, onPaint, onHover) {
    this.canvas = canvas;
    this.r = renderer;
    this.onPaint = onPaint;   // (tx, ty, isDragStart) => void
    this.onHover = onHover;   // (tile|null) => void
    this.pointers = new Map();
    this.tool = 'select';
    this.dragging = false;
    this.painted = new Set();
    this.lastPinchDist = 0;
    this.lastMid = null;
    this.moved = false;

    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('pointerleave', e => this.up(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
  }

  setTool(t) { this.tool = t; }
  get isBuildTool() {
    return this.tool === 'road' || this.tool === 'bulldoze' ||
           this.tool === 'service' || this.tool.startsWith('zone');
  }

  down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = false;

    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.lastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this.dragging = false;
      return;
    }

    if (this.isBuildTool) {
      this.dragging = true;
      this.painted.clear();
      const { tx, ty } = this.r.screenToTile(e.clientX, e.clientY);
      this._paintOnce(tx, ty, true);
    } else {
      this.dragging = true; // pan
    }
  }

  move(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // hover only (mouse)
      const { tx, ty } = this.r.screenToTile(e.clientX, e.clientY);
      this.onHover({ tx, ty });
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (Math.hypot(dx, dy) > 3) this.moved = true;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      this._pinch();
      return;
    }

    if (this.dragging && this.isBuildTool) {
      const { tx, ty } = this.r.screenToTile(e.clientX, e.clientY);
      this.onHover({ tx, ty });
      this._paintOnce(tx, ty, false);
    } else if (this.dragging) {
      // pan
      this.r.camX -= dx / this.r.zoom;
      this.r.camY -= dy / this.r.zoom;
      this.r.clampCamera();
    } else {
      const { tx, ty } = this.r.screenToTile(e.clientX, e.clientY);
      this.onHover({ tx, ty });
    }
  }

  _pinch() {
    const pts = [...this.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    if (this.lastPinchDist > 0) {
      const before = this.r.screenToWorld(mid.x, mid.y);
      this.r.zoom *= dist / this.lastPinchDist;
      this.r.clampCamera();
      const after = this.r.screenToWorld(mid.x, mid.y);
      // keep the pinch midpoint anchored
      this.r.camX += before.x - after.x;
      this.r.camY += before.y - after.y;
      // pan by midpoint movement
      if (this.lastMid) {
        this.r.camX -= (mid.x - this.lastMid.x) / this.r.zoom;
        this.r.camY -= (mid.y - this.lastMid.y) / this.r.zoom;
      }
      this.r.clampCamera();
    }
    this.lastPinchDist = dist;
    this.lastMid = mid;
  }

  _paintOnce(tx, ty, start) {
    const key = tx + ',' + ty;
    if (this.painted.has(key)) return;
    this.painted.add(key);
    this.onPaint(tx, ty, start);
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) { this.lastPinchDist = 0; this.lastMid = null; }
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.painted.clear();
    }
  }

  wheel(e) {
    e.preventDefault();
    const before = this.r.screenToWorld(e.clientX, e.clientY);
    this.r.zoom *= e.deltaY < 0 ? 1.12 : 0.89;
    this.r.clampCamera();
    const after = this.r.screenToWorld(e.clientX, e.clientY);
    this.r.camX += before.x - after.x;
    this.r.camY += before.y - after.y;
    this.r.clampCamera();
  }
}
