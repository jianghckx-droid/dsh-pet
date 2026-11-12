// 节点内容：战斗构成、事件选项、商店货架与金币奖励。
//
// 内容在生成地图时一次性算好并写进 node.content，存档原样保存。
// 这样玩家走过的路线、商店操作或战斗随机数调用都不会改变其他节点的内容。
// 节点内容种子 = hash(主种子, 节点 ID, "content")，与拓扑重试种子无关。

import { createRng, hashSeed, pickWeighted } from './rng.js';
import { deepFloorPlan } from '../floors.js';
import { ENEMY_TYPES } from '../enemies.js';

/** 事件模板：cost 与 effects 都是数据，结算在 map/run.js。 */
export const MAP_EVENT_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'broken-mechanism',
    label: '受损机关',
    desc: '半塌的机关还在缓慢转动，拆下部件有风险，但也许值得。',
    options: Object.freeze([
      Object.freeze({
        id: 'pay',
        label: '支付 {gold} 金币拆解',
        cost: Object.freeze({ gold: 28 }),
        effects: Object.freeze([Object.freeze({ kind: 'draft', count: 1 })]),
        text: '你拆出一枚还能用的技能组件。',
      }),
      Object.freeze({
        id: 'bleed',
        label: '损失 {life} 生命强行拆卸',
        cost: Object.freeze({ lifeRatio: 0.2 }),
        effects: Object.freeze([Object.freeze({ kind: 'draft', count: 1 })]),
        text: '机关反弹了一下，你还是拿到了组件。',
      }),
      Object.freeze({
        id: 'leave',
        label: '离开',
        cost: Object.freeze({}),
        effects: Object.freeze([]),
        text: '你从旁边绕了过去。',
      }),
    ]),
  }),
  Object.freeze({
    id: 'lost-traveler',
    label: '迷途旅人',
    desc: '一个旅人缩在石壁旁，愿意用情报换点补给。',
    options: Object.freeze([
      Object.freeze({
        id: 'buy',
        label: '支付 {gold} 金币换取补给情报',
        cost: Object.freeze({ gold: 16 }),
        effects: Object.freeze([
          Object.freeze({ kind: 'lifeRatio', value: 0.22 }),
          Object.freeze({ kind: 'gold', amount: 18 }),
        ]),
        text: '他指出了附近的补给点，还塞给你一点谢礼。',
      }),
      Object.freeze({
        id: 'share',
        label: '分出食物（损失 {life} 生命）',
        cost: Object.freeze({ lifeRatio: 0.1 }),
        effects: Object.freeze([Object.freeze({ kind: 'attributePoint', count: 1 })]),
        text: '旅人教了你一套呼吸法。',
      }),
      Object.freeze({
        id: 'leave',
        label: '离开',
        cost: Object.freeze({}),
        effects: Object.freeze([]),
        text: '你没有停下。',
      }),
    ]),
  }),
  Object.freeze({
    id: 'ancient-stele',
    label: '古代石碑',
    desc: '碑面刻着看不懂的字，靠近时能感到它在索取。',
    options: Object.freeze([
      Object.freeze({
        id: 'blood',
        label: '以 {life} 生命献祭',
        cost: Object.freeze({ lifeRatio: 0.15 }),
        effects: Object.freeze([Object.freeze({ kind: 'attributePoint', count: 1 })]),
        text: '石碑吸走一缕血色，留下一点领悟。',
      }),
      Object.freeze({
        id: 'pay',
        label: '支付 {gold} 金币供奉',
        cost: Object.freeze({ gold: 36 }),
        effects: Object.freeze([Object.freeze({ kind: 'attributePoint', count: 1 })]),
        text: '金币落进凹槽，碑面亮了一下。',
      }),
      Object.freeze({
        id: 'leave',
        label: '离开',
        cost: Object.freeze({}),
        effects: Object.freeze([]),
        text: '你不打算和石头做交易。',
      }),
    ]),
  }),
  Object.freeze({
    id: 'abandoned-depot',
    label: '遗弃货栈',
    desc: '货架大多空了，角落还有没被翻过的箱子。',
    options: Object.freeze([
      Object.freeze({
        id: 'salvage',
        label: '搜刮补给',
        cost: Object.freeze({}),
        effects: Object.freeze([Object.freeze({ kind: 'lifeRatio', value: 0.15 })]),
        text: '你找到几瓶还能用的药剂。',
      }),
      Object.freeze({
        id: 'force',
        label: '撬开箱子（损失 {life} 生命）',
        cost: Object.freeze({ lifeRatio: 0.08 }),
        effects: Object.freeze([Object.freeze({ kind: 'gold', amount: 34 })]),
        text: '箱子里的金币比预想的多。',
      }),
      Object.freeze({
        id: 'leave',
        label: '离开',
        cost: Object.freeze({}),
        effects: Object.freeze([]),
        text: '你只拿走了门口的水壶。',
      }),
    ]),
  }),
  Object.freeze({
    id: 'foggy-fork',
    label: '迷雾岔路',
    desc: '两条路都看不清尽头，只有一条似乎更短。',
    options: Object.freeze([
      Object.freeze({
        id: 'short',
        label: '走短路（获得 {gold} 金币）',
        cost: Object.freeze({}),
        effects: Object.freeze([Object.freeze({ kind: 'gold', amount: 22 })]),
        text: '你在路边捡到一小袋金币。',
      }),
      Object.freeze({
        id: 'long',
        label: '绕远路（恢复 {life} 生命）',
        cost: Object.freeze({}),
        effects: Object.freeze([Object.freeze({ kind: 'lifeRatio', value: 0.18 })]),
        text: '远路更平缓，你趁机休息了一会儿。',
      }),
      Object.freeze({
        id: 'leave',
        label: '原地等待雾散',
        cost: Object.freeze({}),
        effects: Object.freeze([]),
        text: '雾散了，两条路都还在。',
      }),
    ]),
  }),
]);

/** 商店货架：价格随层数增长，同类商品价格带一点浮动。 */
export const MAP_SHOP_ITEMS = Object.freeze([
  Object.freeze({
    id: 'heal',
    label: '治疗药剂',
    desc: '恢复 35% 最大生命',
    price: 24,
    scale: 0.5,
    effect: Object.freeze({ kind: 'lifeRatio', value: 0.35 }),
  }),
  Object.freeze({
    id: 'component',
    label: '技能组件',
    desc: '下一次进入战斗时获得一次三选一',
    price: 62,
    scale: 1.1,
    effect: Object.freeze({ kind: 'draft', count: 1 }),
  }),
  Object.freeze({
    id: 'attribute',
    label: '属性点',
    desc: '获得 1 点基础属性点',
    price: 46,
    scale: 0.85,
    effect: Object.freeze({ kind: 'attributePoint', count: 1 }),
  }),
]);

function resolveEventOption(option, floor, rng) {
  const goldScale = 1 + floor * 0.04;
  const cost = {};
  if (Number.isFinite(option.cost?.gold)) cost.gold = Math.round(option.cost.gold * goldScale);
  if (Number.isFinite(option.cost?.lifeRatio)) cost.lifeRatio = option.cost.lifeRatio;
  const effects = option.effects.map((effect) => {
    if (effect.kind === 'gold') {
      return { ...effect, amount: Math.round(effect.amount * (0.9 + rng() * 0.3) * goldScale) };
    }
    return { ...effect };
  });
  const parts = [];
  if (cost.gold !== undefined) parts.push(cost.gold + ' 金币');
  if (cost.lifeRatio !== undefined) parts.push(Math.round(cost.lifeRatio * 100) + '% 生命');
  const label = option.label
    .replace('{gold}', String(cost.gold ?? 0))
    .replace('{life}', cost.lifeRatio !== undefined ? Math.round(cost.lifeRatio * 100) + '%' : '');
  const result = [];
  for (const effect of effects) {
    if (effect.kind === 'gold') result.push('+' + effect.amount + ' 金币');
    else if (effect.kind === 'lifeRatio') result.push('恢复 ' + Math.round(effect.value * 100) + '% 最大生命');
    else if (effect.kind === 'draft') result.push('一次构筑三选一');
    else if (effect.kind === 'attributePoint') result.push('+1 属性点');
  }
  return {
    id: option.id,
    label,
    costText: parts.length === 0 ? '无代价' : parts.join(' + '),
    resultText: result.length === 0 ? '没有变化' : result.join(' · '),
    cost,
    effects,
    text: option.text,
  };
}

function generateShopStock(rng, floor, config) {
  const items = MAP_SHOP_ITEMS.slice(0, config.shop.items).map((item, index) => {
    const variance = 0.88 + rng() * 0.24;
    const price = Math.max(5, Math.round((item.price + floor * item.scale) * variance));
    return {
      index,
      id: item.id,
      label: item.label,
      desc: item.desc,
      price,
      effect: { ...item.effect },
    };
  });
  return items;
}

function enemyHint(def) {
  const parts = [];
  for (const [type, weight] of Object.entries(def.mix)) {
    const label = ENEMY_TYPES[type]?.label ?? type;
    parts.push(label + ' ×' + Math.max(1, Math.round((weight / sumMix(def.mix)) * def.count)));
  }
  return parts.join(' · ');
}

function sumMix(mix) {
  let total = 0;
  for (const value of Object.values(mix)) total += Math.max(0, Number(value) || 0);
  return total || 1;
}

function rewardGold(type, floor, rng, config) {
  const base = type === 'boss'
    ? config.reward.boss
    : type === 'elite'
      ? config.reward.elite
      : config.reward.normal;
  const spread = config.reward.spread;
  const variance = 1 - spread + rng() * spread * 2;
  return Math.max(0, Math.round((base + floor * 0.8) * variance));
}

/** 单个节点的内容。类型必须已经分配完成。 */
export function generateNodeContent(node, rng, config) {
  if (node.type === 'normal' || node.type === 'elite' || node.type === 'boss') {
    const plan = nodeBattlePlan(node);
    return {
      kind: 'battle',
      gold: rewardGold(node.type, node.floor, rng, config),
      draft: node.type === 'elite' ? config.reward.eliteDraft : node.type === 'boss' ? 2 : 0,
      enemyHint: enemyHint(plan.def),
      count: plan.def.count,
    };
  }
  if (node.type === 'rest') {
    return { kind: 'rest', healRatio: config.rest.healRatio };
  }
  if (node.type === 'event') {
    const template = MAP_EVENT_TEMPLATES[Math.floor(rng() * MAP_EVENT_TEMPLATES.length)]
      ?? MAP_EVENT_TEMPLATES[0];
    return {
      kind: 'event',
      eventId: template.id,
      label: template.label,
      desc: template.desc,
      options: template.options.map((option) => resolveEventOption(option, node.floor, rng)),
    };
  }
  if (node.type === 'shop') {
    return { kind: 'shop', items: generateShopStock(rng, node.floor, config) };
  }
  return { kind: 'unknown' };
}

/** 给所有节点填充内容。种子派生自主种子与节点 ID，与尝试次数无关。 */
export function fillNodeContent(nodes, seed, config) {
  for (const node of nodes) {
    const rng = createRng(hashSeed(seed, node.id, 'content'));
    node.content = generateNodeContent(node, rng, config);
  }
  return nodes;
}

/**
 * 战斗节点的战斗构成。普通 / 精英 / Boss 都返回 {def, modifier}，
 * 非战斗节点返回 null。数值来自 floors.js 的深层配置，精英层减少数量、
 * 由末位强化敌人承担强度，避免同时叠数量与强度。
 */
export function nodeBattlePlan(node) {
  if (node.type === 'boss') {
    return {
      def: {
        floor: node.floor,
        count: 8,
        mix: { brute: 2, skirmisher: 2, swarm: 2 },
      },
      modifier: 'boss',
    };
  }
  if (node.type === 'elite') {
    const base = deepFloorPlan(node.floor);
    return {
      def: {
        floor: node.floor,
        count: Math.max(6, base.count - 3),
        mix: { ...base.mix },
      },
      modifier: 'elite',
    };
  }
  const base = deepFloorPlan(node.floor);
  return { def: { floor: node.floor, count: base.count, mix: { ...base.mix } }, modifier: null };
}

/** 节点的一句话摘要：地图列表、详情与自动路线原因都用它。 */
export function nodeSummary(node) {
  if (node === null || node === undefined) return '';
  if (node.type === 'rest') return '二选一：恢复 ' + Math.round((node.content?.healRatio ?? 0.3) * 100) + '% 生命或构筑强化';
  if (node.type === 'event') return node.content?.label ?? '事件';
  if (node.type === 'shop') {
    const items = node.content?.items ?? [];
    return items.length === 0 ? '商店' : '商店 · ' + items.map((item) => item.label).join(' / ');
  }
  const hint = node.content?.enemyHint ?? '';
  return hint === '' ? '战斗' : '敌人：' + hint;
}

/** 随机取一个事件模板，供测试与调试使用。 */
export function pickEventTemplate(rng) {
  return pickWeighted(rng, MAP_EVENT_TEMPLATES.map((template) => [template, 1])) ?? MAP_EVENT_TEMPLATES[0];
}

/** 商店价格区间，供报告与平衡模拟使用。 */
export function shopPriceRange(floor, config) {
  const items = MAP_SHOP_ITEMS.slice(0, config.shop.items);
  const lowest = Math.min(...items.map((item) => item.price + floor * item.scale));
  const highest = Math.max(...items.map((item) => item.price + floor * item.scale));
  return { lowest: Math.round(lowest), highest: Math.round(highest) };
}

export function eventGoldCostRange(floor) {
  const scale = 1 + floor * 0.04;
  return {
    lowest: Math.round(Math.min(16, 28, 36) * scale),
    highest: Math.round(Math.max(16, 28, 36) * scale),
  };
}
