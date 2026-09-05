import { circleVsPolygon } from './Collision.js';
import { SpatialHash } from './SpatialHash.js';
import { clamp } from '../math/MathUtil.js';

/**
 * Static-geometry world for circle bodies (the player). Geometry is any closed polygon
 * (see world/Shape.js), so slopes and curves work exactly.
 *
 * Step outline (per body):
 *  1. Pre-solve: sense surfaces within `skin`, cancel velocity into them (this is what
 *     makes resting contact drift-free: no penetration happens in the first place).
 *  2. Integrate in substeps small enough that the body can't tunnel, resolving
 *     overlaps after each substep (push out along the contact normal, cancel/bounce
 *     the normal velocity, corner-correct ceiling clips, keep landings from flinging
 *     the body sideways).
 *  3. Sense again and classify contacts into ground / ceiling / left / right.
 */
export class PhysicsWorld {
  constructor(config) {
    this.cfg = config;
    this.shapes = [];
    this.hash = new SpatialHash(128);
    this._query = [];
    this._hits = [];
    this._dt = config.fixedDt || 1 / 120;
  }

  addShape(shape) { this.shapes.push(shape); this.hash.insert(shape); return shape; }
  removeShape(shape) {
    const i = this.shapes.indexOf(shape);
    if (i >= 0) { this.shapes.splice(i, 1); this.hash.remove(shape); }
  }
  clear() { this.shapes.length = 0; this.hash.clear(); }

  /** Re-index a shape whose geometry `mutate` is about to change. */
  updateShape(shape, mutate) {
    this.hash.remove(shape);
    const changed = mutate();
    this.hash.insert(shape);
    return changed;
  }

  step(body, dt) {
    const p = this.cfg;
    body.prevPos.copy(body.pos);
    body.touched.clear();
    body.hazard = null;
    body.bounced = null;
    if (body.dropThrough > 0) body.dropThrough -= dt;
    this._dt = dt;

    // 1. Pre-solve velocity constraint against sensed contacts (speculative: the body may
    //    still close whatever gap remains this step, so it settles onto curves instead of
    //    hovering at the sensing distance). A bouncy surface launches here too, a step before
    //    it is actually touched, so the body gets a full step to travel back out of it.
    this._sense(body);
    for (const c of body.senseContacts) this._impulse(body, c.wall, c.nx, c.ny, Math.max(0, -c.depth));

    // 2. Integrate with substeps small enough to rule out tunneling. If a body is somehow
    //    moving faster than the substep budget can cover, clamp its speed rather than tunnel.
    const maxStep = body.radius * p.maxSubstepMove;
    let dist = body.vel.len() * dt;
    const maxDist = maxStep * p.maxSubsteps;
    if (dist > maxDist) { body.vel.scale(maxDist / dist); dist = maxDist; }
    const n = clamp(Math.ceil(dist / maxStep), 1, p.maxSubsteps);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const fromY = body.pos.y;
      body.pos.addScaled(body.vel, h);
      this._resolve(body, fromY);
    }

    // 3. Final sensing and classification.
    this._sense(body);
    this._classify(body);
  }

  /** Whether `contact` is solid for `body` given where the body's centre was before moving. */
  shouldCollide(body, contact, fromY) {
    const s = contact.shape;
    if (s.oneWay) {
      if (body.dropThrough > 0) return false;
      if (body.vel.y < 0) return false;
      if (contact.ny > -0.5) return false;                          // only the upward-facing side is solid
      if (fromY + body.radius > contact.y + this.cfg.oneWayTolerance) return false;
    }
    return true;
  }

  /** All contacts within radius r of the body's centre, filtered by shouldCollide. */
  _collect(body, r, fromY, out) {
    const pos = body.pos;
    const list = this.hash.query(pos.x - r, pos.y - r, r * 2, r * 2, this._query);
    out.length = 0;
    for (const s of list) circleVsPolygon(pos.x, pos.y, r, s, out);
    for (let i = out.length - 1; i >= 0; i--) if (!this.shouldCollide(body, out[i], fromY)) out.splice(i, 1);
    return out;
  }

  _sense(body) {
    const skin = this.cfg.skin;
    const hits = this._collect(body, body.radius + skin, body.pos.y, this._hits);
    body.senseContacts.length = 0;
    for (const c of hits) {
      body.senseContacts.push({ wall: c.shape, nx: c.nx, ny: c.ny, depth: c.depth - skin, x: c.x, y: c.y, vertex: c.vertex });
      body.touched.add(c.shape);
      if (c.shape.hazard && !body.hazard) body.hazard = c.shape;
    }
  }

  _resolve(body, fromY) {
    const p = this.cfg;
    const pos = body.pos, vel = body.vel;

    for (let iter = 0; iter < p.solverIterations; iter++) {
      const hits = this._collect(body, body.radius, fromY, this._hits);
      let any = false;
      for (const c of hits) {
        if (c.depth <= 0) continue;
        any = true;
        body.touched.add(c.shape);
        if (c.shape.hazard && !body.hazard) body.hazard = c.shape;

        // Clipping the underside corner of a block while rising: nudge sideways instead of stopping.
        if (c.vertex && c.ny > 0.2 && vel.y < 0 && this._cornerCorrect(body, c)) continue;

        pos.x += c.nx * c.depth;
        pos.y += c.ny * c.depth;

        const preVx = vel.x;
        this._impulse(body, c.shape, c.nx, c.ny);

        // Landing grip: a flat-ish ground contact must not convert fall speed into sideways speed.
        if (c.ny <= p.gripNormalY && Math.abs(vel.x) > Math.abs(preVx)) vel.x = preVx;
      }
      if (!any) break;
    }
  }

  _cornerCorrect(body, c) {
    const cc = this.cfg.cornerCorrection;
    const pos = body.pos, r = body.radius;
    const dx = c.x - pos.x;
    const need = r - Math.abs(dx) + 0.01;   // horizontal shift that clears the corner
    if (need <= 0 || need > cc) return false;
    pos.x -= (dx >= 0 ? 1 : -1) * need;
    return true;
  }

  /**
   * Remove (or reflect, for bouncy surfaces) the velocity component moving into the surface.
   * With a positive `gap` the body keeps enough approach velocity to close it this step.
   */
  _impulse(body, s, nx, ny, gap = 0) {
    const vel = body.vel;
    const vn = vel.x * nx + vel.y * ny;
    const allowed = -gap / this._dt;
    if (vn >= allowed) return false;
    const bounce = s.bounce || 0;
    if (bounce > 0 && -vn > this.cfg.minBounceSpeed) {
      // Leave the surface at `bounce` times the impact speed, but never below the pad's
      // minimum launch, so even a gentle landing gets a real pop.
      const out = Math.max(-vn * bounce, this.cfg.minBounceLaunch) * body.bounceBoost;
      vel.x += nx * (out - vn);
      vel.y += ny * (out - vn);
      body.bounced = { wall: s, nx, ny, speed: -vn, launch: out };
      return true;
    }
    const dv = vn - allowed;
    vel.x -= nx * dv;
    vel.y -= ny * dv;
    return true;
  }

  _classify(body) {
    const p = this.cfg;
    const c = body.contacts;
    c.ground = c.ceiling = c.left = c.right = null;
    for (const s of body.senseContacts) {
      if (s.ny <= p.groundNormalY) {
        if (!c.ground || s.ny < c.ground.ny) c.ground = s;
      } else if (s.ny >= p.ceilingNormalY) {
        if (!c.ceiling || s.ny > c.ceiling.ny) c.ceiling = s;
      } else if (s.nx >= p.wallNormalX) {
        if (!c.left || s.nx > c.left.nx) c.left = s;   // normal points right => wall is on the left
      } else if (s.nx <= -p.wallNormalX) {
        if (!c.right || s.nx < c.right.nx) c.right = s;
      }
    }
  }
}
