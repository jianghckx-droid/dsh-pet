// 卡片数据（MVP 子集）。
//
// 只收录"行为已经实现"的卡。docs/cards.md 里的 24 张是完整设计，
// 但没实现的卡不进代码——否则会出现"有数据、没行为"的死卡，
// 玩家抽到它却什么都不会发生。
//
// MVP 需要 4 张：铁弹（起始）+ 灼烧三件套。
// 其余 20 张随行为一起加入。

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
});

/** 灼烧包的 MVP 池：三选一从这里抽。 */
export const FIRE_POOL = Object.freeze(['orb_fire', 'field_fire', 'summon_fire']);

/** 完整的灼烧 build，供模拟器与单测使用。 */
export const FIRE_BUILD = Object.freeze(['orb_phys', ...FIRE_POOL]);

export function cardsById(ids) {
  return ids.map((id) => {
    const card = CARDS[id];
    if (card === undefined) throw new Error(`unknown card: ${id}`);
    return card;
  });
}
