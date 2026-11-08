// 飞弹：检查目标与实体上限，创建带计划快照的弹体实体。

import { RUNTIME_LIMITS } from '../schema.js';

export const projectileAction = Object.freeze({
  canCast(context) {
    const plan = context.plan;
    if (context.entityCount('projectile') >= RUNTIME_LIMITS.maxProjectiles) return false;
    return context.queryNearest(context.world.player, plan.range) !== null;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    const target = context.queryNearest(player, plan.range);
    if (target === null) return false;
    const entity = context.spawnEntity({
      kind: 'projectile',
      x: player.x,
      y: player.y,
      targetId: target.id,
      plan,
      skillInstanceId: plan.id,
      castId: context.castId,
      speed: plan.speed,
      hitRadius: plan.action.params.radius ?? 3,
      life: plan.life,
    });
    if (entity === null) return false;
    context.emitVisual({
      type: 'shot',
      x: player.x,
      y: player.y,
      skillId: plan.id,
      element: plan.element === null ? null : plan.element.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    return true;
  },
});
