import { Shape } from './Shape.js';
import { Switch } from './Switch.js';
import { Tube } from './Tube.js';
import { Checkpoint } from './Checkpoint.js';

/** Character -> material (or special marker) used by Level.fromAscii. */
export const DEFAULT_LEGEND = {
  '#': 'solid',
  '~': 'ice',
  'B': 'bouncy',
  '-': 'oneway',
  '^': 'hazard',
  'P': 'spawn',
  'c': 'crate',
  'h': 'heavy',
  'o': 'ball',
};

/** Legend values that place a dynamic object (see world/Entities.js) instead of geometry. */
export const ENTITY_TYPES = new Set(['crate', 'heavy', 'ball']);

/**
 * Level data: free-form shapes, dynamic objects, spawn point and pixel bounds.
 * The canonical format is JSON (see toJSON); fromAscii converts the old tile format.
 */
export class Level {
  constructor({ shapes = [], entities = [], switches = [], tubes = [], checkpoints = [], spawn = { x: 64, y: 64 }, width = 1600, height = 576, name = 'level' } = {}) {
    this.shapes = shapes;
    /** Dynamic objects: {type, x, y} with x/y the centre in px. */
    this.entities = entities;
    /** Pressure plates that power shapes sharing their channel. */
    this.switches = switches;
    /** Transport tubes. */
    this.tubes = tubes;
    /** Flags the player respawns at once touched. */
    this.checkpoints = checkpoints;
    this.spawn = { x: spawn.x, y: spawn.y };
    this.width = width;
    this.height = height;
    this.name = name;
  }

  toJSON() {
    return {
      name: this.name,
      width: this.width,
      height: this.height,
      spawn: { x: this.spawn.x, y: this.spawn.y },
      shapes: this.shapes.map((s) => s.toJSON()),
      entities: this.entities.map((e) => ({ type: e.type, x: e.x, y: e.y })),
      switches: this.switches.map((s) => s.toJSON()),
      tubes: this.tubes.map((t) => t.toJSON()),
      checkpoints: this.checkpoints.map((c) => c.toJSON()),
    };
  }

  static fromJSON(data, { name } = {}) {
    if (!data || typeof data !== 'object') throw new Error('Invalid level data');
    // Two nodes are enough when a segment is curved (a lens / hill).
    const shapes = (data.shapes || []).filter((s) => s && Array.isArray(s.nodes) && s.nodes.length >= 2).map((s) => new Shape(s));
    // Levels arrive from localStorage and imported files, so unknown entity types are dropped
    // rather than left to blow up in the renderer.
    const entities = (data.entities || [])
      .filter((e) => e && ENTITY_TYPES.has(e.type) && Number.isFinite(+e.x) && Number.isFinite(+e.y))
      .map((e) => ({ type: e.type, x: +e.x, y: +e.y }));
    const switches = (data.switches || []).map((s) => new Switch(s));
    const tubes = (data.tubes || []).filter((t) => t && Array.isArray(t.nodes) && t.nodes.length >= 2).map((t) => new Tube(t));
    const checkpoints = (data.checkpoints || [])
      .filter((c) => c && Number.isFinite(+c.x) && Number.isFinite(+c.y)).map((c) => new Checkpoint(c));
    return new Level({
      shapes, entities, switches, tubes, checkpoints,
      spawn: data.spawn || { x: 64, y: 64 },
      width: +data.width || 1600,
      height: +data.height || 576,
      name: name || data.name || 'level',
    });
  }

  /** An empty level bordered with solid walls and a spawn near the bottom-left. */
  static blank(width = 1600, height = 1024, border = 32) {
    const shapes = [
      Shape.rect(0, 0, width, border),
      Shape.rect(0, height - border, width, border),
      Shape.rect(0, border, border, height - border * 2),
      Shape.rect(width - border, border, border, height - border * 2),
    ];
    return new Level({ shapes, spawn: { x: border * 2.5, y: height - border * 2.5 }, width, height, name: 'LEVEL_CUSTOM' });
  }

  /** Whether the level can be played: has a spawn and some geometry. */
  get playable() { return this.shapes.length > 0 && Number.isFinite(this.spawn.x) && Number.isFinite(this.spawn.y); }

  /**
   * Converts the tile format. Runs of identical tiles merge into rectangles (horizontally,
   * then vertically) so the ball never rolls across internal tile seams.
   */
  static fromAscii(rows, { tileSize = 32, legend = DEFAULT_LEGEND, name = 'level' } = {}) {
    if (typeof rows === 'string') rows = rows.replace(/^\n+|\n+$/g, '').split('\n');
    const cols = Math.max(...rows.map((r) => r.length));
    const tiles = rows.map((r) => r.padEnd(cols, ' '));
    const spawn = { x: tileSize, y: tileSize };
    const rects = [];
    const entities = [];

    let open = new Map(); // key "x:w:type" -> rect from the previous row
    for (let ry = 0; ry < tiles.length; ry++) {
      const row = tiles[ry];
      const next = new Map();
      let cx = 0;
      while (cx < cols) {
        const ch = row[cx];
        const type = legend[ch];
        if (ch === ' ' || type === undefined) { cx++; continue; }
        if (type === 'spawn') {
          spawn.x = (cx + 0.5) * tileSize;
          spawn.y = (ry + 0.5) * tileSize;
          cx++; continue;
        }
        if (ENTITY_TYPES.has(type)) {
          entities.push({ type, x: (cx + 0.5) * tileSize, y: (ry + 0.5) * tileSize });
          cx++; continue;
        }
        let run = 1;
        while (cx + run < cols && row[cx + run] === ch) run++;
        const key = `${cx}:${run}:${type}`;
        const above = open.get(key);
        if (above && type !== 'oneway') {
          above.h += tileSize;
          next.set(key, above);
        } else {
          const r = { x: cx * tileSize, y: ry * tileSize, w: run * tileSize, h: tileSize, type };
          rects.push(r);
          next.set(key, r);
        }
        cx += run;
      }
      open = next;
    }

    const shapes = rects.map((r) => Shape.rect(r.x, r.y, r.w, r.h, r.type));
    return new Level({ shapes, entities, spawn, width: cols * tileSize, height: tiles.length * tileSize, name });
  }
}
