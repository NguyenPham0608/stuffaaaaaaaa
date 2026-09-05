# Ball Platformer Engine

A modular 2D side-scrolling platformer engine. The player is a ball; the world is
free-form geometry: closed shapes made of nodes, with optional curved segments, each
carrying a material (solid, ice, bouncy, one-way, hazard). Slopes, ramps, half-pipes
and rolling hills all collide exactly.

## Run

ES modules need an HTTP server:

```
python3 -m http.server 8080
# open http://localhost:8080
```

The top bar switches between two modes on one page (the choice is remembered):

- **Play**: arrows / WASD to move, Space / Z / W / Up to jump, Down + jump to drop through
  one-way platforms, R to respawn (also resets objects), backtick (or F3) to toggle the debug
  overlay (shows contacts and the convex pieces objects collide with). Plays the editor's
  saved level when it has geometry, otherwise `level1.js`.
- **Editor**: a vector level editor. Edits autosave to localStorage.

## Editor

1. Pick a **material** (1-5). Drag on empty space to draw a rectangle of it.
2. Drag a shape to move it. Clicking a material while a shape is selected changes its material.
3. With a shape selected: drag **nodes** to move them (right-click deletes one);
   click a **midpoint** handle to add a node there, or drag it to bend that segment into a
   curve (a quadratic Bezier that passes through where you drop it); drag the yellow
   **control** handle to reshape a curve, right-click it to straighten.
4. **Objects** (6-9): spawn, crate, heavy crate, ball. Click to place, drag to move, right-click
   to remove. `0` or Esc goes back to drawing.
5. Level bounds are in px (W/H). Snap (Shift to bypass) and grid size are in the Level panel.
   Import accepts level JSON, a `.js` with an exported JSON object, or the old ASCII tile format.

Shortcuts: Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/redo, Ctrl+D duplicate, Delete, Esc,
Space/middle-drag pan, wheel zoom, ▶ Playtest runs the real engine in place (Esc stops).

## Mechanics

- Run with acceleration/deceleration, turn boost, per-surface friction (ice).
- Slopes and curves: on the ground the ball follows the surface tangent (no stair-stepping),
  climbs and descends ramps, hugs hills, and slides down slippery slopes.
- Jump with variable height (release early), coyote time, jump buffering, apex hang,
  faster fall gravity, fall-speed cap.
- Walls are inert: no wall slide, no wall jump.
- One-way platforms (drop through; only the upward-facing side is solid), bouncy surfaces,
  hazards (respawn).
- Dynamic objects: crates, heavy crates and balls are rigid bodies with rotation and friction.
  Push them (heavier ones slow you down), stack them, stand on them, knock them onto bouncy surfaces.
  Balls collide with the exact level polygon; crates collide with its convex decomposition.
  The player is mirrored into the rigid world as a proxy body each step (see
  `GameScene._stepObjects`), so the platformer motor keeps its feel.
- Rolling ball visuals with landing squash aligned to the surface; render interpolation on a
  fixed 120 Hz step.

## Level format

```json
{
  "name": "MY_LEVEL", "width": 1600, "height": 576,
  "spawn": { "x": 80, "y": 496 },
  "shapes": [
    { "type": "solid", "nodes": [{ "x": 0, "y": 544 }, { "x": 1600, "y": 544 }, { "x": 1600, "y": 576 }, { "x": 0, "y": 576 }] },
    { "type": "ice",   "nodes": [{ "x": 300, "y": 544, "cx": 400, "cy": 400 }, { "x": 500, "y": 544 }] }
  ],
  "entities": [{ "type": "crate", "x": 700, "y": 520 }]
}
```

A node's optional `cx`/`cy` is the quadratic control point of the segment from that node to
the next. Shapes may be concave; winding doesn't matter. `Level.fromAscii` still converts the
old tile format (`#` solid, `~` ice, `B` bouncy, `-` one-way, `^` hazard, `P` spawn,
`c`/`h`/`o` crate / heavy crate / ball).

## Layout

```
src/app.js                   page entry: mode bar (Play / Editor), one shared canvas
src/config.js                all tunables
src/core/Engine.js           fixed-timestep loop, interpolation alpha, resize
src/core/Input.js            action bindings, per-step edge latching
src/core/EventBus.js         pub/sub used for player:jump, player:land, player:died ...
src/math/MathUtil.js         clamp/lerp/approach/damp + Vec2
src/math/Geometry.js         polygon utils: curve flattening, point-in-polygon, ear clipping, convex decomposition
src/physics/Collision.js     circle vs arbitrary closed polygon (per-face contacts, corner merging)
src/physics/SpatialHash.js   broadphase for shapes
src/physics/CircleBody.js    dynamic circle + contact state
src/physics/PhysicsWorld.js  substepped integration, overlap resolution, contact classification
src/physics/RigidBody.js     circle / convex polygon / static terrain rigid body with rotation + mass properties
src/physics/RigidWorld.js    SAT/clipping contacts, sequential-impulse solver with friction (objects)
src/player/PlatformerMotor.js  input + contacts -> velocity (slope following, no rendering, no collision)
src/player/Ball.js           body + motor + rolling visuals
src/world/Materials.js       registry of surface materials
src/world/Shape.js           editable closed path -> flattened polygon + edges
src/world/Level.js           level data (JSON in/out) + ASCII converter
src/world/Entities.js        crate/ball definitions -> rigid bodies, shapes -> static terrain + convex pieces, drawing
src/render/Camera.js         smooth follow, bounds clamp
src/render/Renderer.js       shape / grid / bounds drawing (material styles)
src/render/DebugOverlay.js   diagnostics
src/scenes/GameScene.js      composes everything
src/levels/level1.js         sample level (tiles converted + a few slopes and curves)
src/editor/Editor.js         vector editor: draw/move shapes, nodes, curves, objects, undo/redo, import/export, playtest
test/physics.test.js         node tests: `node test/physics.test.js`
```

## Extending

- **New object type**: add an entry to `ENTITY_DEFS` in `src/world/Entities.js`, a tool in the
  editor's `OBJECT_TOOLS`, and (optionally) a legend character in `Level.DEFAULT_LEGEND`.
- **New material**: `registerMaterial('mud', { label: 'Mud', color: '#654', friction: 0.4 })` in
  `src/world/Materials.js` (or anywhere before levels are built), then add it to the editor's
  `MATERIAL_TOOLS`. Give the material a `draw(ctx, shape)` to customise its look
  (`Renderer.tracePath(ctx, shape)` builds the path with curves).
- **Feel**: edit `CONFIG.player` / `CONFIG.physics`. Everything is in px, px/s, px/s², s.
- **Other controllers**: `PlatformerMotor.update(dt, command)` takes a plain
  `{moveX, down, jumpPressed, jumpHeld}` object, so AI or replay input plugs in without
  touching the motor.
- **Events**: `scene.events.on('player:land', ({speed}) => ...)` for sound/particles.
