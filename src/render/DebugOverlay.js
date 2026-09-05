/** On-screen physics/motor diagnostics. Toggle with the `debug` input action. */
export class DebugOverlay {
  constructor() { this.enabled = false; }

  drawWorld(ctx, ball) {
    if (!this.enabled) return;
    const b = ball.body;
    ctx.lineWidth = 2;
    for (const c of b.senseContacts) {
      ctx.strokeStyle = '#ff5c5c';
      ctx.beginPath();
      ctx.moveTo(b.pos.x - c.nx * b.radius, b.pos.y - c.ny * b.radius);
      ctx.lineTo(b.pos.x - c.nx * b.radius + c.nx * 20, b.pos.y - c.ny * b.radius + c.ny * 20);
      ctx.stroke();
    }
    ctx.strokeStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(b.pos.x, b.pos.y);
    ctx.lineTo(b.pos.x + b.vel.x * 0.1, b.pos.y + b.vel.y * 0.1);
    ctx.stroke();
  }

  drawHud(ctx, view, { engine, ball, scene }) {
    if (!this.enabled) return;
    const b = ball.body, m = ball.motor, c = b.contacts;
    const lines = [
      `fps ${engine.fps}  step ${(engine.fixedDt * 1000).toFixed(2)}ms  t ${engine.time.toFixed(2)}`,
      `state ${m.state}  facing ${m.facing}  moveX ${m.moveX}`,
      `pos ${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)}`,
      `vel ${b.vel.x.toFixed(1)}, ${b.vel.y.toFixed(1)}`,
      `ground ${c.ground ? c.ground.wall.type : '-'}  ceil ${c.ceiling ? 'y' : '-'}  L ${c.left ? 'y' : '-'}  R ${c.right ? 'y' : '-'}`,
      `coyote ${m.coyote.toFixed(2)}  buffer ${m.jumpBuffer.toFixed(2)}  air ${m.airTime.toFixed(2)}`,
      `jumping ${m.jumping}  cut ${m.jumpCut}  drop ${b.dropThrough.toFixed(2)}  deaths ${scene.deaths}`,
    ];
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 470, 14 * lines.length + 10, 6);
    ctx.fill();
    ctx.fillStyle = '#e5e9f0';
    lines.forEach((l, i) => ctx.fillText(l, 14, 24 + i * 14));
  }
}
