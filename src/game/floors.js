// 层数表（1–12 层，MVP 用 1–8）。
//
// 数值来自 docs/floors.md，改动前先跑 `node tools/balance-sim.mjs --sweep`
// 确认第 6 层那道墙还在。
//
// "双锁混编"的实现是：同一层的敌人轮换携带不同的单锁，而不是一只怪同时带两个锁。
// 同时带两个锁的怪留给以后（倍率相乘已经是按这个设计的）。

export const FLOOR_SECONDS = 30;

/** 锁对格数的倍率。一只怪带多个锁时相乘。 */
export const LOCK_CELLS = Object.freeze({
  carapace: 2,
  split: 1.2,
  regen: 1.5,
  shield: 1.5,
  anchor: 1.4,
  cleanse: 1.2,
  devour: 1.5,
  phase: 1.3,
  reflect: 1.2,
  generator: 1.5,
});

export function baseCells(floor) {
  return 3 + 1.2 * floor;
}

export function lockMultiplier(locks = []) {
  return locks.reduce((m, lock) => m * (LOCK_CELLS[lock] ?? 1), 1);
}

/** 先乘倍率再取整，否则 ×2 的锁会比设计值少 1 格（第 7 层就是例子）。 */
export function enemyCells(floor, locks = []) {
  return Math.round(baseCells(floor) * lockMultiplier(locks));
}

export function enemyDamage(floor) {
  return floor >= 8 ? 2 : 1;
}

export function spawnSeconds(def) {
  return FLOOR_SECONDS / def.enemies;
}

export const FLOORS = Object.freeze([
  Object.freeze({ floor: 1, enemies: 6, locks: Object.freeze([]) }),
  Object.freeze({ floor: 2, enemies: 7, locks: Object.freeze([]) }),
  Object.freeze({ floor: 3, enemies: 8, locks: Object.freeze([]) }),
  Object.freeze({ floor: 4, enemies: 9, locks: Object.freeze([]) }),
  Object.freeze({ floor: 5, enemies: 10, locks: Object.freeze([]) }),
  Object.freeze({ floor: 6, enemies: 10, locks: Object.freeze(['carapace']) }),
  Object.freeze({ floor: 7, enemies: 10, locks: Object.freeze(['carapace']) }),
  Object.freeze({ floor: 8, enemies: 11, locks: Object.freeze(['carapace']) }),
  Object.freeze({ floor: 9, enemies: 10, locks: Object.freeze(['split']) }),
  Object.freeze({ floor: 10, enemies: 11, locks: Object.freeze(['anchor']) }),
  Object.freeze({ floor: 11, enemies: 11, locks: Object.freeze(['cleanse']) }),
  Object.freeze({ floor: 12, enemies: 12, locks: Object.freeze(['phase']) }),
  Object.freeze({ floor: 13, enemies: 12, locks: Object.freeze(['devour']) }),
  Object.freeze({ floor: 14, enemies: 12, locks: Object.freeze(['generator']) }),
  Object.freeze({ floor: 15, enemies: 13, locks: Object.freeze(['reflect']) }),
]);

/** MVP 只做到第 8 层（第 6 层是墙，第 8 层是切片上限）。 */
export const MVP_FLOOR_COUNT = 8;

export const MVP_FLOORS = Object.freeze(FLOORS.filter((f) => f.floor <= MVP_FLOOR_COUNT));

export function floorDef(n) {
  const def = FLOORS.find((f) => f.floor === n);
  if (def === undefined) throw new Error(`floor not in table: ${n}`);
  return def;
}
