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
    if (d < bestD) {
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
    entityCount: (kind) => countEntities(world, kind),
    spawnEntity: (spec) => spawnEntity(world, spec),
    emitVisual: (event) => emitVisual(world, event),
    scheduleLater: (delay, command) => scheduleDelayed(world, { delay, command }),
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
