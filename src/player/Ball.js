import { CircleBody } from '../physics/CircleBody.js';
import { PlatformerMotor, MotorState } from './PlatformerMotor.js';
import { lerp } from '../math/MathUtil.js';

/** The player: a circle body + platformer motor + rolling visuals. */
export class Ball {
  constructor({ x, y, params, render, events }) {
    this.params = params;
    this.renderCfg = render;
    this.events = events;
    this.body = new CircleBody({ x, y, radius: params.radius });
    this.motor = new PlatformerMotor(this.body, params, events);
    this.angle = 0;
    this.prevAngle = 0;
    this.angularVel = 0;
    this.squash = 0;     // 0..1 landing squash amount
    this.squashNx = 0;   // surface normal the squash is aligned to
    this.squashNy = -1;
    this.alive = true;
  }

  get pos() { return this.body.pos; }
  get vel() { return this.body.vel; }

  /** Read the shared Input into a plain command object (swap this for AI/replay/gamepad). */
  static readInput(input) {
    return {
      moveX: input.axis('left', 'right'),
      down: input.isDown('down'),
      jumpPressed: input.justPressed('jump'),
      jumpHeld: input.isDown('jump'),
    };
  }

  update(dt, command, world) {
    const b = this.body, p = this.params;
    this.motor.update(dt, command);
    world.step(b, dt);

    // Rolling: no-slip along the ground tangent, coast in the air.
    this.prevAngle = this.angle;
    if (this.motor.state === MotorState.GROUND && b.contacts.ground) {
      const g = b.contacts.ground;
      let tx = -g.ny, ty = g.nx;
      if (tx < 0) { tx = -tx; ty = -ty; }
      this.angularVel = (b.vel.x * tx + b.vel.y * ty) / b.radius;
    } else {
      this.angularVel *= Math.exp(-p.spinDamping * dt);
    }
    this.angle += this.angularVel * dt;

    if (this.motor.state === MotorState.GROUND && this.motor.prevState !== MotorState.GROUND) {
      this.squash = Math.min(1, this.motor.landedSpeed / p.maxFallSpeed);
      const g = b.contacts.ground;
      if (g) { this.squashNx = g.nx; this.squashNy = g.ny; }
    }
    this.squash *= Math.exp(-12 * dt);
  }

  respawn(x, y) {
    this.body.teleport(x, y);
    this.motor.reset();
    this.angle = this.prevAngle = 0;
    this.angularVel = 0;
    this.squash = 0;
    this.alive = true;
  }

  render(ctx, alpha) {
    const b = this.body, r = b.radius, rc = this.renderCfg;
    const x = lerp(b.prevPos.x, b.pos.x, alpha);
    const y = lerp(b.prevPos.y, b.pos.y, alpha);
    const angle = lerp(this.prevAngle, this.angle, alpha);
    const sq = this.squash * 0.25;

    ctx.save();
    ctx.translate(x, y);
    // squash: flatten along the landing normal, widen along the tangent, keep the contact side put
    const sa = Math.atan2(this.squashNy, this.squashNx) + Math.PI / 2;
    ctx.rotate(sa);
    ctx.translate(0, r * sq);
    ctx.scale(1 + sq, 1 - sq);
    ctx.rotate(-sa);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = rc.ballColor;
    ctx.fill();
    ctx.lineWidth = rc.outlineWidth;
    ctx.strokeStyle = rc.outlineColor;
    ctx.stroke();

    ctx.rotate(angle);
    ctx.strokeStyle = rc.ballMark;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.6, 0); ctx.stroke();
    ctx.restore();
  }
}
