// 卡片数据（MVP 子集：灼烧包）。
//
// 只收录"行为已经实现"的卡。docs/cards.md 里的 24 张是完整设计，
// 但没实现的卡不进代码——否则会出现"有数据、没行为"的死卡。
//
// 与 cards.md §7 的偏差：MVP 用「斩杀 / 时锚」替换了「压缩 / 禁疗」，
// 因为 MVP 没有回血敌人，禁疗无处生效。

export const STARTER_ID = 'orb_phys';

export const CARDS = Object.freeze({
  orb_phys: Object.freeze({
    id: 'orb_phys',
    name: '铁弹',
    carrier: 'orb',
    effect: 'phys',
    cells: 1,
    cd: 0.7,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['phys', 'single']),
    solves: Object.freeze(['shield']),
    desc: '击退；对护盾 +1 格',
  }),
  orb_fire: Object.freeze({
    id: 'orb_fire',
    name: '火箭',
    carrier: 'orb',
    effect: 'fire',
    cells: 1,
    cd: 0.9,
    burn: 1,
    aoe: 0,
    tags: Object.freeze(['fire', 'single', 'dot']),
    solves: Object.freeze(['carapace', 'regen']),
    desc: '灼烧 +1 层',
  }),
  field_fire: Object.freeze({
    id: 'field_fire',
    name: '火海',
    carrier: 'field',
    effect: 'fire',
    cells: 1,
    cd: 1.5,
    burn: 1,
    aoe: 3,
    tags: Object.freeze(['fire', 'aoe', 'dot']),
    solves: Object.freeze(['carapace', 'summon']),
    desc: '半径内最多 3 个目标，各 1 格 + 灼烧 +1',
  }),
  summon_fire: Object.freeze({
    id: 'summon_fire',
    name: '火灵',
    carrier: 'summon',
    effect: 'fire',
    cells: 1,
    cd: 1.2,
    burn: 1,
    aoe: 0,
    tags: Object.freeze(['fire', 'single', 'dot']),
    solves: Object.freeze(['carapace', 'regen']),
    desc: '射程 36，灼烧 +1；生命 4',
  }),
  self_fire: Object.freeze({
    id: 'self_fire',
    name: '燃身',
    carrier: 'self',
    effect: 'fire',
    cells: 1,
    cd: 3,
    burn: 2,
    aoe: 0,
    tags: Object.freeze(['fire', 'self', 'dot']),
    solves: Object.freeze(['carapace']),
    desc: '每 3 秒：周围 1 格 + 灼烧 2 层',
  }),
  rule_boom: Object.freeze({
    id: 'rule_boom',
    name: '尸爆',
    carrier: 'rule',
    effect: 'fire',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['rule', 'aoe']),
    solves: Object.freeze(['split', 'summon']),
    desc: '击杀时对周围造成 2 次 1 格',
  }),
  rule_combo: Object.freeze({
    id: 'rule_combo',
    name: '连击',
    carrier: 'rule',
    effect: 'fire',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['rule', 'multi']),
    solves: Object.freeze(['carapace']),
    desc: '每 4 次命中，追加 1 次 1 格',
  }),
  rule_execute: Object.freeze({
    id: 'rule_execute',
    name: '斩杀',
    carrier: 'rule',
    effect: 'fire',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['rule', 'execute']),
    solves: Object.freeze(['split', 'summon']),
    desc: '命中后，2 格以下的目标直接移除',
  }),
  rule_anchor: Object.freeze({
    id: 'rule_anchor',
    name: '时锚',
    carrier: 'rule',
    effect: 'fire',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['rule', 'control']),
    solves: Object.freeze(['bomb']),
    desc: '每 10 秒冻结全场 1.2 秒',
  }),
});

/** 灼烧包的抽卡池：已拥有铁弹 + 三件套时，从这 8 张里出三选一。 */
export const FIRE_PACK = Object.freeze([
  'orb_fire',
  'field_fire',
  'summon_fire',
  'self_fire',
  'rule_boom',
  'rule_combo',
  'rule_execute',
  'rule_anchor',
]);

/** 灼烧包的开局 build（模拟器与单测用）。 */
export const FIRE_BUILD = Object.freeze(['orb_phys', 'orb_fire', 'field_fire', 'summon_fire']);

export function cardsById(ids) {
  return ids.map((id) => {
    const card = CARDS[id];
    if (card === undefined) throw new Error(`unknown card: ${id}`);
    return card;
  });
}
