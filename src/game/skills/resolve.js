// 命中结算与命令队列。
//
// 结算顺序（docs/skill-architecture.md）：
//   1. 校验来源与目标仍有效，记录命中快照
//   2. 应用基础伤害，生命归零只标记，不立刻移除
//   3. 应用属性效果与修饰命令，检查共享反应
//   4. 死亡统一在命令队列处理完后结算，读取死亡时状态快照
//   5. 后续命令按 FIFO 入队处理，不递归调用结算器
//
// 每个命令携带 eventId / rootEventId / depth，派生命令继承根事件与技能归因。
// 深度与每根事件命令数都有上限，超限写入诊断，不静默随机丢弃。

import { contentById } from './registry.js';
import { RUNTIME_LIMITS } from './schema.js';
import { applyStatus, consumeStatus, getStatusInstance, stacksOf } from './status.js';
import { evaluateReactions } from './reactions.js';
import { applyModifierOnHit } from './modifiers/index.js';

const DEFAULT_BOUNDS = Object.freeze({ w: 160, h: 144 });

function boundsOf(world) {
  return world.bounds ?? DEFAULT_BOUNDS;
}

export function ensureResolutionState(world) {
  if (!Array.isArray(world.commands)) world.commands = [];
  if (!Array.isArray(world.delayed)) world.delayed = [];
  if (!(world.rootBudget instanceof Map)) world.rootBudget = new Map();
  if (!(world.splitCasts instanceof Set)) world.splitCasts = new Set();
  if (!(world.echoCasts instanceof Set)) world.echoCasts = new Set();
  if (!Array.isArray(world.diagnostics)) world.diagnostics = [];
  if (typeof world.nextEventId !== 'number') world.nextEventId = 1;
  if (!world.stats) world.stats = { damage: {}, bySkill: {}, reactions: {}, kills: 0 };
  if (!world.stats.damage) world.stats.damage = {};
  if (!world.stats.bySkill) world.stats.bySkill = {};
  if (!world.stats.reactions) world.stats.reactions = {};
  if (!world.stats.casts) world.stats.casts = {};
  if (!world.stats.modifiers) world.stats.modifiers = {};
  if (typeof world.stats.overflow !== 'number') world.stats.overflow = 0;
  if (!Array.isArray(world.events)) world.events = [];
}

export function diagnose(world, code, detail) {
  if (!Array.isArray(world.diagnostics)) world.diagnostics = [];
  if (world.diagnostics.length >= 64) return;
  world.diagnostics.push({ code, t: world.time ?? 0, ...detail });
}

function reactionStat(world, id) {
  if (world.stats.reactions[id] === undefined) world.stats.reactions[id] = { count: 0, damage: 0 };
  return world.stats.reactions[id];
}

/** 入队一个命令；派生命令由调用方填写 rootEventId 与 depth。 */
export function enqueue(world, partial) {
  ensureResolutionState(world);
  const depth = partial.depth ?? 0;
  if (depth > RUNTIME_LIMITS.maxCommandDepth) {
    diagnose(world, 'command-depth', { depth, type: partial.type });
    return false;
  }
  const eventId = world.nextEventId;
  world.nextEventId += 1;
  const rootEventId = partial.rootEventId ?? eventId;
  const used = world.rootBudget.get(rootEventId) ?? 0;
  if (used >= RUNTIME_LIMITS.maxCommandsPerRoot) {
    diagnose(world, 'command-budget', { rootEventId, type: partial.type });
    return false;
  }
  world.rootBudget.set(rootEventId, used + 1);
  world.commands.push({
    eventId,
    rootEventId,
    depth,
    type: partial.type,
    targetId: partial.targetId ?? null,
    sourceEntityId: partial.sourceEntityId ?? null,
    skillInstanceId: partial.skillInstanceId ?? null,
    reactionId: partial.reactionId ?? null,
    tags: Array.isArray(partial.tags) ? [...partial.tags] : [],
    payload: partial.payload ?? {},
  });
  return true;
}

function enqueueReactionCommands(world, parent, result) {
  for (const command of result.commands) {
    enqueue(world, {
      ...command,
      rootEventId: parent.rootEventId,
      depth: parent.depth + 1,
    });
  }
  for (const marker of result.triggered) {
    const stat = reactionStat(world, marker.id);
    stat.count += 1;
    world.events.push({ type: 'reaction', id: marker.id, x: marker.x, y: marker.y });
  }
}

export function findEnemy(world, id) {
  if (id === null || id === undefined) return undefined;
  return world.enemies.find((enemy) => enemy.id === id);
}

function recordDamage(world, command, amount) {
  if (!(amount > 0)) return;
  const key = command.skillInstanceId ?? command.payload.sourceTag ?? 'other';
  world.stats.damage[key] = (world.stats.damage[key] ?? 0) + amount;
  if (command.skillInstanceId !== null && command.skillInstanceId !== undefined) {
    world.stats.bySkill[command.skillInstanceId] =
      (world.stats.bySkill[command.skillInstanceId] ?? 0) + amount;
  }
  if (command.reactionId !== null && command.reactionId !== undefined) {
    reactionStat(world, command.reactionId).damage += amount;
  }
}

function applyDamage(world, enemy, amount, command) {
  if (!(amount > 0)) return 0;
  const before = Math.max(0, enemy.cells);
  const effective = Math.min(before, amount);
  const overflow = amount - effective;
  enemy.cells -= amount;
  enemy.flash = 0.12;
  world.stats.overflow = (world.stats.overflow ?? 0) + overflow;
  recordDamage(world, command, effective);
  return effective;
}

function targetsInRadius(world, center, radius, count, excludeId = -1) {
  return world.enemies
    .filter((enemy) => enemy.cells > 0 && !enemy.dead && enemy.id !== excludeId)
    .map((enemy) => ({ enemy, d: Math.hypot(enemy.x - center.x, enemy.y - center.y) }))
    .filter((entry) => entry.d <= radius + entry.enemy.r)
    .sort((a, b) => a.d - b.d || a.enemy.id - b.enemy.id)
    .slice(0, count)
    .map((entry) => entry.enemy);
}

export function scheduleDelayed(world, command) {
  ensureResolutionState(world);
  if (!Array.isArray(world.delayedSeq)) world.delayedSeq = 0;
  world.delayedSeq += 1;
  world.delayed.push({ due: world.time + command.delay, seq: world.delayedSeq, command });
}

/** 把到期的延迟命令移进队列；echo 在这里真正入队。 */
export function advanceDelayed(world) {
  ensureResolutionState(world);
  if (world.delayed.length === 0) return 0;
  const due = [];
  const keep = [];
  for (const item of world.delayed) {
    if (item.due <= world.time) due.push(item);
    else keep.push(item);
  }
  world.delayed = keep;
  due.sort((a, b) => a.due - b.due || a.seq - b.seq);
  for (const item of due) enqueue(world, item.command);
  return due.length;
}

function executeHit(world, command) {
  const target = findEnemy(world, command.targetId);
  if (target === undefined || target.dead || target.cells <= 0) return;
  const payload = command.payload;
  const element = payload.element === null || payload.element === undefined
    ? null
    : contentById(payload.element);
  const beforeCharge = stacksOf(target, 'charge');
  const damage = (payload.damage ?? 0) * (payload.damageScale ?? 1);
  const dealt = applyDamage(world, target, damage, command);

  // 死亡目标仍完成本次状态施加：先结算效果，再标记待死亡。
  if (element !== null) {
    for (const effect of element.onHit) {
      if (effect.type !== 'applyStatus') continue;
      const result = applyStatus(target, effect.status, effect.stacks, {
        sourceEntityId: command.sourceEntityId,
        skillInstanceId: command.skillInstanceId,
        element: element.id,
        rootEventId: command.rootEventId,
        canSpread: true,
      });
      world.events.push({
        type: 'status',
        status: effect.status,
        x: target.x,
        y: target.y,
        stacks: result.after,
        applied: result.applied,
        element: element.id,
      });
      const applied = evaluateReactions(world, {
        type: 'statusApplied',
        targetId: target.id,
        statusId: effect.status,
        stacks: result.after,
        applied: result.applied,
        eventId: command.eventId,
        rootEventId: command.rootEventId,
        skillInstanceId: command.skillInstanceId,
      });
      enqueueReactionCommands(world, command, applied);
    }
  }

  world.events.push({
    type: 'hit',
    x: target.x,
    y: target.y,
    cells: dealt,
    element: element === null ? null : element.id,
    skillId: command.skillInstanceId,
    depth: command.depth,
    reaction: command.reactionId,
  });

  const reactions = evaluateReactions(world, {
    type: 'hitResolved',
    targetId: target.id,
    tags: command.tags,
    element: element === null ? null : element.id,
    beforeCharge,
    eventId: command.eventId,
    rootEventId: command.rootEventId,
    skillInstanceId: command.skillInstanceId,
  });
  enqueueReactionCommands(world, command, reactions);

  applyModifier(world, command, target, payload);

  if (target.cells <= 0) target.dead = true;
}

function applyModifier(world, command, target, payload) {
  const raw = payload.modifier;
  if (raw === null || raw === undefined) return;
  // 兼容旧命令/测试里直接传入 transform 的写法；新计划统一传修饰定义。
  const modifier = raw.transform !== undefined ? raw : { id: raw.type, transform: raw };
  if (modifier.transform === undefined) return;
  const context = {
    world,
    command,
    target,
    payload,
    transform: modifier.transform,
    enqueue: (partial) =>
      enqueue(world, {
        ...partial,
        rootEventId: command.rootEventId,
        depth: command.depth + 1,
      }),
    scheduleLater: (delay, later) =>
      scheduleDelayed(world, {
        ...later,
        delay,
        rootEventId: command.rootEventId,
        depth: command.depth + 1,
      }),
    queryTargets: (center, radius, count, excludeId) =>
      targetsInRadius(world, center, radius, count, excludeId),
    countStatuses: (target) =>
      Object.values(target.statuses ?? {}).reduce((sum, instance) => sum + instance.stacks, 0),
    consumeStatuses: (target) => {
      let total = 0;
      for (const id of Object.keys(target.statuses ?? {})) {
        total += consumeStatus(target, id, Infinity);
      }
      return total;
    },
    emitVisual: (event) => world.events.push(event),
    once: (setName, key) => {
      if (!(world[setName] instanceof Set)) world[setName] = new Set();
      if (world[setName].has(key)) return false;
      world[setName].add(key);
      return true;
    },
  };
  applyModifierOnHit(modifier, context);
}

function executeAreaHit(world, command) {
  const payload = command.payload;
  const center = { x: payload.centerX ?? 0, y: payload.centerY ?? 0 };
  const targets = targetsInRadius(world, center, payload.radius ?? 0, payload.maxTargets ?? 8);
  targets.forEach((target, index) => {
    enqueue(world, {
      type: 'hit',
      targetId: target.id,
      sourceEntityId: command.sourceEntityId,
      skillInstanceId: command.skillInstanceId,
      rootEventId: command.rootEventId,
      depth: command.depth + 1,
      tags: index === 0 ? [...command.tags, 'primary'] : command.tags,
      payload: { ...payload, centerX: center.x, centerY: center.y },
    });
  });
}

function executeStatusDamage(world, command) {
  const target = findEnemy(world, command.targetId);
  if (target === undefined || target.dead || target.cells <= 0) return;
  const dealt = applyDamage(world, target, command.payload.damage ?? 0, command);
  world.events.push({
    type: 'burn',
    status: command.payload.statusId,
    x: target.x,
    y: target.y,
    cells: dealt,
  });
  if (target.cells <= 0) target.dead = true;
}

function executeApplyStatus(world, command) {
  const target = findEnemy(world, command.targetId);
  if (target === undefined || target.dead || target.cells <= 0) return;
  const payload = command.payload;
  const result = applyStatus(target, payload.status, payload.stacks, {
    ...(payload.meta ?? {}),
    rootEventId: command.rootEventId,
    canSpread: payload.meta?.canSpread ?? true,
  });
  world.events.push({
    type: 'status',
    status: payload.status,
    x: target.x,
    y: target.y,
    stacks: result.after,
    applied: result.applied,
    reaction: command.reactionId,
  });
  const reactions = evaluateReactions(world, {
    type: 'statusApplied',
    targetId: target.id,
    statusId: payload.status,
    stacks: result.after,
    applied: result.applied,
    eventId: command.eventId,
    rootEventId: command.rootEventId,
    skillInstanceId: command.skillInstanceId,
  });
  enqueueReactionCommands(world, command, reactions);
}

function executeMove(world, command) {
  const target = findEnemy(world, command.targetId);
  if (target === undefined || target.dead || target.cells <= 0) return;
  const payload = command.payload;
  const dx = payload.centerX - target.x;
  const dy = payload.centerY - target.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return;
  const step = Math.min(d, payload.strength ?? 0);
  const bounds = boundsOf(world);
  target.x = Math.max(target.r, Math.min(bounds.w - target.r, target.x + (dx / d) * step));
  target.y = Math.max(target.r, Math.min(bounds.h - target.r, target.y + (dy / d) * step));
  world.events.push({ type: 'pull', x: target.x, y: target.y });
}

export function executeCommand(world, command) {
  switch (command.type) {
    case 'hit':
      executeHit(world, command);
      break;
    case 'areaHit':
      executeAreaHit(world, command);
      break;
    case 'statusDamage':
      executeStatusDamage(world, command);
      break;
    case 'applyStatus':
      executeApplyStatus(world, command);
      break;
    case 'move':
      executeMove(world, command);
      break;
    default:
      diagnose(world, 'unknown-command', { type: String(command.type) });
      break;
  }
}

/** FIFO 处理当前队列。返回处理数量；超预算时清空并留下诊断。 */
export function processCommands(world) {
  ensureResolutionState(world);
  let processed = 0;
  while (world.commands.length > 0) {
    if (processed >= RUNTIME_LIMITS.maxCommandsPerStep) {
      diagnose(world, 'step-budget', { pending: world.commands.length, processed });
      world.commands.length = 0;
      break;
    }
    const command = world.commands.shift();
    processed += 1;
    executeCommand(world, command);
  }
  return processed;
}

/** 死亡时读取状态快照并提交反应命令；由战斗层在移除实体前调用。 */
export function queueDeathReactions(world, enemy) {
  ensureResolutionState(world);
  const burn = getStatusInstance(enemy, 'burn');
  const event = {
    type: 'entityDied',
    targetId: enemy.id,
    x: enemy.x,
    y: enemy.y,
    burnStacks: burn === null ? 0 : burn.stacks,
    burnCanSpread: true,
    burnSpreadDepth: burn === null ? 0 : burn.source?.spreadDepth ?? 0,
    burnSkillInstanceId: burn === null ? null : burn.source?.skillInstanceId ?? null,
    rootEventId: burn === null ? null : burn.source?.rootEventId ?? null,
    skillInstanceId: burn === null ? null : burn.source?.skillInstanceId ?? null,
    eventId: world.nextEventId,
  };
  world.nextEventId += 1;
  const result = evaluateReactions(world, event);
  const parent = {
    rootEventId: event.eventId,
    depth: 0,
    skillInstanceId: event.skillInstanceId,
  };
  enqueueReactionCommands(world, parent, result);
  return result;
}
