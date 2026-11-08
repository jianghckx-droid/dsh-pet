// 弧光飞剑：从角色背侧沿弧线飞向锁定目标，末段有限追踪，单目标命中。
//
// 施放瞬间锁定方向与目标位置；角色与目标重合时沿用该技能上一次有效朝向，
// 从未有过朝向时固定向右。左右交替由成功施放次数决定，不额外保存随机状态。

import { RUNTIME_LIMITS } from '../schema.js';

const START_BACK = 8;
const START_SIDE = 5;
const CONTROL1_BACK = 18;
const CONTROL1_SIDE = 20;
const CONTROL2_BACK = 18;
const CONTROL2_SIDE = 12;

function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (length < 1e-6) return null;
  return { x: x / length, y: y / length };
}

export const arcSwordAction = Object.freeze({
  canCast(context) {
    return context.queryNearest(context.world.player, context.plan.range) !== null;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    const limit = Math.min(plan.maxActive, RUNTIME_LIMITS.maxArcSwords);
    if (context.entityCount('arcSword') >= limit) {
      context.diagnoseOnce('arc-sword-limit', { limit });
      return false;
    }
    const target = context.queryNearest(player, plan.range);
    if (target === null) return false;

    const direct = normalize(target.x - player.x, target.y - player.y);
    let aimX;
    let aimY;
    if (direct !== null) {
      aimX = direct.x;
      aimY = direct.y;
      context.skill.lastAimX = aimX;
      context.skill.lastAimY = aimY;
    } else if (
      Number.isFinite(context.skill.lastAimX) &&
      Number.isFinite(context.skill.lastAimY)
    ) {
      aimX = context.skill.lastAimX;
      aimY = context.skill.lastAimY;
    } else {
      aimX = 1;
      aimY = 0;
    }

    const sideX = -aimY;
    const sideY = aimX;
    const side = context.skill.castCount % 2 === 0 ? 1 : -1;
    const startX = player.x - aimX * START_BACK + sideX * START_SIDE * side;
    const startY = player.y - aimY * START_BACK + sideY * START_SIDE * side;
    const control1X = player.x - aimX * CONTROL1_BACK + sideX * CONTROL1_SIDE * side;
    const control1Y = player.y - aimY * CONTROL1_BACK + sideY * CONTROL1_SIDE * side;
    const endX = target.x;
    const endY = target.y;
    const control2X = endX - aimX * CONTROL2_BACK + sideX * CONTROL2_SIDE * side;
    const control2Y = endY - aimY * CONTROL2_BACK + sideY * CONTROL2_SIDE * side;
    const initial = normalize(control1X - startX, control1Y - startY) ?? { x: aimX, y: aimY };

    const entity = context.spawnEntity({
      kind: 'arcSword',
      x: startX,
      y: startY,
      plan,
      skillInstanceId: plan.id,
      castId: context.castId,
      targetId: target.id,
      startX,
      startY,
      control1X,
      control1Y,
      baseEndX: endX,
      baseEndY: endY,
      baseControl2X: control2X,
      baseControl2Y: control2Y,
      endX,
      endY,
      control2X,
      control2Y,
      elapsed: 0,
      flightTime: plan.flightTime,
      life: plan.life,
      hitRadius: plan.hitRadius,
      maxHits: plan.maxHits,
      maxCorrection: plan.maxCorrection,
      hitCount: 0,
      dirX: initial.x,
      dirY: initial.y,
      side,
    });
    if (entity === null) return false;
    context.emitVisual({
      type: 'arcSwordCast',
      x: startX,
      y: startY,
      angle: Math.atan2(initial.y, initial.x),
      side,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    return true;
  },
});
