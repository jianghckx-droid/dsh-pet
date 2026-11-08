// 挥斩：靠近目标后朝其方向挥出扇形，命中扇区内有限敌人。

const angleDelta = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

export const swingAction = Object.freeze({
  canCast(context) {
    return context.queryNearest(context.world.player, context.plan.radius) !== null;
  },

  cast(context) {
    const plan = context.plan;
    const player = context.world.player;
    const target = context.queryNearest(player, plan.radius);
    if (target === null) return false;
    const facing = Math.atan2(target.y - player.y, target.x - player.x);
    const half = ((plan.angle ?? 90) * Math.PI) / 360;
    const candidates = context.queryTargets(player, plan.radius, Math.max(plan.maxTargets * 4, 8));
    const hits = candidates
      .filter((enemy) => angleDelta(Math.atan2(enemy.y - player.y, enemy.x - player.x), facing) <= half)
      .slice(0, plan.maxTargets);
    if (hits.length === 0) return false;
    context.emitVisual({
      type: 'swing',
      x: player.x,
      y: player.y,
      radius: plan.radius,
      angle: facing,
      half,
      element: plan.element === null ? null : plan.element.id,
      skillId: plan.id,
      color: plan.element === null ? plan.action.color : plan.element.color,
    });
    hits.forEach((enemy, index) => {
      context.hit({
        targetId: enemy.id,
        center: player,
        extraTags: ['swing', 'arc'],
        primary: index === 0,
      });
    });
    return true;
  },
});
