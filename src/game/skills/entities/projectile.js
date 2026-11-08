// 飞弹实体：追踪目标、推进、碰撞并提交统一命中。
// 计划快照在发射时固定；改装后的新施放使用新计划。

export const projectileEntity = Object.freeze({
  update(context, dt) {
    const entity = context.entity;
    const world = context.world;
    const target = world.enemies.find(
      (enemy) => enemy.id === entity.targetId && enemy.cells > 0 && !enemy.dead && !enemy.deathHandled,
    );
    if (target === undefined) {
      entity.life -= dt;
      if (entity.life <= 0) entity.dead = true;
      return;
    }
    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const distance = Math.hypot(dx, dy) || 1;
    const travel = entity.speed * dt;
    if (distance <= travel + entity.hitRadius + target.r) {
      context.hit({
        targetId: target.id,
        center: { x: target.x, y: target.y },
        extraTags: ['projectile'],
      });
      entity.dead = true;
      return;
    }
    entity.x += (dx / distance) * travel;
    entity.y += (dy / distance) * travel;
    entity.life -= dt;
    if (entity.life <= 0) entity.dead = true;
  },
});
