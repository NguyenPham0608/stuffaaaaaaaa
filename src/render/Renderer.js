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
