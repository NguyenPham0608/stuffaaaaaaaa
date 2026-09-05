import { aabbOverlap, circleVsPolygon } from './Collision.js';

/**
 * Small 2D rigid-body world: circles + convex polygons + static terrain, SAT/clipping
 * contact generation, sequential-impulse solver with friction and restitution, and
 * Baumgarte positional correction. Intended for sandbox-scale scenes (< ~300 bodies).
 *
 * Terrain (arbitrary closed polygons) is exact for circles; polygons collide with the
 * terrain's convex pieces (separate static bodies flagged `terrainPiece`).
 */
export class RigidWorld {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 1400;
    this.iterations = opts.iterations ?? 12;
    this.slop = opts.slop ?? 0.4;
    this.correction = opts.correction ?? 0.4;
    this.restThreshold = opts.restThreshold ?? 40;   // px/s; slower impacts don't bounce
    this.linearDamping = opts.linearDamping ?? 0.03;
    this.angularDamping = opts.angularDamping ?? 0.08;
    this.maxSpeed = opts.maxSpeed ?? 3000;
    this.bodies = [];
    this.manifolds = [];
  }

  add(b) { this.bodies.push(b); return b; }
  remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }
  clear() { this.bodies.length = 0; this.manifolds.length = 0; }

  step(dt) {
    const bodies = this.bodies;
    for (const b of bodies) {
      b.prevPos.copy(b.pos);
      b.prevAngle = b.angle;
      b.contacts.length = 0;
      b.updateTransform();
    }

    const ms = this.manifolds;
    ms.length = 0;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (a.isStatic && b.isStatic) continue;
        if ((a.proxy && b.isStatic) || (b.proxy && a.isStatic)) continue;
        // A carried body is pinned to the player, so it must not shove the player back, and
        // GameScene settles it against the level itself (both sides here would be immovable).
        if ((a.proxy && b.carried) || (b.proxy && a.carried)) continue;
        if ((a.carried && b.isStatic) || (b.carried && a.isStatic)) continue;
        if (!aabbOverlap(a.aabb, b.aabb)) continue;
        const m = collide(a, b);
        if (!m) continue;
        if (Array.isArray(m)) { for (const k of m) ms.push(k); } else ms.push(m);
      }
    }

    const ld = Math.max(0, 1 - this.linearDamping * dt);
    const ad = Math.max(0, 1 - this.angularDamping * dt);
    for (const b of bodies) {
      if (b.isStatic || b.proxy || b.carried) continue;
      b.vel.y += this.gravity * dt;
      b.vel.scale(ld);
      b.angVel *= ad;
    }

    for (const m of ms) this._prestep(m);
    for (let k = 0; k < this.iterations; k++) for (const m of ms) this._solve(m);

    const maxSq = this.maxSpeed * this.maxSpeed;
    for (const b of bodies) {
      if (b.isStatic || b.proxy || b.carried) continue;   // carried: position is written by GameScene
      const sq = b.vel.lenSq();
      if (sq > maxSq) b.vel.scale(this.maxSpeed / Math.sqrt(sq));
      b.pos.addScaled(b.vel, dt);
      b.angle += b.angVel * dt;
    }

    for (const m of ms) this._correct(m);
    for (const m of ms) {
      m.a.contacts.push({ other: m.b, nx: m.nx, ny: m.ny });
      m.b.contacts.push({ other: m.a, nx: -m.nx, ny: -m.ny });
    }
  }

  _prestep(m) {
    const { a, b, nx, ny } = m;
    m.e = Math.min(a.restitution, b.restitution);
    m.mu = Math.sqrt(a.friction * b.friction);
    const tx = -ny, ty = nx;
    for (const c of m.contacts) {
      c.rax = c.x - a.pos.x; c.ray = c.y - a.pos.y;
      c.rbx = c.x - b.pos.x; c.rby = c.y - b.pos.y;
      const rnA = c.rax * ny - c.ray * nx, rnB = c.rbx * ny - c.rby * nx;
      c.kn = a.invMass + b.invMass + a.invI * rnA * rnA + b.invI * rnB * rnB;
      const rtA = c.rax * ty - c.ray * tx, rtB = c.rbx * ty - c.rby * tx;
      c.kt = a.invMass + b.invMass + a.invI * rtA * rtA + b.invI * rtB * rtB;
      const rvx = b.vel.x - b.angVel * c.rby - a.vel.x + a.angVel * c.ray;
      const rvy = b.vel.y + b.angVel * c.rbx - a.vel.y - a.angVel * c.rax;
      const vn = rvx * nx + rvy * ny;
      c.bias = vn < -this.restThreshold ? -m.e * vn : 0;
      c.Pn = 0; c.Pt = 0;
    }
  }

  _solve(m) {
    const { a, b, nx, ny } = m;
    const tx = -ny, ty = nx;
    for (const c of m.contacts) {
      if (c.kn <= 0) continue;
      // Normal impulse (accumulated, clamped to non-negative).
      let rvx = b.vel.x - b.angVel * c.rby - a.vel.x + a.angVel * c.ray;
      let rvy = b.vel.y + b.angVel * c.rbx - a.vel.y - a.angVel * c.rax;
      const vn = rvx * nx + rvy * ny;
      let lambda = (-vn + c.bias) / c.kn;
      const Pn0 = c.Pn;
      c.Pn = Math.max(Pn0 + lambda, 0);
      lambda = c.Pn - Pn0;
      let px = nx * lambda, py = ny * lambda;
      a.applyImpulse(-px, -py, c.rax, c.ray);
      b.applyImpulse(px, py, c.rbx, c.rby);

      // Friction impulse (accumulated, clamped by Coulomb cone).
      if (c.kt <= 0) continue;
      rvx = b.vel.x - b.angVel * c.rby - a.vel.x + a.angVel * c.ray;
      rvy = b.vel.y + b.angVel * c.rbx - a.vel.y - a.angVel * c.rax;
      const vt = rvx * tx + rvy * ty;
      let lt = -vt / c.kt;
      const maxPt = m.mu * c.Pn;
      const Pt0 = c.Pt;
      c.Pt = Math.max(-maxPt, Math.min(maxPt, Pt0 + lt));
      lt = c.Pt - Pt0;
      px = tx * lt; py = ty * lt;
      a.applyImpulse(-px, -py, c.rax, c.ray);
      b.applyImpulse(px, py, c.rbx, c.rby);
    }
  }

  _correct(m) {
    const { a, b } = m;
    const imSum = a.invMass + b.invMass;
    if (imSum <= 0) return;
    let pen = 0;
    for (const c of m.contacts) if (c.pen > pen) pen = c.pen;
    const corr = Math.max(pen - this.slop, 0) / imSum * this.correction;
    if (corr <= 0) return;
    a.pos.x -= m.nx * corr * a.invMass; a.pos.y -= m.ny * corr * a.invMass;
    b.pos.x += m.nx * corr * b.invMass; b.pos.y += m.ny * corr * b.invMass;
  }
}

// ---------------------------------------------------------------------------
// Narrowphase. Manifold normal always points from a toward b.

function collide(a, b) {
  if (a.shape === 'terrain') return b.shape === 'circle' ? flipAll(circleTerrain(b, a)) : null;
  if (b.shape === 'terrain') return a.shape === 'circle' ? circleTerrain(a, b) : null;
  if (a.shape === 'circle') {
    if (b.shape === 'circle') return circleCircle(a, b);
    if (b.terrainPiece) return null;
    return circlePoly(a, b);
  }
  if (b.shape === 'circle') {
    if (a.terrainPiece) return null;
    const m = circlePoly(b, a);
    if (!m) return null;
    m.a = a; m.b = b; m.nx = -m.nx; m.ny = -m.ny;
    return m;
  }
  return polyPoly(a, b);
}

function flipAll(ms) {
  if (!ms) return null;
  for (const m of ms) { const t = m.a; m.a = m.b; m.b = t; m.nx = -m.nx; m.ny = -m.ny; }
  return ms;
}

const _terrainHits = [];
/** Circle vs terrain: one manifold per touched face/corner, so concave shapes and curves are exact. */
function circleTerrain(a, t) {
  const hits = _terrainHits;
  hits.length = 0;
  circleVsPolygon(a.pos.x, a.pos.y, a.radius, t.terrain, hits);
  if (hits.length === 0) return null;
  const out = [];
  for (const h of hits) out.push(manifold(a, t, -h.nx, -h.ny, [contact(h.x, h.y, h.depth)]));
  return out;
}

function manifold(a, b, nx, ny, contacts) {
  return { a, b, nx, ny, contacts, e: 0, mu: 0 };
}

function contact(x, y, pen) {
  return { x, y, pen, rax: 0, ray: 0, rbx: 0, rby: 0, kn: 0, kt: 0, bias: 0, Pn: 0, Pt: 0 };
}

function circleCircle(a, b) {
  const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
  const r = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  let nx, ny, pen;
  const d = Math.sqrt(d2);
  if (d < 1e-6) { nx = 0; ny = 1; pen = a.radius; }
  else { nx = dx / d; ny = dy / d; pen = r - d; }
  return manifold(a, b, nx, ny, [contact(a.pos.x + nx * a.radius, a.pos.y + ny * a.radius, pen)]);
}

function circlePoly(a, b) {
  const cx = a.pos.x, cy = a.pos.y, r = a.radius;
  const wv = b.worldVerts, wn = b.worldNormals, n = wv.length;
  let sep = -Infinity, fi = 0;
  for (let i = 0; i < n; i++) {
    const s = wn[i].x * (cx - wv[i].x) + wn[i].y * (cy - wv[i].y);
    if (s > r) return null;
    if (s > sep) { sep = s; fi = i; }
  }
  const v1 = wv[fi], v2 = wv[(fi + 1) % n];
  if (sep > 1e-6) {
    const dot1 = (cx - v1.x) * (v2.x - v1.x) + (cy - v1.y) * (v2.y - v1.y);
    const dot2 = (cx - v2.x) * (v1.x - v2.x) + (cy - v2.y) * (v1.y - v2.y);
    const corner = dot1 <= 0 ? v1 : dot2 <= 0 ? v2 : null;
    if (corner) {
      const dx = corner.x - cx, dy = corner.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) return null;
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        return manifold(a, b, dx / d, dy / d, [contact(corner.x, corner.y, r - d)]);
      }
    }
  }
  const nx = -wn[fi].x, ny = -wn[fi].y;
  return manifold(a, b, nx, ny, [contact(cx + nx * r, cy + ny * r, r - sep)]);
}

const _lp = { sep: 0, idx: 0 };
function leastPenetration(A, B, out) {
  let best = -Infinity, bi = 0;
  const wv = A.worldVerts, wn = A.worldNormals, bv = B.worldVerts;
  for (let i = 0; i < wv.length; i++) {
    const n = wn[i];
    let sm = -Infinity, sx = 0, sy = 0;
    for (let k = 0; k < bv.length; k++) {
      const p = bv[k];
      const d = -(p.x * n.x + p.y * n.y);
      if (d > sm) { sm = d; sx = p.x; sy = p.y; }
    }
    const d = (sx - wv[i].x) * n.x + (sy - wv[i].y) * n.y;
    if (d > best) { best = d; bi = i; }
  }
  out.sep = best; out.idx = bi;
}

function clip(nx, ny, c, inPts, outPts) {
  let sp = 0;
  const p0 = inPts[0], p1 = inPts[1];
  const d1 = nx * p0.x + ny * p0.y - c;
  const d2 = nx * p1.x + ny * p1.y - c;
  if (d1 <= 0) outPts[sp++] = p0;
  if (d2 <= 0) outPts[sp++] = p1;
  if (d1 * d2 < 0) {
    const t = d1 / (d1 - d2);
    outPts[sp++] = { x: p0.x + t * (p1.x - p0.x), y: p0.y + t * (p1.y - p0.y) };
  }
  return sp;
}

function polyPoly(a, b) {
  leastPenetration(a, b, _lp);
  const sepA = _lp.sep, ia = _lp.idx;
  if (sepA >= 0) return null;
  leastPenetration(b, a, _lp);
  const sepB = _lp.sep, ib = _lp.idx;
  if (sepB >= 0) return null;

  // Prefer a static body's face as the reference unless the dynamic body's face is clearly
  // less penetrating: this keeps boxes from catching on the seams between convex terrain pieces.
  let useA;
  if (a.isStatic !== b.isStatic) useA = a.isStatic ? sepA >= sepB - 1.5 : !(sepB >= sepA - 1.5);
  else useA = sepA >= sepB * 0.95 + sepA * 0.01;
  let ref, inc, ri, flip;
  if (useA) { ref = a; inc = b; ri = ia; flip = false; }
  else { ref = b; inc = a; ri = ib; flip = true; }

  // Incident face: the face on `inc` most anti-parallel to the reference normal.
  const rn = ref.worldNormals[ri];
  const iwn = inc.worldNormals, iwv = inc.worldVerts;
  let minDot = Infinity, ii = 0;
  for (let i = 0; i < iwn.length; i++) {
    const d = iwn[i].x * rn.x + iwn[i].y * rn.y;
    if (d < minDot) { minDot = d; ii = i; }
  }
  const face = [iwv[ii], iwv[(ii + 1) % iwv.length]];

  const rv = ref.worldVerts;
  const v1 = rv[ri], v2 = rv[(ri + 1) % rv.length];
  let sx = v2.x - v1.x, sy = v2.y - v1.y;
  const len = Math.hypot(sx, sy) || 1;
  sx /= len; sy /= len;
  const refC = rn.x * v1.x + rn.y * v1.y;
  const negSide = -(sx * v1.x + sy * v1.y);
  const posSide = sx * v2.x + sy * v2.y;

  const tmp = [null, null, null], out = [null, null, null];
  if (clip(-sx, -sy, negSide, face, tmp) < 2) return null;
  if (clip(sx, sy, posSide, tmp, out) < 2) return null;

  const contacts = [];
  for (let i = 0; i < 2; i++) {
    const p = out[i];
    const sep = rn.x * p.x + rn.y * p.y - refC;
    if (sep <= 0) contacts.push(contact(p.x, p.y, -sep));
  }
  if (contacts.length === 0) return null;
  return manifold(a, b, flip ? -rn.x : rn.x, flip ? -rn.y : rn.y, contacts);
}
