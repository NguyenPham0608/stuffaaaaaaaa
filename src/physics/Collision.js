import { pointInPolygon } from '../math/Geometry.js';

export function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function unclampedT(e, cx, cy) {
  const abx = e.bx - e.ax, aby = e.by - e.ay;
  const len2 = abx * abx + aby * aby;
  return len2 > 0 ? ((cx - e.ax) * abx + (cy - e.ay) * aby) / len2 : 0;
}

/**
 * Circle vs a closed polygon ({points, edges, x, y, w, h} - see world/Shape.js).
 * Appends contacts {x, y, nx, ny, depth, vertex, shape} to `out`: (x, y) is the closest
 * point on the boundary, the normal points from the surface toward the circle centre,
 * depth > 0 means overlap (touching counts, depth 0). Concave polygons yield one contact
 * per touched face; a convex corner yields a single contact with the corner's normal.
 * If the centre is inside the polygon the normal still points outward (depth = r + dist).
 * Returns the number of contacts added.
 */
export function circleVsPolygon(cx, cy, r, poly, out) {
  if (cx + r < poly.x || cx - r > poly.x + poly.w || cy + r < poly.y || cy - r > poly.y + poly.h) return 0;
  const start = out.length;
  const edges = poly.edges, n = edges.length;
  const r2 = r * r;
  let inside = -1;

  for (let i = 0; i < n; i++) {
    const e = edges[i];
    if (cx + r < e.x || cx - r > e.x + e.w || cy + r < e.y || cy - r > e.y + e.h) continue;
    let t = unclampedT(e, cx, cy);
    const vertex = t <= 0 || t >= 1;
    if (vertex) {
      // A corner is the true closest feature only if the neighbouring edge agrees; otherwise
      // that edge's own face contact covers it and this one would just add a spurious normal.
      if (t <= 0 && unclampedT(edges[(i + n - 1) % n], cx, cy) < 1) continue;
      if (t >= 1 && unclampedT(edges[(i + 1) % n], cx, cy) > 0) continue;
      t = t <= 0 ? 0 : 1;
    }
    const qx = e.ax + (e.bx - e.ax) * t, qy = e.ay + (e.by - e.ay) * t;
    const dx = cx - qx, dy = cy - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    let dup = false;
    for (let k = start; k < out.length; k++) {
      const o = out[k];
      if (Math.abs(o.x - qx) < 1e-6 && Math.abs(o.y - qy) < 1e-6) { dup = true; break; }
    }
    if (dup) continue;

    if (inside < 0) inside = pointInPolygon(cx, cy, poly.points) ? 1 : 0;
    const d = Math.sqrt(d2);
    let nx, ny, depth;
    if (d < 1e-6) { nx = e.nx; ny = e.ny; depth = r; }
    else if (inside) { nx = -dx / d; ny = -dy / d; depth = r + d; }
    else { nx = dx / d; ny = dy / d; depth = r - d; }
    out.push({ x: qx, y: qy, nx, ny, depth, vertex, shape: poly });
  }
  return out.length - start;
}
