// 层数表：敌人数量、类型与层修饰符。
//
// 旧文档里的"锁"（甲壳、分裂、锚定……）已随旧卡牌系统一起舍弃。
// 现在每一层只描述敌人构成与压力，不再要求特定卡牌组合。

export const FLOOR_SECONDS = 26;
export const TIME_LIMIT = 45;

/** 层修饰符：让同一套 build 在不同层表现不同。 */
export const MODIFIERS = Object.freeze({
  crowded: Object.freeze({ name: '拥挤', desc: '敌人 +50%，生命 −30%' }),
  frenzy: Object.freeze({ name: '狂暴', desc: '敌人移速 +30%，伤害 +1' }),
  elite: Object.freeze({ name: '精英', desc: '最后一只敌人强化，清层后额外给一次三选一' }),
  boss: Object.freeze({ name: '最终怪物', desc: '末位 Boss 大幅强化，击败后给两次三选一' }),
});

const FLOOR_MODIFIERS = Object.freeze({ 4: 'crowded', 7: 'frenzy', 10: 'elite', 13: 'elite' });

export function floorModifier(floor) {
  return FLOOR_MODIFIERS[floor] ?? null;
}

export const FLOORS = Object.freeze([
  Object.freeze({ floor: 1, count: 8, mix: Object.freeze({ swarm: 1 }) }),
  Object.freeze({ floor: 2, count: 9, mix: Object.freeze({ swarm: 1 }) }),
  Object.freeze({ floor: 3, count: 9, mix: Object.freeze({ swarm: 3, brute: 1 }) }),
  Object.freeze({ floor: 4, count: 12, mix: Object.freeze({ swarm: 3, brute: 1 }) }),
  Object.freeze({ floor: 5, count: 10, mix: Object.freeze({ swarm: 2, brute: 1 }) }),
  Object.freeze({ floor: 6, count: 10, mix: Object.freeze({ swarm: 2, brute: 1, skirmisher: 1 }) }),
  Object.freeze({ floor: 7, count: 11, mix: Object.freeze({ swarm: 2, brute: 1, skirmisher: 1 }) }),
  Object.freeze({ floor: 8, count: 10, mix: Object.freeze({ swarm: 2, brute: 2 }) }),
  Object.freeze({ floor: 9, count: 11, mix: Object.freeze({ swarm: 2, brute: 1, skirmisher: 1 }) }),
  Object.freeze({ floor: 10, count: 12, mix: Object.freeze({ swarm: 2, brute: 1, skirmisher: 2 }) }),
  Object.freeze({ floor: 11, count: 12, mix: Object.freeze({ swarm: 3, brute: 1, skirmisher: 1 }) }),
  Object.freeze({ floor: 12, count: 13, mix: Object.freeze({ swarm: 2, brute: 2, skirmisher: 1 }) }),
  Object.freeze({ floor: 13, count: 13, mix: Object.freeze({ swarm: 2, brute: 1, skirmisher: 2 }) }),
  Object.freeze({ floor: 14, count: 14, mix: Object.freeze({ swarm: 3, brute: 1, skirmisher: 2 }) }),
  Object.freeze({ floor: 15, count: 14, mix: Object.freeze({ swarm: 2, brute: 2, skirmisher: 2 }) }),
]);

export const MAX_FLOOR = 15;

/** 地图系统的最深层数；第 99 层为最终 Boss。 */
export const MAP_DEPTH = 99;

/**
 * 深层构成。地图会把第 1–99 层都当作可能的战斗层，所以第 16 层起不再逐层手写，
 * 而是沿用第 15 层的数量与混合继续平滑成长。数量在 16 只封顶：
 * 45 秒时限与护甲减伤共同决定上限，避免深层变成纯数值墙。
 */
export function deepFloorPlan(floor) {
  const def = FLOORS.find((entry) => entry.floor === floor);
  if (def !== undefined) return def;
  const depth = Math.max(16, Math.floor(floor));
  const count = Math.min(16, 14 + Math.floor((depth - 15) / 14));
  const mix = { swarm: 2, brute: 2, skirmisher: 2 };
  if (depth >= 30) mix.brute = 3;
  if (depth >= 45) mix.swarm = 3;
  if (depth >= 60) mix.skirmisher = 3;
  if (depth >= 75) {
    mix.swarm = 3;
    mix.brute = 3;
    mix.skirmisher = 3;
  }
  return { floor: depth, count, mix };
}

export function floorDef(n) {
  const def = FLOORS.find((entry) => entry.floor === n);
  if (def !== undefined) return def;
  if (Number.isInteger(n) && n >= 16 && n <= MAP_DEPTH) return deepFloorPlan(n);
  throw new Error(`floor not in table: ${n}`);
}

export function enemyTotal(def, { modifier, extra = 0 } = {}) {
  let base = def.count;
  if (modifier === 'crowded') base = Math.round(base * 1.5);
  return base + extra;
}

export function spawnSeconds(def) {
  return FLOOR_SECONDS / def.count;
}
