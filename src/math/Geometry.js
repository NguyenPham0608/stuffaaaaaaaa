/**
 * Polygon helpers. All polygons are arrays of {x, y}. Winding convention (screen
 * coordinates, y down): twice the signed area `signedArea2` is positive, and the outward
 * normal of edge a->b is (ey, -ex) / len.
 */

export function signedArea2(pts) {
  let a2 = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a2 += p.x * q.y - q.x * p.y;
  }
  return a2;
}

/** Reverse `pts` in place if needed so signedArea2 > 0. */
export function ensureWinding(pts) {
  if (signedArea2(pts) < 0) pts.reverse();
  return pts;
}

export function polygonBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i], pj = pts[j];
    if ((pi.y > y) !== (pj.y > y) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}

/** Point on the quadratic Bezier p0 -> c -> p1 at parameter t. */
export function quadPoint(p0, c, p1, t, out = { x: 0, y: 0 }) {
  const mt = 1 - t;
  out.x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x;
  out.y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y;
  return out;
}

/**
 * Turn an editable closed path into a polygon. Nodes are {x, y, cx, cy}; when cx/cy are
 * set they are the quadratic control point of the segment from that node to the next.
 * Curved segments are subdivided so the polygon stays within ~`tolerance` px of the curve.
 */
export function flattenPath(nodes, tolerance = 1.5) {
  const out = [];
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    if (a.cx == null || a.cy == null) continue;
    const c = { x: a.cx, y: a.cy };
    // Deviation of the control point from the chord drives the subdivision count.
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dev = Math.hypot(c.x - mx, c.y - my);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const segs = Math.max(4, Math.min(64, Math.ceil(Math.sqrt(dev / tolerance) * 2 + chord / 48)));
    for (let k = 1; k < segs; k++) out.push(quadPoint(a, c, b, k / segs, { x: 0, y: 0 }));
  }
  return out;
}

/** Drop repeated points and points lying on the line between their neighbours. */
export function simplifyPolygon(pts, eps = 0.05) {
  let out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < eps && Math.abs(last.y - p.y) < eps) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) < eps && Math.abs(out[0].y - out[out.length - 1].y) < eps) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      if (Math.abs(cross) / len < eps) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

export function isConvex(pts) {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-7) return false;
  }
  return true;
}

function cross3(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

function pointInTri(p, a, b, c) {
  return cross3(a, b, p) >= -1e-9 && cross3(b, c, p) >= -1e-9 && cross3(c, a, p) >= -1e-9;
}

/** Ear-clipping triangulation. Returns index triples in the input winding (signedArea2 > 0). */
export function triangulate(pts) {
  const n = pts.length;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cross3(a, b, c) <= 1e-9) continue; // reflex or degenerate
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(pts[j], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { // self-intersecting or degenerate input: clip anything so we terminate
      tris.push([idx[0], idx[1], idx[2]]);
      idx.splice(1, 1);
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/**
 * Split a (possibly concave) polygon into convex pieces: triangulate, then greedily merge
 * neighbours whose union stays convex (Hertel-Mehlhorn). Returns arrays of {x, y}.
 */
export function decomposeConvex(pts) {
  if (pts.length < 3) return [];
  if (isConvex(pts)) return [pts.map((p) => ({ x: p.x, y: p.y }))];
  const polys = triangulate(pts);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const r = tryMerge(polys[i], polys[j], pts);
        if (r) { polys[i] = r; polys.splice(j, 1); merged = true; break outer; }
      }
    }
  }
  return polys.map((poly) => poly.map((i) => ({ x: pts[i].x, y: pts[i].y })));
}

function tryMerge(A, B, pts) {
  const na = A.length, nb = B.length;
  for (let k = 0; k < na; k++) {
    const u = A[k], v = A[(k + 1) % na];
    for (let m = 0; m < nb; m++) {
      if (B[m] !== v || B[(m + 1) % nb] !== u) continue;
      const result = [];
      for (let t = 0; t < na; t++) result.push(A[(k + 1 + t) % na]);          // v ... u
      for (let t = 2; t < nb; t++) result.push(B[(m + t) % nb]);              // after u ... before v
      if (isConvex(result.map((i) => pts[i]))) return result;
      return null;
    }
  }
  return null;
}
