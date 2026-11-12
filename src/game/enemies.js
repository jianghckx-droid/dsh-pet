// 敌人定义：通过行为、位置和数量制造不同问题，不要求玩家拥有唯一解法。
//
// 敌人不读取具体技能 ID；只使用统一的伤害、状态、移动和死亡接口。
// 第一版原型使用设计稿里的三种敌人：群游者、重甲兽、游击者。

export const ENEMY_TYPES = Object.freeze({
  swarm: Object.freeze({
    id: 'swarm',
    label: '群游者',
    cells: 4,
    speed: 34,
    damage: 1,
    radius: 2.6,
    behavior: 'chase',
    attackInterval: 1.6,
    xp: 1,
    color: { rim: '#7e312c', body: '#c4534b' },
  }),
  brute: Object.freeze({
    id: 'brute',
    label: '重甲兽',
    cells: 14,
    speed: 16,
    damage: 2,
    radius: 4.2,
    behavior: 'chase',
    attackInterval: 2.2,
    xp: 3,
    color: { rim: '#314554', body: '#6f97b0' },
  }),
  skirmisher: Object.freeze({
    id: 'skirmisher',
    label: '游击者',
    cells: 6,
    speed: 30,
    damage: 1,
    radius: 2.8,
    behavior: 'kite',
    preferredRange: 52,
    attackInterval: 2.4,
    shot: Object.freeze({ speed: 120, damage: 1, radius: 2.5, life: 1.6 }),
    xp: 2,
    color: { rim: '#4d2379', body: '#8f4bd6' },
  }),
});

export function enemyType(id) {
  const def = ENEMY_TYPES[id];
  if (def === undefined) throw new Error(`unknown enemy type: ${String(id)}`);
  return def;
}

/**
 * 按层成长；同一层的不同敌人共享倍率，保持相对关系。
 * 第 1–15 层沿用原系数；深层改走更缓的曲线，否则体魄与技能成长追不上
 * 指数式的生命膨胀，99 层会变成纯数值墙。
 */
export function enemyCellsAt(floor, type) {
  const def = enemyType(type);
  const depth = Math.max(1, Math.floor(Number(floor) || 1));
  const growth = depth <= 15
    ? 0.13 * (depth - 1)
    : 0.13 * 14 + 0.045 * (depth - 15);
  return Math.max(1, Math.round(def.cells * (1 + growth)));
}

export function enemyDamageAt(floor, type) {
  const def = enemyType(type);
  const depth = Math.max(1, Math.floor(Number(floor) || 1));
  let bonus = depth >= 10 ? 1 : 0;
  if (depth >= 30) bonus += 1;
  if (depth >= 55) bonus += 1;
  if (depth >= 80) bonus += 1;
  return def.damage + bonus;
}

/** 层定义给出权重表，刷新时按权重循环取类型，保证同层混合稳定可复现。 */
export function bagOf(mix) {
  const bag = [];
  for (const [type, weight] of Object.entries(mix)) {
    const times = Math.max(0, Math.floor(weight));
    for (let i = 0; i < times; i += 1) bag.push(type);
  }
  return bag;
}
