# Graph Report - .  (2026-09-04)

## Corpus Check
- Corpus is ~14,042 words - fits in a single context window. You may not need a graph.

## Summary
- 243 nodes · 447 edges · 16 communities (8 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.77)
- Token cost: 55,530 input · 0 output

## Community Hubs (Navigation)
- App Bootstrap & Level Config
- Player Motor & Circle Physics
- Rigid Body Collision Engine
- Entity Rendering & Debug Overlay
- Level Editor & Camera
- Project Overview & Module Index
- Physics World Simulation
- Game Scene Lifecycle
- Input Handling
- Vector Math (Vec2)
- Core Game Engine Loop
- Player Ball & Proxy Body
- Spatial Hash Broadphase
- Renderer Drawing
- Event Bus
- Editor Legend

## God Nodes (most connected - your core abstractions)
1. `Engine` - 15 edges
2. `Input` - 15 edges
3. `PhysicsWorld` - 15 edges
4. `GameScene` - 15 edges
5. `Vec2` - 14 edges
6. `Renderer` - 13 edges
7. `EditorGrid` - 12 edges
8. `RigidWorld` - 12 edges
9. `Ball` - 11 edges
10. `Camera` - 11 edges

## Surprising Connections (you probably didn't know these)
- `#game canvas` --shares_data_with--> `Engine`  [INFERRED]
  index.html → src/core/Engine.js
- `#sidebar (editor tools/size/level/playtest panel)` --shares_data_with--> `EditorGrid`  [INFERRED]
  index.html → src/editor/EditorGrid.js
- `GameScene._stepObjects` --conceptually_related_to--> `RigidWorld`  [INFERRED]
  README.md → src/physics/RigidWorld.js
- `#game canvas` --shares_data_with--> `Renderer`  [INFERRED]
  index.html → src/render/Renderer.js
- `GameScene._stepObjects` --conceptually_related_to--> `Ball`  [INFERRED]
  README.md → src/player/Ball.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Play/Editor Mode Switching UI** — index_html_modebar, src_app_app, readme_play_mode, readme_editor_mode [INFERRED 0.80]
- **Dynamic Rigid-Body Objects (crates/balls) System** — src_physics_rigidbody_rigidbody, src_physics_rigidworld_rigidworld, src_world_entities_entities, src_player_ball_ball [INFERRED 0.85]
- **Level Editor Architecture** — src_editor_editor_editor, src_editor_editorgrid_editorgrid, index_html_sidebar, src_world_level_level [INFERRED 0.85]

## Communities (16 total, 8 thin omitted)

### Community 0 - "App Bootstrap & Level Config"
Cohesion: 0.08
Nodes (18): canvas, helpEl, modeButtons, MODES, pickPlayLevel(), sidebar, statusEl, CONFIG (+10 more)

### Community 1 - "Player Motor & Circle Physics"
Cohesion: 0.14
Nodes (8): approach(), clamp(), damp(), lerp(), sign(), CircleBody, MotorState, PlatformerMotor

### Community 2 - "Rigid Body Collision Engine"
Cohesion: 0.17
Nodes (11): aabbOverlap(), circleCircle(), circlePoly(), clip(), collide(), contact(), leastPenetration(), _lp (+3 more)

### Community 3 - "Entity Rendering & Debug Overlay"
Cohesion: 0.17
Nodes (10): rectVerts(), RigidBody, DebugOverlay, surfaceCache, createEntityBody(), createWallBodies(), drawBallShape(), drawBody() (+2 more)

### Community 4 - "Level Editor & Camera"
Cohesion: 0.12
Nodes (4): createEditor(), TOOLS, EditorGrid, Camera

### Community 5 - "Project Overview & Module Index"
Cohesion: 0.13
Nodes (17): #game canvas, #modebar (Play/Editor mode buttons), #sidebar (editor tools/size/level/playtest panel), Ball Platformer Engine, Editor Mode, PlatformerMotor Plain-Command Interface (rationale: decouples input source from motor so AI/replay input can drive it), Play Mode, src/app.js (page entry: mode bar, shared canvas) (+9 more)

### Community 6 - "Physics World Simulation"
Cohesion: 0.25
Nodes (3): circleVsAABB(), PhysicsWorld, makeWorld()

### Community 11 - "Player Ball & Proxy Body"
Cohesion: 0.20
Nodes (3): Player-as-Proxy-Body Mirroring (rationale: keeps platformer motor's feel while participating in rigid-body world), Ball, GameScene._stepObjects

## Knowledge Gaps
- **19 isolated node(s):** `canvas`, `sidebar`, `statusEl`, `helpEl`, `modeButtons` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Input` connect `Input Handling` to `App Bootstrap & Level Config`, `Project Overview & Module Index`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `PhysicsWorld` connect `Physics World Simulation` to `App Bootstrap & Level Config`, `Entity Rendering & Debug Overlay`, `Spatial Hash Broadphase`, `Project Overview & Module Index`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `Vec2` connect `Vector Math (Vec2)` to `Player Motor & Circle Physics`, `Entity Rendering & Debug Overlay`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **What connects `canvas`, `sidebar`, `statusEl` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Bootstrap & Level Config` be split into smaller, more focused modules?**
  _Cohesion score 0.08232118758434548 - nodes in this community are weakly interconnected._
- **Should `Player Motor & Circle Physics` be split into smaller, more focused modules?**
  _Cohesion score 0.1422924901185771 - nodes in this community are weakly interconnected._
- **Should `Level Editor & Camera` be split into smaller, more focused modules?**
  _Cohesion score 0.12105263157894737 - nodes in this community are weakly interconnected._