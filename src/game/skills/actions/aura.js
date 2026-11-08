// 光环：周期性选择身边有限目标，逐个提交统一命中。

export const auraAction = Object.freeze({
  canCast(context) {
    return context.queryTargets(context.world.player, context.plan.radius, context.plan.maxTargets).length > 0;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    const targets = context.queryTargets(player, plan.radius, plan.maxTargets);
    if (targets.length === 0) return false;
    context.emitVisual({
      type: 'pulse',
      x: player.x,
      y: player.y,
      radius: plan.radius,
      element: plan.element === null ? null : plan.element.id,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    targets.forEach((target, index) => {
      context.hit({
        targetId: target.id,
        center: player,
        extraTags: ['aura'],
        primary: index === 0,
      });
    });
    return true;
  },
});
