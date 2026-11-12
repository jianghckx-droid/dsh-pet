// 战斗世界接口：动作与实体处理器只通过这里查询目标、创建实体、提交命中。
//
// 处理器不直接改敌人生命、状态或其他技能，也不读取 registry 的具体内容。
// 这样属性、反应、伤害归因继续由公共结算处理。

import { RUNTIME_LIMITS } from './schema.js';
import { ARENA } from './constants.js';
import { ensureResolutionState, enqueue, diagnose, scheduleDelayed } from './resolve.js';

const ENTITY_LIMITS = Object.freeze({
  projectile: RUNTIME_LIMITS.maxProjectiles,
  orbitSword: RUNTIME_LIMITS.maxOrbitSwords,
  arcSword: RUNTIME_LIMITS.maxArcSwords,
  trap: RUNTIME_LIMITS.maxTraps,
  piercingSword: RUNTIME_LIMITS.maxSwordPieces,
  swordArray: RUNTIME_LIMITS.maxSwordArrays,
});

export function livingEnemies(world) {
  return world.enemies.filter((enemy) => enemy.cells > 0 && !enemy.dead && !enemy.deathHandled);
}

export function enemiesInRadius(world, center, radius, count, excludeId = -1) {
  return livingEnemies(world)
    .filter((enemy) => enemy.id !== excludeId)
    .map((enemy) => ({ enemy, d: Math.hypot(enemy.x - center.x, enemy.y - center.y) }))
    .filter((entry) => entry.d <= radius + entry.enemy.r)
    .sort((a, b) => a.d - b.d || a.enemy.id - b.enemy.id)
    .slice(0, count)
    .map((entry) => entry.enemy);
}

export function nearestEnemy(world, from, range, excludeId = -1) {
  let best = null;
  let bestD = range;
  for (const enemy of livingEnemies(world)) {
    if (enemy.id === excludeId) continue;
    const d = Math.hypot(enemy.x - from.x, enemy.y - from.y) - enemy.r;
    if (d < bestD || (d === bestD && best !== null && enemy.id < best.id)) {
      best = enemy;
      bestD = d;
    }
  }
  return best;
}

export function countEntities(world, kind) {
  if (!Array.isArray(world.entities)) return 0;
  return world.entities.filter((entity) => entity.kind === kind && !entity.dead).length;
}

/** 同一诊断码只记录一次，避免每帧重试把诊断环填满。 */
export function diagnoseOnce(world, code, detail) {
  if (!Array.isArray(world.diagnostics)) world.diagnostics = [];
  if (world.diagnostics.some((entry) => entry.code === code)) return;
  diagnose(world, code, detail);
}

function segmentCircleEntry(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t = (-b - root) / (2 * a);
  if (t < 0 || t > 1) return null;
  return t;
}

/**
 * 线段扫掠：返回沿途接触的敌人，按最早交点、再按敌人 ID 排序。
 * 供弧光飞剑这类高速实体使用，避免按点判定时穿过敌人。
 */
export function sweepEnemies(world, x0, y0, x1, y1, radius) {
  const hits = [];
  for (const enemy of livingEnemies(world)) {
    const t = segmentCircleEntry(x0, y0, x1, y1, enemy.x, enemy.y, enemy.r + radius);
    if (t !== null) hits.push({ enemy, t });
  }
  hits.sort((a, b) => a.t - b.t || a.enemy.id - b.enemy.id);
  return hits;
}

export function spawnEntity(world, spec) {
  ensureResolutionState(world);
  if (!Array.isArray(world.entities)) world.entities = [];
  const limit = ENTITY_LIMITS[spec.kind] ?? RUNTIME_LIMITS.maxEntities;
  const activeCount = world.entities.filter((entity) => !entity.dead).length;
  if (activeCount >= RUNTIME_LIMITS.maxEntities || countEntities(world, spec.kind) >= limit) {
    diagnose(world, 'entity-limit', { kind: spec.kind, limit });
    return null;
  }
  const entity = {
    ownerId: world.player.id,
    bornAt: world.time,
    dead: false,
    ...spec,
    id: world.nextId++,
  };
  world.entities.push(entity);
  return entity;
}

export function removeEntity(world, entity) {
  entity.dead = true;
}

/**
 * 提交一次统一命中。payload 字段与 resolve.js 的共享契约一致；
 * 属性、强力标签和修饰都由这里统一带入，处理器不自己拼状态。
 */
export function enqueueHit(world, plan, opts) {
  ensureResolutionState(world);
  const tags = [...plan.tags];
  if (plan.heavy) tags.push('heavy');
  for (const tag of opts.extraTags ?? []) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  tags.push(opts.primary === false ? 'secondary' : 'primary');
  enqueue(world, {
    type: 'hit',
    targetId: opts.targetId,
    sourceEntityId: opts.sourceEntityId ?? world.player.id,
    skillInstanceId: plan.id,
    tags,
    payload: {
      damage: plan.damage,
      damageScale: opts.damageScale ?? 1,
      element: plan.element === null ? null : plan.element.id,
      heavy: plan.heavy,
      modifier: plan.modifier,
      modifierTransform: plan.transform,
      castId: opts.castId ?? null,
      action: plan.action.handler,
      // 技能直接命中：吃通用与条件加成，可以暴击。
      channel: 'direct',
      centerX: opts.center?.x ?? 0,
      centerY: opts.center?.y ?? 0,
      radius: plan.radius,
      maxTargets: plan.maxTargets,
    },
  });
}

export function emitVisual(world, event) {
  ensureResolutionState(world);
  world.events.push(event);
}

/** 动作和实体共享的基础上下文；具体处理器再附加 plan / entity。 */
export function createWorldContext(world) {
  return {
    world,
    get time() {
      return world.time;
    },
    rng: world.rng,
    queryTargets: (center, radius, count, excludeId) =>
      enemiesInRadius(world, center, radius, count, excludeId),
    queryNearest: (from, range, excludeId) => nearestEnemy(world, from, range, excludeId),
    sweepEnemies: (x0, y0, x1, y1, radius) => sweepEnemies(world, x0, y0, x1, y1, radius),
    entityCount: (kind) => countEntities(world, kind),
    diagnose: (code, detail) => diagnose(world, code, detail),
    diagnoseOnce: (code, detail) => diagnoseOnce(world, code, detail),
    spawnEntity: (spec) => spawnEntity(world, spec),
    emitVisual: (event) => emitVisual(world, event),
    scheduleLater: (delay, command) => scheduleDelayed(world, { ...command, delay }),
    enqueue: (command) => enqueue(world, command),
    bounds: ARENA,
  };
}

export function createActionContext(world, skill, plan, castId) {
  const base = createWorldContext(world);
  return {
    ...base,
    skill,
    plan,
    castId,
    hit: (opts) =>
      enqueueHit(world, plan, {
        ...opts,
        castId: opts.castId ?? castId,
      }),
  };
}

export function createEntityContext(world, entity) {
  const base = createWorldContext(world);
  const plan = entity.plan;
  return {
    ...base,
    entity,
    plan,
    castId: entity.castId,
    hit: (opts) =>
      enqueueHit(world, plan, {
        ...opts,
        sourceEntityId: entity.id,
        castId: opts.castId ?? entity.castId,
      }),
  };
}
