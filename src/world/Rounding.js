import { Shape } from './Shape.js';
import { pointInPolygon } from '../math/Geometry.js';

/**
 * Finishes level geometry for play: every sharp corner that is an *outer* corner of the
 * merged silhouette gets a fillet. Shapes are judged together, whatever their material, so
 * that layered geometry reads as one piece:
 *
 *  - a corner buried inside another shape, or sitting on another shape's edge (a flush
 *    seam), is not a corner of the silhouette and stays sharp;
 *  - a fillet never runs past the point where another shape meets the edge, so a block
 *    resting on a wider one leaves the wall flat underneath it;
 *  - concave (inside) corners are never touched, and neither are gentle bends, so curves
 *    stay the curves that were drawn.
 *
 * One-way platforms are left as they are: their whole top edge is the landing surface.
 * The result feeds both rendering and physics, so the ball rolls over exactly what is drawn.
 */
export function roundLevelShapes(shapes, { cornerRadius = 12, cornerMinAngle = 8 } = {}) {
  const minTurn = Math.sin((cornerMinAngle * Math.PI) / 180);
  return shapes.map((s) => {
    if (s.oneWay || s.points.length < 3 || cornerRadius <= 0) return s;
    const others = shapes.filter((o) => o !== s && o.points.length >= 3);
    const nodes = roundOutline(s.points, others, cornerRadius, minTurn);
    return new Shape({ type: s.type, nodes, channel: s.channel, move: s.move });
  });
}

const SEAM = 0.75;   // px: a corner this close to another shape's edge counts as touching it

function roundOutline(pts, others, R, minTurn) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const V = pts[i], P = pts[(i + n - 1) % n], N = pts[(i + 1) % n];
    const la = Math.hypot(P.x - V.x, P.y - V.y), lb = Math.hypot(N.x - V.x, N.y - V.y);
    if (la < 1e-6 || lb < 1e-6) { out.push(V); continue; }
    const ux = (P.x - V.x) / la, uy = (P.y - V.y) / la;   // toward the previous vertex
    const vx = (N.x - V.x) / lb, vy = (N.y - V.y) / lb;   // toward the next vertex
    // With signedArea2 > 0 winding, a convex corner is a left turn: cross(V - P, N - V) > 0.
    // That cross is the sine of the turn, so it doubles as the "too gentle a bend" test.
    const turn = uy * vx - ux * vy;
    if (turn <= minTurn) { out.push(V); continue; }
    if (others.some((o) => touches(V, o))) { out.push(V); continue; }

    const alpha = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));   // interior angle
    const t = Math.min(R / Math.tan(alpha / 2), freeAlong(V, P, la, others), freeAlong(V, N, lb, others));
    if (t < 1) { out.push(V); continue; }
    const r = t * Math.tan(alpha / 2);

    let bx = ux + vx, by = uy + vy;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const cx = V.x + (bx * r) / Math.sin(alpha / 2), cy = V.y + (by * r) / Math.sin(alpha / 2);
    const a0 = Math.atan2(V.y + uy * t - cy, V.x + ux * t - cx);
    const a1 = Math.atan2(V.y + vy * t - cy, V.x + vx * t - cx);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 10)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (delta * k) / steps;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }
  return out;
}

/** Whether V lies inside `o` or on its boundary (within SEAM). */
function touches(V, o) {
  if (V.x < o.x - SEAM || V.x > o.right + SEAM || V.y < o.y - SEAM || V.y > o.bottom + SEAM) return false;
  if (pointInPolygon(V.x, V.y, o.points)) return true;
  for (const e of o.edges) {
    const t = Math.max(0, Math.min(1, ((V.x - e.ax) * (e.bx - e.ax) + (V.y - e.ay) * (e.by - e.ay)) / (e.len * e.len)));
    if (Math.hypot(V.x - (e.ax + (e.bx - e.ax) * t), V.y - (e.ay + (e.by - e.ay) * t)) <= SEAM) return true;
  }
  return false;
}

/**
 * How far along the edge from V toward W a fillet may reach: up to the first point where
 * another shape's boundary crosses the edge, or half the edge when nothing does (the other
 * end may be rounding too).
 */
function freeAlong(V, W, L, others) {
  const dx = W.x - V.x, dy = W.y - V.y;
  const minX = Math.min(V.x, W.x), maxX = Math.max(V.x, W.x), minY = Math.min(V.y, W.y), maxY = Math.max(V.y, W.y);
  let d = L;
  for (const o of others) {
    if (maxX < o.x || minX > o.right || maxY < o.y || minY > o.bottom) continue;
    for (const e of o.edges) {
      const sx = e.bx - e.ax, sy = e.by - e.ay;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-9) continue;   // parallel: a shape lying along the edge is caught by its end edges
      const qx = e.ax - V.x, qy = e.ay - V.y;
      const t = (qx * sy - qy * sx) / denom;
      const u = (qx * dy - qy * dx) / denom;
      if (t > 1e-6 && t <= 1 + 1e-9 && u >= -1e-6 && u <= 1 + 1e-6) d = Math.min(d, t * L);
    }
  }
  return d < L - 1e-6 ? d : L / 2;
}
