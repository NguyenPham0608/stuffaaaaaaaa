import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { RigidWorld } from '../physics/RigidWorld.js';
import { RigidBody } from '../physics/RigidBody.js';
import { Ball } from '../player/Ball.js';
import { Camera } from '../render/Camera.js';
import { Renderer } from '../render/Renderer.js';
import { DebugOverlay } from '../render/DebugOverlay.js';
import { EventBus } from '../core/EventBus.js';
import { createEntityBody, createStaticBodies, drawBody } from '../world/Entities.js';
import { Shape } from '../world/Shape.js';
import { aabbOverlap } from '../physics/Collision.js';
import { damp } from '../math/MathUtil.js';

/**
 * Wires level + physics + player + camera together.
 *
 * Two physics systems cooperate: PhysicsWorld moves the player against the level's
 * shapes (the platformer feel), and RigidWorld simulates crates/balls. The player is
 * mirrored into the rigid world as a proxy body each step so it can push objects,
 * get pushed, and stand on them; contacts with objects are fed back to the motor
 * as ground/wall contacts.
 *
 * On top of that sit the level's logic elements: switches power shapes that share their
 * channel (doors slide along their `move`), tubes swallow whatever enters a mouth and
 * carry it visibly to the far end, and holding grab sticks an object to the player's front.
 */
export class GameScene {
  constructor({ input, level, config }) {
    this.input = input;
    this.config = config;
    this.events = new EventBus();
    this.world = new PhysicsWorld(config.physics);
    this.rigid = new RigidWorld({ gravity: config.rigid.gravity, iterations: config.rigid.iterations });
    this.renderer = new Renderer(config.render);
    this.camera = new Camera(config.camera);
    this.debug = new DebugOverlay();
    this.debug.enabled = !!config.debug.enabled;
    this.ball = new Ball({ x: 0, y: 0, params: config.player, render: config.render, events: this.events });
    this.proxy = new RigidBody({
      shape: 'circle', radius: config.player.radius, mass: config.rigid.playerMass,
      friction: config.rigid.playerFriction, restitution: config.rigid.playerRestitution, proxy: true, kind: 'player',
    });
    this.objects = [];
    this.doors = [];
    this.riders = [];        // {kind, body|null, tube, dir, dist} - things travelling inside a tube
    this.carried = null;     // the rigid body stuck to the player's front, if any
    this.carrySide = 1;      // which side of the player it is held on
    this.tubeCooldown = 0;   // blocks the player being re-swallowed right after an exit
    this.checkpoint = null;  // the flag the player respawns at, once one has been touched
    this.powered = new Set();
    this.deaths = 0;
    this.engine = null;
    this.loadLevel(level);
  }

  enter(engine) {
    this.engine = engine;
    this.camera.setView(engine.view.width, engine.view.height);
    this.camera.snapTo(this.ball.pos.x, this.ball.pos.y);
  }

  loadLevel(level) {
    this.level = level;
    this.world.clear();
    for (const s of level.shapes) this.world.addShape(s);
    this.doors = level.shapes.filter((s) => s.isDoor);
    for (const d of this.doors) this.world.updateShape(d, () => d.setOffset(0));
    // Pipe walls are solid geometry the level does not draw (drawTubes shows them instead).
    this.tubeWalls = [];
    for (const t of level.tubes) {
      for (const quad of t.wallQuads()) {
        const s = new Shape({ type: 'solid', nodes: quad });
        if (s.points.length < 3) continue;
        this.tubeWalls.push(s);
        this.world.addShape(s);
      }
    }
    // Static colliders are built once, with every door at rest so the two line up.
    this.staticBodies = createStaticBodies([...level.shapes, ...this.tubeWalls]);
    this.doorBodies = new Map(this.doors.map((d) => [d, this.staticBodies.filter((b) => b.source === d)]));
    this.camera.bounds = { x: 0, y: 0, w: level.width, h: level.height };
    // Checkpoints outlive a death, so they are only cleared when a level is loaded.
    this.checkpoint = null;
    for (const c of level.checkpoints) c.reset();
    this.respawn();
    this.events.emit('level:loaded', { level });
  }

  /** Rebuild every dynamic object and reset the level's logic to its resting state. */
  resetObjects() {
    const r = this.rigid;
    r.clear();
    this.riders.length = 0;
    this.carried = null;
    this.tubeCooldown = 0;
    this.powered.clear();
    for (const s of this.level.switches) s.reset();
    for (const d of this.doors) this._setDoor(d, 0);
    for (const b of this.staticBodies) r.add(b);
    this.objects = this.level.entities.map((e) => r.add(createEntityBody(e, this.config.tileSize)));
    for (const o of this.objects) { o.travelling = false; o.carried = false; }
    r.add(this.proxy);
  }

  /** Place a door `t` (0..1) along its travel, dragging its colliders with it. */
  _setDoor(d, t) {
    const before = { x: d.x, y: d.y };
    if (!this.world.updateShape(d, () => d.setOffset(t))) return;
    const dx = d.x - before.x, dy = d.y - before.y;
    for (const body of this.doorBodies.get(d) ?? []) {
      if (body.shape === 'terrain') continue;   // reads its shape directly, so it already moved
      body.pos.x += dx; body.pos.y += dy;
      body.prevPos.copy(body.pos);
      body.updateTransform();
    }
  }

  /** Where the player comes back: the last checkpoint touched, else the level's spawn. */
  get respawnPoint() {
    return this.checkpoint ? this.checkpoint.spawnPoint(this.config.player.radius) : this.level.spawn;
  }

  respawn() {
    const at = this.respawnPoint;
    this.ball.respawn(at.x, at.y);
    this.resetObjects();
    this._syncProxy();
    this.camera.snapTo(this.ball.pos.x, this.ball.pos.y);
    this.events.emit('player:respawn', { ball: this.ball });
  }

  kill(reason) {
    this.deaths++;
    this.events.emit('player:died', { ball: this.ball, reason });
    this.respawn();
  }

  update(dt) {
    const input = this.input;
    input.poll();
    if (input.justPressed('debug')) this.debug.enabled = !this.debug.enabled;
    if (input.justPressed('reset')) { this.respawn(); return; }

    this._updateSwitches(dt);
    this._updateDoors(dt);
    this._updateCheckpoints(dt);

    const riding = this.riders.some((r) => r.kind === 'player');
    if (!riding) this.ball.update(dt, Ball.readInput(input), this.world);
    this._stepObjects(dt);
    // Placed once the player's position for this step is final, so it never lags behind.
    this._updateCarry(input.isDown('grab'));
    this._updateTubes(dt);

    const b = this.ball.body;
    if (!riding) {
      if (b.hazard) { this.kill('hazard'); return; }
      if (b.pos.y - b.radius > this.level.height + 100) { this.kill('fell'); return; }
    }

    this.camera.follow(b.pos, b.vel, dt);
  }

  // ---- Switches and powered doors ----

  /** A body's kind for switch filtering, plus the box it occupies. */
  _pressers() {
    const out = [];
    const b = this.ball.body;
    out.push({ kind: 'player', box: { x: b.pos.x - b.radius, y: b.pos.y - b.radius, w: b.radius * 2, h: b.radius * 2 } });
    for (const o of this.objects) {
      if (o.travelling) continue;
      out.push({ kind: o.kind, box: o.aabb });
    }
    return out;
  }

  _updateSwitches(dt) {
    const lg = this.config.logic;
    const pressers = this._pressers();
    this.powered.clear();
    for (const s of this.level.switches) {
      const zone = s.trigger(lg.switchReach);
      const pressed = pressers.some((p) => s.takes(p.kind) && aabbOverlap(zone, p.box));
      if (pressed && s.latch) s.latched = true;
      s.active = pressed || s.latched;
      if (s.active) this.powered.add(s.channel);
      s.press = damp(s.press, s.active ? 1 : 0, lg.switchSpring, dt);
    }
  }

  _updateDoors(dt) {
    const step = dt / Math.max(0.01, this.config.logic.doorDuration);
    for (const d of this.doors) {
      const target = this.powered.has(d.channel) ? 1 : 0;
      if (d.offset === target) continue;
      const next = target > d.offset ? Math.min(target, d.offset + step) : Math.max(target, d.offset - step);
      this._setDoor(d, next);
    }
  }

  _updateCheckpoints(dt) {
    const b = this.ball.body;
    const box = { x: b.pos.x - b.radius, y: b.pos.y - b.radius, w: b.radius * 2, h: b.radius * 2 };
    for (const c of this.level.checkpoints) {
      // Touching any flag makes it the current one, so walking back to an earlier one re-arms it.
      if (c !== this.checkpoint && aabbOverlap(c.rect, box)) {
        const first = !c.reached;
        c.reached = true;
        this.checkpoint = c;
        if (first) this.events.emit('player:checkpoint', { checkpoint: c });
      }
      c.raise = damp(c.raise, c.reached ? 1 : 0, this.config.logic.checkpointSpring, dt);
    }
  }

  // ---- Carrying ----

  /** Carried bodies are driven by the player, so the solver must not move them. */
  _hold(o, on) {
    if (on === o.carried) return;
    o.carried = on;
    if (on) {
      o.heldInvMass = o.invMass; o.heldInvI = o.invI;
      o.invMass = 0; o.invI = 0;
    } else {
      o.invMass = o.heldInvMass ?? o.invMass;
      o.invI = o.heldInvI ?? o.invI;
    }
  }

  _drop(throwIt) {
    if (!this.carried) return;
    const o = this.carried;
    this._hold(o, false);
    if (throwIt) o.vel.x += this.ball.body.vel.x * this.config.logic.carryThrow;
    this.carried = null;
  }

  _updateCarry(held) {
    const lg = this.config.logic;
    const b = this.ball.body;
    if (!held) { this._drop(true); return; }
    if (this.carried && (this.carried.travelling || !this.objects.includes(this.carried))) this._drop(false);
    if (!this.carried) {
      // Grab the nearest object within reach, preferring whatever is ahead of the player.
      const reach = b.radius + lg.carryRange;
      let best = null, bestScore = Infinity;
      for (const o of this.objects) {
        if (o.travelling) continue;
        const dx = o.pos.x - b.pos.x, dy = o.pos.y - b.pos.y;
        const gap = Math.hypot(dx, dy) - o.radius - reach;
        if (gap > 0) continue;
        const ahead = Math.sign(dx) === this.ball.motor.facing ? 0 : 40;
        const score = gap + ahead + Math.abs(dy) * 0.5;
        if (score < bestScore) { bestScore = score; best = o; }
      }
      if (!best) return;
      this.carried = best;
      this.carrySide = Math.sign(best.pos.x - b.pos.x) || this.ball.motor.facing || 1;
      this._hold(best, true);
      this.events.emit('player:grab', { body: best });
    }
    // Locked to the player's side: the position is written outright every step, so it never
    // lags, swings or drifts. It still shoves other objects, and carries the player's velocity
    // so releasing it throws it.
    const o = this.carried;
    this.carrySide = this.ball.motor.facing || this.carrySide;
    const tx = b.pos.x + this.carrySide * (b.radius + o.radius + lg.carryGap);
    o.prevPos.copy(o.pos);
    o.pos.set(tx, b.pos.y);
    o.vel.set(b.vel.x, b.vel.y);
    o.angVel = 0;
    o.angle *= lg.carryUpright;   // settle upright while held
    o.updateTransform();
  }

  // ---- Tubes ----

  _updateTubes(dt) {
    const lg = this.config.logic;
    this.tubeCooldown = Math.max(0, this.tubeCooldown - dt);
    for (const o of this.objects) if (o.tubeCooldown > 0) o.tubeCooldown = Math.max(0, o.tubeCooldown - dt);

    for (const t of this.level.tubes) {
      if (!t.usable) continue;
      this._maybeEnter(t, lg);
    }
    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i];
      r.dist += lg.tubeSpeed * dt * r.dir;
      const done = r.dir > 0 ? r.dist >= r.tube.length : r.dist <= 0;
      const at = r.tube.pointAt(r.dist);
      // Leaving: step clear of the mouth along the exit direction, so the body is not still
      // sitting in the opening where anything could nudge it straight back in.
      const clear = done ? lg.tubeExitClear * r.dir : 0;
      const x = at.x + at.tx * clear, y = at.y + at.ty * clear;
      if (r.kind === 'player') {
        this.ball.body.teleport(x, y);
      } else {
        r.body.pos.set(x, y);
        r.body.prevPos.set(x, y);
        r.body.vel.set(0, 0);
        r.body.updateTransform();
      }
      if (!done) continue;
      const vx = at.tx * lg.tubeExitSpeed * r.dir, vy = at.ty * lg.tubeExitSpeed * r.dir;
      if (r.kind === 'player') {
        this.ball.body.vel.set(vx, vy);
        this.ball.motor.reset();
        this.tubeCooldown = lg.tubeCooldown;
      } else {
        r.body.travelling = false;
        r.body.vel.set(vx, vy);
        r.body.tubeCooldown = lg.tubeCooldown;
        this.rigid.add(r.body);
      }
      this.riders.splice(i, 1);
      this.events.emit('tube:exit', { tube: r.tube });
    }
  }

  _maybeEnter(t, lg) {
    const enter = (kind, body, pos, vel) => {
      const end = t.mouthAt(pos, 0);
      if (end < 0) return false;
      const at = t.pointAt(end === 0 ? 0 : t.length);
      const inward = end === 0 ? 1 : -1;
      if ((vel.x * at.tx + vel.y * at.ty) * inward < lg.tubeEnterSpeed) return false;
      this.riders.push({ kind, body, tube: t, dir: inward, dist: end === 0 ? 0 : t.length });
      this.events.emit('tube:enter', { tube: t, kind });
      return true;
    };

    const b = this.ball.body;
    if (this.tubeCooldown <= 0 && !this.riders.some((r) => r.kind === 'player')) enter('player', null, b.pos, b.vel);

    for (const o of this.objects) {
      if (o.travelling || o.tubeCooldown > 0) continue;
      if (enter('object', o, o.pos, o.vel)) {
        if (this.carried === o) this._drop(false);
        o.travelling = true;
        this.rigid.remove(o);
      }
    }
  }

  // ---- Objects ----

  _syncProxy() {
    const b = this.ball.body, p = this.proxy;
    p.pos.copy(b.pos); p.prevPos.copy(b.pos);
    p.vel.copy(b.vel);
    p.angVel = 0;
  }

  _stepObjects(dt) {
    const b = this.ball.body, p = this.proxy, cfg = this.config.physics;
    this._syncProxy();
    this.rigid.step(dt);
    if (!this.riders.some((r) => r.kind === 'player')) {
      b.pos.copy(p.pos);
      b.vel.copy(p.vel);
    }

    // Objects the player is touching become contacts the motor understands.
    const c = b.contacts;
    const rc = this.config.rigid;
    b.push = null;
    for (const k of p.contacts) {
      if (k.other === this.carried) continue;   // what you are holding must not shove you
      const nx = -k.nx, ny = -k.ny; // pointing from the object toward the player, like surface contacts
      const contact = { wall: objectSurface(k.other), nx, ny, depth: 0 };
      if (ny <= cfg.groundNormalY) { if (!c.ground) c.ground = contact; }
      else if (ny >= cfg.ceilingNormalY) { if (!c.ceiling) c.ceiling = contact; }
      else if (nx >= cfg.wallNormalX) { if (!c.left) c.left = contact; }
      else if (nx <= -cfg.wallNormalX) { if (!c.right) c.right = contact; }

      // Shoving something sideways: heavier objects slow you down more.
      if (Math.abs(nx) >= cfg.wallNormalX && !k.other.isStatic) {
        const dir = nx > 0 ? -1 : 1; // object is on the left => pushing left
        const factor = Math.max(rc.pushMinFactor, rc.playerMass / (rc.playerMass + k.other.mass));
        if (!b.push || factor < b.push.factor) b.push = { dir, factor };
        const cap = this.config.player.moveSpeed * factor;
        if (b.vel.x * dir > cap) b.vel.x = cap * dir;
      }
    }

    // Objects that leave the level are gone for good (until respawn).
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (o.travelling) continue;
      if (o.pos.y - o.radius > this.level.height + 200) {
        if (this.carried === o) this._drop(false);
        this.rigid.remove(o);
        this.objects.splice(i, 1);
      }
    }
  }

  render(ctx, alpha, view) {
    if (this.camera.viewW !== view.width / this.camera.zoom || this.camera.viewH !== view.height / this.camera.zoom) {
      this.camera.setView(view.width, view.height);
    }
    this.renderer.clear(ctx);
    this.camera.applyTo(ctx, view.dpr, alpha);
    const rect = this.camera.visibleRect(alpha);
    this.renderer.drawGrid(ctx, rect);
    this.renderer.drawShapes(ctx, this.level.shapes, rect);
    this.renderer.drawSwitches(ctx, this.level.switches, rect);
    this.renderer.drawCheckpoints(ctx, this.level.checkpoints, rect, this.checkpoint);
    for (const o of this.objects) if (!o.travelling) drawBody(ctx, o, alpha);
    this.ball.render(ctx, alpha);
    this.renderer.drawTubes(ctx, this.level.tubes, rect, (c) => {
      for (const r of this.riders) {
        if (r.tube !== c) continue;
        if (r.kind === 'player') this.ball.render(ctx, alpha);
        else drawBody(ctx, r.body, alpha);
      }
    });
    this.debug.drawWorld(ctx, this.ball);
    if (this.debug.enabled) this._drawObjectDebug(ctx);
    this.debug.drawHud(ctx, view, { engine: this.engine, ball: this.ball, scene: this });
  }

  _drawObjectDebug(ctx) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,90,0.5)';
    for (const b of this.staticBodies) {
      if (b.shape !== 'poly') continue;
      const wv = b.worldVerts;
      ctx.beginPath();
      ctx.moveTo(wv[0].x, wv[0].y);
      for (let i = 1; i < wv.length; i++) ctx.lineTo(wv[i].x, wv[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = '#ff5'; ctx.fillStyle = '#ff5';
    for (const m of this.rigid.manifolds) {
      for (const c of m.contacts) {
        ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + m.nx * 12, c.y + m.ny * 12); ctx.stroke();
      }
    }
  }
}

const surfaceCache = new WeakMap();
/** A surface-like descriptor so the motor can treat a dynamic object as ground/wall. */
function objectSurface(body) {
  let s = surfaceCache.get(body);
  if (!s) {
    s = { type: body.kind, friction: 1, bounce: 0, oneWay: false, hazard: false, body };
    surfaceCache.set(body, s);
  }
  return s;
}
