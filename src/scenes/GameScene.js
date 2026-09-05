import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { RigidWorld } from '../physics/RigidWorld.js';
import { RigidBody } from '../physics/RigidBody.js';
import { Ball } from '../player/Ball.js';
import { Camera } from '../render/Camera.js';
import { Renderer } from '../render/Renderer.js';
import { DebugOverlay } from '../render/DebugOverlay.js';
import { EventBus } from '../core/EventBus.js';
import { createEntityBody, createStaticBodies, drawBody } from '../world/Entities.js';

/**
 * Wires level + physics + player + camera together.
 *
 * Two physics systems cooperate: PhysicsWorld moves the player against the level's
 * shapes (the platformer feel), and RigidWorld simulates crates/balls. The player is
 * mirrored into the rigid world as a proxy body each step so it can push objects,
 * get pushed, and stand on them; contacts with objects are fed back to the motor
 * as ground/wall contacts.
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
    this.staticBodies = createStaticBodies(level.shapes);
    this.camera.bounds = { x: 0, y: 0, w: level.width, h: level.height };
    this.respawn();
    this.events.emit('level:loaded', { level });
  }

  /** Rebuild every dynamic object from the level definition. */
  resetObjects() {
    const r = this.rigid;
    r.clear();
    for (const b of this.staticBodies) r.add(b);
    this.objects = this.level.entities.map((e) => r.add(createEntityBody(e, this.config.tileSize)));
    r.add(this.proxy);
  }

  respawn() {
    this.ball.respawn(this.level.spawn.x, this.level.spawn.y);
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
    if (input.justPressed('reset')) this.respawn();

    this.ball.update(dt, Ball.readInput(input), this.world);
    this._stepObjects(dt);

    const b = this.ball.body;
    if (b.hazard) { this.kill('hazard'); return; }
    if (b.pos.y - b.radius > this.level.height + 100) { this.kill('fell'); return; }

    this.camera.follow(b.pos, b.vel, dt);
  }

  _syncProxy() {
    const b = this.ball.body, p = this.proxy;
    p.pos.copy(b.pos); p.prevPos.copy(b.pos);
    p.vel.copy(b.vel);
    p.angVel = 0;
  }

  _stepObjects(dt) {
    if (this.objects.length === 0) return;
    const b = this.ball.body, p = this.proxy, cfg = this.config.physics;
    this._syncProxy();
    this.rigid.step(dt);
    b.pos.copy(p.pos);
    b.vel.copy(p.vel);

    // Objects the player is touching become contacts the motor understands.
    const c = b.contacts;
    const rc = this.config.rigid;
    b.push = null;
    for (const k of p.contacts) {
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
      if (o.pos.y - o.radius > this.level.height + 200) { this.rigid.remove(o); this.objects.splice(i, 1); }
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
    for (const o of this.objects) drawBody(ctx, o, alpha);
    this.ball.render(ctx, alpha);
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
