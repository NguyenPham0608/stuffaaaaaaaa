import { RigidBody, rectVerts } from '../physics/RigidBody.js';
import { lerp } from '../math/MathUtil.js';
import { decomposeConvex } from '../math/Geometry.js';
import { CONFIG } from '../config.js';

/**
 * Dynamic level objects (crates, balls). Levels record them as {type, x, y}; this module
 * turns them into rigid bodies, converts level shapes into static colliders for the
 * rigid world, and draws them (in-game and as editor previews).
 */
export const ENTITY_DEFS = {
  crate: { label: 'Crate',       color: '#e0b483', size: 0.875, density: 0.0017, friction: 0.38, restitution: 0.1 },
  heavy: { label: 'Heavy crate', color: '#6b7280', size: 0.875, density: 0.005,  friction: 0.5,  restitution: 0.05 },
  ball:  { label: 'Ball',        color: '#2f8fc9', size: 0.75,  density: 0.002,  friction: 0.45, restitution: 0.35 },
};

export function createEntityBody(entity, tileSize) {
  const d = ENTITY_DEFS[entity.type];
  if (!d) throw new Error(`Unknown entity type: ${entity.type}`);
  const px = tileSize * d.size;
  const common = { x: entity.x, y: entity.y, density: d.density, friction: d.friction, restitution: d.restitution, color: d.color, kind: entity.type };
  if (entity.type === 'ball') return new RigidBody({ ...common, shape: 'circle', radius: px / 2 });
  return new RigidBody({ ...common, shape: 'poly', verts: rectVerts(-px / 2, -px / 2, px, px) });
}

/**
 * Static rigid colliders mirroring the level's shapes (every material is solid to objects).
 * Each shape becomes one terrain body (exact, used by circles) plus its convex pieces
 * (used by polygons).
 */
export function createStaticBodies(shapes) {
  const bodies = [];
  for (const s of shapes) {
    if (s.points.length < 3) continue;
    const common = { isStatic: true, friction: Math.min(1, s.friction) * 0.6, restitution: (s.bounce || 0) * 0.9, color: s.color };
    bodies.push(new RigidBody({ ...common, shape: 'terrain', terrain: s, kind: 'terrain' }));
    for (const piece of decomposeConvex(s.points)) {
      if (piece.length < 3) continue;
      bodies.push(new RigidBody({ ...common, shape: 'poly', verts: piece, kind: 'wall', terrainPiece: true }));
    }
  }
  return bodies;
}

export function drawBody(ctx, b, alpha = 1) {
  const x = lerp(b.prevPos.x, b.pos.x, alpha);
  const y = lerp(b.prevPos.y, b.pos.y, alpha);
  const ang = lerp(b.prevAngle, b.angle, alpha);
  if (b.shape === 'circle') drawBallShape(ctx, x, y, b.radius, ang, b.color);
  else drawCrateShape(ctx, x, y, b.verts, ang, b.kind);
}

/** Editor preview of an entity at its centre. */
export function drawEntityPreview(ctx, entity, tileSize, alpha = 1) {
  const d = ENTITY_DEFS[entity.type];
  const px = tileSize * d.size;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (entity.type === 'ball') drawBallShape(ctx, entity.x, entity.y, px / 2, 0, d.color);
  else drawCrateShape(ctx, entity.x, entity.y, rectVerts(-px / 2, -px / 2, px, px), 0, entity.type);
  ctx.restore();
}

export function drawSpawn(ctx, x, y, radius, color) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, radius + 6, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = CONFIG.render.outlineWidth;
  ctx.strokeStyle = CONFIG.render.outlineColor;
  ctx.stroke();
  ctx.restore();
}

function drawCrateShape(ctx, x, y, verts, angle, kind) {
  const d = ENTITY_DEFS[kind] ?? ENTITY_DEFS.crate;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.fillStyle = d.color;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = CONFIG.render.outlineWidth;
  ctx.strokeStyle = CONFIG.render.outlineColor;
  ctx.stroke();
  ctx.restore();
}

function drawBallShape(ctx, x, y, r, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = CONFIG.render.outlineWidth;
  ctx.strokeStyle = CONFIG.render.outlineColor;
  ctx.stroke();
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.6, 0); ctx.stroke();
  ctx.restore();
}
