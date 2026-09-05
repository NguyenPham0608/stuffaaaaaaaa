import { aabbOverlap } from '../physics/Collision.js';

/** Draws the level: flat shapes on a flat background. */
export class Renderer {
  constructor(cfg) {
    this.cfg = cfg;
  }

  clear(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.cfg.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  drawGrid(ctx, rect, spacing = this.cfg.gridSpacing, major = 4) {
    const s = spacing;
    if (s * ctx.getTransform().a < 5) return;
    ctx.lineWidth = 1;
    const x0 = Math.floor(rect.x / s) * s, y0 = Math.floor(rect.y / s) * s;
    ctx.strokeStyle = this.cfg.gridColor;
    ctx.beginPath();
    for (let x = x0; x <= rect.x + rect.w; x += s) { if (Math.round(x / s) % major === 0) continue; ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); }
    for (let y = y0; y <= rect.y + rect.h; y += s) { if (Math.round(y / s) % major === 0) continue; ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); }
    ctx.stroke();
    ctx.strokeStyle = this.cfg.gridMajorColor;
    ctx.beginPath();
    for (let x = x0; x <= rect.x + rect.w; x += s) { if (Math.round(x / s) % major !== 0) continue; ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); }
    for (let y = y0; y <= rect.y + rect.h; y += s) { if (Math.round(y / s) % major !== 0) continue; ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); }
    ctx.stroke();
  }

  /** Mark the level bounds with a dashed border; inside and outside share one background. */
  drawBounds(ctx, level) {
    ctx.strokeStyle = this.cfg.outlineColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 7]);
    ctx.strokeRect(0, 0, level.width, level.height);
    ctx.setLineDash([]);
  }

  /** Trace a shape's editable path (curves included) onto the context. */
  static tracePath(ctx, shape) {
    const nodes = shape.nodes, n = nodes.length;
    if (n === 0) return;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 0; i < n; i++) {
      const a = nodes[i], b = nodes[(i + 1) % n];
      if (a.cx != null) ctx.quadraticCurveTo(a.cx, a.cy, b.x, b.y);
      else ctx.lineTo(b.x, b.y);
    }
    ctx.closePath();
  }

  drawShapes(ctx, shapes, rect) {
    for (const s of shapes) {
      if (s.points.length < 3 || !aabbOverlap(s, rect)) continue;
      if (s.draw) { s.draw(ctx, s); continue; }
      Renderer.tracePath(ctx, s);
      if (s.oneWay) {
        // Ghosted body plus a solid lip on the side you can land on.
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        this._strokeTopEdges(ctx, s, s.color, 4);
      } else {
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }
  }

  /** Pressure plates: a plate standing on the ground that squashes flat when pressed. */
  drawSwitches(ctx, switches, rect) {
    const base = 3;
    for (const s of switches) {
      const r = s.rect;
      if (!aabbOverlap(r, rect)) continue;
      const h = base + (s.h - base) * (1 - s.press);   // compresses onto its base, never past it

      // socket lip, flush with the ground line
      ctx.fillStyle = this.cfg.outlineColor;
      ctx.beginPath();
      ctx.roundRect(r.x - 3, s.y - base, r.w + 6, base, 1.5);
      ctx.fill();

      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.roundRect(r.x, s.y - h, r.w, h, Math.min(3, h / 2));
      ctx.fill();
      ctx.lineWidth = this.cfg.outlineWidth;
      ctx.strokeStyle = this.cfg.outlineColor;
      ctx.stroke();

      // one-time plates carry an inset line so you can tell them apart before pressing
      if (s.latch && h > 6) {
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(r.x + 5, s.y - h + 3, r.w - 10, h - 6, 1);
        ctx.stroke();
      }
    }
  }

  /**
   * Clear tubes. `drawInside` is invoked between the tube's glass and its rim so whatever is
   * being transported is drawn within the tube walls.
   */
  drawTubes(ctx, tubes, rect, drawInside) {
    for (const t of tubes) {
      if (!t.usable || !aabbOverlap(t, rect)) continue;
      const path = new Path2D();
      path.moveTo(t.points[0].x, t.points[0].y);
      for (let i = 1; i < t.points.length; i++) path.lineTo(t.points[i].x, t.points[i].y);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';

      // solid walls, then a clear bore punched back through them
      ctx.strokeStyle = this.cfg.tubeWall;
      ctx.lineWidth = (t.radius + t.wall) * 2;
      ctx.stroke(path);
      ctx.strokeStyle = this.cfg.background;
      ctx.lineWidth = t.radius * 2;
      ctx.stroke(path);
      ctx.strokeStyle = this.cfg.tubeGlass;
      ctx.stroke(path);

      drawInside?.(t);
    }
  }

  /** Stroke the flattened edges whose outward normal points up. */
  _strokeTopEdges(ctx, s, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const e of s.edges) {
      if (e.ny > -0.35) continue;
      ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by);
    }
    ctx.stroke();
  }
}
