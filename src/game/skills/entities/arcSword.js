// 弧光飞剑实体：三次贝塞尔弧线 + 末段有限追踪 + 线段扫掠碰撞。
//
// 进度按时间归一化：0→1 对应 flightTime。前 70% 锁定施放时终点，后 30%
// 把终点向目标当前位置修正，累计位移不超过 maxCorrection，控制点二同步平移。
// 目标失效后保留最后有效终点，不重新索敌。命中只提交一次共享命中并结束。

const TRACK_START = 0.7;
const MAX_PARAM_STEP = 0.08;

function arcSwordPoint(entity, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * entity.startX + b * entity.control1X + c * entity.control2X + d * entity.endX,
    y: a * entity.startY + b * entity.control1Y + c * entity.control2Y + d * entity.endY,
  };
}

function arcSwordTarget(world, targetId) {
  for (const enemy of world.enemies) {
    if (enemy.id !== targetId) continue;
    if (enemy.cells <= 0 || enemy.dead || enemy.deathHandled) return null;
    return enemy;
  }
  return null;
}

function arcSwordUpdateEnd(context, entity) {
  const target = arcSwordTarget(context.world, entity.targetId);
  if (target === null) return;
  const dx = target.x - entity.baseEndX;
  const dy = target.y - entity.baseEndY;
  const distance = Math.hypot(dx, dy);
  const cap = Number.isFinite(entity.maxCorrection) ? entity.maxCorrection : 18;
  const scale = distance > cap ? cap / distance : 1;
  const offsetX = dx * scale;
  const offsetY = dy * scale;
  entity.endX = entity.baseEndX + offsetX;
  entity.endY = entity.baseEndY + offsetY;
  entity.control2X = entity.baseControl2X + offsetX;
  entity.control2Y = entity.baseControl2Y + offsetY;
}

export const arcSwordEntity = Object.freeze({
  update(context, dt) {
    const entity = context.entity;
    const flightTime = entity.flightTime > 0 ? entity.flightTime : 0.55;
    const previousElapsed = Math.max(0, entity.elapsed);
    entity.elapsed += dt;
    entity.life -= dt;
    const tPrev = Math.min(1, previousElapsed / flightTime);
    const tNext = Math.min(1, entity.elapsed / flightTime);

    if (tNext > TRACK_START) arcSwordUpdateEnd(context, entity);

    const delta = tNext - tPrev;
    const steps = Math.max(1, Math.ceil(delta / MAX_PARAM_STEP));
    let fromX = entity.x;
    let fromY = entity.y;
    let toX = fromX;
    let toY = fromY;

    for (let index = 1; index <= steps; index += 1) {
      const t = tPrev + (delta * index) / steps;
      const point = arcSwordPoint(entity, t);
      toX = point.x;
      toY = point.y;
      const moveX = toX - fromX;
      const moveY = toY - fromY;
      const moved = Math.hypot(moveX, moveY);
      if (moved > 1e-6) {
        entity.dirX = moveX / moved;
        entity.dirY = moveY / moved;
      }
      const contacts = context.sweepEnemies(fromX, fromY, toX, toY, entity.hitRadius);
      if (contacts.length > 0) {
        const contact = contacts[0];
        const hitX = fromX + moveX * contact.t;
        const hitY = fromY + moveY * contact.t;
        entity.x = hitX;
        entity.y = hitY;
        context.hit({
          targetId: contact.enemy.id,
          center: { x: hitX, y: hitY },
          extraTags: ['arcSword'],
          primary: true,
        });
        entity.hitCount += 1;
        entity.dead = true;
        break;
      }
      fromX = toX;
      fromY = toY;
    }

    if (!entity.dead) {
      entity.x = toX;
      entity.y = toY;
    }
    if (entity.hitCount >= entity.maxHits) entity.dead = true;
    if (entity.life <= 0) entity.dead = true;
    if (tNext >= 1) entity.dead = true;
  },
});
