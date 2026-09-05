import { CONFIG } from '../config.js';
import { Engine } from '../core/Engine.js';
import { Input } from '../core/Input.js';
import { Level } from '../world/Level.js';
import { Shape } from '../world/Shape.js';
import { Materials } from '../world/Materials.js';
import { GameScene } from '../scenes/GameScene.js';
import { Renderer } from '../render/Renderer.js';
import { Camera } from '../render/Camera.js';
import { ENTITY_DEFS, drawEntityPreview, drawSpawn } from '../world/Entities.js';
import { Switch, SWITCH_ACCEPTS } from '../world/Switch.js';
import { Tube } from '../world/Tube.js';
import { Checkpoint } from '../world/Checkpoint.js';
import { quadPoint, pointInPolygon } from '../math/Geometry.js';

const STORAGE_KEY = 'ballplatformer.editor.v2';
const LEGACY_STORAGE_KEY = 'ballplatformer.editor.v1'; // tile-era ASCII levels, converted on first load

export const MATERIAL_TOOLS = ['solid', 'ice', 'bouncy', 'oneway', 'hazard'].map((type, i) => ({
  type, label: Materials[type].label, color: Materials[type].color, key: String(i + 1),
}));
export const OBJECT_TOOLS = [
  { type: 'spawn', label: 'Spawn', color: CONFIG.render.ballColor, key: '6' },
  { type: 'crate', label: 'Crate', color: ENTITY_DEFS.crate.color, key: '7' },
  { type: 'heavy', label: 'Heavy', color: ENTITY_DEFS.heavy.color, key: '8' },
  { type: 'ball',  label: 'Ball',  color: ENTITY_DEFS.ball.color,  key: '9' },
  { type: 'switch', label: 'Switch', color: '#ffffff', key: 'e' },
  { type: 'tube',   label: 'Tube',   color: '#cfefff', key: 't' },
  { type: 'checkpoint', label: 'Checkpoint', color: CONFIG.render.checkpointOn, key: 'c' },
];

/** Read the editor's saved level (plain JSON) without starting the editor. */
export function loadSavedLevel() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const data = JSON.parse(legacy);
      if (data.ascii) return Level.fromAscii(data.ascii, { tileSize: CONFIG.tileSize, name: data.name || 'LEVEL_CUSTOM' }).toJSON();
    }
    return null;
  } catch { return null; }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Mounts the level editor onto `canvas`, wiring the sidebar controls (looked up by id).
 * Levels are free-form: closed shapes with draggable nodes and optional curved segments.
 * Returns { stop() } which tears down every listener, loop and playtest.
 */
export function createEditor({ canvas, statusEl }) {
  const ctx = canvas.getContext('2d');
  const ac = new AbortController();
  const signal = ac.signal;
  const $ = (id) => document.getElementById(id);

  const renderer = new Renderer(CONFIG.render);
  const camera = new Camera(CONFIG.camera);
  camera.bounds = null;

  let level = loadSaved() ?? Level.blank();
  let material = MATERIAL_TOOLS[0].type;
  let mode = 'select';                   // 'select' (drag on empty space pans) | 'draw' (drag draws a rectangle)
  let objectTool = null;                 // null | 'spawn' | 'crate' | 'heavy' | 'ball'
  let selected = null;                   // {kind:'shape'|'entity'|'switch'|'tube', ...} | null
  let channel = 'a';                     // channel new switches and doors are wired to
  let accepts = 'any';                   // what new switches respond to
  let latch = false;                     // whether new switches stay pressed once triggered
  let tubeRadius = 22;
  let pendingTube = null;                // nodes collected while the tube tool is drawing
  let hoverWorld = { x: 0, y: 0 };
  let hoverHit = null;
  let drag = null;
  let isPanning = false, panLast = null;
  let spaceDown = false, shiftDown = false;
  let undoStack = [], redoStack = [];
  let snap = true;
  let gridSize = CONFIG.editor.gridSize;
  let playtest = null;                   // { engine, input } while active
  let rafId = 0;
  let saveTimer = 0;
  let statusOverrideUntil = 0;

  // ---- Persistence ----
  function loadSaved() {
    try {
      const data = loadSavedLevel();
      if (!data) return null;
      const lvl = Level.fromJSON(data);
      $('level-name').value = lvl.name || 'LEVEL_CUSTOM';
      return lvl;
    } catch { return null; }
  }

  function saveNow() {
    try {
      level.name = $('level-name').value.trim() || 'LEVEL_CUSTOM';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(level.toJSON()));
    } catch { /* storage unavailable, ignore */ }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  function markDirty() {
    scheduleSave();
    refreshSelectionInfo();
  }

  function snapshot() { level.name = $('level-name').value; return JSON.stringify(level.toJSON()); }

  const SEL_FIELD = { shape: 'shape', entity: 'entity', switch: 'sw', tube: 'tube', checkpoint: 'cp' };

  function restore(json) {
    const kind = selected?.kind;
    const [oldList, item] = listFor(selected);
    const keep = oldList ? oldList.indexOf(item) : -1;
    level = Level.fromJSON(JSON.parse(json));
    $('level-name').value = level.name;
    selected = null;
    if (kind && keep >= 0) {
      const list = { shape: level.shapes, entity: level.entities, switch: level.switches, tube: level.tubes, checkpoint: level.checkpoints }[kind];
      if (list?.[keep]) selected = { kind, [SEL_FIELD[kind]]: list[keep] };
    }
    syncLevelInputs();
    refreshChannelList();
    markDirty();
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }

  function undo() {
    const prev = undoStack.pop();
    if (prev === undefined) return;
    redoStack.push(snapshot());
    restore(prev);
  }

  function redo() {
    const next = redoStack.pop();
    if (next === undefined) return;
    undoStack.push(snapshot());
    restore(next);
  }

  function replaceLevel(lvl) {
    pushUndo();
    level = lvl;
    selected = null;
    $('level-name').value = lvl.name;
    syncLevelInputs();
    markDirty();
    camera.snapTo(level.spawn.x, level.spawn.y);
  }

  // ---- Canvas / camera ----
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    return { w, h, dpr };
  }

  function worldFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    return { x: camera.x + sx / camera.zoom, y: camera.y + sy / camera.zoom };
  }

  function snapValue(v) { return snap && !shiftDown ? Math.round(v / gridSize) * gridSize : v; }
  function snapPoint(p) { return { x: snapValue(p.x), y: snapValue(p.y) }; }
  const handleR = () => CONFIG.editor.handleRadius / camera.zoom;

  // ---- Geometry helpers (shapes are closed paths, tubes are open ones) ----
  const isClosed = (o) => !(o instanceof Tube);
  const segCount = (o) => o.nodes.length - (isClosed(o) ? 0 : 1);
  /** The path object of a selection that has editable nodes, or null. */
  const pathOf = (sel) => (sel?.kind === 'shape' ? sel.shape : sel?.kind === 'tube' ? sel.tube : null);

  function midpoint(o, i) {
    const n = o.nodes.length;
    const a = o.nodes[i], b = o.nodes[(i + 1) % n];
    if (a.cx != null) return quadPoint(a, { x: a.cx, y: a.cy }, b, 0.5);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function insertNode(o, i) {
    const n = o.nodes.length;
    const a = o.nodes[i], b = o.nodes[(i + 1) % n];
    let node;
    if (a.cx != null) {
      const c = { x: a.cx, y: a.cy };
      const m = quadPoint(a, c, b, 0.5);
      a.cx = (a.x + c.x) / 2; a.cy = (a.y + c.y) / 2;
      node = { x: m.x, y: m.y, cx: (c.x + b.x) / 2, cy: (c.y + b.y) / 2 };
    } else {
      node = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, cx: null, cy: null };
    }
    o.nodes.splice(i + 1, 0, node);
    rebuildPath(o);
    return i + 1;
  }

  function deleteNode(o, i) {
    const min = isClosed(o) ? 3 : 2;
    if (o.nodes.length <= min) { flashStatus(`Needs at least ${min} nodes`); return; }
    o.nodes.splice(i, 1);
    rebuildPath(o);
  }

  /** Bend segment i so the curve passes through `p` at its midpoint. */
  function bendSegment(o, i, p) {
    const n = o.nodes.length;
    const a = o.nodes[i], b = o.nodes[(i + 1) % n];
    a.cx = 2 * p.x - (a.x + b.x) / 2;
    a.cy = 2 * p.y - (a.y + b.y) / 2;
    rebuildPath(o);
  }

  function moveNode(o, i, p) {
    const n = o.nodes.length;
    const node = o.nodes[i];
    const prev = isClosed(o) || i > 0 ? o.nodes[(i + n - 1) % n] : null;
    const dx = p.x - node.x, dy = p.y - node.y;
    node.x = p.x; node.y = p.y;
    // Controls of the two adjacent segments follow by half so the curves keep their shape relative to the chord.
    if (node.cx != null) { node.cx += dx / 2; node.cy += dy / 2; }
    if (prev?.cx != null) { prev.cx += dx / 2; prev.cy += dy / 2; }
    rebuildPath(o);
  }

  /** Shapes track a resting pose for their door motion; tubes just rebuild. */
  function rebuildPath(o) {
    o.rebuild();
    if (isClosed(o)) o.syncBase();
  }

  function entityRadius(e) { return (ENTITY_DEFS[e.type].size * CONFIG.tileSize) / 2; }

  /** Distance from `p` to a tube's centreline. */
  function tubeDistance(t, p) {
    let best = Infinity;
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1], b = t.points[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u)));
    }
    return best;
  }

  /** What is under the cursor: handles of the selected path first, then elements. */
  function hitTest(w) {
    const hr = handleR();
    const path = pathOf(selected);
    if (path) {
      const kind = selected.kind, ref = kind === 'shape' ? { shape: path } : { tube: path };
      const n = path.nodes.length;
      for (let i = 0; i < n; i++) if (dist(w, path.nodes[i]) <= hr) return { kind: 'node', ...ref, path, index: i };
      for (let i = 0; i < segCount(path); i++) {
        const nd = path.nodes[i];
        if (nd.cx != null && dist(w, { x: nd.cx, y: nd.cy }) <= hr) return { kind: 'ctrl', ...ref, path, index: i };
      }
      for (let i = 0; i < segCount(path); i++) if (dist(w, midpoint(path, i)) <= hr) return { kind: 'mid', ...ref, path, index: i };
    }
    if (dist(w, level.spawn) <= CONFIG.player.radius + 2 / camera.zoom) return { kind: 'spawn' };
    const inBox = (r, pad = 0) => w.x >= r.x - pad && w.x <= r.x + r.w + pad && w.y >= r.y - pad && w.y <= r.y + r.h + pad;
    for (let i = level.switches.length - 1; i >= 0; i--) {
      const s = level.switches[i];
      if (inBox(s.rect, 4)) return { kind: 'switch', sw: s };
    }
    for (let i = level.checkpoints.length - 1; i >= 0; i--) {
      const c = level.checkpoints[i];
      if (inBox(c.rect, 4)) return { kind: 'checkpoint', cp: c };
    }
    for (let i = level.entities.length - 1; i >= 0; i--) {
      const e = level.entities[i];
      if (dist(w, e) <= entityRadius(e)) return { kind: 'entity', entity: e };
    }
    for (let i = level.tubes.length - 1; i >= 0; i--) {
      const t = level.tubes[i];
      if (t.usable && tubeDistance(t, w) <= t.radius) return { kind: 'tube', tube: t };
    }
    for (let i = level.shapes.length - 1; i >= 0; i--) {
      const s = level.shapes[i];
      if (w.x < s.x || w.x > s.right || w.y < s.y || w.y > s.bottom) continue;
      if (pointInPolygon(w.x, w.y, s.points)) return { kind: 'shape', shape: s };
    }
    return null;
  }

  function select(sel) {
    selected = sel;
    refreshSelectionInfo();
  }

  /** The array a selected element lives in, so delete/duplicate stay generic. */
  function listFor(sel) {
    switch (sel?.kind) {
      case 'shape': return [level.shapes, sel.shape];
      case 'entity': return [level.entities, sel.entity];
      case 'switch': return [level.switches, sel.sw];
      case 'tube': return [level.tubes, sel.tube];
      case 'checkpoint': return [level.checkpoints, sel.cp];
      default: return [null, null];
    }
  }

  function deleteSelected() {
    const [list, item] = listFor(selected);
    if (!list) return;
    pushUndo();
    list.splice(list.indexOf(item), 1);
    selected = null;
    markDirty();
  }

  function duplicateSelected() {
    if (!selected) return;
    pushUndo();
    const off = gridSize * 2;
    if (selected.kind === 'shape') {
      const copy = selected.shape.clone().translate(off, off);
      level.shapes.push(copy);
      selected = { kind: 'shape', shape: copy };
    } else if (selected.kind === 'tube') {
      const copy = selected.tube.clone().translate(off, off);
      level.tubes.push(copy);
      selected = { kind: 'tube', tube: copy };
    } else if (selected.kind === 'switch') {
      const s = new Switch({ ...selected.sw.toJSON(), x: selected.sw.x + off, y: selected.sw.y + off });
      level.switches.push(s);
      selected = { kind: 'switch', sw: s };
    } else if (selected.kind === 'checkpoint') {
      const c = new Checkpoint({ ...selected.cp.toJSON(), x: selected.cp.x + off, y: selected.cp.y + off });
      level.checkpoints.push(c);
      selected = { kind: 'checkpoint', cp: c };
    } else {
      const e = { ...selected.entity, x: selected.entity.x + off, y: selected.entity.y + off };
      level.entities.push(e);
      selected = { kind: 'entity', entity: e };
    }
    markDirty();
  }

  function straightenSelected() {
    const path = pathOf(selected);
    if (!path) return;
    pushUndo();
    for (const n of path.nodes) { n.cx = null; n.cy = null; }
    rebuildPath(path);
    markDirty();
  }

  // ---- Render loop (editor mode only; playtest owns the canvas via Engine) ----
  function frame() {
    rafId = requestAnimationFrame(frame);
    const { w, h, dpr } = fitCanvas();
    camera.setView(w, h);
    camera.prevX = camera.x; camera.prevY = camera.y;

    renderer.clear(ctx);
    camera.applyTo(ctx, dpr, 1);
    const rect = camera.visibleRect(1);
    renderer.drawGrid(ctx, rect, gridSize, 4);
    renderer.drawBounds(ctx, level);
    renderer.drawShapes(ctx, level.shapes, rect);
    renderer.drawSwitches(ctx, level.switches, rect);
    renderer.drawCheckpoints(ctx, level.checkpoints, rect);
    for (const e of level.entities) drawEntityPreview(ctx, e, CONFIG.tileSize);
    drawSpawn(ctx, level.spawn.x, level.spawn.y, CONFIG.player.radius, CONFIG.render.ballColor);
    renderer.drawTubes(ctx, level.tubes, rect);
    drawDoorHints(ctx);
    drawOverlay(ctx);

    if (Date.now() > statusOverrideUntil) {
      const p = hoverWorld;
      const tool = objectTool ? `place ${objectTool}` : mode === 'draw' ? `draw ${Materials[material].label}` : 'select / pan';
      statusEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}  |  ${tool}  |  ${hoverText()}  |  zoom ${camera.zoom.toFixed(2)}x`;
    }
  }

  function hoverText() {
    if (drag) return drag.kind === 'rect' ? `${Math.abs(Math.round(drag.cur.x - drag.start.x))} × ${Math.abs(Math.round(drag.cur.y - drag.start.y))}` : drag.kind;
    const h = hoverHit;
    if (!h) return objectTool ? 'click to place' : mode === 'draw' ? 'drag to draw' : 'drag to pan';
    switch (h.kind) {
      case 'node': return `node ${h.index}`;
      case 'ctrl': return `curve control ${h.index}`;
      case 'mid': return 'midpoint: click to add node, drag to bend';
      case 'shape': return `${Materials[h.shape.type].label}${h.shape.isDoor ? ` door "${h.shape.channel}"` : ' shape'} (${h.shape.nodes.length} nodes)`;
      case 'entity': return ENTITY_DEFS[h.entity.type].label;
      case 'switch': return `switch "${h.sw.channel}" · ${SWITCH_ACCEPTS[h.sw.accepts].label}${h.sw.latch ? ' · one-time' : ''}`;
      case 'checkpoint': return 'checkpoint';
      case 'tube': return `tube (${h.tube.nodes.length} nodes, ${Math.round(h.tube.length)}px)`;
      case 'spawn': return 'spawn';
      default: return '';
    }
  }

  /** Show where each door travels when its channel is powered, and which switches drive it. */
  function drawDoorHints(ctx) {
    const z = camera.zoom;
    ctx.save();
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.lineWidth = 1.5 / z;
    for (const s of level.shapes) {
      if (!s.isDoor) continue;
      const cx = s.centerX, cy = s.centerY;
      ctx.strokeStyle = 'rgba(11,99,197,0.75)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + s.move.dx, cy + s.move.dy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx + s.move.dx, cy + s.move.dy, 4 / z, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11,99,197,0.75)';
      ctx.fill();
      ctx.setLineDash([5 / z, 4 / z]);
      ctx.fillStyle = '#0b63c5';
      ctx.font = `${11 / z}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(String(s.channel).toUpperCase(), cx, cy);
      ctx.textAlign = 'start';
    }
    ctx.restore();
  }

  function drawOverlay(ctx) {
    const z = camera.zoom;
    const hr = handleR();

    // hover outline for unselected shapes / objects
    if (!drag && hoverHit?.kind === 'shape' && hoverHit.shape !== selected?.shape) {
      Renderer.tracePath(ctx, hoverHit.shape);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = 'rgba(11,99,197,0.7)';
      ctx.stroke();
    }

    if (selected?.kind === 'entity') {
      const e = selected.entity;
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.strokeStyle = '#0b63c5';
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(e.x, e.y, entityRadius(e) + 4 / z, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (selected?.kind === 'switch' || selected?.kind === 'checkpoint') {
      const r = (selected.sw ?? selected.cp).rect;
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.strokeStyle = '#0b63c5';
      ctx.lineWidth = 1.5 / z;
      ctx.strokeRect(r.x - 3 / z, r.y - 3 / z, r.w + 6 / z, r.h + 6 / z);
      ctx.setLineDash([]);
    }

    const sel = pathOf(selected);
    if (sel) {
      const n = sel.nodes.length, segs = segCount(sel);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = '#0b63c5';
      if (isClosed(sel)) {
        Renderer.tracePath(ctx, sel);
      } else {
        ctx.beginPath();
        ctx.moveTo(sel.points[0].x, sel.points[0].y);
        for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x, sel.points[i].y);
      }
      ctx.stroke();

      // control polygons
      ctx.setLineDash([3 / z, 3 / z]);
      ctx.lineWidth = 1 / z;
      ctx.strokeStyle = 'rgba(11,99,197,0.6)';
      ctx.beginPath();
      for (let i = 0; i < segs; i++) {
        const a = sel.nodes[i], b = sel.nodes[(i + 1) % n];
        if (a.cx == null) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(a.cx, a.cy); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // midpoint handles
      for (let i = 0; i < segs; i++) {
        const m = midpoint(sel, i);
        const hot = hoverHit?.kind === 'mid' && hoverHit.index === i;
        ctx.beginPath(); ctx.arc(m.x, m.y, (hot ? hr : hr * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#0b63c5' : 'rgba(23,28,39,0.9)';
        ctx.fill();
        ctx.lineWidth = 1.25 / z;
        ctx.strokeStyle = hot ? '#ffffff' : 'rgba(11,99,197,0.8)';
        ctx.stroke();
      }
      // control handles
      for (let i = 0; i < segs; i++) {
        const a = sel.nodes[i];
        if (a.cx == null) continue;
        const hot = hoverHit?.kind === 'ctrl' && hoverHit.index === i;
        const r = hot ? hr : hr * 0.75;
        ctx.beginPath();
        ctx.moveTo(a.cx, a.cy - r); ctx.lineTo(a.cx + r, a.cy); ctx.lineTo(a.cx, a.cy + r); ctx.lineTo(a.cx - r, a.cy); ctx.closePath();
        ctx.fillStyle = hot ? '#f9c74f' : '#e0a83a';
        ctx.fill();
        ctx.lineWidth = 1.25 / z; ctx.strokeStyle = '#161a23'; ctx.stroke();
      }
      // node handles
      for (let i = 0; i < n; i++) {
        const a = sel.nodes[i];
        const hot = hoverHit?.kind === 'node' && hoverHit.index === i;
        ctx.beginPath(); ctx.arc(a.x, a.y, hot ? hr * 1.2 : hr, 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#ffffff' : '#0b63c5';
        ctx.fill();
        ctx.lineWidth = 1.5 / z; ctx.strokeStyle = '#161a23'; ctx.stroke();
      }
    }

    // tube being drawn
    if (pendingTube) {
      const pts = [...pendingTube, snapPoint(hoverWorld)];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = tubeRadius * 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.strokeStyle = '#0b63c5';
      ctx.lineWidth = 2 / z;
      ctx.stroke();
      for (const p of pendingTube) {
        ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, Math.PI * 2);
        ctx.fillStyle = '#0b63c5'; ctx.fill();
        ctx.lineWidth = 1.5 / z; ctx.strokeStyle = '#161a23'; ctx.stroke();
      }
    }

    if (drag?.kind === 'rect') {
      const x = Math.min(drag.start.x, drag.cur.x), y = Math.min(drag.start.y, drag.cur.y);
      const w = Math.abs(drag.cur.x - drag.start.x), h = Math.abs(drag.cur.y - drag.start.y);
      ctx.fillStyle = Materials[material].color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = '#0b63c5';
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    if (objectTool && !drag && !isPanning) {
      const p = snapPoint(hoverWorld);
      ctx.globalAlpha = 0.5;
      if (objectTool === 'spawn') {
        drawSpawn(ctx, p.x, p.y, CONFIG.player.radius, CONFIG.render.ballColor);
      } else if (objectTool === 'switch') {
        const sw = new Switch({ x: p.x, y: p.y, channel, accepts, latch });
        ctx.fillStyle = sw.color;
        ctx.beginPath(); ctx.roundRect(sw.rect.x, sw.rect.y, sw.rect.w, sw.rect.h, 3); ctx.fill();
        ctx.lineWidth = 2 / z; ctx.strokeStyle = CONFIG.render.outlineColor; ctx.stroke();
      } else if (objectTool === 'checkpoint') {
        renderer.drawCheckpoints(ctx, [new Checkpoint({ x: p.x, y: p.y })], camera.visibleRect(1));
      } else if (objectTool === 'tube') {
        if (!pendingTube) {
          ctx.lineWidth = 3 / z; ctx.strokeStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(p.x, p.y, tubeRadius, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        drawEntityPreview(ctx, { type: objectTool, x: p.x, y: p.y }, CONFIG.tileSize, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- Mouse ----
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  canvas.addEventListener('mousedown', (e) => {
    if (playtest) return;
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      isPanning = true; panLast = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    const w = worldFromEvent(e);
    const p = snapPoint(w);

    if (e.button === 2) { rightClick(w); return; }
    if (e.button !== 0) return;

    if (objectTool === 'tube') {
      pendingTube = pendingTube ?? [];
      pendingTube.push(p);
      return;
    }
    if (objectTool) {
      pushUndo();
      if (objectTool === 'spawn') {
        level.spawn = { x: p.x, y: p.y };
      } else if (objectTool === 'switch') {
        const sw = new Switch({ x: p.x, y: p.y, channel, accepts, latch });
        level.switches.push(sw);
        select({ kind: 'switch', sw });
        refreshChannelList();
      } else if (objectTool === 'checkpoint') {
        const cp = new Checkpoint({ x: p.x, y: p.y });
        level.checkpoints.push(cp);
        select({ kind: 'checkpoint', cp });
      } else {
        const ent = { type: objectTool, x: p.x, y: p.y };
        level.entities.push(ent);
        select({ kind: 'entity', entity: ent });
      }
      markDirty();
      return;
    }

    const hit = hitTest(w);
    if (!hit) {
      select(null);
      if (mode === 'draw') { drag = { kind: 'rect', start: p, cur: p }; return; }
      isPanning = true; panLast = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    switch (hit.kind) {
      case 'node':
        pushUndo();
        drag = { kind: 'node', path: hit.path, index: hit.index };
        break;
      case 'ctrl':
        pushUndo();
        drag = { kind: 'ctrl', path: hit.path, index: hit.index };
        break;
      case 'mid':
        pushUndo();
        drag = { kind: 'mid', path: hit.path, index: hit.index, start: w, moved: false };
        break;
      case 'spawn':
        pushUndo();
        drag = { kind: 'spawn' };
        break;
      case 'switch':
        select({ kind: 'switch', sw: hit.sw });
        pushUndo();
        drag = { kind: 'point', item: hit.sw, origin: w, start: { x: hit.sw.x, y: hit.sw.y } };
        break;
      case 'checkpoint':
        select({ kind: 'checkpoint', cp: hit.cp });
        pushUndo();
        drag = { kind: 'point', item: hit.cp, origin: w, start: { x: hit.cp.x, y: hit.cp.y } };
        break;
      case 'entity':
        select({ kind: 'entity', entity: hit.entity });
        pushUndo();
        drag = { kind: 'entity', entity: hit.entity, origin: w, start: { x: hit.entity.x, y: hit.entity.y } };
        break;
      case 'shape':
      case 'tube': {
        const path = hit.kind === 'shape' ? hit.shape : hit.tube;
        select(hit.kind === 'shape' ? { kind: 'shape', shape: path } : { kind: 'tube', tube: path });
        pushUndo();
        drag = { kind: 'path', path, origin: w, nodes: path.nodes.map((n) => ({ ...n })), moved: false };
        break;
      }
    }
  }, { signal });

  function rightClick(w) {
    if (pendingTube) { finishTube(); return; }
    const hit = hitTest(w);
    if (!hit) return;
    const drop = (list, item) => { list.splice(list.indexOf(item), 1); if (listFor(selected)[1] === item) selected = null; };
    switch (hit.kind) {
      case 'node': pushUndo(); deleteNode(hit.path, hit.index); break;
      case 'ctrl': pushUndo(); hit.path.nodes[hit.index].cx = hit.path.nodes[hit.index].cy = null; rebuildPath(hit.path); break;
      case 'mid': pushUndo(); insertNode(hit.path, hit.index); break;
      case 'switch': pushUndo(); drop(level.switches, hit.sw); break;
      case 'checkpoint': pushUndo(); drop(level.checkpoints, hit.cp); break;
      case 'entity': pushUndo(); drop(level.entities, hit.entity); break;
      case 'tube': pushUndo(); drop(level.tubes, hit.tube); break;
      case 'shape': pushUndo(); drop(level.shapes, hit.shape); break;
      default: return;
    }
    markDirty();
  }

  function finishTube() {
    const pts = pendingTube;
    pendingTube = null;
    if (!pts || pts.length < 2) { flashStatus('A tube needs at least 2 points'); return; }
    pushUndo();
    const t = new Tube({ nodes: pts, radius: tubeRadius });
    level.tubes.push(t);
    setSelectMode();
    select({ kind: 'tube', tube: t });
    markDirty();
  }

  window.addEventListener('mousemove', (e) => {
    if (playtest) return;
    const w = worldFromEvent(e);
    hoverWorld = w;
    if (isPanning && panLast) {
      camera.x -= (e.clientX - panLast.x) / camera.zoom;
      camera.y -= (e.clientY - panLast.y) / camera.zoom;
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drag) {
      hoverHit = hitTest(w);
      updateCursor();
      return;
    }
    const p = snapPoint(w);
    const d = drag;
    switch (d.kind) {
      case 'rect': d.cur = p; break;
      case 'node': moveNode(d.path, d.index, p); break;
      case 'ctrl': { const nd = d.path.nodes[d.index]; nd.cx = p.x; nd.cy = p.y; rebuildPath(d.path); break; }
      case 'mid':
        if (!d.moved && dist(w, d.start) * camera.zoom > 4) d.moved = true;
        if (d.moved) bendSegment(d.path, d.index, p);
        break;
      case 'spawn': level.spawn = { x: p.x, y: p.y }; break;
      case 'point': {
        const t = snapPoint({ x: d.start.x + (w.x - d.origin.x), y: d.start.y + (w.y - d.origin.y) });
        d.item.x = t.x; d.item.y = t.y;
        break;
      }
      case 'entity': {
        const t = snapPoint({ x: d.start.x + (w.x - d.origin.x), y: d.start.y + (w.y - d.origin.y) });
        d.entity.x = t.x; d.entity.y = t.y;
        break;
      }
      case 'path': {
        // Move so the first node lands on the grid; every node and control follows by the same delta.
        const anchor = d.nodes[0];
        const t = snapPoint({ x: anchor.x + (w.x - d.origin.x), y: anchor.y + (w.y - d.origin.y) });
        const dx = t.x - anchor.x, dy = t.y - anchor.y;
        if (dx !== 0 || dy !== 0) d.moved = true;
        d.path.nodes.forEach((n, i) => {
          const o = d.nodes[i];
          n.x = o.x + dx; n.y = o.y + dy;
          if (o.cx != null) { n.cx = o.cx + dx; n.cy = o.cy + dy; }
        });
        rebuildPath(d.path);
        break;
      }
    }
    markDirty();
  }, { signal });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) { isPanning = false; panLast = null; updateCursor(); }
    if (!drag || playtest) return;
    const d = drag;
    drag = null;
    if (d.kind === 'rect') {
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      if (w >= 2 && h >= 2) {
        pushUndo();
        const s = Shape.rect(x, y, w, h, material);
        level.shapes.push(s);
        select({ kind: 'shape', shape: s });
        markDirty();
      }
    } else if (d.kind === 'mid' && !d.moved) {
      insertNode(d.path, d.index);
      markDirty();
    }
    hoverHit = hitTest(worldFromEvent(e));
    updateCursor();
  }, { signal });

  canvas.addEventListener('wheel', (e) => {
    if (playtest) return;
    e.preventDefault();
    const before = worldFromEvent(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 200 : e.deltaY;
    const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * CONFIG.editor.zoomSpeed);
    camera.zoom = Math.min(6, Math.max(0.15, camera.zoom * factor));
    const after = worldFromEvent(e);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
  }, { passive: false, signal });

  function updateCursor() {
    if (playtest) { canvas.style.cursor = 'default'; return; }
    if (isPanning) { canvas.style.cursor = 'grabbing'; return; }
    if (spaceDown) { canvas.style.cursor = 'grab'; return; }
    if (objectTool) { canvas.style.cursor = 'copy'; return; }
    const k = hoverHit?.kind;
    canvas.style.cursor = k === 'node' || k === 'ctrl' || k === 'mid' ? 'pointer'
      : k === 'shape' || k === 'entity' || k === 'spawn' || k === 'switch' || k === 'tube' || k === 'checkpoint' ? 'move'
      : mode === 'draw' ? 'crosshair' : 'grab';
  }

  // ---- Keyboard ----
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); updateCursor(); }
    if (e.key === 'Shift') shiftDown = true;
    if (playtest) {
      if (e.code === 'Escape') stopPlaytest();
      return;
    }
    const mat = MATERIAL_TOOLS.find((t) => t.key === e.key);
    if (mat) { setMaterial(mat.type); return; }
    const obj = OBJECT_TOOLS.find((t) => t.key === e.key);
    if (obj) { setObjectTool(obj.type); return; }
    if (e.key === '0' || e.key.toLowerCase() === 'v') { setSelectMode(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (hoverHit?.kind === 'node') { pushUndo(); deleteNode(hoverHit.path, hoverHit.index); markDirty(); }
      else deleteSelected();
      return;
    }
    if (e.key === 'Enter' && pendingTube) { e.preventDefault(); finishTube(); return; }
    if (e.code === 'Escape') {
      if (pendingTube) { pendingTube = null; flashStatus('Tube cancelled'); }
      else if (drag) { drag = null; undo(); }
      else if (objectTool || mode === 'draw') setSelectMode();
      else select(null);
    }
  }, { signal });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; updateCursor(); }
    if (e.key === 'Shift') shiftDown = false;
  }, { signal });

  // ---- Toolbar wiring ----
  function makeToolButtons(gridId, tools, onPick, isActive) {
    const grid = $(gridId);
    grid.innerHTML = '';
    for (const t of tools) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.innerHTML = `<span class="swatch" style="background:${t.color}"></span>${t.label}<span class="key">${t.key}</span>`;
      btn.addEventListener('click', () => { onPick(t.type); btn.blur(); }, { signal });
      btn.dataset.type = t.type;
      grid.appendChild(btn);
    }
    return () => { [...grid.children].forEach((b) => b.classList.toggle('active', isActive(b.dataset.type))); };
  }
  const refreshMaterialButtons = makeToolButtons('material-grid', MATERIAL_TOOLS, setMaterial, (t) => !objectTool && mode === 'draw' && t === material);
  const refreshObjectButtons = makeToolButtons('object-grid', OBJECT_TOOLS, setObjectTool, (t) => t === objectTool);
  const selectBtn = $('tool-select');
  selectBtn.addEventListener('click', () => { setSelectMode(); selectBtn.blur(); }, { signal });

  function refreshTools() {
    refreshMaterialButtons(); refreshObjectButtons();
    selectBtn.classList.toggle('active', mode === 'select' && !objectTool);
    updateCursor();
  }

  /** Picking a material arms drawing (drag on empty space) and recolours the selected shape. */
  function setMaterial(type) {
    material = type;
    objectTool = null;
    mode = 'draw';
    if (selected?.kind === 'shape' && selected.shape.type !== type) {
      pushUndo();
      selected.shape.setMaterial(type);
      markDirty();
    }
    refreshTools();
  }

  function setObjectTool(type) {
    if (pendingTube && type !== 'tube') pendingTube = null;
    objectTool = objectTool === type ? null : type;
    if (objectTool) mode = 'select';
    refreshTools();
  }

  function setSelectMode() {
    pendingTube = null;
    objectTool = null;
    mode = 'select';
    refreshTools();
  }

  function refreshSelectionInfo() {
    const info = $('selection-info');
    const shapeSel = selected?.kind === 'shape';
    $('sel-straighten').disabled = !pathOf(selected);
    $('sel-duplicate').disabled = !selected;
    $('sel-delete').disabled = !selected;
    $('door-row').hidden = !shapeSel;
    if (shapeSel) {
      const s = selected.shape;
      $('door-on').checked = s.isDoor;
      $('door-dx').value = s.move?.dx ?? 0;
      $('door-dy').value = s.move?.dy ?? -Math.round(s.h || 96);
    }
    // Selecting a wired element picks up its settings, so the next one you place matches it.
    const wired = selected?.kind === 'switch' ? selected.sw : shapeSel && selected.shape.isDoor ? selected.shape : null;
    if (wired) { channel = wired.channel; $('channel').value = channel; }
    if (selected?.kind === 'switch') {
      accepts = selected.sw.accepts; $('accepts').value = accepts;
      latch = selected.sw.latch; $('switch-latch').checked = latch;
    }
    if (!selected) { info.textContent = 'Nothing selected'; return; }
    switch (selected.kind) {
      case 'shape': {
        const s = selected.shape;
        const curves = s.nodes.filter((n) => n.cx != null).length;
        info.textContent = `${Materials[s.type].label}${s.isDoor ? ` door "${s.channel}"` : ''} · ${s.nodes.length} nodes`
          + `${curves ? ` · ${curves} curved` : ''} · ${Math.round(s.w)}×${Math.round(s.h)}`;
        break;
      }
      case 'switch': {
        const s = selected.sw;
        info.textContent = `Switch "${s.channel}" · takes ${SWITCH_ACCEPTS[s.accepts].label}${s.latch ? ' · one-time' : ''}`;
        break;
      }
      case 'tube': {
        const t = selected.tube;
        info.textContent = `Tube · ${t.nodes.length} nodes · ${Math.round(t.length)}px · r${t.radius}`;
        break;
      }
      case 'checkpoint':
        info.textContent = `Checkpoint at ${Math.round(selected.cp.x)}, ${Math.round(selected.cp.y)}`;
        break;
      default: {
        const e = selected.entity;
        info.textContent = `${ENTITY_DEFS[e.type].label} at ${Math.round(e.x)}, ${Math.round(e.y)}`;
      }
    }
  }

  /** Wire the selected shape as a door on the current channel (or unwire it). */
  function applyDoor() {
    if (selected?.kind !== 'shape') return;
    const s = selected.shape;
    pushUndo();
    if (!$('door-on').checked) {
      this?.blur?.();
      s.setOffset(0);
      s.channel = null; s.move = null;
    } else {
      s.channel = channel;
      s.move = { dx: +$('door-dx').value || 0, dy: +$('door-dy').value || 0, duration: CONFIG.logic.doorDuration };
    }
    refreshChannelList();
    markDirty();
  }

  const on = (id, fn) => $(id).addEventListener('click', (e) => { fn(e); e.currentTarget.blur(); }, { signal });
  on('sel-delete', deleteSelected);
  on('sel-duplicate', duplicateSelected);
  on('sel-straighten', straightenSelected);

  // ---- Logic controls (switch channel / filter, tube radius, door motion) ----
  $('channel').value = channel;
  $('channel').addEventListener('change', (e) => {
    channel = e.target.value.trim() || 'a';
    e.target.value = channel;
    if (selected?.kind === 'switch') { pushUndo(); selected.sw.channel = channel; markDirty(); }
    else if (selected?.kind === 'shape' && selected.shape.isDoor) { pushUndo(); selected.shape.channel = channel; markDirty(); }
    refreshChannelList();
  }, { signal });

  $('accepts').value = accepts;
  $('accepts').addEventListener('change', (e) => {
    accepts = e.target.value;
    if (selected?.kind === 'switch') { pushUndo(); selected.sw.accepts = accepts; markDirty(); }
  }, { signal });

  $('switch-latch').addEventListener('change', (e) => {
    latch = e.target.checked;
    if (selected?.kind === 'switch') { pushUndo(); selected.sw.latch = latch; markDirty(); }
  }, { signal });

  /** Offer every channel already used in the level as an autocomplete suggestion. */
  function refreshChannelList() {
    const used = new Set(level.switches.map((s) => s.channel));
    for (const s of level.shapes) if (s.channel) used.add(s.channel);
    used.add(channel);
    $('channel-list').innerHTML = [...used].sort()
      .map((c) => `<option value="${c.replace(/"/g, '&quot;')}"></option>`).join('');
  }

  $('tube-radius').value = tubeRadius;
  $('tube-radius').addEventListener('change', (e) => {
    tubeRadius = Math.max(8, Math.min(80, +e.target.value || tubeRadius));
    e.target.value = tubeRadius;
    if (selected?.kind === 'tube') { pushUndo(); selected.tube.radius = tubeRadius; selected.tube.rebuild(); markDirty(); }
  }, { signal });

  for (const id of ['door-on', 'door-dx', 'door-dy']) {
    $(id).addEventListener('change', applyDoor, { signal });
  }

  function syncLevelInputs() {
    $('level-w').value = level.width;
    $('level-h').value = level.height;
  }
  const applyBounds = () => {
    const w = Math.max(128, +$('level-w').value || level.width);
    const h = Math.max(128, +$('level-h').value || level.height);
    if (w === level.width && h === level.height) return;
    pushUndo();
    level.width = w; level.height = h;
    markDirty();
  };
  $('level-w').addEventListener('change', applyBounds, { signal });
  $('level-h').addEventListener('change', applyBounds, { signal });

  $('snap').checked = snap;
  $('snap').addEventListener('change', (e) => { snap = e.target.checked; }, { signal });
  $('grid-size').value = gridSize;
  $('grid-size').addEventListener('change', (e) => { gridSize = Math.max(1, +e.target.value || gridSize); e.target.value = gridSize; }, { signal });

  on('new', () => {
    const w = Math.max(128, +$('level-w').value || 1600);
    const h = Math.max(128, +$('level-h').value || 1024);
    replaceLevel(Level.blank(w, h));
  });

  on('load-level1', async () => {
    const mod = await import('../levels/level1.js');
    replaceLevel(Level.fromJSON(mod.LEVEL_1, { name: 'LEVEL_1' }));
  });

  on('import', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    e.target.value = '';
    const lvl = parseLevelText(text, file.name.replace(/\.[^.]+$/, ''));
    if (!lvl) { flashStatus('Could not read a level from that file'); return; }
    replaceLevel(lvl);
  }, { signal });

  function parseLevelText(text, fallbackName) {
    try { return Level.fromJSON(JSON.parse(text)); } catch { /* not plain JSON */ }
    const nameMatch = text.match(/export const (\w+)/);
    const name = nameMatch ? nameMatch[1] : fallbackName;
    const brace = text.indexOf('{'), last = text.lastIndexOf('}');
    if (brace >= 0 && last > brace) {
      try { return Level.fromJSON(JSON.parse(text.slice(brace, last + 1)), { name }); } catch { /* try ascii */ }
    }
    const m = text.match(/`([\s\S]*?)`/);
    if (m) return Level.fromAscii(m[1], { tileSize: CONFIG.tileSize, name });
    if (/[#P]/.test(text) && text.includes('\n')) return Level.fromAscii(text, { tileSize: CONFIG.tileSize, name });
    return null;
  }

  on('export', () => {
    level.name = $('level-name').value.trim() || 'LEVEL_CUSTOM';
    const blob = new Blob([JSON.stringify(level.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${level.name.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  on('copy', async () => {
    level.name = $('level-name').value.trim() || 'LEVEL_CUSTOM';
    try { await navigator.clipboard.writeText(JSON.stringify(level.toJSON())); flashStatus('Copied level JSON to clipboard'); }
    catch { flashStatus('Clipboard unavailable'); }
  });

  on('undo', undo);
  on('redo', redo);
  $('level-name').addEventListener('input', scheduleSave, { signal });

  function flashStatus(msg) {
    statusEl.textContent = msg;
    statusOverrideUntil = Date.now() + 1500;
  }

  // ---- Playtest ----
  const gravityInput = $('pt-gravity');
  gravityInput.value = CONFIG.player.gravity;
  gravityInput.addEventListener('change', () => {
    CONFIG.player.gravity = +gravityInput.value || CONFIG.player.gravity;
  }, { signal });

  const playtestBtn = $('playtest');
  on('playtest', () => (playtest ? stopPlaytest() : startPlaytest()));

  function startPlaytest() {
    if (!level.playable) { flashStatus('Add some geometry and a spawn first'); return; }
    cancelAnimationFrame(rafId);
    drag = null;
    const input = new Input(window);
    const ptLevel = Level.fromJSON(level.toJSON(), { name: 'playtest' });
    const scene = new GameScene({ input, level: ptLevel, config: CONFIG });
    const engine = new Engine(canvas, CONFIG.physics);
    engine.setScene(scene);
    engine.start();
    playtest = { engine, input };
    playtestBtn.textContent = '■ Stop (Esc)';
    playtestBtn.classList.add('playing');
    updateCursor();
  }

  function stopPlaytest() {
    if (!playtest) return;
    playtest.engine.destroy();
    playtest.input.destroy();
    playtest = null;
    playtestBtn.textContent = '▶ Playtest';
    playtestBtn.classList.remove('playing');
    updateCursor();
    rafId = requestAnimationFrame(frame);
  }

  // ---- Boot ----
  syncLevelInputs();
  refreshChannelList();
  refreshSelectionInfo();
  refreshTools();
  camera.setView(canvas.clientWidth || 800, canvas.clientHeight || 600);
  camera.snapTo(level.spawn.x, level.spawn.y);
  rafId = requestAnimationFrame(frame);

  const api = {
    get level() { return level; },
    get selected() { return selected; },
    camera, MATERIAL_TOOLS, OBJECT_TOOLS,
    get material() { return material; },
    set material(t) { setMaterial(t); },
    get channel() { return channel; },
    get mode() { return objectTool ? `place:${objectTool}` : mode; },
    undo, redo,
    stop() {
      stopPlaytest();
      cancelAnimationFrame(rafId);
      clearTimeout(saveTimer);
      saveNow();
      ac.abort();
      canvas.style.cursor = '';
    },
  };
  return api;
}
