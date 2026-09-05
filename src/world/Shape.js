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
  constructor({ type = 'solid', nodes = [], data = {} } = {}) {
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
    return this.rebuild();
  }

  clone() { return new Shape(this.toJSON()); }

  toJSON() {
    return {
      type: this.type,
      nodes: this.nodes.map((n) => (n.cx != null ? { x: n.x, y: n.y, cx: n.cx, cy: n.cy } : { x: n.x, y: n.y })),
    };
  }

  static rect(x, y, w, h, type = 'solid') {
    return new Shape({ type, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
  }
}
