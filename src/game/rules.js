// 战斗规则：唯一一份。
//
// 游戏端（client.js）与数值模拟器（tools/balance-sim.mjs）都必须从这里取规则，
// 否则"设计用的数字"和"跑起来的游戏"会各算各的。
//
// 三条硬规则，改动前先看 docs/design.md §5 与 docs/cards.md §1：
//   1. 结算顺序固定：基础格 → +锋锐 → 锁裁决 → 扣格
//   2. 锁永远最后裁决，所以属性无法覆盖锁
//   3. 锋锐只加主攻击，不加灼烧跳/雷跳/碎冰/尸爆/斩杀

export const BURN = Object.freeze({
  cap: 5, // 每个目标最多 5 层
  tickSeconds: 1.5, // 每层每 1.5 秒造成 1 格
  durationSeconds: 6, // 叠层后 6 秒内没有新层就熄灭
  damagePerStack: 1,
});

export const PLAYER = Object.freeze({
  baseCells: 12,
  cellsPerBody: 2, // 体魄：+2 格/点
  pointsPerEdgeCell: 2, // 锋锐：每 2 点 +1 格
});

export const ATTR_MAX = 10;

export const ATTRIBUTES = Object.freeze([
  Object.freeze({ id: 'edge', label: '锋锐', max: ATTR_MAX, desc: '每 2 点 +1 格' }),
  Object.freeze({ id: 'swift', label: '迅捷', max: ATTR_MAX, desc: '冷却 −4%/点' }),
  Object.freeze({ id: 'body', label: '体魄', max: ATTR_MAX, desc: '生命 +2 格/点' }),
  Object.freeze({ id: 'tough', label: '坚韧', max: ATTR_MAX, desc: '受伤 −3%/点' }),
  Object.freeze({ id: 'recover', label: '复原', max: ATTR_MAX, desc: '每秒 +0.2 格' }),
  Object.freeze({ id: 'vision', label: '视野', max: ATTR_MAX, desc: '射程 +6%/点' }),
]);

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(v) ? v : lo)));

export function normalizeAttrs(attrs = {}) {
  const out = {};
  for (const attr of ATTRIBUTES) out[attr.id] = clampInt(attrs[attr.id] ?? 0, 0, attr.max);
  return out;
}

export function attrsSpent(attrs = {}) {
  let n = 0;
  for (const attr of ATTRIBUTES) n += attrs[attr.id] ?? 0;
  return n;
}

export function playerCells(attrs = {}) {
  return PLAYER.baseCells + (attrs.body ?? 0) * PLAYER.cellsPerBody;
}

export function edgeCells(attrs = {}) {
  return Math.floor((attrs.edge ?? 0) / PLAYER.pointsPerEdgeCell);
}

/** 坚韧：受伤 −3%/点，至少还是掉 1 格以下（不取整，格数允许小数）。 */
export function damageTaken(cells, attrs = {}) {
  const cut = (attrs.tough ?? 0) * 0.03;
  return Math.max(0.1, cells * (1 - cut));
}

/** 迅捷：冷却 −4%/点。 */
export function cooldown(cd, attrs = {}) {
  return cd * (1 - (attrs.swift ?? 0) * 0.04);
}

/** 复原：每秒 +0.2 格。 */
export function regenPerSecond(attrs = {}) {
  return (attrs.recover ?? 0) * 0.2;
}

/** 视野：射程 / 领域半径 +6%/点。 */
export function visionScale(attrs = {}) {
  return 1 + (attrs.vision ?? 0) * 0.06;
}

/** 主攻击的格数：卡面基础格 + 锋锐。衍生效果不要调这个函数。 */
export function attackCells(card, attrs = {}) {
  return (card.cells ?? 1) + edgeCells(attrs);
}

function locksOf(enemy) {
  if (Array.isArray(enemy.locks)) return enemy.locks;
  return enemy.lock ? [enemy.lock] : [];
}

/**
 * 锁裁决。
 * main=true 表示主攻击（吃护盾正面减伤），false 表示衍生伤害（灼烧跳等）。
 */
export function resolveHit(enemy, cells, { main = true } = {}) {
  let dealt = cells;
  for (const lock of locksOf(enemy)) {
    if (lock === 'carapace') {
      dealt = Math.min(dealt, 1); // 单次最多 1 格
    } else if (lock === 'shield' && main) {
      dealt = Math.max(0, dealt - 1); // 正面直接命中 -1 格
    }
  }
  return Math.max(0, dealt);
}

export function createStatus() {
  return { burn: 0, burnLeft: 0, burnTick: BURN.tickSeconds };
}

export function applyBurn(status, stacks, cap = BURN.cap) {
  if (stacks <= 0) return;
  status.burn = Math.min(cap, status.burn + stacks);
  status.burnLeft = BURN.durationSeconds;
}

/**
 * 推进状态，返回这一帧的灼烧伤害（0 表示没有跳）。
 * 调用方负责再走一次 resolveHit(..., { main: false })。
 */
export function advanceStatus(status, dt) {
  if (status.burn <= 0) return 0;
  status.burnLeft -= dt;
  if (status.burnLeft <= 0) {
    status.burn = 0;
    return 0;
  }
  status.burnTick -= dt;
  if (status.burnTick > 0) return 0;
  status.burnTick += BURN.tickSeconds;
  return status.burn * BURN.damagePerStack;
}

/**
 * 稳态 DPS：忽略预热与目标死亡，用来比较 build 的形状。
 * 数值模拟器与单测共用，保证"设计稿里的 5 倍差距"能被复现。
 */
export function steadyDps(cards, attrs, enemy) {
  let direct = 0;
  let burnPerSecond = 0;
  for (const card of cards) {
    direct += resolveHit(enemy, attackCells(card, attrs), { main: true }) / card.cd;
    burnPerSecond += (card.burn ?? 0) / card.cd;
  }
  // 层数只在"连续 6 秒没有新层"时整体熄灭，不会逐层衰减。
  // 所以平衡态是"6 秒内能叠到几层"，再受 5 层上限约束。
  const stacks = Math.min(BURN.cap, burnPerSecond * BURN.durationSeconds);
  return direct + (stacks * BURN.damagePerStack) / BURN.tickSeconds;
}
