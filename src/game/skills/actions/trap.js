// 陷阱：在脚下放置等待触发的实体。触发与清理由 entities/trap.js 推进。

export const trapAction = Object.freeze({
  canCast(context) {
    return context.entityCount('trap') < context.plan.maxActive;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    if (context.entityCount('trap') >= plan.maxActive) return false;
    const target = context.queryNearest(player, plan.range);
    const center = target === null ? { x: player.x, y: player.y } : { x: target.x, y: target.y };
    const entity = context.spawnEntity({
      kind: 'trap',
      x: center.x,
      y: center.y,
      plan,
      skillInstanceId: plan.id,
      castId: context.castId,
      radius: plan.radius,
      triggerRadius: plan.triggerRadius,
      armTime: plan.armTime,
      life: plan.duration,
      maxTargets: plan.maxTargets,
      armedAt: context.time + plan.armTime,
    });
    if (entity === null) return false;
    context.emitVisual({
      type: 'trapPlaced',
      x: center.x,
      y: center.y,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    return true;
  },
});
