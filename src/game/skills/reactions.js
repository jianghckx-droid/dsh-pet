// 共享反应：读取语义事件快照，只提交命令，不直接结算。
//
// 反应按显式优先级、再按稳定 ID 排序；同一事件对同一反应至多触发一次。
// 每个处理器必须返回终止理由明确的命令，例如传火后的灼烧带 canSpread=false。

import { contentList } from './registry.js';
import { consumeStatus, stacksOf } from './status.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function aliveEnemies(world) {
  return world.enemies.filter((enemy) => enemy.cells > 0);
}

function nearby(world, from, radius, count, excludeId = -1) {
  return aliveEnemies(world)
    .filter((enemy) => enemy.id !== excludeId)
    .map((enemy) => ({ enemy, d: dist(from, enemy) }))
    .filter((entry) => entry.d <= radius)
    .sort((a, b) => a.d - b.d || a.enemy.id - b.enemy.id)
    .slice(0, count)
    .map((entry) => entry.enemy);
}

function spreadFire(world, event, def) {
  if (event.burnStacks <= 0) return null;
  if ((event.burnSpreadDepth ?? 0) >= def.config.maxChain) return null;
  const targets = nearby(world, event, def.config.radius, def.config.targets, event.targetId);
  if (targets.length === 0) return null;
  const stacks = Math.max(
    def.config.minStacks,
    Math.min(def.config.maxStacks, Math.floor(event.burnStacks * def.config.transferRatio)),
  );
  const commands = targets.map((target) => ({
    type: 'applyStatus',
    targetId: target.id,
    sourceEntityId: event.targetId,
    skillInstanceId: event.burnSkillInstanceId ?? event.skillInstanceId ?? null,
    tags: ['reaction', 'spreadFire', 'fire'],
    payload: {
      status: 'burn',
      stacks,
      meta: {
        sourceEntityId: event.targetId,
        skillInstanceId: event.burnSkillInstanceId ?? event.skillInstanceId ?? null,
        element: 'fire',
        rootEventId: event.rootEventId ?? null,
        canSpread: true,
        spreadDepth: (event.burnSpreadDepth ?? 0) + 1,
      },
    },
  }));
  return { commands, triggered: { id: def.id, x: event.x, y: event.y } };
}

function conductive(world, event, def) {
  if (event.type !== 'hitResolved') return null;
  if (!event.tags.includes('thunder') || event.tags.includes('noConductive')) return null;
  if ((event.beforeCharge ?? 0) < 1) return null;
  const target = world.enemies.find((enemy) => enemy.id === event.targetId);
  if (target === undefined || target.deathHandled) return null;
  if (stacksOf(target, 'charge') <= 0) return null;
  consumeStatus(target, 'charge', def.config.consume);
  const targets = nearby(world, target, def.config.radius, def.config.targets, target.id);
  if (targets.length === 0) {
    return { commands: [], triggered: { id: def.id, x: target.x, y: target.y } };
  }
  const commands = targets.map((other) => ({
    type: 'hit',
    targetId: other.id,
    sourceEntityId: target.id,
    skillInstanceId: event.skillInstanceId ?? null,
    tags: ['reaction', 'conductive', 'lightning', 'thunder', 'noConductive', 'noCharge'],
    payload: {
      damage: def.config.damage,
      damageScale: 1,
      element: null,
      heavy: false,
      // 反应伤害吃通用与条件加成，不暴击。
      channel: 'reaction',
      sourceTag: 'reaction:conductive',
    },
  }));
  return { commands, triggered: { id: def.id, x: target.x, y: target.y } };
}

function shatter(world, event, def) {
  if (event.type !== 'hitResolved') return null;
  if (!event.tags.includes('heavy') || event.tags.includes('noShatter')) return null;
  const target = world.enemies.find((enemy) => enemy.id === event.targetId);
  if (target === undefined || target.deathHandled) return null;
  if (stacksOf(target, def.config.status) < def.config.threshold) return null;
  consumeStatus(target, def.config.status, Infinity);
  const targets = nearby(world, target, def.config.radius, def.config.targets);
  const commands = targets.map((other) => ({
    type: 'hit',
    targetId: other.id,
    sourceEntityId: target.id,
    skillInstanceId: event.skillInstanceId ?? null,
    tags: ['reaction', 'shatter', 'frost', 'noShatter'],
    payload: {
      damage: def.config.damage,
      damageScale: 1,
      element: null,
      heavy: false,
      // 反应伤害吃通用与条件加成，不暴击。
      channel: 'reaction',
      sourceTag: 'reaction:shatter',
    },
  }));
  return { commands, triggered: { id: def.id, x: target.x, y: target.y } };
}

const REACTION_IMPL = Object.freeze({ spreadFire, conductive, shatter });

/**
 * 评估一个语义事件。
 * @returns {{commands:Array, triggered:Array<{id:string,x:number,y:number}>}}
 */
export function evaluateReactions(world, event) {
  const commands = [];
  const triggered = [];
  if (event === null || event === undefined) return { commands, triggered };
  const list = contentList('reaction')
    .filter((def) => def.event === event.type)
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const def of list) {
    if (event.firedReactions !== undefined && event.firedReactions.has(def.id)) continue;
    const handler = REACTION_IMPL[def.handler];
    if (handler === undefined) continue;
    const result = handler(world, event, def);
    if (result === null) continue;
    if (event.firedReactions === undefined) event.firedReactions = new Set();
    event.firedReactions.add(def.id);
    for (const command of result.commands) commands.push({ ...command, reactionId: def.id });
    if (result.triggered !== undefined) triggered.push(result.triggered);
  }
  return { commands, triggered };
}
