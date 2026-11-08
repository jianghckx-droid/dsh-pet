// 剑阵实体：固定在目标位置，按间隔对范围内有限目标提交命中，到期清理。

export const swordArrayEntity = Object.freeze({
  update(context, dt) {
    const entity = context.entity;
    entity.life -= dt;
    if (entity.life <= 0) {
      entity.dead = true;
      return;
    }
    entity.tickTimer -= dt;
    if (entity.tickTimer > 0) return;
    entity.tickTimer += entity.tickInterval;
    const targets = context.queryTargets(entity, entity.radius, entity.maxTargets);
    if (targets.length === 0) return;
    context.emitVisual({
      type: 'swordArrayPulse',
      x: entity.x,
      y: entity.y,
      radius: entity.radius,
      skillId: entity.plan.id,
      color: entity.plan.element === null ? entity.plan.action.color : entity.plan.element.color,
    });
    targets.forEach((enemy, index) => {
      context.hit({
        targetId: enemy.id,
        center: { x: entity.x, y: entity.y },
        extraTags: ['swordArray', 'sustain'],
        primary: index === 0,
      });
    });
  },
});
