// 冲击：在选定目标位置产生一次范围强力命中，带 heavy 标签。

export const impactAction = Object.freeze({
  canCast(context) {
    return context.queryNearest(context.world.player, context.plan.range) !== null;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    const target = context.queryNearest(player, plan.range);
    if (target === null) return false;
    const center = { x: target.x, y: target.y };
    const targets = context.queryTargets(center, plan.radius, plan.maxTargets);
    if (targets.length === 0) return false;
    context.emitVisual({
      type: 'impact',
      x: center.x,
      y: center.y,
      radius: plan.radius,
      element: plan.element === null ? null : plan.element.id,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    targets.forEach((other, index) => {
      context.hit({
        targetId: other.id,
        center,
        extraTags: ['impact'],
        primary: index === 0,
      });
    });
    return true;
  },
});
