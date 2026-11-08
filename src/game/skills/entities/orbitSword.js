// 环绕飞剑实体：维护角度、半径、生命周期和逐目标命中间隔。
// 碰撞只提交统一命中，属性与反应仍走公共结算。

export const orbitSwordEntity = Object.freeze({
  update(context, dt) {
    const entity = context.entity;
    const world = context.world;
    entity.life -= dt;
    if (entity.life <= 0) {
      if (entity.nextHit instanceof Map) entity.nextHit.clear();
      entity.dead = true;
      return;
    }
    if (!(entity.nextHit instanceof Map)) entity.nextHit = new Map();
    entity.angle += entity.angularSpeed * dt;
    entity.x = world.player.x + Math.cos(entity.angle) * entity.orbitRadius;
    entity.y = world.player.y + Math.sin(entity.angle) * entity.orbitRadius;

    const candidates = context.queryTargets(
      entity,
      entity.hitRadius,
      Math.max(entity.maxTargets * 4, 8),
    );
    let hits = 0;
    for (const enemy of candidates) {
      if (hits >= entity.maxTargets) break;
      const readyAt = entity.nextHit.get(enemy.id) ?? 0;
      if (world.time < readyAt) continue;
      context.hit({
        targetId: enemy.id,
        center: { x: entity.x, y: entity.y },
        extraTags: ['orbit'],
        primary: hits === 0,
      });
      entity.nextHit.set(enemy.id, world.time + entity.hitInterval);
      hits += 1;
    }

    // 目标失效后清理命中记录，避免 Map 随波次无限增长。
    const aliveIds = new Set(
      world.enemies
        .filter((enemy) => enemy.cells > 0 && !enemy.dead && !enemy.deathHandled)
        .map((enemy) => enemy.id),
    );
    for (const id of entity.nextHit.keys()) {
      if (!aliveIds.has(id)) entity.nextHit.delete(id);
    }
  },
});
