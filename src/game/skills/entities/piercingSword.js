// 穿透飞剑实体：直线飞行，沿途每个目标至多命中一次，达到命中数或射程后清理。

export const piercingSwordEntity = Object.freeze({
  update(context, dt) {
    const entity = context.entity;
    entity.life -= dt;
    const travel = entity.speed * dt;
    entity.traveled += travel;
    entity.x += entity.dirX * travel;
    entity.y += entity.dirY * travel;
    if (entity.life <= 0 || entity.traveled > entity.range) {
      entity.dead = true;
      return;
    }
    if (!Array.isArray(entity.hitIds)) entity.hitIds = [];
    const candidates = context.queryTargets(
      entity,
      entity.hitRadius,
      Math.max(entity.maxHits * 4, 8),
    );
    for (const enemy of candidates) {
      if (entity.hitIds.length >= entity.maxHits) break;
      if (entity.hitIds.includes(enemy.id)) continue;
      context.hit({
        targetId: enemy.id,
        center: { x: entity.x, y: entity.y },
        extraTags: ['swordPierce', 'path'],
        primary: entity.hitIds.length === 0,
      });
      entity.hitIds.push(enemy.id);
    }
    if (entity.hitIds.length >= entity.maxHits) entity.dead = true;
  },
});
