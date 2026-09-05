import { Materials } from './Materials.js';
import { flattenPath, simplifyPolygon, ensureWinding, polygonBounds } from '../math/Geometry.js';

let nextId = 1;

/**
 * A static piece of level geometry: a closed path of nodes, each optionally carrying the
 * quadratic control point (cx, cy) of the segment to the next node. `points`/`edges` are
 * the flattened polygon the physics uses; call rebuild() after editing `nodes`.
 * Surface behaviour comes from the material.
 */
export class Shape {
  constructor({ type = 'solid', nodes = [], data = {}, channel = null, move = null } = {}) {
    const def = typeof type === 'string' ? Materials[type] : type;
    if (!def) throw new Error(`Unknown material: ${type}`);
    this.id = nextId++;
    this.type = def.name;
    this.color = def.color;
    this.friction = def.friction;
    this.bounce = def.bounce;
    this.oneWay = !!def.oneWay;
    this.hazard = !!def.hazard;
    this.draw = def.draw || null;
    this.nodes = nodes.map((n) => ({ x: n.x, y: n.y, cx: n.cx ?? null, cy: n.cy ?? null }));
    /** Switch channel that drives this shape, and how far it travels when powered. */
    this.channel = channel;
    this.move = move ? { dx: move.dx ?? 0, dy: move.dy ?? 0, duration: move.duration ?? 0.5 } : null;
    this.offset = 0;                 // 0 = resting, 1 = fully moved
    this.baseNodes = this.nodes.map((n) => ({ ...n }));
    this.data = data;
    this.points = [];
    this.edges = [];
    this.x = this.y = this.w = this.h = 0;
    this.rebuild();
  }

  setMaterial(type) {
    const def = Materials[type];
    if (!def) throw new Error(`Unknown material: ${type}`);
    Object.assign(this, {
      type: def.name, color: def.color, friction: def.friction, bounce: def.bounce,
      oneWay: !!def.oneWay, hazard: !!def.hazard, draw: def.draw || null,
    });
  }

  get isDoor() { return !!(this.channel && this.move); }

  /** Snapshot the current nodes as the resting pose a `move` is measured from. */
  syncBase() {
    this.baseNodes = this.nodes.map((n) => ({ ...n }));
    return this;
  }

  /** Place the shape `t` (0..1) of the way along its `move`. Returns true if it changed. */
  setOffset(t) {
    if (!this.move || Math.abs(t - this.offset) < 1e-4) return false;
    this.offset = t;
    const { dx, dy } = this.move;
    this.nodes.forEach((n, i) => {
      const b = this.baseNodes[i];
      n.x = b.x + dx * t; n.y = b.y + dy * t;
      if (b.cx != null) { n.cx = b.cx + dx * t; n.cy = b.cy + dy * t; }
    });
    this.rebuild();
    return true;
  }

  /** Recompute the flattened polygon, bounds and edge list from `nodes`. */
  rebuild() {
    const pts = ensureWinding(simplifyPolygon(flattenPath(this.nodes)));
    this.points = pts;
    const b = polygonBounds(pts);
    this.x = b.x; this.y = b.y; this.w = b.w; this.h = b.h;
    this.edges = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const ex = q.x - p.x, ey = q.y - p.y;
      const len = Math.hypot(ex, ey) || 1;
      return {
        shape: this, ax: p.x, ay: p.y, bx: q.x, by: q.y,
        nx: ey / len, ny: -ex / len, len,
        x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(ex), h: Math.abs(ey),
      };
    });
    return this;
  }

  get right() { return this.x + this.w; }
  get bottom() { return this.y + this.h; }
  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.h / 2; }

  translate(dx, dy) {
    for (const n of this.nodes) {
      n.x += dx; n.y += dy;
      if (n.cx != null) { n.cx += dx; n.cy += dy; }
    }
    this.rebuild();
    return this.syncBase();
  }

  clone() { return new Shape(this.toJSON()); }

  toJSON() {
    const out = {
      type: this.type,
      nodes: this.baseNodes.map((n) => (n.cx != null ? { x: n.x, y: n.y, cx: n.cx, cy: n.cy } : { x: n.x, y: n.y })),
    };
    if (this.channel) out.channel = this.channel;
    if (this.move) out.move = { ...this.move };
    return out;
  }

  static rect(x, y, w, h, type = 'solid') {
    return new Shape({ type, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
  }
}
