// 常规移动决策与位移请求裁决。
//
// 技能只提供 movement.preferredRange，不直接争夺玩家移动。策略层在每步做一次
// 统一选择；多个并列目标按 ID 打破平局。位移请求首版只保证场地内落点与确定性，
// 不宣称完整危险评估。

import { ARENA } from './skills/constants.js';
import { MOVEMENT_STRATEGIES } from './skills/schema.js';

const CENTER_PULL = 56;
const PLAYER_MARGIN = 6;

const clampValue = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

export function preferredRanges(plans) {
  const ranges = [];
  for (const plan of plans) {
    const value = plan.movement?.preferredRange;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) ranges.push(value);
  }
  return ranges.length > 0 ? ranges : [40];
}

export function desiredRange(plans, strategy) {
  const ranges = preferredRanges(plans);
  const min = Math.min(...ranges);
  const max = Math.max(...ranges);
  if (strategy === 'approach') return min;
  if (strategy === 'keepDistance') return max;
  // auto：混合构筑取折中距离，先保留近战可接近的机会，也不过度贴近。
  return Math.round((min + max) / 2);
}

export function createMovementState(plans, strategy = 'auto') {
  const chosen = MOVEMENT_STRATEGIES.includes(strategy) ? strategy : 'auto';
  return { strategy: chosen, desiredRange: desiredRange(plans, chosen) };
}

export function refreshMovementState(world) {
  world.movement = createMovementState(world.plans, world.movement?.strategy ?? 'auto');
  return world.movement;
}

function nearestLiving(world) {
  let best = null;
  let bestD = Infinity;
  for (const enemy of world.enemies) {
    if (enemy.cells <= 0 || enemy.dead || enemy.deathHandled) continue;
    const d = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    if (d < bestD || (d === bestD && best !== null && enemy.id < best.id)) {
      best = enemy;
      bestD = d;
    }
  }
  return best;
}

/** 玩家常规移动：由策略统一决定保持距离、接近或折中。 */
export function movePlayer(world, dt) {
  const player = world.player;
  const desired = world.movement?.desiredRange ?? 40;
  const nearest = nearestLiving(world);
  let vx = 0;
  let vy = 0;
  if (nearest !== null) {
    const dx = player.x - nearest.x;
    const dy = player.y - nearest.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < desired - 8) {
      vx += dx / d;
      vy += dy / d;
    } else if (d > desired + 8) {
      vx -= dx / d;
      vy -= dy / d;
    } else {
      vx += -dy / d;
      vy += dx / d;
    }
  }
  const cx = ARENA.w / 2 - player.x;
  const cy = ARENA.h / 2 - player.y;
  const cd = Math.hypot(cx, cy) || 1;
  if (cd > CENTER_PULL) {
    vx += (cx / cd) * 0.7;
    vy += (cy / cd) * 0.7;
  }
  const len = Math.hypot(vx, vy);
  if (len < 0.001) return;
  player.x = clampValue(player.x + (vx / len) * player.speed * dt, PLAYER_MARGIN, ARENA.w - PLAYER_MARGIN);
  player.y = clampValue(player.y + (vy / len) * player.speed * dt, PLAYER_MARGIN, ARENA.h - PLAYER_MARGIN);
}

function compareRequests(a, b) {
  return b.priority - a.priority || a.sourceId - b.sourceId || a.seq - b.seq;
}

/**
 * 提交临时位移请求。request: { sourceId, priority, x, y, distance? }
 * 首版按优先级、来源 ID、入队顺序裁决，落点限制在场地内。
 */
export function requestDisplacement(world, request) {
  if (!Array.isArray(world.displacements)) world.displacements = [];
  if (typeof world.nextDisplacementSeq !== 'number') world.nextDisplacementSeq = 1;
  const seq = world.nextDisplacementSeq;
  world.nextDisplacementSeq += 1;
  const priority = Number.isFinite(request.priority) ? request.priority : 0;
  world.displacements.push({ ...request, priority, seq, applied: false });
  return seq;
}

/** 每步一次性裁决位移请求；无效请求直接丢弃，不消耗技能冷却。 */
export function resolveDisplacements(world) {
  if (!Array.isArray(world.displacements) || world.displacements.length === 0) return [];
  const requests = world.displacements.sort(compareRequests);
  world.displacements = [];
  const applied = [];
  for (const request of requests) {
    if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) continue;
    if (!(Number.isFinite(request.distance) && request.distance > 0)) continue;
    const startX = world.player.x;
    const startY = world.player.y;
    const dx = request.x - startX;
    const dy = request.y - startY;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) continue;
    const step = Math.min(d, request.distance);
    world.player.x = clampValue(startX + (dx / d) * step, PLAYER_MARGIN, ARENA.w - PLAYER_MARGIN);
    world.player.y = clampValue(startY + (dy / d) * step, PLAYER_MARGIN, ARENA.h - PLAYER_MARGIN);
    request.applied = true;
    applied.push(request);
  }
  return applied;
}
