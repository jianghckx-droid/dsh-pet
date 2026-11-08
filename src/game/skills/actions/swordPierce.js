// 飞剑穿敌：朝目标方向放出直线飞行的穿透飞剑，沿途每个敌人只命中一次。

import { RUNTIME_LIMITS } from '../schema.js';

export const swordPierceAction = Object.freeze({
  canCast(context) {
    if (context.entityCount('piercingSword') >= RUNTIME_LIMITS.maxSwordPieces) return false;
    return context.queryNearest(context.world.player, context.plan.range) !== null;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    const target = context.queryNearest(player, plan.range);
    if (target === null) return false;
    if (context.entityCount('piercingSword') >= RUNTIME_LIMITS.maxSwordPieces) return false;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const length = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const entity = context.spawnEntity({
      kind: 'piercingSword',
      x: player.x,
      y: player.y,
      plan,
      skillInstanceId: plan.id,
      castId: context.castId,
      dirX: dx / length,
      dirY: dy / length,
      angle,
      speed: plan.speed,
      hitRadius: plan.radius,
      life: plan.life,
      range: plan.range,
      maxHits: plan.maxHits,
      hitIds: [],
      traveled: 0,
    });
    if (entity === null) return false;
    context.emitVisual({
      type: 'swordShot',
      x: player.x,
      y: player.y,
      angle,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    return true;
  },
});
