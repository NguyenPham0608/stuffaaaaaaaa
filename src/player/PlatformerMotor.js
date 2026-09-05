import { approach, sign } from '../math/MathUtil.js';

export const MotorState = Object.freeze({ GROUND: 'ground', AIR: 'air' });

/**
 * Turns input + contact state into velocity changes on a CircleBody.
 * Knows nothing about rendering or collision resolution; PhysicsWorld.step runs after this.
 */
export class PlatformerMotor {
  constructor(body, params, events = null) {
    this.body = body;
    this.p = params;
    this.events = events;

    this.state = MotorState.AIR;
    this.prevState = MotorState.AIR;
    this.facing = 1;
    this.moveX = 0;

    // Timers (seconds, count down)
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airTime = 0;
    this.jumpTime = 0;      // time since last jump started
    this.jumping = false;   // rising from a jump (cut still possible)
    this.jumpCut = false;
    this.lastJumpKind = null;
    this.landedSpeed = 0;   // impact speed of the last landing (for effects)
  }

  /** @param {number} dt  @param {{moveX:number, down:boolean, jumpPressed:boolean, jumpHeld:boolean}} input */
  update(dt, input) {
    const p = this.p, b = this.body, v = b.vel, c = b.contacts;
    const moveX = this.moveX = sign(input.moveX);
    if (moveX !== 0) this.facing = moveX;

    // A contact can linger for a step after something launched the body off it (a bounce pad,
    // or an object shoving it). Such a contact must not count as ground at all: following it
    // would cancel the launch, and granting coyote time would let a jump replace it with a
    // slower one. Once the body is clearly moving away along the normal, it is airborne.
    const leaving = c.ground && (v.x * c.ground.nx + v.y * c.ground.ny) > p.leaveGroundSpeed;
    const grounded = !!c.ground && !leaving;

    // ---- Timers
    if (grounded) this.coyote = p.coyoteTime; else this.coyote -= dt;
    this.jumpBuffer = input.jumpPressed ? p.jumpBufferTime : this.jumpBuffer - dt;
    this.jumpTime += dt;
    // Holding jump charges the next bounce; PhysicsWorld applies it when a pad launches.
    b.bounceBoost = input.jumpHeld ? p.bounceHoldMult : 1;
    if (grounded) { if (v.y >= 0) this.jumping = false; } else this.airTime += dt;

    // ---- State
    this.prevState = this.state;
    this.state = grounded ? MotorState.GROUND : MotorState.AIR;
    if (this.state === MotorState.GROUND && this.prevState !== MotorState.GROUND) {
      this.landedSpeed = Math.max(0, b.prevPos.y < b.pos.y ? (b.pos.y - b.prevPos.y) / dt : 0);
      this.airTime = 0;
      this.events?.emit('player:land', { motor: this, speed: this.landedSpeed });
    }

    // ---- Horizontal (shoving an object caps the speed you can push it at)
    let target = moveX * p.moveSpeed;
    if (b.push && b.push.dir === moveX) target *= b.push.factor;
    const control = 1;
    const groundFriction = b.groundWall?.friction ?? 1;
    const onGround = grounded && !this.jumping;
    // On the ground, speed is controlled along the surface tangent so slopes don't change it.
    const along = onGround ? this._tangentSpeed(c.ground) : v.x;
    const reversing = moveX !== 0 && along !== 0 && sign(along) !== moveX;
    let accel;
    if (this.state === MotorState.GROUND) {
      accel = (moveX !== 0 ? p.groundAccel : p.groundDecel) * groundFriction;
    } else {
      accel = moveX !== 0 ? p.airAccel : p.airDecel;
    }
    if (reversing) accel *= p.turnBoost;
    const newAlong = approach(along, target, accel * control * dt);
    if (!onGround) v.x = newAlong;

    // ---- Vertical
    if (onGround) {
      this._followGround(dt, c.ground, groundFriction, newAlong);
    } else {
      let g = p.gravity;
      if (this.state === MotorState.AIR) {
        if (v.y > 0) g *= p.fallGravityMult;
        else if (Math.abs(v.y) < p.apexThreshold) g *= p.apexGravityMult;
      }
      v.y = Math.min(v.y + g * dt, p.maxFallSpeed);
    }

    // Jump cut (variable height)
    if (this.jumping && !this.jumpCut && !input.jumpHeld && v.y < 0 && this.jumpTime >= p.jumpMinTime) {
      v.y *= p.jumpCutMult;
      this.jumpCut = true;
    }

    // ---- Jumps
    if (this.jumpBuffer > 0) {
      const groundWall = b.groundWall;
      if (grounded && input.down && groundWall?.oneWay) {
        b.dropThrough = p.dropThroughTime;
        this.jumpBuffer = 0;
      } else if (grounded || this.coyote > 0) {
        this._jump(-p.jumpSpeed, v.x, 'ground');
      }
    }

    // ---- Full rest: kill the tiny residual velocities so a resting ball never creeps.
    // Slippery slopes are exempt so the ball slides off ice, and so are bouncy surfaces -
    // zeroing there would swallow the tiny push the pad needs to launch the ball again.
    if (grounded && moveX === 0 && !this.jumping && !c.ground.wall?.bounce
        && v.lenSq() < p.stickSpeed * p.stickSpeed) {
      const flat = c.ground ? -c.ground.ny > p.stickMaxSlope : true;
      if (groundFriction >= 0.5 || flat) v.set(0, 0);
    }
  }

  /** Ground tangent oriented so +t points rightward (x increasing). */
  _tangent(ground) {
    let tx = -ground.ny, ty = ground.nx;
    if (tx < 0) { tx = -tx; ty = -ty; }
    return { tx, ty };
  }

  _tangentSpeed(ground) {
    const { tx, ty } = this._tangent(ground);
    const v = this.body.vel;
    return v.x * tx + v.y * ty;
  }

  /**
   * On the ground the ball follows the surface: `vt` is the speed along the ground
   * tangent (so slopes and curves neither stair-step nor change speed); the body is pushed
   * lightly into the surface to keep contact and pulled downhill on slippery materials.
   */
  _followGround(dt, ground, friction, vt) {
    const p = this.p, v = this.body.vel;
    const { tx, ty } = this._tangent(ground);
    vt += p.gravity * ty * (1 - Math.min(1, friction)) * p.slideFactor * dt;
    const push = p.gravity * dt;
    v.x = tx * vt - ground.nx * push;
    v.y = ty * vt - ground.ny * push;
  }

  _jump(vy, vx, kind) {
    const v = this.body.vel;
    v.y = vy; v.x = vx;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.jumping = true;
    this.jumpCut = false;
    this.jumpTime = 0;
    this.lastJumpKind = kind;
    this.state = MotorState.AIR;
    this.events?.emit('player:jump', { motor: this, kind });
  }

  reset() {
    this.state = this.prevState = MotorState.AIR;
    this.coyote = this.jumpBuffer = 0;
    this.airTime = this.jumpTime = 0;
    this.jumping = this.jumpCut = false;
    this.moveX = 0;
  }
}
