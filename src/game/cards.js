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
  // ---- P0 位移家族 ----
  gravity_well: Object.freeze({
    id: 'gravity_well',
    name: '引力井',
    carrier: 'verb',
    kind: 'pull',
    cells: 0,
    cd: 2,
    burn: 0,
    aoe: 0,
    radius: 40,
    strength: 10,
    tags: Object.freeze(['verb', 'gravity']),
    solves: Object.freeze(['summon']),
    desc: '每 2 秒把 40 格内的敌人拉近 10px',
  }),
  shockwave: Object.freeze({
    id: 'shockwave',
    name: '冲击波',
    carrier: 'verb',
    kind: 'push',
    cells: 1,
    cd: 4,
    burn: 0,
    aoe: 0,
    radius: 24,
    strength: 18,
    tags: Object.freeze(['verb', 'gravity']),
    solves: Object.freeze(['bomb']),
    desc: '每 4 秒推开 24 格内的敌人 18px，各 1 格',
  }),
  vortex: Object.freeze({
    id: 'vortex',
    name: '涡流',
    carrier: 'verb',
    kind: 'vortex',
    cells: 0,
    cd: 6,
    burn: 0,
    aoe: 0,
    radius: 30,
    duration: 1.5,
    tags: Object.freeze(['verb', 'gravity']),
    solves: Object.freeze(['summon']),
    desc: '半径 30 内的敌人绕你旋转 1.5 秒',
  }),
  rule_pin: Object.freeze({
    id: 'rule_pin',
    name: '钉住',
    carrier: 'rule',
    effect: 'control',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['rule', 'verb']),
    solves: Object.freeze(['carapace']),
    desc: '每 3 秒，下一发命中定身 1 秒',
  }),
  rule_wall_slam: Object.freeze({
    id: 'rule_wall_slam',
    name: '撞墙',
    carrier: 'rule',
    effect: 'phys',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['rule', 'gravity']),
    solves: Object.freeze(['carapace']),
    desc: '被位移撞到墙的敌人受 2 格（每只每秒一次）',
  }),
});

/** P0 位移包：先只放这一族，便于单独验证。 */
export const GRAVITY_PACK = Object.freeze([
  'gravity_well',
  'shockwave',
  'vortex',
  'rule_pin',
  'rule_wall_slam',
]);

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

// ---- 核心卡（跨包、跨轮，永久槽）----
// 与普通卡不同：核心不占抽卡槽，进战斗时直接挂上，改变的是"规则"。

export const CORE_CARDS = Object.freeze({
  core_anchor: Object.freeze({
    id: 'core_anchor',
    name: '时锚',
    carrier: 'core',
    effect: 'control',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['core', 'control']),
    desc: '开局 3 秒内刷出的敌人被冻结 3 秒',
  }),
  core_ember: Object.freeze({
    id: 'core_ember',
    name: '余烬之种',
    carrier: 'core',
    effect: 'fire',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['core', 'fire']),
    desc: '灼烧上限 +2；灼烧目标死亡时传给 3 个敌人',
  }),
  core_echo: Object.freeze({
    id: 'core_echo',
    name: '回响',
    carrier: 'core',
    effect: 'time',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['core', 'cooldown']),
    desc: '每击杀 8 个敌人，立刻刷新所有冷却',
  }),
  core_siphon: Object.freeze({
    id: 'core_siphon',
    name: '汲取',
    carrier: 'core',
    effect: 'life',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['core', 'heal']),
    desc: '每次击杀回复 1 格生命',
  }),
  core_hunter: Object.freeze({
    id: 'core_hunter',
    name: '猎手',
    carrier: 'core',
    effect: 'mind',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['core', 'target']),
    desc: '优先攻击当前格数最低的敌人',
  }),
  core_pierce: Object.freeze({
    id: 'core_pierce',
    name: '磁力',
    carrier: 'core',
    effect: 'phys',
    cells: 0,
    cd: 0,
    burn: 0,
    aoe: 0,
    tags: Object.freeze(['core', 'pierce']),
    desc: '弹丸命中后额外穿透 1 个目标',
  }),
});

/** 解锁条件是行为式的；stats 由客户端累计。 */
export const CORES = Object.freeze([
  Object.freeze({
    id: 'core_anchor',
    cond: (s) => s.bestFloor >= 2,
    condText: '到达第 2 层',
  }),
  Object.freeze({
    id: 'core_pierce',
    cond: (s) => s.drafts >= 2,
    condText: '累计抽到 2 张卡',
  }),
  Object.freeze({
    id: 'core_siphon',
    cond: (s) => s.kills >= 50,
    condText: '累计击杀 50',
  }),
  Object.freeze({
    id: 'core_ember',
    cond: (s) => s.bestFloor >= 5,
    condText: '到达第 5 层',
  }),
  Object.freeze({
    id: 'core_echo',
    cond: (s) => s.maxFloorKills >= 12,
    condText: '单层击杀 12',
  }),
  Object.freeze({
    id: 'core_hunter',
    cond: (s) => s.bestFloor >= 6,
    condText: '到达第 6 层',
  }),
]);

export function unlockedCores(stats) {
  return CORES.filter((core) => core.cond(stats)).map((core) => core.id);
}

export function cardsById(ids) {
  return ids.map((id) => {
    const card = CARDS[id] ?? CORE_CARDS[id];
    if (card === undefined) throw new Error(`unknown card: ${id}`);
    return card;
  });
}
