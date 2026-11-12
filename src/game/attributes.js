// 角色属性：基础属性 → 战斗属性 → 伤害、减伤与施放节奏。
//
// 换算、上限与公式来自 docs/character-attributes-design.md。这里只放纯函数：
// 不持有战斗状态，也不读全局 RNG。战斗层把 createCombatStats() 的结果放进
// world.combat，公共结算入口再按命令标注的伤害通道读取它：
//
//   最终伤害 = 基础伤害 × (1 + 通用伤害加成 + 满足条件的伤害加成)
//            × 暴击倍率
//   护甲减伤 = min(60%, 护甲 / (护甲 + 100))
//   实际冷却 = 基础冷却 / (1 + 攻击速度)
//
// 装备尚未实现；装备词条通过 bonuses 参数直接加在战斗属性上，条件伤害用
// 规则数组表达，等到装备系统落地时只需往这里传数据，不改结算代码。

/** 四项基础属性；顺序即升级界面的展示顺序。 */
export const ATTRIBUTES = Object.freeze({
  strength: Object.freeze({
    id: 'strength',
    label: '力量',
    affects: Object.freeze(['armor']),
    summary: '护甲 +2',
  }),
  agility: Object.freeze({
    id: 'agility',
    label: '敏捷',
    affects: Object.freeze(['attackSpeed', 'critChance']),
    summary: '攻击速度 +1%，暴击率 +0.5 个百分点',
  }),
  intellect: Object.freeze({
    id: 'intellect',
    label: '智力',
    affects: Object.freeze(['damageBonus']),
    summary: '通用伤害加成 +2%',
  }),
  vitality: Object.freeze({
    id: 'vitality',
    label: '体魄',
    affects: Object.freeze(['maxLife']),
    summary: '最大生命 +1',
  }),
});

export const ATTRIBUTE_IDS = Object.freeze(Object.keys(ATTRIBUTES));

/** 每投入 1 点的换算。所有战斗风格共用同一份。 */
export const POINT_EFFECTS = Object.freeze({
  strength: Object.freeze({ armor: 2 }),
  agility: Object.freeze({ attackSpeed: 0.01, critChance: 0.005 }),
  intellect: Object.freeze({ damageBonus: 0.02 }),
  vitality: Object.freeze({ maxLife: 1 }),
});

/** 未装备任何物品时也保留的基础值。 */
export const COMBAT_BASE = Object.freeze({
  maxLife: 24,
  armor: 0,
  damageBonus: 0,
  attackSpeed: 0,
  critChance: 0.05,
  critDamage: 0.5,
});

export const COMBAT_CAPS = Object.freeze({
  armorReduction: 0.6,
  attackSpeed: 1,
  critChance: 1,
});

/**
 * 伤害通道：决定这一条伤害能不能暴击。
 * 元素标签由命令自带，条件伤害按标签匹配，与通道无关。
 */
export const DAMAGE_CHANNELS = Object.freeze({
  direct: Object.freeze({ id: 'direct', label: '直接命中', crit: true }),
  derived: Object.freeze({ id: 'derived', label: '派生命中', crit: true }),
  dot: Object.freeze({ id: 'dot', label: '持续伤害', crit: false }),
  reaction: Object.freeze({ id: 'reaction', label: '反应伤害', crit: false }),
});

const COMBAT_LABELS = Object.freeze({
  armor: '护甲',
  maxLife: '生命',
  damageBonus: '伤害',
  attackSpeed: '攻速',
  critChance: '暴击',
  critDamage: '暴击伤害',
});

const clampCombat = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

const finite = (value, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function normalizeCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function emptyAttributes() {
  const out = {};
  for (const id of ATTRIBUTE_IDS) out[id] = 0;
  return out;
}

/** 把存档 / UI 输入收敛成"四项非负整数"；未知字段丢弃。 */
export function normalizeAttributes(raw) {
  const out = emptyAttributes();
  if (raw === null || typeof raw !== 'object') return out;
  for (const id of ATTRIBUTE_IDS) out[id] = normalizeCount(raw[id]);
  return out;
}

export function spentPoints(attributes) {
  const attrs = normalizeAttributes(attributes);
  let total = 0;
  for (const id of ATTRIBUTE_IDS) total += attrs[id];
  return total;
}

/** 等级对应的总点数：1 级 0 点，每升一级 +1。 */
export function totalPointsFor(level) {
  return Math.max(0, Math.floor(finite(level, 1)) - 1);
}

/** 存档迁移用：按等级推算还没花掉的点数，已投入的部分扣掉。 */
export function unspentPointsFor(level, attributes) {
  return Math.max(0, totalPointsFor(level) - spentPoints(attributes));
}

export function armorReductionOf(armor) {
  const value = Math.max(0, finite(armor));
  if (value <= 0) return 0;
  return Math.min(COMBAT_CAPS.armorReduction, value / (value + 100));
}

/** 条件伤害规则是否可用：必须至少写一个条件，否则等于无条件加成。 */
function validConditional(rule) {
  if (rule === null || typeof rule !== 'object') return false;
  if (!(finite(rule.damage) > 0)) return false;
  const hasElement = typeof rule.element === 'string' && rule.element.length > 0;
  const hasTag = typeof rule.tag === 'string' && rule.tag.length > 0;
  const hasStatus = typeof rule.status === 'string' && rule.status.length > 0;
  return hasElement || hasTag || hasStatus;
}

/**
 * 基础属性 + 装备词条 → 最终战斗属性。
 * bonuses 是装备系统的接入点：{ maxLife, armor, damageBonus, attackSpeed,
 * critChance, critDamage, conditional: [{ damage, element?, tag?, status? }] }。
 */
export function createCombatStats(attributes, bonuses = {}) {
  const attrs = normalizeAttributes(attributes);
  const extra = bonuses === null || typeof bonuses !== 'object' ? {} : bonuses;
  const effects = POINT_EFFECTS;

  const armor = Math.max(0, COMBAT_BASE.armor + attrs.strength * effects.strength.armor + finite(extra.armor));
  const maxLife = Math.max(1, COMBAT_BASE.maxLife + attrs.vitality * effects.vitality.maxLife + finite(extra.maxLife));
  const damageBonus = Math.max(
    0,
    COMBAT_BASE.damageBonus + attrs.intellect * effects.intellect.damageBonus + finite(extra.damageBonus),
  );
  const attackSpeed = clampCombat(
    COMBAT_BASE.attackSpeed + attrs.agility * effects.agility.attackSpeed + finite(extra.attackSpeed),
    0,
    COMBAT_CAPS.attackSpeed,
  );
  const critChance = clampCombat(
    COMBAT_BASE.critChance + attrs.agility * effects.agility.critChance + finite(extra.critChance),
    0,
    COMBAT_CAPS.critChance,
  );
  const critDamage = Math.max(0, COMBAT_BASE.critDamage + finite(extra.critDamage));
  const conditional = Array.isArray(extra.conditional)
    ? extra.conditional.filter(validConditional).map((rule) => ({ ...rule }))
    : [];

  return {
    attributes: attrs,
    spent: spentPoints(attrs),
    maxLife,
    armor,
    armorReduction: armorReductionOf(armor),
    damageBonus,
    attackSpeed,
    critChance,
    critDamage,
    conditional,
  };
}

/** 没有战斗对象时（UI 预览、纯函数调用）使用的基准。 */
export const DEFAULT_COMBAT = createCombatStats();

/** 命中上下文里满足条件的伤害加成之和；同一条规则只算一次。 */
export function conditionalBonus(combat, context = {}) {
  const rules = combat === null || combat === undefined ? null : combat.conditional;
  if (!Array.isArray(rules) || rules.length === 0) return 0;
  const element = context.element ?? null;
  const tags = Array.isArray(context.tags) ? context.tags : [];
  const target = context.target ?? null;
  let sum = 0;
  for (const rule of rules) {
    if (typeof rule.element === 'string' && rule.element !== element) continue;
    if (typeof rule.tag === 'string' && !tags.includes(rule.tag)) continue;
    if (typeof rule.status === 'string') {
      const stacks = target === null || target.statuses === undefined
        ? 0
        : target.statuses[rule.status]?.stacks ?? 0;
      if (stacks <= 0) continue;
    }
    sum += finite(rule.damage);
  }
  return sum;
}

/**
 * 把一条伤害折算成最终值。属性在公共入口统一应用，各动作不重复实现。
 * @returns {{amount:number, base:number, scaling:number, crit:boolean,
 *            critMultiplier:number, channel:string}}
 */
export function resolveDamage(combat, options = {}) {
  const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
  const base = Math.max(0, finite(options.amount));
  const channel = typeof options.channel === 'string' ? options.channel : 'direct';
  const spec = DAMAGE_CHANNELS[channel] ?? DAMAGE_CHANNELS.direct;
  const scaling =
    1 +
    finite(stats.damageBonus) +
    conditionalBonus(stats, {
      element: options.element ?? null,
      tags: options.tags,
      target: options.target ?? null,
    });
  let crit = false;
  if (spec.crit && finite(stats.critChance) > 0 && typeof options.rng === 'function') {
    crit = options.rng() < stats.critChance;
  }
  const critMultiplier = crit ? 1 + Math.max(0, finite(stats.critDamage)) : 1;
  return {
    amount: base * scaling * critMultiplier,
    base,
    scaling,
    crit,
    critMultiplier,
    channel: spec.id,
  };
}

/** 受到伤害：护甲对当前所有敌人伤害统一生效。 */
export function mitigateDamage(amount, combat) {
  const raw = Math.max(0, finite(amount));
  const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
  const reduction = clampCombat(finite(stats.armorReduction), 0, COMBAT_CAPS.armorReduction);
  return raw * (1 - reduction);
}

/** 攻击速度只作用于施放冷却，不改变实体内部计时。 */
export function effectiveCooldown(baseCooldown, combat) {
  const base = Math.max(0, finite(baseCooldown));
  const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
  const speed = clampCombat(finite(stats.attackSpeed), 0, COMBAT_CAPS.attackSpeed);
  return base / (1 + speed);
}

function percentValue(scale) {
  const pct = Math.round(finite(scale) * 1000) / 10;
  return (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)) + '%';
}

export function formatCombatValue(key, value) {
  if (key === 'armor' || key === 'maxLife') return String(Math.round(finite(value)));
  if (key === 'damageBonus') return '+' + percentValue(value);
  return percentValue(value);
}

/** 一条战斗属性的可读文本，例如「护甲 6 → 8」。 */
export function describeCombat(key, before, after) {
  const label = COMBAT_LABELS[key] ?? key;
  return `${label} ${formatCombatValue(key, before)} → ${formatCombatValue(key, after)}`;
}

/**
 * 投入 1 点后的预览：升级界面用它显示「力量 3 → 4，护甲 6 → 8」。
 * 返回 null 表示未知属性。
 */
export function previewAttribute(attributes, id, bonuses = {}) {
  const def = ATTRIBUTES[id];
  if (def === undefined) return null;
  const current = normalizeAttributes(attributes);
  const before = createCombatStats(current, bonuses);
  const next = { ...current, [id]: current[id] + 1 };
  const after = createCombatStats(next, bonuses);
  const changes = def.affects.map((key) => ({
    key,
    label: COMBAT_LABELS[key] ?? key,
    before: before[key],
    after: after[key],
    text: describeCombat(key, before[key], after[key]),
  }));
  return {
    id,
    label: def.label,
    points: current[id],
    nextPoints: next[id],
    changes,
    text: changes.map((change) => change.text).join(' · '),
  };
}

/** 战斗属性的一行摘要；顶部与属性面板共用。 */
export function describeCombatStats(combat) {
  const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
  return [
    '护甲 ' + formatCombatValue('armor', stats.armor),
    '伤害 ' + formatCombatValue('damageBonus', stats.damageBonus),
    '攻速 ' + formatCombatValue('attackSpeed', stats.attackSpeed),
    '暴击 ' + formatCombatValue('critChance', stats.critChance) +
      ' ×' + String(Math.round((1 + finite(stats.critDamage)) * 100) / 100),
  ].join(' · ');
}
