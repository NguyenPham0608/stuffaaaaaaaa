import { flattenPath, polygonBounds } from '../math/Geometry.js';

let nextId = 1;

/**
 * A clear transport tube: an open path of nodes (each optionally carrying the quadratic
 * control point of the segment to the next). Anything entering an end travels visibly along
 * the centreline and is spat out of the far end.
 */
export class Tube {
  constructor({ nodes = [], radius = 22, wall = 7 } = {}) {
    this.id = nextId++;
    this.radius = radius;
    this.wall = wall;                // thickness of the solid pipe wall
    this.nodes = nodes.map((n) => ({ x: n.x, y: n.y, cx: n.cx ?? null, cy: n.cy ?? null }));
    this.points = [];
    this.cum = [];
    this.length = 0;
    this.x = this.y = this.w = this.h = 0;
    this.rebuild();
  }

  rebuild() {
    const pts = flattenPath(this.nodes, 1.5, false);
    this.points = pts;
    this.cum = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      this.cum.push(total);
    }
    this.length = total;
    const b = polygonBounds(pts);
    const r = this.radius + this.wall;
    this.x = b.x - r; this.y = b.y - r;
    this.w = b.w + r * 2; this.h = b.h + r * 2;
    return this;
  }

  /** Unit normal of the centreline at each flattened point. */
  _normals() {
    const pts = this.points, out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      out.push({ x: -dy / len, y: dx / len });
    }
    return out;
  }

  /**
   * The pipe's solid walls, as one convex quad per centreline segment per side. Both mouths
   * are left open so things can be swallowed; everywhere else the pipe is solid.
   */
  wallQuads() {
    if (!this.usable) return [];
    const pts = this.points, n = this._normals(), r = this.radius, w = this.wall;
    const quads = [];
    for (const side of [1, -1]) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], na = n[i - 1], nb = n[i];
        quads.push([
          { x: a.x + na.x * side * r, y: a.y + na.y * side * r },
          { x: b.x + nb.x * side * r, y: b.y + nb.y * side * r },
          { x: b.x + nb.x * side * (r + w), y: b.y + nb.y * side * (r + w) },
          { x: a.x + na.x * side * (r + w), y: a.y + na.y * side * (r + w) },
        ]);
      }
    }
    return quads;
  }

  get usable() { return this.points.length >= 2 && this.length > 1; }

  /** Position and unit direction at `d` px along the centreline (clamped to the ends). */
  pointAt(d) {
    const pts = this.points, cum = this.cum;
    if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, tx: 1, ty: 0 };
    const t = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < t) i++;
    const a = pts[i - 1], b = pts[i];
    const segLen = cum[i] - cum[i - 1] || 1;
    const f = (t - cum[i - 1]) / segLen;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * f, y: a.y + dy * f, tx: dx / len, ty: dy / len };
  }

  /** The end (0 = start, 1 = end) whose mouth `p` is inside, or -1. */
  mouthAt(p, slack = 0) {
    const r = this.radius + slack;
    const a = this.points[0], b = this.points[this.points.length - 1];
    if (a && Math.hypot(p.x - a.x, p.y - a.y) <= r) return 0;
    if (b && Math.hypot(p.x - b.x, p.y - b.y) <= r) return 1;
    return -1;
  }

  translate(dx, dy) {
    for (const n of this.nodes) {
      n.x += dx; n.y += dy;
      if (n.cx != null) { n.cx += dx; n.cy += dy; }
    }
    return this.rebuild();
  }

  clone() { return new Tube(this.toJSON()); }

  toJSON() {
    return {
      radius: this.radius,
      wall: this.wall,
      nodes: this.nodes.map((n) => (n.cx != null ? { x: n.x, y: n.y, cx: n.cx, cy: n.cy } : { x: n.x, y: n.y })),
    };
  }
}
