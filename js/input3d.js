/* input3d.js — 3D camera pan / pinch-zoom / twist-rotate + tile picking via raycast. */

class InputManager3D {
  constructor(canvas, renderer, onPaint, onHover) {
    this.canvas = canvas;
    this.r = renderer;
    this.onPaint = onPaint;
    this.onHover = onHover;
    this.pointers = new Map();
    this.tool = 'select';
    this.painted = new Set();
    this.lastPinchDist = 0;
    this.lastPinchAngle = null;
    this.lastMid = null;
    this.moved = false;
    this._dragging = false;

    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e));
    canvas.addEventListener('pointerleave', e => this._up(e));
    canvas.addEventListener('wheel', e => this._wheel(e), { passive: false });
    // Mouse hover (no button held)
    canvas.addEventListener('mousemove', e => { if (!this.pointers.size) { const t = this.r.screenToTile(e.clientX, e.clientY); this.onHover(t); } });
  }

  setTool(t) { this.tool = t; }

  get _isBuild() {
    return this.tool !== 'select';
  }

  _down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = false;

    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.lastPinchAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      this.lastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this._dragging = false;
      return;
    }

    if (this._isBuild) {
      this.painted.clear();
      const tile = this.r.screenToTile(e.clientX, e.clientY);
      if (tile) { this._paintOnce(tile, true); }
    }
    this._dragging = true;
  }

  _move(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;

    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (Math.hypot(dx, dy) > 4) this.moved = true;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      this._handlePinch();
      return;
    }

    if (this._dragging && this._isBuild) {
      if (this.moved) {
        const tile = this.r.screenToTile(e.clientX, e.clientY);
        if (tile) { this._paintOnce(tile, false); this.onHover(tile); }
      }
    } else if (this._dragging && this.moved) {
      // Pan camera
      this._pan(dx, dy);
    } else {
      const tile = this.r.screenToTile(e.clientX, e.clientY);
      this.onHover(tile);
    }
  }

  _handlePinch() {
    const pts = [...this.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

    if (this.lastPinchDist > 0) {
      // Zoom
      this.r.camDist *= this.lastPinchDist / dist;
      // Twist → rotate azimuth
      if (this.lastPinchAngle !== null) {
        let da = angle - this.lastPinchAngle;
        // Wrap angle delta to [-π, π]
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.r.camAzimuth -= da * 0.9;
      }
      // Midpoint move → pan
      if (this.lastMid) this._pan(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
    }
    this.lastPinchDist = dist;
    this.lastPinchAngle = angle;
    this.lastMid = mid;
    this.r._positionCamera();
  }

  _pan(screenDx, screenDy) {
    const r = this.r;
    const factor = r.camDist * 0.0018;
    const theta = r.camAzimuth;
    // Right vector and forward vector on ground plane
    const rightX = Math.cos(theta), rightZ = -Math.sin(theta);
    const fwdX = Math.sin(theta), fwdZ = Math.cos(theta);
    r.camTarget.x -= (rightX * screenDx + fwdX * screenDy) * factor;
    r.camTarget.z -= (rightZ * screenDx + fwdZ * screenDy) * factor;
    r._positionCamera();
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) { this.lastPinchDist = 0; this.lastPinchAngle = null; this.lastMid = null; }
    if (this.pointers.size === 0) { this._dragging = false; this.painted.clear(); }
  }

  _wheel(e) {
    e.preventDefault();
    this.r.camDist *= e.deltaY > 0 ? 1.12 : 0.89;
    this.r._positionCamera();
  }

  _paintOnce(tile, start) {
    const key = `${tile.tx},${tile.ty}`;
    if (this.painted.has(key)) return;
    this.painted.add(key);
    this.onPaint(tile.tx, tile.ty, start);
  }
}
