// 状态实例：层数、到期时间、周期跳动与来源。
//
// 定义（上限/时长/跳动）在 content/statuses.js；这里只处理实例状态。
// 重复施加策略固定为"加层并刷新整体持续时间"，由定义声明，不隐式继承。

import { contentById } from './registry.js';
import { RUNTIME_LIMITS } from './schema.js';

export function createStatuses() {
  return {};
}

export function statusDef(id) {
  const def = contentById(id);
  if (def === undefined || def.kind !== 'status') {
    throw new Error(`unknown status: ${String(id)}`);
  }
  return def;
}

export function getStatusInstance(entity, id) {
  if (entity === null || entity === undefined || entity.statuses === undefined) return null;
  return entity.statuses[id] ?? null;
}

export function stacksOf(entity, id) {
  const instance = getStatusInstance(entity, id);
  return instance === null ? 0 : instance.stacks;
}

function ensureStatuses(entity) {
  if (entity.statuses === undefined || entity.statuses === null) entity.statuses = createStatuses();
  return entity.statuses;
}

/**
 * 施加状态。返回 {before, after, applied, refreshed}。
 * 来源放在实例上，周期伤害与传火都能继承技能归因。
 */
export function applyStatus(entity, id, stacks, meta = {}) {
  const def = statusDef(id);
  const table = ensureStatuses(entity);
  let instance = table[id];
  const before = instance === undefined ? 0 : instance.stacks;
  if (stacks <= 0) {
    return { def, before, after: before, applied: 0, refreshed: instance !== undefined };
  }
  if (instance === undefined) {
    instance = {
      id,
      stacks: 0,
      remaining: def.duration,
      tickTimer: def.tickSeconds ?? 0,
      source: { ...meta },
    };
    table[id] = instance;
  }
  const after = Math.min(def.cap, before + stacks);
  instance.stacks = after;
  instance.remaining = def.duration;
  instance.source = { ...meta };
  if (before === 0) instance.tickTimer = def.tickSeconds ?? 0;
  return { def, before, after, applied: after - before, refreshed: true };
}

/** 消耗层数（反应使用），返回实际消耗量。 */
export function consumeStatus(entity, id, stacks = Infinity) {
  const instance = getStatusInstance(entity, id);
  if (instance === null) return 0;
  const consumed = Math.min(instance.stacks, Math.max(0, stacks));
  instance.stacks -= consumed;
  if (instance.stacks <= 0) delete entity.statuses[id];
  return consumed;
}

export function removeStatus(entity, id) {
  if (entity.statuses === undefined) return;
  delete entity.statuses[id];
}

export function statusSnapshot(entity) {
  return {
    burn: stacksOf(entity, 'burn'),
    chill: stacksOf(entity, 'chill'),
    charge: stacksOf(entity, 'charge'),
  };
}

/** 寒冷降低移动速度；每层数值来自状态定义。 */
export function slowFactor(entity) {
  const instance = getStatusInstance(entity, 'chill');
  if (instance === null) return 1;
  const def = statusDef('chill');
  return 1 - Math.min(def.maxSlow ?? 0.4, instance.stacks * (def.slowPerStack ?? 0));
}

/**
 * 推进所有实体的状态计时，返回这一帧的周期伤害。
 * 周期伤害只产生命令，不在这里直接改生命。
 */
export function tickStatuses(world, dt) {
  const ticks = [];
  const entities = world.enemies;
  if (!Array.isArray(entities)) return ticks;
  for (const entity of entities) {
    if (entity.cells <= 0 || entity.statuses === undefined) continue;
    for (const [id, instance] of Object.entries(entity.statuses)) {
      const def = statusDef(id);
      instance.remaining -= dt;
      if (instance.remaining <= 0) {
        delete entity.statuses[id];
        continue;
      }
      if (def.tickSeconds === undefined) continue;
      instance.tickTimer -= dt;
      let guard = 0;
      while (instance.tickTimer <= 0 && guard < RUNTIME_LIMITS.maxTicksPerStep) {
        instance.tickTimer += def.tickSeconds;
        guard += 1;
        const damage = instance.stacks * (def.damagePerStack ?? 0);
        if (damage <= 0) continue;
        ticks.push({
          targetId: entity.id,
          statusId: id,
          stacks: instance.stacks,
          damage,
          sourceEntityId: instance.source?.sourceEntityId ?? null,
          skillInstanceId: instance.source?.skillInstanceId ?? null,
          element: instance.source?.element ?? null,
          rootEventId: instance.source?.rootEventId ?? null,
        });
      }
    }
  }
  return ticks;
}
