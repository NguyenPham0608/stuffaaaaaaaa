// Run with: node test/physics.test.js
import assert from 'node:assert/strict';
import { circleVsPolygon } from '../src/physics/Collision.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { CircleBody } from '../src/physics/CircleBody.js';
import { RigidWorld } from '../src/physics/RigidWorld.js';
import { RigidBody, rectVerts } from '../src/physics/RigidBody.js';
import { Shape } from '../src/world/Shape.js';
import { Level } from '../src/world/Level.js';
import { createStaticBodies } from '../src/world/Entities.js';
import { decomposeConvex, isConvex, flattenPath, signedArea2 } from '../src/math/Geometry.js';
import { PlatformerMotor, MotorState } from '../src/player/PlatformerMotor.js';
import { GameScene } from '../src/scenes/GameScene.js';
import { CONFIG } from '../src/config.js';
import { LEVEL_1 } from '../src/levels/level1.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const DT = CONFIG.physics.fixedDt;
const IDLE = { moveX: 0, down: false, jumpPressed: false, jumpHeld: false };

function makeWorld(shapes) {
  const w = new PhysicsWorld(CONFIG.physics);
  for (const s of shapes) w.addShape(s);
  return w;
}
const rect = (x, y, w, h, type) => Shape.rect(x, y, w, h, type);
const poly = (nodes, type = 'solid') => new Shape({ type, nodes });

test('circleVsPolygon: no overlap', () => {
  const out = [];
  assert.equal(circleVsPolygon(50, 50, 10, rect(0, 0, 32, 32), out), 0);
});

test('circleVsPolygon: side contact gives axis normal and depth', () => {
  const out = [];
  assert.equal(circleVsPolygon(40, 16, 10, rect(0, 0, 32, 32), out), 1);
  near(out[0].nx, 1); near(out[0].ny, 0); near(out[0].depth, 2); assert.equal(out[0].vertex, false);
});

test('circleVsPolygon: corner contact gives a single diagonal normal', () => {
  const out = [];
  assert.equal(circleVsPolygon(38, -6, 10, rect(0, 0, 32, 32), out), 1);
  assert.ok(out[0].vertex);
  near(out[0].nx, 0.7071, 1e-3); near(out[0].ny, -0.7071, 1e-3);
});

test('circleVsPolygon: centre inside still pushes outward', () => {
  const out = [];
  assert.equal(circleVsPolygon(16, 3, 10, rect(0, 0, 32, 32), out), 1);
  near(out[0].nx, 0); near(out[0].ny, -1); near(out[0].depth, 13);
});

test('circleVsPolygon: slope gives a tilted normal', () => {
  const ramp = poly([{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  const out = [];
  assert.equal(circleVsPolygon(50, 50 - 5, 10, ramp, out), 1);
  near(out[0].nx, -0.7071, 1e-3); near(out[0].ny, -0.7071, 1e-3);
  near(out[0].depth, 10 - 5 / Math.SQRT2, 1e-6);
});

test('circleVsPolygon: inner corner of a concave shape yields two face contacts', () => {
  const L = poly([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 64 }, { x: 96, y: 64 }, { x: 96, y: 96 }, { x: 0, y: 96 }]);
  const out = [];
  assert.equal(circleVsPolygon(32 + 9, 64 - 9, 10, L, out), 2);
  const nxs = out.map((c) => c.nx).sort(), nys = out.map((c) => c.ny).sort();
  near(nxs[0], 0); near(nxs[1], 1); near(nys[0], -1); near(nys[1], 0);
});

test('flattenPath subdivides curves and keeps winding positive after Shape.rebuild', () => {
  const hill = poly([{ x: 0, y: 100, cx: 50, cy: 0 }, { x: 100, y: 100 }]);
  assert.ok(hill.points.length > 4);
  assert.ok(signedArea2(hill.points) > 0);
  assert.equal(flattenPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]).length, 3);
});

test('decomposeConvex: convex stays whole, concave splits into convex pieces covering the input', () => {
  assert.equal(decomposeConvex(rect(0, 0, 32, 32).points).length, 1);
  const L = poly([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 64 }, { x: 96, y: 64 }, { x: 96, y: 96 }, { x: 0, y: 96 }]);
  const pieces = decomposeConvex(L.points);
  assert.ok(pieces.length >= 2 && pieces.length <= 3, `pieces=${pieces.length}`);
  for (const p of pieces) assert.ok(isConvex(p));
  const area = pieces.reduce((a, p) => a + signedArea2(p) / 2, 0);
  near(area, signedArea2(L.points) / 2, 1e-6);
});

test('falling body lands on floor and reports ground', () => {
  const world = makeWorld([rect(0, 100, 200, 32)]);
  const body = new CircleBody({ x: 100, y: 20, radius: 13 });
  for (let i = 0; i < 240; i++) { body.vel.y += 2300 * DT; world.step(body, DT); }
  assert.ok(body.onGround, 'should be grounded');
  near(body.pos.y, 100 - 13, 0.8);
  near(body.vel.y, 0, 1e-9);
});

test('no tunneling at very high speed', () => {
  const world = makeWorld([rect(0, 100, 200, 8)]);
  const body = new CircleBody({ x: 100, y: 0, radius: 6 });
  body.vel.y = 20000; // 166px per step, floor is 8px thick
  world.step(body, DT);
  assert.ok(body.pos.y + body.radius <= 100 + 1e-6, `tunneled: y=${body.pos.y}`);
});

test('resting ball on corner does not drift', () => {
  const world = makeWorld([rect(100, 100, 64, 32)]);
  const body = new CircleBody({ x: 100 - 5, y: 100 - 12, radius: 13 }); // overhanging the left edge
  const motor = new PlatformerMotor(body, CONFIG.player);
  for (let i = 0; i < 60; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  const x0 = body.pos.x, y0 = body.pos.y;
  for (let i = 0; i < 600; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  near(body.pos.x, x0, 0.05); near(body.pos.y, y0, 0.05);
  assert.ok(body.onGround);
});

test('ball rests on a slope and rolls along it under input', () => {
  const ramp = poly([{ x: 0, y: 200 }, { x: 400, y: -200 }, { x: 400, y: 200 }]);
  const world = makeWorld([ramp, rect(0, 200, 400, 32)]);
  const body = new CircleBody({ x: 60, y: 100, radius: 13 });
  const motor = new PlatformerMotor(body, CONFIG.player);
  for (let i = 0; i < 240; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  assert.equal(motor.state, MotorState.GROUND);
  assert.ok(body.groundWall === ramp, 'ground is the ramp');
  near(body.contacts.ground.ny, -Math.SQRT1_2, 0.02);
  const x0 = body.pos.x, y0 = body.pos.y;
  for (let i = 0; i < 120; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  near(body.pos.x, x0, 0.05); near(body.pos.y, y0, 0.05);   // no creep on a solid slope
  for (let i = 0; i < 120; i++) { motor.update(DT, { ...IDLE, moveX: 1 }); world.step(body, DT); }
  assert.ok(body.pos.x > x0 + 40 && body.pos.y < y0 - 40, `should climb: ${body.pos.x},${body.pos.y}`);
  assert.equal(motor.state, MotorState.GROUND);
});

test('ball slides down an icy slope by itself', () => {
  const ramp = poly([{ x: 0, y: 200 }, { x: 400, y: 0 }, { x: 400, y: 200 }], 'ice');
  const world = makeWorld([ramp]);
  const body = new CircleBody({ x: 300, y: 20, radius: 13 });
  const motor = new PlatformerMotor(body, CONFIG.player);
  for (let i = 0; i < 60; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  assert.equal(motor.state, MotorState.GROUND);
  const x0 = body.pos.x;
  for (let i = 0; i < 30; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  assert.equal(motor.state, MotorState.GROUND);
  assert.ok(body.pos.x < x0 - 5, `should slide left/down: ${x0} -> ${body.pos.x}`);
});

test('ball follows a curved hill without leaving the ground', () => {
  const hill = poly([{ x: 0, y: 200, cx: 200, cy: 40 }, { x: 400, y: 200 }]);
  const world = makeWorld([hill, rect(-200, 200, 800, 32)]);
  const body = new CircleBody({ x: -100, y: 150, radius: 13 });
  const motor = new PlatformerMotor(body, CONFIG.player);
  for (let i = 0; i < 120; i++) { motor.update(DT, IDLE); world.step(body, DT); }
  let airborne = 0;
  for (let i = 0; i < 300 && body.pos.x < 380; i++) {
    motor.update(DT, { ...IDLE, moveX: 1 }); world.step(body, DT);
    if (body.pos.x > 20 && body.pos.x < 380 && motor.state !== MotorState.GROUND) airborne++;
  }
  assert.ok(body.pos.x > 380, `crossed the hill: x=${body.pos.x}`);
  assert.ok(airborne <= 3, `left the ground for ${airborne} steps`);
});

test('wall contact classified and velocity into wall cancelled', () => {
  const world = makeWorld([rect(200, 0, 32, 300)]);
  const body = new CircleBody({ x: 150, y: 100, radius: 13 });
  body.vel.x = 400;
  for (let i = 0; i < 30; i++) world.step(body, DT);
  assert.ok(body.contacts.right, 'wall should be on the right');
  near(body.vel.x, 0); near(body.pos.x, 200 - 13, 0.8);
});

test('one-way platform: lands from above, passes from below, drops through', () => {
  const world = makeWorld([rect(0, 100, 200, 32, 'oneway')]);
  const body = new CircleBody({ x: 100, y: 200, radius: 13 });
  body.vel.y = -900;
  for (let i = 0; i < 20; i++) { world.step(body, DT); body.vel.y += 2300 * DT; }
  assert.ok(body.pos.y < 100, 'should have passed up through the platform');
  for (let i = 0; i < 200; i++) { body.vel.y = Math.min(body.vel.y + 2300 * DT, 950); world.step(body, DT); }
  assert.ok(body.onGround && body.groundWall.oneWay, 'should rest on the one-way');
  body.dropThrough = 0.2;
  for (let i = 0; i < 30; i++) { body.vel.y += 2300 * DT; world.step(body, DT); }
  assert.ok(body.pos.y > 100 + 13, 'should have dropped through');
});

test('bouncy floor returns the impact speed', () => {
  const world = makeWorld([rect(0, 100, 200, 32, 'bouncy')]);
  const body = new CircleBody({ x: 100, y: 60, radius: 13 });
  body.vel.y = 600;
  for (let i = 0; i < 10; i++) world.step(body, DT);
  assert.ok(body.vel.y <= -595, `should leave about as fast as it arrived, vy=${body.vel.y}`);
  assert.ok(body.bounced === null || body.bounced.wall.type === 'bouncy');
});

test('bounce pad rebounds above the drop without running away', () => {
  const world = makeWorld([rect(0, 600, 400, 32, 'bouncy')]);
  const body = new CircleBody({ x: 200, y: 520, radius: 13 });   // 67px above the pad
  const motor = new PlatformerMotor(body, CONFIG.player);
  let highest = 0;
  for (let i = 0; i < 2000; i++) {
    motor.update(DT, IDLE);
    world.step(body, DT);
    highest = Math.max(highest, 600 - body.pos.y - body.radius);
  }
  assert.ok(highest > 67, `bounces above the drop height, got ${highest.toFixed(0)}`);
  assert.ok(highest < 200, `plain bouncing stays modest, got ${highest.toFixed(0)}`);
});

test('holding jump on a bounce pad launches higher than releasing it', () => {
  const peak = (jumpHeld) => {
    const world = makeWorld([rect(0, 600, 400, 32, 'bouncy')]);
    const body = new CircleBody({ x: 200, y: 520, radius: 13 });
    const motor = new PlatformerMotor(body, CONFIG.player);
    let highest = 0;
    for (let i = 0; i < 2000; i++) {
      motor.update(DT, { ...IDLE, jumpHeld });
      world.step(body, DT);
      highest = Math.max(highest, 600 - body.pos.y - body.radius);
    }
    return highest;
  };
  const held = peak(true), released = peak(false);
  assert.ok(held > released * 1.2, `held ${held.toFixed(0)} should clear released ${released.toFixed(0)}`);
});

test('bouncy floor gives a gentle landing a real launch', () => {
  const world = makeWorld([rect(0, 100, 200, 32, 'bouncy')]);
  const body = new CircleBody({ x: 100, y: 80, radius: 13 });
  body.vel.y = 120;
  for (let i = 0; i < 10; i++) world.step(body, DT);
  assert.ok(body.vel.y <= -CONFIG.physics.minBounceLaunch + 1e-6, `weak impact still launches, vy=${body.vel.y}`);
});

test('hazard contact is reported', () => {
  const world = makeWorld([rect(0, 100, 200, 32, 'hazard')]);
  const body = new CircleBody({ x: 100, y: 80, radius: 13 });
  body.vel.y = 300;
  for (let i = 0; i < 10; i++) world.step(body, DT);
  assert.ok(body.hazard && body.hazard.hazard);
});

test('ceiling corner correction nudges the ball past a corner', () => {
  const world = makeWorld([rect(110, 0, 100, 32)]);
  const body = new CircleBody({ x: 100, y: 80, radius: 13 }); // reaches to x=113, 3px into the block
  body.vel.y = -700;
  for (let i = 0; i < 20; i++) world.step(body, DT);
  assert.ok(body.pos.y < 32, `should have passed the ceiling, y=${body.pos.y}`);
  assert.ok(body.pos.x + body.radius <= 110 + 1e-6, 'should have been nudged left');
});

test('motor: grounded jump, coyote time, jump buffer, walls are inert', () => {
  const world = makeWorld([rect(0, 200, 400, 32), rect(400, 0, 32, 232)]);
  const body = new CircleBody({ x: 100, y: 150, radius: 13 });
  const motor = new PlatformerMotor(body, CONFIG.player);
  const run = (n, cmd) => { for (let i = 0; i < n; i++) { motor.update(DT, cmd); world.step(body, DT); } };

  run(120, IDLE);
  assert.equal(motor.state, MotorState.GROUND);

  run(1, { ...IDLE, jumpPressed: true, jumpHeld: true });
  assert.ok(body.vel.y < -600, 'jump launched');
  assert.equal(motor.state, MotorState.AIR);

  // Fly into the right wall while holding right: it neither slows the fall nor allows a jump.
  body.teleport(360, 60); motor.reset();
  run(40, { ...IDLE, moveX: 1, jumpHeld: false });
  assert.ok(body.contacts.right, 'touching the wall');
  assert.equal(motor.state, MotorState.AIR);
  const fallSpeed = body.vel.y;
  run(1, { ...IDLE, moveX: 1, jumpPressed: true, jumpHeld: true });
  assert.ok(body.vel.y > fallSpeed - 1e-6, 'pressing jump on a wall does nothing');

  body.teleport(600, 150); motor.reset(); motor.coyote = CONFIG.player.coyoteTime;
  run(1, { ...IDLE, jumpPressed: true, jumpHeld: true });
  assert.ok(body.vel.y < -600, 'coyote jump launched');
});

test('rigid crate settles on a slope made of convex terrain pieces', () => {
  const ramp = poly([{ x: 0, y: 300 }, { x: 600, y: 0 }, { x: 600, y: 300 }]);
  const floor = rect(-100, 300, 800, 32);
  const world = new RigidWorld({ gravity: 1600, iterations: 12 });
  for (const b of createStaticBodies([ramp, floor])) world.add(b);
  const crate = world.add(new RigidBody({ x: 20, y: 200, shape: 'poly', verts: rectVerts(-14, -14, 28, 28), density: 0.002, friction: 0.6 }));
  for (let i = 0; i < 600; i++) world.step(DT);
  assert.ok(crate.pos.y < 300 - 10, `crate should stay above the floor line: y=${crate.pos.y}`);
  assert.ok(crate.pos.y > 100, `crate should have come down: y=${crate.pos.y}`);
});

test('rigid ball rolls smoothly over a curved terrain shape', () => {
  const hill = poly([{ x: 0, y: 200, cx: 200, cy: 40 }, { x: 400, y: 200 }]);
  const floor = rect(-300, 200, 3000, 32);
  const world = new RigidWorld({ gravity: 1600, iterations: 12 });
  for (const b of createStaticBodies([hill, floor])) world.add(b);
  const ball = world.add(new RigidBody({ x: -60, y: 188, shape: 'circle', radius: 12, density: 0.002, friction: 0.45 }));
  ball.vel.x = 900;
  let maxContacts = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 400; i++) {
    world.step(DT);
    maxContacts = Math.max(maxContacts, ball.contacts.length);
    minY = Math.min(minY, ball.pos.y); maxY = Math.max(maxY, ball.pos.y);
  }
  assert.ok(ball.pos.x > 420, `should have crossed the hill: x=${ball.pos.x}`);
  assert.ok(minY < 150, `should have climbed the hill: minY=${minY}`);
  assert.ok(maxY <= 200 - 12 + 3, `should never sink into the floor: y=${maxY}`);
  assert.ok(maxContacts >= 1);
});

test('level parser merges tiles into shapes and finds spawn', () => {
  const lvl = Level.fromAscii(['####', '#P #', '#--#', '####'], { tileSize: 32 });
  assert.equal(lvl.spawn.x, 48); assert.equal(lvl.spawn.y, 48);
  const solid = lvl.shapes.filter((s) => s.type === 'solid');
  const oneway = lvl.shapes.filter((s) => s.type === 'oneway');
  assert.equal(oneway.length, 1); assert.equal(oneway[0].w, 64);
  assert.equal(solid.length, 4);
  assert.ok(solid.some((s) => s.w === 128 && s.h === 32));
  assert.ok(solid.some((s) => s.w === 32 && s.h === 64));
});

test('level JSON round-trips including curves, and level1 loads', () => {
  const lvl = new Level({ shapes: [poly([{ x: 0, y: 100, cx: 50, cy: 0 }, { x: 100, y: 100 }], 'ice')], entities: [{ type: 'crate', x: 10, y: 20 }], spawn: { x: 5, y: 6 }, width: 300, height: 200, name: 'T' });
  const back = Level.fromJSON(JSON.parse(JSON.stringify(lvl.toJSON())));
  assert.equal(back.shapes[0].type, 'ice');
  assert.equal(back.shapes[0].nodes[0].cx, 50);
  assert.equal(back.entities[0].type, 'crate');
  assert.equal(back.width, 300);
  // god mode flies the spawn point, so it has to survive the save/load Play reads through
  assert.deepEqual(back.spawn, { x: 5, y: 6 });
  const l1 = Level.fromJSON(LEVEL_1);
  assert.ok(l1.playable && l1.shapes.length > 10 && l1.entities.length > 0);
});

// ---------------------------------------------------------------------------
// Logic elements: switches, powered doors, tubes and carrying.

class StubInput {
  constructor() { this.down = new Set(); }
  poll() {}
  isDown(a) { return this.down.has(a); }
  justPressed() { return false; }
  justReleased() { return false; }
  axis(n, p) { return (this.down.has(p) ? 1 : 0) - (this.down.has(n) ? 1 : 0); }
}

const FLOOR = { type: 'solid', nodes: [{ x: 0, y: 600 }, { x: 1200, y: 600 }, { x: 1200, y: 640 }, { x: 0, y: 640 }] };
function makeScene(data) {
  const input = new StubInput();
  const level = Level.fromJSON({ width: 1200, height: 700, spawn: { x: 100, y: 560 }, shapes: [FLOOR], ...data });
  return { scene: new GameScene({ input, level, config: CONFIG }), input };
}
const runScene = (s, n) => { for (let i = 0; i < n; i++) s.update(DT); };

test('a switch powers a door on its channel, and releases it again', () => {
  const door = {
    type: 'solid', nodes: [{ x: 600, y: 440 }, { x: 660, y: 440 }, { x: 660, y: 600 }, { x: 600, y: 600 }],
    channel: 'a', move: { dx: 0, dy: -170, duration: 0.4 },
  };
  const { scene } = makeScene({
    shapes: [FLOOR, door],
    switches: [{ x: 300, y: 590, channel: 'a', accepts: 'any' }],
    entities: [{ type: 'crate', x: 300, y: 540 }],
  });
  const d = scene.level.shapes[1];
  near(d.y, 440, 1e-6);
  runScene(scene, 240);
  assert.ok(scene.level.switches[0].active, 'crate presses the plate');
  near(d.offset, 1, 1e-6);
  near(d.y, 270, 1e-6);
  scene.rigid.remove(scene.objects[0]);
  scene.objects.length = 0;
  runScene(scene, 240);
  assert.equal(scene.level.switches[0].active, false);
  near(d.offset, 0, 1e-6);
  near(d.y, 440, 1e-6);
});

test('checkpoints become the respawn point and survive dying', () => {
  const hazard = { type: 'hazard', nodes: [{ x: 900, y: 600 }, { x: 1100, y: 600 }, { x: 1100, y: 640 }, { x: 900, y: 640 }] };
  const { scene, input } = makeScene({
    width: 1200, shapes: [FLOOR, hazard],
    checkpoints: [{ x: 400, y: 600 }, { x: 700, y: 600 }],
    spawn: { x: 80, y: 587 },
  });
  const [c1, c2] = scene.level.checkpoints;
  near(scene.respawnPoint.x, 80, 1e-6);

  input.down.add('right');
  runScene(scene, 200);
  assert.ok(c1.reached && scene.checkpoint === c1, 'first flag taken');
  near(scene.respawnPoint.x, 400, 1e-6);
  near(scene.respawnPoint.y, 600 - CONFIG.player.radius - 1, 1e-6);

  runScene(scene, 200);
  assert.ok(c2.reached && scene.checkpoint === c2, 'second flag takes over');

  const deaths = scene.deaths;
  runScene(scene, 300);
  assert.ok(scene.deaths > deaths, 'ran into the hazard');
  assert.ok(scene.ball.pos.x > 600, `respawned at the flag, not the spawn: x=${scene.ball.pos.x}`);
  assert.ok(c1.reached && c2.reached, 'flags stay raised through a death');

  // Loading a level clears them again.
  scene.loadLevel(scene.level);
  assert.equal(scene.checkpoint, null);
  assert.equal(c2.reached, false);
  near(scene.respawnPoint.x, 80, 1e-6);
});

test('a one-time switch stays pressed after whatever triggered it leaves', () => {
  const door = {
    type: 'solid', nodes: [{ x: 600, y: 440 }, { x: 660, y: 440 }, { x: 660, y: 600 }, { x: 600, y: 600 }],
    channel: 'vault-door', move: { dx: 0, dy: -170, duration: 0.4 },
  };
  const { scene } = makeScene({
    shapes: [FLOOR, door],
    switches: [{ x: 300, y: 600, channel: 'vault-door', accepts: 'any', latch: true }],
    entities: [{ type: 'crate', x: 300, y: 540 }],
  });
  const sw = scene.level.switches[0], d = scene.level.shapes[1];
  runScene(scene, 200);
  assert.ok(sw.active && sw.latched, 'latched once pressed');
  scene.rigid.remove(scene.objects[0]);
  scene.objects.length = 0;
  runScene(scene, 300);
  assert.ok(sw.active, 'stays pressed with nothing on it');
  near(d.offset, 1, 1e-6);
  scene.respawn();
  assert.equal(sw.latched, false, 'a respawn resets it');
  assert.equal(sw.active, false);
});

test('channels are arbitrary strings and survive a round-trip', () => {
  const l = Level.fromJSON(JSON.parse(JSON.stringify(Level.fromJSON({
    width: 800, height: 600, spawn: { x: 10, y: 10 },
    shapes: [{ type: 'solid', nodes: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }], channel: 'gate 7', move: { dx: 5, dy: 0 } }],
    switches: [{ x: 1, y: 2, channel: 'gate 7', accepts: 'any', latch: true }],
  }).toJSON())));
  assert.equal(l.switches[0].channel, 'gate 7');
  assert.equal(l.switches[0].latch, true);
  assert.equal(l.shapes[0].channel, 'gate 7');
});

test('switch filters accept only their own kind', () => {
  for (const [accepts, expected] of [['any', true], ['box', true], ['ball', false], ['player', false]]) {
    const { scene } = makeScene({
      switches: [{ x: 300, y: 590, channel: 'a', accepts }],
      entities: [{ type: 'crate', x: 300, y: 540 }],
    });
    runScene(scene, 200);
    assert.equal(scene.level.switches[0].active, expected, `crate on accepts=${accepts}`);
  }
});

test('a tube swallows an object, moves it along the path, and spits it out the far end', () => {
  const { scene } = makeScene({
    tubes: [{ radius: 26, nodes: [{ x: 420, y: 585 }, { x: 700, y: 300 }, { x: 980, y: 585 }] }],
    entities: [{ type: 'ball', x: 340, y: 585 }],
  });
  const o = scene.objects[0];
  o.vel.x = 400;
  let inside = 0, highest = Infinity;
  for (let i = 0; i < 400; i++) {
    scene.update(DT);
    if (scene.riders.length) { inside++; highest = Math.min(highest, o.pos.y); }
  }
  assert.ok(inside > 30, `should be visibly inside for a while, got ${inside} steps`);
  assert.ok(highest < 350, `should follow the path up, highest y=${highest}`);
  assert.ok(o.pos.x > 950, `should come out the far end, x=${o.pos.x}`);
  assert.equal(o.travelling, false);
});

test('the player rides a tube too', () => {
  const { scene, input } = makeScene({
    tubes: [{ radius: 26, nodes: [{ x: 420, y: 585 }, { x: 700, y: 250 }, { x: 980, y: 585 }] }],
    spawn: { x: 330, y: 585 },
  });
  input.down.add('right');
  let rode = false, highest = Infinity;
  for (let i = 0; i < 400; i++) {
    scene.update(DT);
    if (scene.riders.some((r) => r.kind === 'player')) { rode = true; highest = Math.min(highest, scene.ball.pos.y); }
  }
  assert.ok(rode, 'player should be swallowed');
  assert.ok(highest < 300, `player should travel up the tube, highest y=${highest}`);
});

test('a tube whose exit faces a wall cannot swallow you forever', () => {
  // The exit throws the player into a bouncy wall, which fires them straight back at the
  // mouth. Without the post-exit cooldown they are re-swallowed every time and never escape.
  const bouncy = { type: 'bouncy', nodes: [{ x: 1010, y: 470 }, { x: 1070, y: 470 }, { x: 1070, y: 600 }, { x: 1010, y: 600 }] };
  const { scene, input } = makeScene({
    width: 1400, shapes: [{ type: 'solid', nodes: [{ x: 0, y: 600 }, { x: 1400, y: 600 }, { x: 1400, y: 640 }, { x: 0, y: 640 }] }, bouncy],
    tubes: [{ radius: 26, nodes: [{ x: 420, y: 587 }, { x: 700, y: 330 }, { x: 980, y: 587 }] }],
    spawn: { x: 300, y: 587 },
  });
  input.down.add('right');
  let insideRun = 0, longest = 0;
  for (let i = 0; i < 2400; i++) {
    scene.update(DT);
    insideRun = scene.riders.length ? insideRun + 1 : 0;
    longest = Math.max(longest, insideRun);
  }
  assert.equal(scene.riders.length, 0, 'must not end the run trapped inside the tube');
  assert.ok(longest < 400, `never stuck inside for long, longest stay ${longest} steps`);
});

test('a tube is solid except at its mouths', () => {
  // A pipe crossing the floor: its side wall stands in the way, its mouth does not.
  const { scene, input } = makeScene({
    tubes: [{ radius: 26, wall: 7, nodes: [{ x: 500, y: 300 }, { x: 500, y: 700 }] }],
  });
  assert.ok(scene.tubeWalls.length > 0, 'pipe walls become collidable geometry');
  input.down.add('right');
  runScene(scene, 400);
  assert.ok(scene.ball.body.contacts.right, 'stopped by the pipe wall');
  near(scene.ball.pos.x, 500 - 26 - 7 - scene.ball.body.radius, 1.5);
});

test('a carried crate is stopped by a wall and stops the player with it', () => {
  const wall = { type: 'solid', nodes: [{ x: 600, y: 300 }, { x: 660, y: 300 }, { x: 660, y: 600 }, { x: 600, y: 600 }] };
  const { scene, input } = makeScene({ shapes: [FLOOR, wall], entities: [{ type: 'crate', x: 180, y: 560 }] });
  const crate = scene.objects[0];
  runScene(scene, 60);
  input.down.add('grab');
  input.down.add('right');
  let worstFace = -Infinity;
  for (let i = 0; i < 500; i++) {
    scene.update(DT);
    if (scene.carried === crate) worstFace = Math.max(worstFace, crate.pos.x + crate.carryRadius);
  }
  assert.equal(scene.carried, crate, 'still holding it');
  assert.ok(worstFace <= 600 + 0.05, `the crate's face never enters the wall, worst ${worstFace}`);
  // crate face on the wall -> crate centre one half-width back -> player one hold offset behind that
  const hold = scene.ball.body.radius + crate.carryRadius + CONFIG.logic.carryGap;
  near(scene.ball.pos.x, 600 - crate.carryRadius - hold, 0.1);
  assert.ok(Math.abs(scene.ball.vel.x) < 1, `player is held still against it, vx ${scene.ball.vel.x}`);
  assert.equal(scene.deaths, 0);
});

test('a crate that cannot fit is let go safely', () => {
  // A 25px-high tunnel: the player (26 tall, 1px to spare) is already inside, next to a 28px
  // crate jammed between roof and floor. Grabbing it cannot make it fit, so it must be
  // released - without shoving the player into the floor, and without the crate being fired
  // through it. (It starts beside the player, on the floor: that is where a grab finds it.)
  const roof = { type: 'solid', nodes: [{ x: 600, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 575 }, { x: 600, y: 575 }] };
  const { scene, input } = makeScene({ shapes: [FLOOR, roof], entities: [{ type: 'crate', x: 728, y: 586 }], spawn: { x: 700, y: 587 } });
  const crate = scene.objects[0];
  input.down.add('grab');
  runScene(scene, 300);
  assert.equal(scene.carried, null, 'gave the crate up');
  assert.equal(scene.deaths, 0, 'the player survived');
  near(scene.ball.pos.y, 587, 1, 'the player is still standing in the tunnel');
  assert.ok(crate.pos.y + crate.carryRadius <= 600 + 4, `the crate stays on the floor, not through it: y=${crate.pos.y}`);
  // Grab is latched off after a forced drop until it is released, so it does not re-grab every step.
  assert.equal(scene.carryBlocked, true);
  input.down.delete('grab');
  runScene(scene, 1);
  assert.equal(scene.carryBlocked, false);
});

test('holding grab carries an object, swaps sides on turning, and releases it', () => {
  const { scene, input } = makeScene({ entities: [{ type: 'crate', x: 200, y: 560 }] });
  const crate = scene.objects[0];
  runScene(scene, 60);
  assert.equal(scene.carried, null);

  input.down.add('grab');
  input.down.add('right');
  runScene(scene, 120);
  assert.equal(scene.carried, crate, 'running into it while holding grab picks it up');
  // Locked flush to the player's side, not sprung: the offset is exact and never drifts.
  // Crates hang by their half-width (they are held upright) with bottoms aligned to the player's.
  const expected = scene.ball.body.radius + crate.carryRadius + CONFIG.logic.carryGap;
  near(crate.pos.x - scene.ball.pos.x, expected, 1e-6);
  near(crate.pos.y - scene.ball.pos.y, scene.ball.body.radius - crate.carryRadius, 1e-6);
  runScene(scene, 60);
  near(crate.pos.x - scene.ball.pos.x, expected, 1e-6);

  input.down.delete('right');
  input.down.add('left');
  runScene(scene, 120);
  near(crate.pos.x - scene.ball.pos.x, -expected, 1e-6);

  input.down.delete('grab');
  runScene(scene, 60);
  assert.equal(scene.carried, null, 'releasing grab drops it');
});

test('level1 is playable and survives a JSON round-trip unchanged', () => {
  const a = Level.fromJSON(LEVEL_1);
  assert.ok(a.playable, 'the built-in level must be playable');
  assert.ok(a.tubes.every((t) => t.usable), 'every tube has a usable path');
  assert.ok(a.shapes.every((s) => s.points.length >= 3), 'every shape flattens to a polygon');
  // Doors must rest at offset 0 so their colliders are built in the right place.
  assert.ok(a.shapes.filter((s) => s.isDoor).every((s) => s.offset === 0));

  // Re-exporting and re-importing has to produce the identical level, since that is the
  // path the editor and localStorage both take.
  const b = Level.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
  assert.deepEqual(b.toJSON(), a.toJSON());
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
console.log(failed ? `\n${failed} failing` : `\nall ${tests.length} passing`);
process.exit(failed ? 1 : 0);
