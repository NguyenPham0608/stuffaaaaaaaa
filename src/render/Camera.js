import { damp } from '../math/MathUtil.js';

/** Smooth-follow camera. x/y are the world coordinates of the view's top-left corner. */
export class Camera {
  constructor(cfg) {
    this.cfg = cfg;
    this.x = 0; this.y = 0;
    this.prevX = 0; this.prevY = 0;
    this.zoom = cfg.zoom ?? 1;
    this.viewW = 0; this.viewH = 0;
    this.bounds = null; // {x, y, w, h} in world space; only the bottom edge constrains the view
  }

  setView(w, h) { this.viewW = w / this.zoom; this.viewH = h / this.zoom; }

  snapTo(cx, cy) {
    this.x = cx - this.viewW / 2; this.y = cy - this.viewH / 2;
    this._clamp();
    this.prevX = this.x; this.prevY = this.y;
  }

  follow(target, vel, dt) {
    this.prevX = this.x; this.prevY = this.y;
    const c = this.cfg;
    const tx = target.x + vel.x * c.lookAheadX - this.viewW / 2;
    const ty = target.y + vel.y * c.lookAheadY - this.viewH / 2;
    this.x = damp(this.x, tx, c.smoothingX, dt);
    this.y = damp(this.y, ty, c.smoothingY, dt);
    this._clamp();
  }

  /** Only the ground is clamped: the view never drops below the level's bottom edge.
   *  Sideways and upward the camera is free, so it can follow past the level's edges. */
  _clamp() {
    const b = this.bounds;
    if (!b) return;
    const maxY = b.y + b.h - this.viewH;
    if (this.y > maxY) this.y = maxY;
  }

  /** Apply the world->screen transform to a context (dpr included). */
  applyTo(ctx, dpr, alpha) {
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    const s = this.zoom * dpr;
    ctx.setTransform(s, 0, 0, s, -x * s, -y * s);
  }

  /** Interpolated world-space rectangle currently visible. */
  visibleRect(alpha) {
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    return { x, y, w: this.viewW, h: this.viewH };
  }
}
