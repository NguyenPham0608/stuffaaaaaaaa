import { Vec2 } from '../math/MathUtil.js';
import { pointInPolygon } from '../math/Geometry.js';

let nextId = 1;

/**
 * A rigid body: circle, convex polygon, or static terrain (an arbitrary closed polygon
 * from world/Shape.js that only circles collide with exactly; polygons collide with its
 * convex pieces, see world/Entities.js). Static bodies have zero inverse mass/inertia.
 * Polygon verts are given relative to (x, y); the body is re-centred on the polygon
 * centroid and winding is normalised so face normals point outward (y-down screen coordinates).
 */
export class RigidBody {
  constructor(o = {}) {
    const {
      x = 0, y = 0, angle = 0, shape = 'circle', radius = 12, verts = null, terrain = null,
      density = 0.001, mass = null, isStatic = false, restitution = 0.2, friction = 0.5,
      color = '#8fa1b3', kind = 'body', proxy = false, terrainPiece = false,
    } = o;
    this.id = nextId++;
    this.kind = kind;
    this.shape = shape;
    this.pos = new Vec2(x, y);
    this.prevPos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.angle = angle;
    this.prevAngle = angle;
    this.angVel = 0;
    this.restitution = restitution;
    this.friction = friction;
    this.color = color;
    this.isStatic = isStatic || shape === 'terrain';
    /** Proxy bodies are driven externally: they receive impulses/corrections but no gravity or integration,
     *  and never collide with static bodies (their owner handles that). */
    this.proxy = proxy;
    /** Convex piece of a terrain shape: circles skip it (the terrain body handles them exactly). */
    this.terrainPiece = terrainPiece;
    this.terrain = terrain;
    this.radius = radius;
    this.verts = null;
    this.worldVerts = null;
    this.worldNormals = null;
    this.aabb = { x: 0, y: 0, w: 0, h: 0 };
    /** Contacts from the last step: {other, nx, ny} with the normal pointing toward `other`. */
    this.contacts = [];
    this.grabbed = false;

    if (shape === 'terrain') {
      this.mass = Infinity; this.inertia = Infinity; this.invMass = 0; this.invI = 0;
      this.radius = 0;
      this.updateTransform();
      return;
    }

    let area, inertiaPerDensity;
    if (shape === 'circle') {
      area = Math.PI * radius * radius;
      inertiaPerDensity = 0.5 * area * radius * radius;
    } else {
      const v = verts.map(p => ({ x: p.x, y: p.y }));
      const n = v.length;
      let a2 = 0;
      for (let i = 0; i < n; i++) { const p = v[i], q = v[(i + 1) % n]; a2 += p.x * q.y - q.x * p.y; }
      if (a2 < 0) { v.reverse(); a2 = -a2; }
      area = a2 / 2;
      let cx = 0, cy = 0;
      for (let i = 0; i < n; i++) {
        const p = v[i], q = v[(i + 1) % n];
        const cr = p.x * q.y - q.x * p.y;
        cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
      }
      cx /= 3 * a2; cy /= 3 * a2;
      this.pos.x += cx; this.pos.y += cy;
      this.prevPos.copy(this.pos);
      this.verts = v.map(p => ({ x: p.x - cx, y: p.y - cy }));
      let I = 0, rmax = 0;
      for (let i = 0; i < n; i++) {
        const p = this.verts[i], q = this.verts[(i + 1) % n];
        const cr = p.x * q.y - q.x * p.y;
        I += cr * (p.x * p.x + p.y * p.y + p.x * q.x + p.y * q.y + q.x * q.x + q.y * q.y);
        rmax = Math.max(rmax, Math.hypot(p.x, p.y));
      }
      inertiaPerDensity = I / 12;
      this.radius = rmax;
      this.worldVerts = this.verts.map(() => ({ x: 0, y: 0 }));
      this.worldNormals = this.verts.map(() => ({ x: 0, y: 0 }));
    }
    const m = mass ?? area * density;
    this.mass = m;
    this.inertia = inertiaPerDensity * (m / area);
    this.invMass = isStatic ? 0 : 1 / m;
    this.invI = isStatic ? 0 : 1 / this.inertia;
    this.updateTransform();
  }

  updateTransform() {
    const p = this.pos, r = this.radius, bb = this.aabb;
    if (this.shape === 'terrain') {
      const t = this.terrain;
      bb.x = t.x; bb.y = t.y; bb.w = t.w; bb.h = t.h;
      return;
    }
    if (this.shape === 'circle') {
      bb.x = p.x - r; bb.y = p.y - r; bb.w = r * 2; bb.h = r * 2;
      return;
    }
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const v = this.verts, wv = this.worldVerts, wn = this.worldNormals, n = v.length;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p.x + c * v[i].x - s * v[i].y;
      const y = p.y + s * v[i].x + c * v[i].y;
      wv[i].x = x; wv[i].y = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (let i = 0; i < n; i++) {
      const a = wv[i], b = wv[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey) || 1;
      wn[i].x = ey / len; wn[i].y = -ex / len;
    }
    bb.x = minX; bb.y = minY; bb.w = maxX - minX; bb.h = maxY - minY;
  }

  /** Apply impulse (px, py) at offset (rx, ry) from the centre. */
  applyImpulse(px, py, rx, ry) {
    this.vel.x += px * this.invMass;
    this.vel.y += py * this.invMass;
    this.angVel += this.invI * (rx * py - ry * px);
  }

  containsPoint(x, y) {
    if (this.shape === 'terrain') return pointInPolygon(x, y, this.terrain.points);
    if (this.shape === 'circle') {
      const dx = x - this.pos.x, dy = y - this.pos.y;
      return dx * dx + dy * dy <= this.radius * this.radius;
    }
    const wv = this.worldVerts, wn = this.worldNormals;
    for (let i = 0; i < wv.length; i++) {
      if (wn[i].x * (x - wv[i].x) + wn[i].y * (y - wv[i].y) > 0) return false;
    }
    return true;
  }
}

/** Axis-aligned rectangle verts helper (top-left x/y). */
export function rectVerts(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}
