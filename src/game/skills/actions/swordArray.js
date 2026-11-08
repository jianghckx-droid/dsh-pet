// 剑阵：在目标位置创建固定区域，周期性对范围内有限目标提交命中。

import { RUNTIME_LIMITS } from '../schema.js';

export const swordArrayAction = Object.freeze({
  canCast(context) {
    if (context.entityCount('swordArray') >= context.plan.maxActive) return false;
    return context.queryNearest(context.world.player, context.plan.range) !== null;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    if (context.entityCount('swordArray') >= plan.maxActive) return false;
    const target = context.queryNearest(player, plan.range);
    if (target === null) return false;
    if (context.entityCount('swordArray') >= RUNTIME_LIMITS.maxSwordArrays) return false;
    const entity = context.spawnEntity({
      kind: 'swordArray',
      x: target.x,
      y: target.y,
      plan,
      skillInstanceId: plan.id,
      castId: context.castId,
      radius: plan.radius,
      life: plan.duration,
      tickInterval: plan.tickInterval,
      tickTimer: plan.tickInterval,
      maxTargets: plan.maxTargets,
    });
    if (entity === null) return false;
    context.emitVisual({
      type: 'swordArray',
      x: target.x,
      y: target.y,
      radius: plan.radius,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    return true;
  },
});
