// 陷阱实体：等待敌人进入触发范围，触发后提交范围命中并销毁。
// 与飞剑不同，它不移动，也不自主选敌。

export const trapEntity = Object.freeze({
  update(context, dt) {
    const entity = context.entity;
    entity.life -= dt;
    if (entity.life <= 0) {
      entity.dead = true;
      return;
    }
    if (context.time < entity.armedAt) return;
    const trigger = context.queryTargets(entity, entity.triggerRadius, 1);
    if (trigger.length === 0) return;
    const targets = context.queryTargets(entity, entity.radius, entity.maxTargets);
    context.emitVisual({
      type: 'trapTrigger',
      x: entity.x,
      y: entity.y,
      radius: entity.radius,
      color: entity.plan.element === null ? entity.plan.action.color : entity.plan.element.color,
      skillId: entity.plan.id,
    });
    targets.forEach((enemy, index) => {
      context.hit({
        targetId: enemy.id,
        center: { x: entity.x, y: entity.y },
        extraTags: ['trap'],
        primary: index === 0,
      });
    });
    entity.dead = true;
  },
});
