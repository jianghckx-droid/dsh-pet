// 御剑：召唤环绕自身的飞剑实体。环绕、碰撞与命中间隔由 entities/orbitSword.js 推进。

export const orbitSwordAction = Object.freeze({
  canCast(context) {
    return context.entityCount('orbitSword') < context.plan.maxActive;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    if (context.entityCount('orbitSword') >= plan.maxActive) return false;
    const entity = context.spawnEntity({
      kind: 'orbitSword',
      x: player.x,
      y: player.y,
      plan,
      skillInstanceId: plan.id,
      castId: context.castId,
      angle: context.rng() * Math.PI * 2,
      orbitRadius: plan.orbitRadius,
      hitRadius: plan.hitRadius,
      angularSpeed: plan.angularSpeed,
      life: plan.duration,
      hitInterval: plan.hitInterval,
      maxTargets: plan.maxTargets,
      nextHit: new Map(),
    });
    if (entity === null) return false;
    context.emitVisual({
      type: 'swordSummon',
      x: player.x,
      y: player.y,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    return true;
  },
});
