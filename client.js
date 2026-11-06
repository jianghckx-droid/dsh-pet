window.__ModuleLoader__.load({
  id: 'dsh-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // <core>
    // 由 tools/build-client.mjs 从 src/game/*.js 生成，不要手改这一段。
    // ---- rules.js ----
    // 战斗规则：唯一一份。
    //
    // 游戏端（client.js）与数值模拟器（tools/balance-sim.mjs）都必须从这里取规则，
    // 否则"设计用的数字"和"跑起来的游戏"会各算各的。
    //
    // 三条硬规则，改动前先看 docs/design.md §5 与 docs/cards.md §1：
    //   1. 结算顺序固定：基础格 → +锋锐 → 锁裁决 → 扣格
    //   2. 锁永远最后裁决，所以属性无法覆盖锁
    //   3. 锋锐只加主攻击，不加灼烧跳/雷跳/碎冰/尸爆/斩杀

    const BURN = Object.freeze({
      cap: 5, // 每个目标最多 5 层
      tickSeconds: 1.5, // 每层每 1.5 秒造成 1 格
      durationSeconds: 6, // 叠层后 6 秒内没有新层就熄灭
      damagePerStack: 1,
    });

    const PLAYER = Object.freeze({
      baseCells: 12,
      cellsPerBody: 2, // 体魄：+2 格/点
      pointsPerEdgeCell: 2, // 锋锐：每 2 点 +1 格
    });

    const ATTR_MAX = 10;

    const ATTRIBUTES = Object.freeze([
      Object.freeze({ id: 'edge', label: '锋锐', max: ATTR_MAX, desc: '每 2 点 +1 格' }),
      Object.freeze({ id: 'swift', label: '迅捷', max: ATTR_MAX, desc: '冷却 −4%/点' }),
      Object.freeze({ id: 'body', label: '体魄', max: ATTR_MAX, desc: '生命 +2 格/点' }),
      Object.freeze({ id: 'tough', label: '坚韧', max: ATTR_MAX, desc: '受伤 −3%/点' }),
      Object.freeze({ id: 'recover', label: '复原', max: ATTR_MAX, desc: '每秒 +0.2 格' }),
      Object.freeze({ id: 'vision', label: '视野', max: ATTR_MAX, desc: '射程 +6%/点' }),
    ]);

    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(v) ? v : lo)));

    function normalizeAttrs(attrs = {}) {
      const out = {};
      for (const attr of ATTRIBUTES) out[attr.id] = clampInt(attrs[attr.id] ?? 0, 0, attr.max);
      return out;
    }

    function attrsSpent(attrs = {}) {
      let n = 0;
      for (const attr of ATTRIBUTES) n += attrs[attr.id] ?? 0;
      return n;
    }

    function playerCells(attrs = {}) {
      return PLAYER.baseCells + (attrs.body ?? 0) * PLAYER.cellsPerBody;
    }

    function edgeCells(attrs = {}) {
      return Math.floor((attrs.edge ?? 0) / PLAYER.pointsPerEdgeCell);
    }

    /** 坚韧：受伤 −3%/点，至少还是掉 1 格以下（不取整，格数允许小数）。 */
    function damageTaken(cells, attrs = {}) {
      const cut = (attrs.tough ?? 0) * 0.03;
      return Math.max(0.1, cells * (1 - cut));
    }

    /** 迅捷：冷却 −4%/点。 */
    function cooldown(cd, attrs = {}) {
      return cd * (1 - (attrs.swift ?? 0) * 0.04);
    }

    /** 复原：每秒 +0.2 格。 */
    function regenPerSecond(attrs = {}) {
      return (attrs.recover ?? 0) * 0.2;
    }

    /** 视野：射程 / 领域半径 +6%/点。 */
    function visionScale(attrs = {}) {
      return 1 + (attrs.vision ?? 0) * 0.06;
    }

    /** 主攻击的格数：卡面基础格 + 锋锐。衍生效果不要调这个函数。 */
    function attackCells(card, attrs = {}) {
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
    function resolveHit(enemy, cells, { main = true } = {}) {
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

    function createStatus() {
      return { burn: 0, burnLeft: 0, burnTick: BURN.tickSeconds };
    }

    function applyBurn(status, stacks, cap = BURN.cap) {
      if (stacks <= 0) return;
      status.burn = Math.min(cap, status.burn + stacks);
      status.burnLeft = BURN.durationSeconds;
    }

    /**
     * 推进状态，返回这一帧的灼烧伤害（0 表示没有跳）。
     * 调用方负责再走一次 resolveHit(..., { main: false })。
     */
    function advanceStatus(status, dt) {
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
    function steadyDps(cards, attrs, enemy) {
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

    // ---- cards.js ----
    // 卡片数据（MVP 子集：灼烧包）。
    //
    // 只收录"行为已经实现"的卡。docs/cards.md 里的 24 张是完整设计，
    // 但没实现的卡不进代码——否则会出现"有数据、没行为"的死卡。
    //
    // 与 cards.md §7 的偏差：MVP 用「斩杀 / 时锚」替换了「压缩 / 禁疗」，
    // 因为 MVP 没有回血敌人，禁疗无处生效。

    const STARTER_ID = 'orb_phys';

    const CARDS = Object.freeze({
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
        mode: 'turret',
        hp: 4,
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
      // ---- P1 标记家族 ----
      mark_hunter: Object.freeze({
        id: 'mark_hunter',
        name: '猎标',
        carrier: 'rule',
        effect: 'mind',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'mark']),
        solves: Object.freeze(['split']),
        desc: '攻击叠 1 层标记（上限 3）；带标记者优先被瞄准',
      }),
      fuse: Object.freeze({
        id: 'fuse',
        name: '引信',
        carrier: 'rule',
        effect: 'fire',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'mark']),
        solves: Object.freeze(['split', 'summon']),
        desc: '带标记的敌人死亡时爆炸，伤害 = 层数',
      }),
      spread: Object.freeze({
        id: 'spread',
        name: '传导',
        carrier: 'rule',
        effect: 'mind',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'mark']),
        solves: Object.freeze(['summon']),
        desc: '带标记的敌人死亡时，标记传给 2 个最近的敌人',
      }),
      execute_mark: Object.freeze({
        id: 'execute_mark',
        name: '处决',
        carrier: 'rule',
        effect: 'mind',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'mark']),
        solves: Object.freeze(['carapace', 'split']),
        desc: '3 层标记且 ≤4 格的目标直接移除',
      }),
      mark_bolt: Object.freeze({
        id: 'mark_bolt',
        name: '标记弹',
        carrier: 'orb',
        effect: 'mind',
        cells: 0,
        cd: 1.0,
        burn: 0,
        aoe: 0,
        mark: 2,
        tags: Object.freeze(['mark', 'single']),
        solves: Object.freeze(['split']),
        desc: '不造成伤害，叠 2 层标记',
      }),
      // ---- P2 召唤家族 ----
      bomber: Object.freeze({
        id: 'bomber',
        name: '自爆傀儡',
        carrier: 'summon',
        mode: 'charge',
        hp: 3,
        blast: 3,
        radius: 18,
        cells: 0,
        cd: 8,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['summon', 'blast']),
        solves: Object.freeze(['split', 'summon']),
        desc: '冲向最近敌人，接触后 18 格范围爆炸 3 格',
      }),
      link: Object.freeze({
        id: 'link',
        name: '连结',
        carrier: 'rule',
        effect: 'life',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'summon']),
        solves: Object.freeze(['reflect']),
        desc: '你受到的伤害 50% 转移给最近的召唤物',
      }),
      merge: Object.freeze({
        id: 'merge',
        name: '合体',
        carrier: 'rule',
        effect: 'life',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'summon']),
        solves: Object.freeze(['summon']),
        desc: '两个召唤物靠近时合并：生命相加，攻击变范围',
      }),
      sacrifice: Object.freeze({
        id: 'sacrifice',
        name: '献祭',
        carrier: 'rule',
        effect: 'time',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'summon']),
        solves: Object.freeze(['summon']),
        desc: '召唤物死亡时，刷新一个随机冷却',
      }),
      totem: Object.freeze({
        id: 'totem',
        name: '图腾',
        carrier: 'summon',
        mode: 'totem',
        hp: 6,
        cells: 0,
        cd: 2,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['summon', 'heal']),
        solves: Object.freeze(['regen']),
        desc: '不动，每 2 秒给周围召唤物回 1 格',
      }),
      // ---- P3 时间家族 ----
      time_stop: Object.freeze({
        id: 'time_stop',
        name: '时停',
        carrier: 'rule',
        effect: 'time',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'time']),
        solves: Object.freeze(['bomb']),
        desc: '每 12 秒冻结全场 1.5 秒',
      }),
      rewind: Object.freeze({
        id: 'rewind',
        name: '回溯',
        carrier: 'rule',
        effect: 'time',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'time']),
        solves: Object.freeze(['carapace']),
        desc: '生命低于 50% 时，回到 3 秒前的位置与生命（每层 1 次）',
      }),
      delay: Object.freeze({
        id: 'delay',
        name: '延迟',
        carrier: 'rule',
        effect: 'time',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'time']),
        solves: Object.freeze(['reflect']),
        desc: '受到的伤害延迟 2 秒结算；期间击杀来源则取消',
      }),
      chain: Object.freeze({
        id: 'chain',
        name: '连锁',
        carrier: 'rule',
        effect: 'time',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'time']),
        solves: Object.freeze(['carapace', 'summon']),
        desc: '击杀后，下次攻击额外发射 1 发（最多叠 3）',
      }),
      // ---- P4 风险家族 ----
      desperate: Object.freeze({
        id: 'desperate',
        name: '破釜',
        carrier: 'rule',
        effect: 'life',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'risk']),
        solves: Object.freeze(['carapace']),
        desc: '生命低于 30% 时，所有冷却减半',
      }),
      shield_burst: Object.freeze({
        id: 'shield_burst',
        name: '护盾爆',
        carrier: 'rule',
        effect: 'life',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'risk']),
        solves: Object.freeze(['bomb']),
        desc: '每 6 秒获得 2 格护盾；护盾破碎时对周围造成 3 格',
      }),
      blood_debt: Object.freeze({
        id: 'blood_debt',
        name: '血偿',
        carrier: 'rule',
        effect: 'life',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'risk']),
        solves: Object.freeze(['carapace']),
        desc: '每次受伤，下一次攻击 +1 格（最多 +3）',
      }),
      overdraft: Object.freeze({
        id: 'overdraft',
        name: '透支',
        carrier: 'rule',
        effect: 'life',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'risk']),
        solves: Object.freeze(['summon']),
        desc: '每层开始扣 3 格生命，立刻刷新一次所有冷却',
      }),
      // ---- P5 环境家族 ----
      flame_trap: Object.freeze({
        id: 'flame_trap',
        name: '火焰陷阱',
        carrier: 'trap',
        kind: 'flame',
        radius: 12,
        cells: 2,
        burn: 2,
        cd: 5,
        ttl: 8,
        aoe: 0,
        tags: Object.freeze(['trap', 'fire']),
        solves: Object.freeze(['summon']),
        desc: '在脚下放置陷阱：触发时 12 格范围 2 格 + 2 层灼烧',
      }),
      frost_trap: Object.freeze({
        id: 'frost_trap',
        name: '冰霜陷阱',
        carrier: 'trap',
        kind: 'frost',
        radius: 12,
        cells: 1,
        freeze: 1.5,
        cd: 7,
        ttl: 8,
        aoe: 0,
        tags: Object.freeze(['trap', 'ice']),
        solves: Object.freeze(['bomb']),
        desc: '触发时冻结范围内敌人 1.5 秒',
      }),
      fire_trail: Object.freeze({
        id: 'fire_trail',
        name: '火痕',
        carrier: 'trail',
        kind: 'fire',
        radius: 7,
        cells: 1,
        burn: 1,
        cd: 0.5,
        ttl: 2,
        aoe: 0,
        tags: Object.freeze(['trail', 'fire']),
        solves: Object.freeze(['carapace']),
        desc: '移动时留下火焰，持续 2 秒，每 0.5 秒 1 格',
      }),
      shock_trail: Object.freeze({
        id: 'shock_trail',
        name: '电痕',
        carrier: 'trail',
        kind: 'shock',
        radius: 7,
        cells: 1,
        cd: 0.5,
        ttl: 2,
        aoe: 0,
        tags: Object.freeze(['trail', 'thunder']),
        solves: Object.freeze(['summon']),
        desc: '移动轨迹带电，经过的敌人每 0.5 秒 1 格',
      }),
    });

    /** P5 环境包。 */
    const ENV_PACK = Object.freeze(['flame_trap', 'frost_trap', 'fire_trail', 'shock_trail']);

    /** P4 风险包。 */
    const RISK_PACK = Object.freeze(['desperate', 'shield_burst', 'blood_debt', 'overdraft']);
    /** P3 时间包。 */
    const TIME_PACK = Object.freeze(['time_stop', 'rewind', 'delay', 'chain']);

    /** P2 召唤包。 */
    const SUMMON_PACK = Object.freeze(['bomber', 'link', 'merge', 'sacrifice', 'totem']);

    /** P1 标记包。 */
    const MARK_PACK = Object.freeze([
      'mark_hunter',
      'fuse',
      'spread',
      'execute_mark',
      'mark_bolt',
    ]);

    /** P0 位移包：先只放这一族，便于单独验证。 */
    const GRAVITY_PACK = Object.freeze([
      'gravity_well',
      'shockwave',
      'vortex',
      'rule_pin',
      'rule_wall_slam',
    ]);

    /** 灼烧包的抽卡池：已拥有铁弹 + 三件套时，从这 8 张里出三选一。 */
    const FIRE_PACK = Object.freeze([
      'orb_fire',
      'field_fire',
      'summon_fire',
      'self_fire',
      'rule_boom',
      'rule_combo',
      'rule_execute',
      'rule_anchor',
    ]);

    /** 实验包：灼烧包 + P0–P5 全部新机制，进游戏用的唯一入口。 */
    const LAB_PACK = Object.freeze([
      ...FIRE_PACK,
      ...GRAVITY_PACK,
      ...MARK_PACK,
      ...SUMMON_PACK,
      ...TIME_PACK,
      ...RISK_PACK,
      ...ENV_PACK,
    ]);

    /** 灼烧包的开局 build（模拟器与单测用）。 */
    const FIRE_BUILD = Object.freeze(['orb_phys', 'orb_fire', 'field_fire', 'summon_fire']);

    // ---- 核心卡（跨包、跨轮，永久槽）----
    // 与普通卡不同：核心不占抽卡槽，进战斗时直接挂上，改变的是"规则"。

    const CORE_CARDS = Object.freeze({
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
    const CORES = Object.freeze([
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

    function unlockedCores(stats) {
      return CORES.filter((core) => core.cond(stats)).map((core) => core.id);
    }

    function cardsById(ids) {
      return ids.map((id) => {
        const card = cardById(id);
        if (card === undefined) throw new Error(`unknown card: ${id}`);
        return card;
      });
    }

    function cardById(id) {
      return CARDS[id] ?? CORE_CARDS[id];
    }

    // ---- floors.js ----
    // 层数表（1–12 层，MVP 用 1–8）。
    //
    // 数值来自 docs/floors.md，改动前先跑 `node tools/balance-sim.mjs --sweep`
    // 确认第 6 层那道墙还在。
    //
    // "双锁混编"的实现是：同一层的敌人轮换携带不同的单锁，而不是一只怪同时带两个锁。
    // 同时带两个锁的怪留给以后（倍率相乘已经是按这个设计的）。

    const FLOOR_SECONDS = 26;

    /** 层修饰符：让同一套 build 在不同层表现不同。 */
    const MODIFIERS = Object.freeze({
      crowded: Object.freeze({ name: '拥挤', desc: '敌人 +50%，血量 −30%' }),
      frenzy: Object.freeze({ name: '狂暴', desc: '敌人移速 +30%，伤害 +1' }),
      silent: Object.freeze({ name: '静默', desc: '领域类卡失效' }),
      elite: Object.freeze({ name: '精英', desc: '最后一只怪带双锁，击杀给一次三选一' }),
    });

    const FLOOR_MODIFIERS = Object.freeze({ 4: 'crowded', 7: 'frenzy', 10: 'silent', 13: 'elite' });

    function floorModifier(floor) {
      return FLOOR_MODIFIERS[floor] ?? null;
    }

    /** 锁对格数的倍率。一只怪带多个锁时相乘。 */
    const LOCK_CELLS = Object.freeze({
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

    function baseCells(floor) {
      return 4 + 1.35 * floor;
    }

    function lockMultiplier(locks = []) {
      return locks.reduce((m, lock) => m * (LOCK_CELLS[lock] ?? 1), 1);
    }

    /** 先乘倍率再取整，否则 ×2 的锁会比设计值少 1 格（第 7 层就是例子）。 */
    function enemyCells(floor, locks = []) {
      return Math.round(baseCells(floor) * lockMultiplier(locks));
    }

    function enemyDamage(floor) {
      if (floor >= 10) return 3;
      if (floor >= 5) return 2;
      return 1;
    }

    function spawnSeconds(def) {
      return FLOOR_SECONDS / def.enemies;
    }

    const FLOORS = Object.freeze([
      Object.freeze({ floor: 1, enemies: 8, locks: Object.freeze([]) }),
      Object.freeze({ floor: 2, enemies: 9, locks: Object.freeze([]) }),
      Object.freeze({ floor: 3, enemies: 10, locks: Object.freeze([]) }),
      Object.freeze({ floor: 4, enemies: 12, locks: Object.freeze([]) }),
      Object.freeze({ floor: 5, enemies: 13, locks: Object.freeze([]) }),
      Object.freeze({ floor: 6, enemies: 8, locks: Object.freeze(['carapace']) }),
      Object.freeze({ floor: 7, enemies: 9, locks: Object.freeze(['carapace']) }),
      Object.freeze({ floor: 8, enemies: 10, locks: Object.freeze(['carapace']) }),
      Object.freeze({ floor: 9, enemies: 12, locks: Object.freeze(['split']) }),
      Object.freeze({ floor: 10, enemies: 13, locks: Object.freeze(['anchor']) }),
      Object.freeze({ floor: 11, enemies: 13, locks: Object.freeze(['cleanse']) }),
      Object.freeze({ floor: 12, enemies: 14, locks: Object.freeze(['phase']) }),
      Object.freeze({ floor: 13, enemies: 14, locks: Object.freeze(['devour']) }),
      Object.freeze({ floor: 14, enemies: 15, locks: Object.freeze(['generator']) }),
      Object.freeze({ floor: 15, enemies: 16, locks: Object.freeze(['reflect']) }),
    ]);

    /** MVP 只做到第 8 层（第 6 层是墙，第 8 层是切片上限）。 */
    const MVP_FLOOR_COUNT = 8;

    const MVP_FLOORS = Object.freeze(FLOORS.filter((f) => f.floor <= MVP_FLOOR_COUNT));

    function floorDef(n) {
      const def = FLOORS.find((f) => f.floor === n);
      if (def === undefined) throw new Error(`floor not in table: ${n}`);
      return def;
    }

    // ---- arena.js ----
    // 战斗状态机（无渲染、无 DOM、可复现）。
    //
    // 这一层是游戏真正的核心：位置、走位、刷怪、命中、状态、层推进、三选一。
    // client.js 只负责把 battle 画出来；测试直接跑这里。
    //
    // 设计约束：
    //   - 纯函数式推进：step(battle, dt)，不读全局、不用 Math.random
    //   - 同一 seed + 同一 dt 序列 → 同一结果
    //   - 所有伤害都走 rules.js 的 resolveHit，锁不会在这里被绕过
    //   - 抽卡只在 arena 里发生，UI 只调用 chooseCard
    //
    // 已知取舍：
    //   - 没有寻路，敌人直线追玩家；160×144 的场地不需要
    //   - 走位是"绕最近目标 + 回中心"的启发式，不是完整 AI（轮次 5 再做）
    //   - 召唤物是炮台：会攻击，但不会被敌人选为目标
    //   - 分裂子体不给经验，避免刷经验

    const ARENA = Object.freeze({ w: 160, h: 144 });
    const TIME_LIMIT = 45;
    const MAX_SLOTS = 3;
    const MAX_EXTRA = 18;

    const PLAYER_SPEED = 52;
    const PLAYER_RADIUS = 3;
    const CONTACT_PAD = 1.5;
    const ENEMY_ATTACK_INTERVAL = 1.6;
    const ENEMY_SPEED_BASE = 26;
    const ENEMY_SPEED_PER_FLOOR = 1.4;
    const ORB_RANGE = 74;
    const FIELD_RADIUS = 30;
    const SUMMON_RANGE = 42;
    const BULLET_SPEED = 180;
    const BULLET_HIT_RADIUS = 3.5;
    const KEEP_DISTANCE = 42;
    const CENTER_PULL = 56;

    const SELF_RADIUS = 20;
    const BOOM_RADIUS = 14;
    const FREEZE_SECONDS = 1.2;
    const ANCHOR_SECONDS = 10;
    const COMBO_EVERY = 4;
    const EXECUTE_THRESHOLD = 2;
    const XP_PER_CELL = 3;
    const VORTEX_SPEED = 120;

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function mulberry32(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function enemyRadius(cells) {
      return 2.5 + Math.min(3.5, cells / 10);
    }

    function spawnPoint(rng) {
      const edge = Math.floor(rng() * 4);
      if (edge === 0) return { x: rng() * ARENA.w, y: -6 };
      if (edge === 1) return { x: ARENA.w + 6, y: rng() * ARENA.h };
      if (edge === 2) return { x: rng() * ARENA.w, y: ARENA.h + 6 };
      return { x: -6, y: rng() * ARENA.h };
    }

    const hasRule = (battle, id) => battle.rules.some((rule) => rule.id === id);
    const hasCore = (battle, id) => battle.cards.some((card) => card.id === id);

    /** 破釜：残血时冷却减半。所有出手机制都要走这里。 */
    function cardCooldown(battle, cd) {
      let value = cooldown(cd, battle.attrs);
      if (hasRule(battle, 'desperate') && battle.player.cells < battle.player.maxCells * 0.3) {
        value *= 0.5;
      }
      return value;
    }
    const orbRange = (battle) => ORB_RANGE * visionScale(battle.attrs);
    const fieldRadius = (battle) => FIELD_RADIUS * visionScale(battle.attrs);
    const selfRadius = (battle) => SELF_RADIUS * visionScale(battle.attrs);
    const summonRange = (battle) => SUMMON_RANGE * visionScale(battle.attrs);

    function makeSummon(battle, card) {
      const hp = card.hp ?? 4;
      return {
        id: battle.nextId++,
        card,
        x: battle.player.x - 8,
        y: battle.player.y - 8,
        cells: hp,
        maxCells: hp,
        mode: card.mode ?? 'turret',
        timer: cardCooldown(battle, card.cd) * 0.5,
      };
    }

    function nearestSummon(battle, from, range = Infinity) {
      let best = null;
      let bestD = range;
      for (const s of battle.summons) {
        const d = dist(from, s);
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
      return best;
    }

    function refreshOneCooldown(battle) {
      const pool = [...battle.sources, ...battle.selfs];
      if (pool.length === 0) return;
      const pick = pool[Math.floor(battle.rng() * pool.length)];
      pick.timer = 0;
    }

    function killSummon(battle, summon) {
      const index = battle.summons.indexOf(summon);
      if (index < 0) return;
      battle.summons.splice(index, 1);
      if (hasRule(battle, 'sacrifice')) refreshOneCooldown(battle);
      battle.respawns.push({ card: summon.card, at: battle.time + 8 });
      battle.events.push({ type: 'summonDown', x: summon.x, y: summon.y });
    }

    /** 把一张卡加进当前战斗。开局 build 与抽卡都走这里。 */
    function addCard(battle, id) {
      const card = cardsById([id])[0];
      battle.cards.push(card);
      if (card.carrier === 'rule') {
        battle.rules.push(card);
        return card;
      }
      if (card.carrier === 'core') {
        return card;
      }
      if (card.carrier === 'verb') {
        battle.verbs.push({ card, timer: card.cd * 0.5 });
        return card;
      }
      if (card.carrier === 'trap') {
        battle.trapSources.push({ card, timer: card.cd * 0.5 });
        return card;
      }
      if (card.carrier === 'trail') {
        battle.trailSources.push({ card, timer: 0 });
        return card;
      }
      if (card.carrier === 'self') {
        battle.selfs.push({ card, timer: cardCooldown(battle, card.cd) });
        return card;
      }
      if (card.carrier === 'summon') {
        battle.summons.push(makeSummon(battle, card));
        return card;
      }
      battle.sources.push({ card, timer: cardCooldown(battle, card.cd) * 0.5 });
      return card;
    }

    function rollOffer(battle) {
      if (battle.offer !== null || battle.pending <= 0) return;
      if (battle.slots.length >= MAX_SLOTS) return;
      const owned = new Set(battle.cards.map((card) => card.id));
      const available = battle.pool.filter((id) => !owned.has(id));
      if (available.length === 0) return;

      const picked = [];

      // 定向保底：上一轮死在哪把锁，这次一定给一张能解它的卡
      if (battle.pity !== null) {
        const counter = available.find((id) => (cardById(id)?.solves ?? []).includes(battle.pity));
        if (counter !== undefined) {
          picked.push(counter);
          available.splice(available.indexOf(counter), 1);
        }
        battle.pity = null;
      }

      // 按家族抽：优先从同一个主题里取，保证三张能互相组合
      if (battle.families.length > 0 && picked.length < 3) {
        const family = battle.families[Math.floor(battle.rng() * battle.families.length)];
        for (const id of family) {
          if (picked.length >= 3) break;
          if (!available.includes(id)) continue;
          picked.push(id);
          available.splice(available.indexOf(id), 1);
        }
      }

      while (picked.length < 3 && available.length > 0) {
        const index = Math.floor(battle.rng() * available.length);
        picked.push(available.splice(index, 1)[0]);
      }
      battle.offer = picked;
    }

    function awardXp(battle, amount) {
      battle.xp += amount;
      while (battle.xp >= battle.xpNext) {
        battle.xp -= battle.xpNext;
        battle.level += 1;
        battle.xpNext = 6 + battle.level * 2;
        battle.points += 1;
        if (battle.level % 2 === 0) battle.pending += 1;
      }
      rollOffer(battle);
    }

    /** 选中一张卡：进槽、生效、刷新下一次 offer。 */
    function chooseCard(battle, id) {
      if (battle.offer === null || !battle.offer.includes(id)) return false;
      if (battle.slots.length >= MAX_SLOTS) return false;
      battle.slots.push(id);
      battle.offer = null;
      battle.pending = Math.max(0, battle.pending - 1);
      addCard(battle, id);
      battle.events.push({ type: 'draft', id });
      rollOffer(battle);
      return true;
    }

    function createBattle({
      floor,
      build,
      attrs = {},
      seed = 1,
      pool = [],
      drafted = [],
      points = 0,
      level = 1,
      xp = 0,
      xpNext = 6,
      pending = 0,
      extra = 0,
      cores = [],
      families = [],
      pity = null,
    }) {
      const def = floorDef(floor);
      const normalized = normalizeAttrs(attrs);
      const maxCells = playerCells(normalized);
      const battle = {
        def,
        floor,
        attrs: normalized,
        points,
        pool: [...pool],
        families: families.map((family) => [...family]),
        pity,
        modifier: floorModifier(floor),
        slots: [...drafted],
        cards: [],
        rules: [],
        selfs: [],
        verbs: [],
        sources: [],
        summons: [],
        respawns: [],
        traps: [],
        trails: [],
        trapSources: [],
        trailSources: [],
        enemies: [],
        bullets: [],
        rng: mulberry32(seed),
        time: 0,
        state: 'fighting',
        player: {
          x: ARENA.w / 2,
          y: ARENA.h / 2,
          cells: maxCells,
          maxCells,
          speed: PLAYER_SPEED,
          shield: 0,
        },
        level,
        xp,
        xpNext,
        pending,
        extra: Math.min(MAX_EXTRA, Math.max(0, extra)),
        burnCap: BURN.cap,
        emberSpread: 1,
        echoKills: 0,
        offer: null,
        hitCount: 0,
        anchorTimer: 0,
        pinCd: 0,
        timeStopTimer: 0,
        delayQueue: [],
        snapshots: [],
        snapshotTimer: 0,
        rewindCd: 0,
        rewindUsed: false,
        chainStacks: 0,
        shieldTimer: 6,
        bloodStacks: 0,
        stats: { damage: {}, killsByLock: {} },
        surge: false,
        spawned: 0,
        kills: 0,
        events: [],
        nextId: 1,
        seed,
      };
      for (const id of build) addCard(battle, id);
      for (const id of cores) addCard(battle, id);
      battle.burnCap = hasCore(battle, 'core_ember') ? BURN.cap + 2 : BURN.cap;
      battle.emberSpread = hasCore(battle, 'core_ember') ? 3 : 1;
      if (hasRule(battle, 'overdraft')) {
        battle.player.cells = Math.max(1, battle.player.cells - 3);
        refreshCooldowns(battle);
      }
      if (battle.pending > 0) rollOffer(battle);
      return battle;
    }

    function nearestEnemy(battle, from, range = Infinity, excludeId = -1) {
      let best = null;
      let bestD = range;
      for (const e of battle.enemies) {
        if (e.cells <= 0 || e.id === excludeId) continue;
        const d = dist(from, e);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      return best;
    }

    /** 猎手核心：优先打格数最低的；标记规则：优先打带标记的。 */
    function pickTarget(battle, from, range, excludeId = -1) {
      if (hasRule(battle, 'mark_hunter')) {
        let marked = null;
        let bestMark = 0;
        let bestD = Infinity;
        for (const e of battle.enemies) {
          if (e.cells <= 0 || e.id === excludeId || (e.mark ?? 0) <= 0) continue;
          const d = dist(from, e);
          if (d > range) continue;
          if (e.mark > bestMark || (e.mark === bestMark && d < bestD)) {
            marked = e;
            bestMark = e.mark;
            bestD = d;
          }
        }
        if (marked !== null) return marked;
      }
      if (!hasCore(battle, 'core_hunter')) return nearestEnemy(battle, from, range, excludeId);
      let best = null;
      let bestCells = Infinity;
      let bestD = Infinity;
      for (const e of battle.enemies) {
        if (e.cells <= 0 || e.id === excludeId) continue;
        const d = dist(from, e);
        if (d > range) continue;
        if (e.cells < bestCells || (e.cells === bestCells && d < bestD)) {
          best = e;
          bestCells = e.cells;
          bestD = d;
        }
      }
      return best;
    }

    /** 本方实际要刷多少只：拥挤层 +50%，过载潮再叠加。 */
    function enemyTotal(battle) {
      let base = battle.def.enemies;
      if (battle.modifier === 'crowded') base = Math.round(base * 1.5);
      return base + battle.extra;
    }

    function spawnTick(battle) {
      const total = enemyTotal(battle);
      // 额外敌人不延长层时长，而是压缩刷怪间隔，否则压力永远刷不完
      const interval = FLOOR_SECONDS / total;
      while (battle.spawned < total && battle.time >= battle.spawned * interval) {
        const index = battle.spawned;
        const isElite = battle.modifier === 'elite' && index === total - 1;
        const lock = battle.def.locks.length ? battle.def.locks[index % battle.def.locks.length] : null;
        const locks = isElite ? ['carapace', 'phase'] : lock ? [lock] : [];
        let cells = isElite
          ? Math.round(enemyCells(battle.floor, []) * 3)
          : enemyCells(battle.floor, locks);
        if (!isElite && battle.modifier === 'crowded') cells = Math.round(cells * 0.7);
        const at = spawnPoint(battle.rng);
        battle.enemies.push({
          id: battle.nextId++,
          x: at.x,
          y: at.y,
          cells,
          maxCells: cells,
          locks,
          primary: true,
          canSplit: lock === 'split',
          elite: isElite,
          r: enemyRadius(cells),
          speed:
            (ENEMY_SPEED_BASE + battle.floor * ENEMY_SPEED_PER_FLOOR + battle.rng() * 4) *
            (locks.includes('anchor') ? 0.7 : 1) *
            (battle.modifier === 'frenzy' ? 1.3 : 1),
          damage: enemyDamage(battle.floor) + (battle.modifier === 'frenzy' ? 1 : 0),
          attackTimer: ENEMY_ATTACK_INTERVAL,
          status: createStatus(),
          freeze: 0,
          root: 0,
          vortex: 0,
          wallCd: 0,
          mark: 0,
          markLeft: 0,
          cleanseCd: 3,
          devourCd: 6,
          phaseCd: 4,
          invuln: 0,
          shield: 0,
          genCd: 3,
          reflectCd: 0,
          flash: 0,
        });
        battle.spawned += 1;
        if (hasCore(battle, 'core_anchor') && battle.time < 3) {
          battle.enemies[battle.enemies.length - 1].freeze = 3;
        }
      }
    }

    function playerMove(battle, dt) {
      const p = battle.player;
      const nearest = nearestEnemy(battle, p);
      let vx = 0;
      let vy = 0;
      if (nearest) {
        const dx = p.x - nearest.x;
        const dy = p.y - nearest.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < KEEP_DISTANCE - 8) {
          vx += dx / d;
          vy += dy / d;
        } else if (d > KEEP_DISTANCE + 8) {
          vx -= dx / d;
          vy -= dy / d;
        } else {
          vx += -dy / d;
          vy += dx / d;
        }
      }
      const cx = ARENA.w / 2 - p.x;
      const cy = ARENA.h / 2 - p.y;
      const cd = Math.hypot(cx, cy) || 1;
      if (cd > CENTER_PULL) {
        vx += (cx / cd) * 0.7;
        vy += (cy / cd) * 0.7;
      }
      const len = Math.hypot(vx, vy);
      if (len < 0.001) return;
      p.x = clamp(p.x + (vx / len) * p.speed * dt, 6, ARENA.w - 6);
      p.y = clamp(p.y + (vy / len) * p.speed * dt, 6, ARENA.h - 6);
    }

    /** 敌方护盾先吸收，再扣格。所有伤害都走这里。 */
    function applyDamage(enemy, amount) {
      let left = amount;
      if ((enemy.shield ?? 0) > 0) {
        const absorbed = Math.min(enemy.shield, left);
        enemy.shield -= absorbed;
        left -= absorbed;
      }
      enemy.cells -= left;
      return left;
    }

    function recordDamage(battle, id, amount) {
      if (!(amount > 0)) return;
      battle.stats.damage[id] = (battle.stats.damage[id] ?? 0) + amount;
    }

    function rawHit(battle, enemy, cells, burn = 0, source = 'bullet') {
      if ((enemy.invuln ?? 0) > 0) {
        battle.events.push({ type: 'phase', x: enemy.x, y: enemy.y });
        return 0;
      }
      const dealt = resolveHit(enemy, cells, { main: true });
      const applied = applyDamage(enemy, dealt);
      recordDamage(battle, source, applied);
      enemy.flash = 0.12;
      if (burn) applyBurn(enemy.status, burn, battle.burnCap);
      battle.events.push({ type: 'hit', x: enemy.x, y: enemy.y, cells: dealt });
      return dealt;
    }

    function addMark(enemy, stacks) {
      enemy.mark = Math.min(3, (enemy.mark ?? 0) + stacks);
      enemy.markLeft = 6;
    }

    function hitEnemy(battle, enemy, card) {
      let cells = attackCells(card, battle.attrs);
      if (hasRule(battle, 'blood_debt') && battle.bloodStacks > 0) {
        cells += battle.bloodStacks;
        battle.bloodStacks = 0;
      }
      rawHit(battle, enemy, cells, card.burn ?? 0, card.id ?? 'bullet');

      if (card.mark) addMark(enemy, card.mark);
      if (hasRule(battle, 'mark_hunter')) addMark(enemy, 1);

      if (hasRule(battle, 'rule_pin') && battle.pinCd <= 0) {
        enemy.root = Math.max(enemy.root, 1);
        battle.pinCd = 3;
      }

      if (hasRule(battle, 'rule_execute') && enemy.cells > 0 && enemy.cells <= EXECUTE_THRESHOLD) {
        enemy.cells = 0;
        battle.events.push({ type: 'execute', x: enemy.x, y: enemy.y });
      }

      if (
        hasRule(battle, 'execute_mark') &&
        (enemy.mark ?? 0) >= 3 &&
        enemy.cells > 0 &&
        enemy.cells <= 4
      ) {
        enemy.cells = 0;
        battle.events.push({ type: 'execute', x: enemy.x, y: enemy.y });
      }

      if (hasRule(battle, 'rule_combo')) {
        battle.hitCount += 1;
        if (battle.hitCount % COMBO_EVERY === 0) {
          const extra = pickTarget(battle, battle.player, orbRange(battle), enemy.id);
          if (extra !== null && extra.cells > 0) rawHit(battle, extra, 1, 0, 'combo');
        }
      }
    }

    function fireBullet(battle, from, card, target) {
      battle.bullets.push({
        id: battle.nextId++,
        x: from.x,
        y: from.y,
        targetId: target.id,
        // 存基础格数：命中时 hitEnemy 会再走一次 attackCells，否则锋锐会被加成两次
        cells: card.cells ?? 1,
        burn: card.burn ?? 0,
        mark: card.mark ?? 0,
        pierce: hasCore(battle, 'core_pierce') ? 1 : 0,
        life: 1.2,
      });
      battle.events.push({ type: 'shot', x: from.x, y: from.y, card: card.id });
    }

    function pulse(battle, card) {
      const targets = battle.enemies
        .filter((e) => e.cells > 0 && dist(battle.player, e) <= fieldRadius(battle) + e.r)
        .slice(0, card.aoe || 1);
      for (const e of targets) hitEnemy(battle, e, card);
      if (targets.length > 0) {
        battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: card.id });
      }
    }

    function attackTick(battle, dt) {
      for (const source of battle.sources) {
        if (battle.modifier === 'silent' && source.card.carrier === 'field') continue;
        source.timer -= dt;
        if (source.timer > 0) continue;
        source.timer += cardCooldown(battle, source.card.cd);
        if (source.card.carrier === 'field') {
          pulse(battle, source.card);
          continue;
        }
        const extra = hasRule(battle, 'chain') ? battle.chainStacks : 0;
        if (extra > 0) battle.chainStacks = 0;
        for (let shot = 0; shot < 1 + extra; shot += 1) {
          const target = pickTarget(battle, battle.player, orbRange(battle));
          if (target === null) break;
          fireBullet(battle, battle.player, source.card, target);
        }
      }

    }

    function summonsTick(battle, dt) {
      const p = battle.player;

      if (hasRule(battle, 'merge')) {
        for (let i = 0; i < battle.summons.length; i += 1) {
          for (let j = i + 1; j < battle.summons.length; j += 1) {
            const a = battle.summons[i];
            const b = battle.summons[j];
            if (dist(a, b) > 10) continue;
            a.cells += b.cells;
            a.maxCells += b.maxCells;
            a.merged = true;
            battle.summons.splice(j, 1);
            j -= 1;
            battle.events.push({ type: 'merge', x: a.x, y: a.y });
          }
        }
      }

      for (let i = battle.summons.length - 1; i >= 0; i -= 1) {
        const summon = battle.summons[i];

        if (summon.mode === 'totem') {
          summon.timer -= dt;
          if (summon.timer > 0) continue;
          summon.timer += cardCooldown(battle, summon.card.cd);
          for (const other of battle.summons) {
            if (other === summon) continue;
            if (dist(summon, other) > 30) continue;
            other.cells = Math.min(other.maxCells, other.cells + 1);
          }
          continue;
        }

        if (summon.mode === 'charge') {
          const target = nearestEnemy(battle, summon, 220);
          if (target === null) continue;
          const d = dist(summon, target) || 1;
          if (d <= target.r + 4) {
            for (const e of battle.enemies) {
              if (e.cells <= 0) continue;
              if (dist(e, summon) > (summon.card.radius ?? 18)) continue;
              rawHit(battle, e, summon.card.blast ?? 3, 0, summon.card.id);
            }
            battle.events.push({ type: 'blast', x: summon.x, y: summon.y });
            killSummon(battle, summon);
            continue;
          }
          summon.x += ((target.x - summon.x) / d) * 60 * dt;
          summon.y += ((target.y - summon.y) / d) * 60 * dt;
          continue;
        }

        const tx = p.x - 10;
        const ty = p.y - 10;
        summon.x += (tx - summon.x) * Math.min(1, dt * 3);
        summon.y += (ty - summon.y) * Math.min(1, dt * 3);
        summon.timer -= dt;
        if (summon.timer > 0) continue;
        summon.timer += cardCooldown(battle, summon.card.cd);
        const target = pickTarget(battle, summon, summonRange(battle));
        if (target !== null) fireBullet(battle, summon, summon.card, target);
      }
    }

    function selfTick(battle, dt) {
      for (const self of battle.selfs) {
        self.timer -= dt;
        if (self.timer > 0) continue;
        self.timer += cardCooldown(battle, self.card.cd);
        const targets = battle.enemies.filter(
          (e) => e.cells > 0 && dist(battle.player, e) <= selfRadius(battle) + e.r,
        );
        for (const e of targets) hitEnemy(battle, e, self.card);
        if (targets.length > 0) {
          battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: self.card.id });
        }
      }
    }

    function freezeAll(battle, seconds) {
      for (const e of battle.enemies) {
        if (e.cells > 0) e.freeze = Math.max(e.freeze, seconds);
      }
      battle.events.push({ type: 'freeze' });
    }

    function rulesTick(battle, dt) {
      if (hasRule(battle, 'rule_anchor')) {
        battle.anchorTimer += dt;
        if (battle.anchorTimer >= ANCHOR_SECONDS) {
          battle.anchorTimer -= ANCHOR_SECONDS;
          freezeAll(battle, FREEZE_SECONDS);
        }
      }
      if (hasRule(battle, 'time_stop')) {
        battle.timeStopTimer += dt;
        if (battle.timeStopTimer >= 12) {
          battle.timeStopTimer -= 12;
          freezeAll(battle, 1.5);
        }
      }
    }

    function burstShield(battle) {
      for (const e of battle.enemies) {
        if (e.cells <= 0) continue;
        if (dist(battle.player, e) > 24) continue;
        rawHit(battle, e, 3, 0, 'burst');
      }
      battle.events.push({ type: 'burst', x: battle.player.x, y: battle.player.y });
    }

    function riskTick(battle, dt) {
      if (!hasRule(battle, 'shield_burst')) return;
      battle.shieldTimer -= dt;
      if (battle.shieldTimer > 0) return;
      battle.shieldTimer += 6;
      battle.player.shield = Math.min(4, battle.player.shield + 2);
      battle.events.push({ type: 'shield', x: battle.player.x, y: battle.player.y });
    }

    function trapTick(battle, dt) {
      const p = battle.player;

      for (const source of battle.trapSources) {
        source.timer -= dt;
        if (source.timer > 0) continue;
        source.timer += cardCooldown(battle, source.card.cd);
        battle.traps.push({ card: source.card, x: p.x, y: p.y, ttl: source.card.ttl });
      }

      for (let i = battle.traps.length - 1; i >= 0; i -= 1) {
        const trap = battle.traps[i];
        trap.ttl -= dt;
        const triggered = battle.enemies.some(
          (e) => e.cells > 0 && dist(trap, e) <= trap.card.radius + e.r,
        );
        if (triggered) {
          for (const e of battle.enemies) {
            if (e.cells <= 0) continue;
            if (dist(trap, e) > trap.card.radius + e.r) continue;
            if (trap.card.cells) rawHit(battle, e, trap.card.cells, 0, trap.card.id);
            if (trap.card.burn) applyBurn(e.status, trap.card.burn, battle.burnCap);
            if (trap.card.freeze) e.freeze = Math.max(e.freeze, trap.card.freeze);
          }
          battle.events.push({ type: 'trap', x: trap.x, y: trap.y });
          battle.traps.splice(i, 1);
          continue;
        }
        if (trap.ttl <= 0) battle.traps.splice(i, 1);
      }

      for (const source of battle.trailSources) {
        source.timer -= dt;
        if (source.timer > 0) continue;
        source.timer += source.card.cd;
        battle.trails.push({ card: source.card, x: p.x, y: p.y, ttl: source.card.ttl, tick: 0 });
      }

      for (let i = battle.trails.length - 1; i >= 0; i -= 1) {
        const trail = battle.trails[i];
        trail.ttl -= dt;
        trail.tick -= dt;
        if (trail.tick <= 0) {
          trail.tick += 0.5;
          for (const e of battle.enemies) {
            if (e.cells <= 0) continue;
            if (dist(trail, e) > trail.card.radius + e.r) continue;
            rawHit(battle, e, trail.card.cells, trail.card.burn ?? 0, trail.card.id);
          }
        }
        if (trail.ttl <= 0) battle.trails.splice(i, 1);
      }
    }

    function bulletsTick(battle, dt) {
      const alive = [];
      for (const bullet of battle.bullets) {
        const target = battle.enemies.find((e) => e.id === bullet.targetId && e.cells > 0);
        if (!target) {
          bullet.life -= dt;
          if (bullet.life > 0) alive.push(bullet);
          continue;
        }
        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        const d = Math.hypot(dx, dy) || 1;
        const travel = BULLET_SPEED * dt;
        if (d <= travel + BULLET_HIT_RADIUS) {
          hitEnemy(battle, target, { cells: bullet.cells, burn: bullet.burn, mark: bullet.mark });
          if (target.locks.includes('reflect') && (target.reflectCd ?? 0) <= 0) {
            target.reflectCd = 1;
            battle.player.cells -= 1;
            battle.events.push({ type: 'reflect', x: battle.player.x, y: battle.player.y });
          }
          if (bullet.pierce > 0) {
            const next = pickTarget(battle, bullet, orbRange(battle), target.id);
            if (next !== null) {
              bullet.pierce -= 1;
              bullet.targetId = next.id;
              alive.push(bullet);
            }
          }
          continue;
        }
        bullet.x += (dx / d) * travel;
        bullet.y += (dy / d) * travel;
        alive.push(bullet);
      }
      battle.bullets = alive;
    }

    function placeEnemy(enemy, nx, ny) {
      const cx = clamp(nx, enemy.r, ARENA.w - enemy.r);
      const cy = clamp(ny, enemy.r, ARENA.h - enemy.r);
      const hitWall = cx !== nx || cy !== ny;
      enemy.x = cx;
      enemy.y = cy;
      return hitWall;
    }

    /** 撞墙伤害不看甲壳：位移是"撞"，不是"打"。 */
    function wallSlam(battle, enemy) {
      if (!hasRule(battle, 'rule_wall_slam')) return;
      if (enemy.wallCd > 0) return;
      enemy.wallCd = 1;
      recordDamage(battle, 'wall', applyDamage(enemy, 2));
      battle.events.push({ type: 'wall', x: enemy.x, y: enemy.y });
    }

    function displacementTick(battle, dt) {
      const p = battle.player;
      for (const verb of battle.verbs) {
        verb.timer -= dt;
        if (verb.timer > 0) continue;
        verb.timer += verb.card.cd;
        const radius = verb.card.radius * visionScale(battle.attrs);

        if (verb.card.kind === 'pull') {
          for (const e of battle.enemies) {
            if (e.cells <= 0 || e.locks.includes('anchor')) continue;
            const d = dist(p, e) || 1;
            if (d > radius) continue;
            const hit = placeEnemy(
              e,
              e.x + ((p.x - e.x) / d) * verb.card.strength,
              e.y + ((p.y - e.y) / d) * verb.card.strength,
            );
            if (hit) wallSlam(battle, e);
          }
          battle.events.push({ type: 'pull', x: p.x, y: p.y });
          continue;
        }

        if (verb.card.kind === 'push') {
          for (const e of battle.enemies) {
            if (e.cells <= 0 || e.locks.includes('anchor')) continue;
            const d = dist(p, e) || 1;
            if (d > radius) continue;
            rawHit(battle, e, verb.card.cells, 0, verb.card.id);
            const hit = placeEnemy(
              e,
              e.x + ((e.x - p.x) / d) * verb.card.strength,
              e.y + ((e.y - p.y) / d) * verb.card.strength,
            );
            if (hit) wallSlam(battle, e);
          }
          battle.events.push({ type: 'push', x: p.x, y: p.y });
          continue;
        }

        if (verb.card.kind === 'vortex') {
          for (const e of battle.enemies) {
            if (e.cells <= 0 || e.locks.includes('anchor')) continue;
            if (dist(p, e) > radius) continue;
            e.vortex = Math.max(e.vortex, verb.card.duration);
          }
          battle.events.push({ type: 'vortex', x: p.x, y: p.y });
        }
      }
    }

    function enemiesTick(battle, dt) {
      const p = battle.player;
      for (const e of battle.enemies) {
        if (e.cells <= 0) continue;
        e.flash = Math.max(0, e.flash - dt);
        if (e.wallCd > 0) e.wallCd = Math.max(0, e.wallCd - dt);
        if ((e.reflectCd ?? 0) > 0) e.reflectCd = Math.max(0, e.reflectCd - dt);
        if (e.freeze > 0) {
          e.freeze = Math.max(0, e.freeze - dt);
          continue;
        }
        if (e.root > 0) {
          e.root = Math.max(0, e.root - dt);
          continue;
        }
        if (e.vortex > 0) {
          e.vortex = Math.max(0, e.vortex - dt);
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const hit = placeEnemy(
            e,
            e.x + (-dy / d) * VORTEX_SPEED * dt,
            e.y + (dx / d) * VORTEX_SPEED * dt,
          );
          if (hit) wallSlam(battle, e);
          continue;
        }
        if (e.locks.includes('devour')) {
          e.devourCd = (e.devourCd ?? 6) - dt;
          if (e.devourCd <= 0) {
            e.devourCd += 6;
            const prey = nearestSummon(battle, e, 12);
            if (prey !== null) {
              e.cells = Math.min(e.maxCells, e.cells + 3);
              killSummon(battle, prey);
            }
          }
        }
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = e.r + PLAYER_RADIUS + CONTACT_PAD;
        if (d > reach) {
          const step = Math.min(e.speed * dt, d - reach);
          e.x += (dx / d) * step;
          e.y += (dy / d) * step;
          e.attackTimer = Math.min(e.attackTimer, ENEMY_ATTACK_INTERVAL);
          continue;
        }
        e.attackTimer -= dt;
        if (e.attackTimer > 0) continue;
        e.attackTimer += ENEMY_ATTACK_INTERVAL;
        let dmg = damageTaken(e.damage, battle.attrs);
        if (hasRule(battle, 'link')) {
          const linked = nearestSummon(battle, p, 40);
          if (linked !== null) {
            const transfer = dmg * 0.5;
            linked.cells -= transfer;
            dmg -= transfer;
            if (linked.cells <= 0) killSummon(battle, linked);
          }
        }
        if (battle.player.shield > 0 && dmg > 0) {
          const absorbed = Math.min(battle.player.shield, dmg);
          battle.player.shield -= absorbed;
          dmg -= absorbed;
          if (battle.player.shield <= 0 && hasRule(battle, 'shield_burst')) burstShield(battle);
        }
        if (dmg <= 0) continue;
        if (hasRule(battle, 'delay')) {
          battle.delayQueue.push({ due: battle.time + 2, amount: dmg, sourceId: e.id });
          battle.events.push({ type: 'delay', x: p.x, y: p.y, cells: dmg });
        } else {
          p.cells -= dmg;
          if (hasRule(battle, 'blood_debt')) {
            battle.bloodStacks = Math.min(3, battle.bloodStacks + 1);
          }
          battle.events.push({ type: 'hurt', x: p.x, y: p.y, cells: dmg });
        }
        if (p.cells <= 0) {
          p.cells = 0;
          battle.state = 'dead';
          return;
        }
      }
    }

    function statusTick(battle, dt) {
      for (const e of battle.enemies) {
        if (e.cells <= 0) continue;
        if ((e.mark ?? 0) > 0) {
          e.markLeft = (e.markLeft ?? 0) - dt;
          if (e.markLeft <= 0) e.mark = 0;
        }
        if (e.locks.includes('generator')) {
          e.genCd = (e.genCd ?? 3) - dt;
          if (e.genCd <= 0) {
            e.genCd += 3;
            for (const ally of battle.enemies) {
              if (ally === e || ally.cells <= 0) continue;
              if (dist(e, ally) > 20) continue;
              ally.shield = Math.min(4, (ally.shield ?? 0) + 2);
            }
          }
        }
        if (e.locks.includes('cleanse')) {
          e.cleanseCd = (e.cleanseCd ?? 3) - dt;
          if (e.cleanseCd <= 0) {
            e.cleanseCd += 3;
            e.status.burn = 0;
            e.mark = 0;
          }
        }
        if (e.locks.includes('phase')) {
          e.phaseCd = (e.phaseCd ?? 4) - dt;
          if (e.phaseCd <= 0) {
            e.phaseCd += 4;
            e.invuln = 1.5;
          }
          if (e.invuln > 0) {
            e.invuln = Math.max(0, e.invuln - dt);
            continue;
          }
        }
        const burn = advanceStatus(e.status, dt);
        if (burn <= 0) continue;
        const dealt = resolveHit(e, burn, { main: false });
        recordDamage(battle, 'burn', applyDamage(e, dealt));
        battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: dealt });
      }
    }

    function refreshCooldowns(battle) {
      for (const source of battle.sources) source.timer = 0;
      for (const summon of battle.summons) summon.timer = 0;
      for (const self of battle.selfs) self.timer = 0;
    }

    function resolveDeaths(battle) {
      const alive = [];
      const booms = [];
      const embers = [];
      const marks = [];
      for (const e of battle.enemies) {
        if (e.cells > 0) {
          alive.push(e);
          continue;
        }
        battle.kills += 1;
        battle.stats.kills = (battle.stats.kills ?? 0) + 1;
        for (const lock of e.locks) {
          battle.stats.killsByLock[lock] = (battle.stats.killsByLock[lock] ?? 0) + 1;
        }
        battle.events.push({ type: 'kill', x: e.x, y: e.y, id: e.id });
        if (e.primary) {
          awardXp(battle, Math.max(1, Math.round(e.maxCells / XP_PER_CELL)));
          if (e.elite) {
            battle.pending += 1;
            battle.events.push({ type: 'elite', x: e.x, y: e.y });
          }
          if (hasRule(battle, 'rule_boom')) booms.push({ x: e.x, y: e.y });
          if (hasCore(battle, 'core_siphon')) {
            battle.player.cells = Math.min(battle.player.maxCells, battle.player.cells + 1);
          }
          if (e.status.burn > 0) embers.push({ x: e.x, y: e.y, burn: e.status.burn });
          if ((e.mark ?? 0) > 0) marks.push({ x: e.x, y: e.y, stacks: e.mark });
          if (hasCore(battle, 'core_echo')) {
            battle.echoKills += 1;
            if (battle.echoKills % 8 === 0) refreshCooldowns(battle);
          }
          if (hasRule(battle, 'chain')) {
            battle.chainStacks = Math.min(3, battle.chainStacks + 1);
          }
          if (battle.delayQueue.length > 0) {
            battle.delayQueue = battle.delayQueue.filter((item) => item.sourceId !== e.id);
          }
        }
        if (e.canSplit && e.primary) {
          const child = Math.max(1, Math.ceil(e.maxCells * 0.5));
          for (let i = 0; i < 2; i += 1) {
            alive.push({
              ...e,
              id: battle.nextId++,
              cells: child,
              maxCells: child,
              primary: false,
              canSplit: false,
              locks: [],
              r: enemyRadius(child),
              status: createStatus(),
              freeze: 0,
              flash: 0,
            });
          }
        }
      }
      battle.enemies = alive;

      // 余烬：灼烧目标死亡时把层数传给最近的敌人（核心把 1 个变成 3 个）
      for (const ember of embers) {
        const targets = alive
          .filter((other) => other.cells > 0)
          .sort(
            (a, b) =>
              Math.hypot(a.x - ember.x, a.y - ember.y) - Math.hypot(b.x - ember.x, b.y - ember.y),
          )
          .slice(0, battle.emberSpread);
        for (const target of targets) applyBurn(target.status, ember.burn, battle.burnCap);
      }

      // 引信：带标记的敌人死亡时按层数爆炸；传导：标记扩散给最近的两个
      for (const mark of marks) {
        if (hasRule(battle, 'fuse')) {
          for (const other of alive) {
            if (other.cells <= 0) continue;
            if (Math.hypot(other.x - mark.x, other.y - mark.y) > 18) continue;
            recordDamage(battle, 'fuse', applyDamage(other, mark.stacks));
            battle.events.push({ type: 'burn', x: other.x, y: other.y, cells: mark.stacks });
          }
        }
        if (hasRule(battle, 'spread')) {
          const targets = alive
            .filter((other) => other.cells > 0)
            .sort(
              (a, b) =>
                Math.hypot(a.x - mark.x, a.y - mark.y) - Math.hypot(b.x - mark.x, b.y - mark.y),
            )
            .slice(0, 2);
          for (const target of targets) addMark(target, mark.stacks);
        }
      }

      for (const at of booms) {
        for (const e of alive) {
          if (e.cells <= 0) continue;
          if (dist(e, at) > BOOM_RADIUS) continue;
          recordDamage(battle, 'boom', applyDamage(e, 1) + applyDamage(e, 1));
          e.flash = 0.1;
          battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: 2 });
        }
      }
    }

    function checkEnd(battle) {
      if (battle.state !== 'fighting') return;
      if (battle.player.cells <= 0) {
        battle.state = 'dead';
        return;
      }
      if (battle.spawned >= enemyTotal(battle) && battle.enemies.length === 0) {
        battle.state = 'cleared';
        if (battle.surge) {
          battle.surge = false;
          battle.pending += 1;
          rollOffer(battle);
          battle.events.push({ type: 'surgeReward' });
        }
        return;
      }
      if (battle.time >= TIME_LIMIT) {
        battle.state = 'timeout';
      }
    }

    /** 追加压力：token 换来的额外敌人，只加数量不改组成。 */
    function addPressure(battle, count) {
      if (battle.state !== 'fighting') return 0;
      const before = battle.extra;
      const add = Math.max(0, Math.floor(count));
      battle.extra = Math.min(MAX_EXTRA, battle.extra + add);
      if (battle.extra > before) battle.events.push({ type: 'pressure', extra: battle.extra });
      return battle.extra - before;
    }

    /** 过载潮：token 攒满时来一波额外的怪，清层后给一次三选一。 */
    function triggerSurge(battle, extra = 6) {
      if (battle.state !== 'fighting' || battle.surge) return false;
      addPressure(battle, extra);
      battle.surge = true;
      battle.events.push({ type: 'surge' });
      return true;
    }

    /** 花 1 点属性。体魄当场提高上限并补回等量生命。 */
    function spendPoint(battle, id) {
      const attr = ATTRIBUTES.find((a) => a.id === id);
      if (attr === undefined) return false;
      if (battle.points <= 0) return false;
      if ((battle.attrs[id] ?? 0) >= attr.max) return false;
      const before = playerCells(battle.attrs);
      battle.attrs[id] += 1;
      battle.points -= 1;
      const after = playerCells(battle.attrs);
      if (after !== before) {
        battle.player.maxCells = after;
        battle.player.cells = Math.min(after, battle.player.cells + (after - before));
      }
      battle.events.push({ type: 'spend', id });
      return true;
    }

    /** 推进一帧，返回这一帧产生的事件。 */
    function step(battle, dt) {
      if (battle.state !== 'fighting') return [];
      battle.events = [];
      battle.time += dt;
      spawnTick(battle);
      for (let i = battle.respawns.length - 1; i >= 0; i -= 1) {
        if (battle.time < battle.respawns[i].at) continue;
        const dead = battle.respawns.splice(i, 1)[0];
        if (battle.summons.length < 6) battle.summons.push(makeSummon(battle, dead.card));
      }
      playerMove(battle, dt);
      attackTick(battle, dt);
      summonsTick(battle, dt);
      displacementTick(battle, dt);
      if (battle.pinCd > 0) battle.pinCd -= dt;
      selfTick(battle, dt);
      rulesTick(battle, dt);
      riskTick(battle, dt);
      trapTick(battle, dt);
      bulletsTick(battle, dt);
      enemiesTick(battle, dt);
      statusTick(battle, dt);
      const regen = regenPerSecond(battle.attrs);
      if (regen > 0 && battle.player.cells > 0 && battle.player.cells < battle.player.maxCells) {
        battle.player.cells = Math.min(battle.player.maxCells, battle.player.cells + regen * dt);
      }

      for (let i = battle.delayQueue.length - 1; i >= 0; i -= 1) {
        const item = battle.delayQueue[i];
        if (battle.time < item.due) continue;
        battle.delayQueue.splice(i, 1);
        battle.player.cells -= item.amount;
        battle.events.push({ type: 'hurt', x: battle.player.x, y: battle.player.y, cells: item.amount });
      }

      battle.snapshotTimer -= dt;
      if (battle.snapshotTimer <= 0) {
        battle.snapshotTimer += 0.25;
        battle.snapshots.push({
          t: battle.time,
          x: battle.player.x,
          y: battle.player.y,
          cells: battle.player.cells,
        });
        if (battle.snapshots.length > 16) battle.snapshots.shift();
      }
      if (hasRule(battle, 'rewind')) {
        battle.rewindCd -= dt;
        const half = battle.player.maxCells * 0.5;
        if (
          !battle.rewindUsed &&
          battle.rewindCd <= 0 &&
          battle.player.cells > 0 &&
          battle.player.cells < half
        ) {
          const target = battle.snapshots.find((snap) => snap.t <= battle.time - 3);
          if (target !== undefined) {
            battle.player.x = target.x;
            battle.player.y = target.y;
            battle.player.cells = Math.max(battle.player.cells, target.cells);
            battle.rewindUsed = true;
            battle.events.push({ type: 'rewind', x: target.x, y: target.y });
          }
        }
      }

      resolveDeaths(battle);
      checkEnd(battle);
      return battle.events;
    }

    /** 一直跑到结束，返回同一场战斗。dt 固定，保证可复现。 */
    function runToEnd(battle, { dt = 1 / 60, maxSeconds = 120 } = {}) {
      while (battle.state === 'fighting' && battle.time < maxSeconds) {
        step(battle, dt);
      }
      return battle;
    }
// </core>

    const W = ARENA.w
    const H = ARENA.h
    const STEP = 1 / 60
    const POLL_MS = 800
    const CLEAR_PAUSE = 1.1
    const FAIL_PAUSE = 3.4
    const MAX_FLOOR = 15
    const TOKENS_PER_ENEMY = 500
    const TYPE_ID = 'dsh-pet'
    const KIND = 'pet'

    const BUILDS = {
      lab: {
        id: 'lab',
        label: '实验',
        cards: ['orb_phys', 'orb_fire', 'field_fire'],
        pool: [...LAB_PACK],
        families: [
          [...FIRE_PACK],
          [...GRAVITY_PACK],
          [...MARK_PACK],
          [...SUMMON_PACK],
          [...TIME_PACK],
          [...RISK_PACK],
          [...ENV_PACK],
        ],
      },
    }

    const COLORS = {
      bg: '#0a0d12',
      grid: '#121a24',
      frame: '#1c2733',
      player: '#cfe3ef',
      playerDark: '#7fa3b8',
      eye: '#0a0d12',
      bullet: '#ffd166',
      burn: '#ff9f45',
      enemy: { rim: '#7e312c', body: '#c4534b' },
      carapace: { rim: '#2f4a5c', body: '#6f97b0' },
      split: { rim: '#4d2379', body: '#8f4bd6' },
      summon: { rim: '#7a5410', body: '#e0a526' },
    }

    const CSS = [
      '.dsh-pet{display:flex;flex-direction:column;gap:6px;padding:8px;color:#dbe7f0;font-size:11px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;height:100%;box-sizing:border-box;overflow-y:auto}',
      '.dsh-pet-top{display:flex;align-items:center;gap:6px}',
      '.dsh-pet-floor{font-weight:700;color:#ffd166;letter-spacing:.04em}',
      '.dsh-pet-muted{color:#7f93a3}',
      '.dsh-pet-spacer{margin-left:auto}',
      '.dsh-pet-btn{font:inherit;font-size:10px;color:#cfe3ef;background:#111a24;border:1px solid #24313d;',
      'border-radius:4px;padding:2px 6px;cursor:pointer}',
      '.dsh-pet-btn:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-dot{width:6px;height:6px;border-radius:50%;background:#41505f}',
      '.dsh-pet-dot.on{background:#6ee7a8;box-shadow:0 0 6px #6ee7a8}',
      '.dsh-pet-stage{position:relative;border-radius:4px;overflow:hidden;background:#0a0d12}',
      '.dsh-pet-canvas{display:block;width:100%;height:auto;image-rendering:pixelated}',
      '.dsh-pet-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;gap:4px;padding:8px;text-align:center;background:rgba(8,12,18,.72)}',
      '.dsh-pet-overlay-title{font-size:15px;letter-spacing:.18em}',
      '.dsh-pet-overlay-title.bad{color:#e35d5d}',
      '.dsh-pet-overlay-title.good{color:#6ee7a8}',
      '.dsh-pet-overlay-sub{font-size:10px;color:#9fb2c2;line-height:1.5}',
      '.dsh-pet-cells{height:4px;background:#18212b;border-radius:2px;overflow:hidden}',
      '.dsh-pet-cells i{display:block;height:100%;background:#6ee7a8;transition:width .12s linear}',
      '.dsh-pet-bottom{display:flex;gap:8px;color:#6c8091;font-size:10px}',
      '.dsh-pet-hot{color:#e35d5d}',
      '.dsh-pet-offer{position:absolute;left:5px;right:5px;bottom:5px;display:flex;flex-direction:column;gap:3px;',
      'background:rgba(10,14,20,.94);border:1px solid #2a3a4a;border-radius:5px;padding:5px}',
      '.dsh-pet-offer-title{font-size:9px;color:#ffd166;letter-spacing:.08em}',
      '.dsh-pet-card{display:flex;flex-direction:column;gap:1px;text-align:left;font:inherit;font-size:10px;',
      'color:#dbe7f0;background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:3px 5px;cursor:pointer}',
      '.dsh-pet-card:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-card-name{color:#ffd166;font-weight:700}',
      '.dsh-pet-card-desc{color:#8fa4b5;font-size:9px}',
      '.dsh-pet-attrs{display:flex;flex-direction:column;gap:3px}',
      '.dsh-pet-attrs-head{display:flex;justify-content:space-between;font-size:10px;color:#7f93a3}',
      '.dsh-pet-points{color:#ffd166}',
      '.dsh-pet-attr-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px}',
      '.dsh-pet-attr{display:flex;justify-content:space-between;font:inherit;font-size:10px;color:#cfe3ef;',
      'background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:2px 5px;cursor:pointer}',
      '.dsh-pet-attr:hover:not(:disabled){background:#16222e;border-color:#3a5470}',
      '.dsh-pet-attr:disabled{opacity:.45;cursor:default}',
      '.dsh-pet-attr-val{color:#8fa4b5}',
      '.dsh-pet-cores{display:flex;flex-direction:column;gap:3px}',
      '.dsh-pet-cores-head{display:flex;justify-content:space-between;font-size:10px;color:#7f93a3}',
      '.dsh-pet-core-pool{display:flex;flex-wrap:wrap;gap:3px}',
      '.dsh-pet-core{font:inherit;font-size:9px;color:#8fa4b5;background:#111a24;',
      'border:1px solid #1f2a36;border-radius:4px;padding:2px 5px;cursor:pointer}',
      '.dsh-pet-core.on{color:#0a0d12;background:#ffd166;border-color:#ffd166}',
      '.dsh-pet-core:disabled{opacity:.35;cursor:default}',
    ].join('')

    // ---- 进度 ----

    const SAVE_PREFIX = 'dsh.pet.v3.'

    function loadAccount(key) {
      const empty = {
        attrs: {},
        points: 0,
        cores: [],
        stats: { kills: 0, bestFloor: 1, maxFloorKills: 0, drafts: 0 },
      }
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return empty
        const raw = store.getItem(SAVE_PREFIX + key)
        if (raw === null) return empty
        const parsed = JSON.parse(raw)
        const src = parsed !== null && typeof parsed === 'object' ? parsed : {}
        const stats = src.stats !== null && typeof src.stats === 'object' ? src.stats : {}
        return {
          attrs: normalizeAttrs(src.attrs),
          points: Math.max(0, Math.floor(Number(src.points) || 0)),
          cores: Array.isArray(src.cores) ? src.cores.filter((id) => CORE_CARDS[id]) : [],
          stats: {
            kills: Math.max(0, Math.floor(Number(stats.kills) || 0)),
            bestFloor: Math.max(1, Math.floor(Number(stats.bestFloor) || 1)),
            maxFloorKills: Math.max(0, Math.floor(Number(stats.maxFloorKills) || 0)),
            drafts: Math.max(0, Math.floor(Number(stats.drafts) || 0)),
          },
        }
      } catch {
        return empty
      }
    }

    function saveAccount(entry) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return
        store.setItem(
          SAVE_PREFIX + entry.key,
          JSON.stringify({
            attrs: entry.attrs,
            points: entry.points,
            cores: entry.cores,
            stats: entry.stats,
          }),
        )
      } catch {
        // 存档失败不能打断战斗
      }
    }

    const ENTRIES = new Map()

    function drainTokens(entry) {
      const battle = entry.battle
      if (battle === null || entry.phase !== 'fight') return
      while (entry.tokenQueue >= TOKENS_PER_ENEMY) {
        if (addPressure(battle, 1) === 0) {
          entry.tokenQueue = 0
          return
        }
        entry.tokenQueue -= TOKENS_PER_ENEMY
      }
    }

    function pushTokens(entry, delta) {
      if (!Number.isFinite(delta) || delta <= 0) return
      entry.tokenQueue += delta
      entry.surgeMeter += delta
      if (entry.surgeMeter >= 3000) {
        entry.surgeMeter -= 3000
        if (entry.battle !== null && entry.phase === 'fight') triggerSurge(entry.battle)
      }
      drainTokens(entry)
    }

    function syncAccount(entry) {
      const battle = entry.battle
      if (battle === null) return
      entry.points = battle.points
      entry.attrs = { ...battle.attrs }
      entry.level = battle.level
      entry.xp = battle.xp
      entry.xpNext = battle.xpNext
      entry.pending = battle.pending
      entry.stats.kills += battle.kills
      entry.stats.maxFloorKills = Math.max(entry.stats.maxFloorKills, battle.kills)
      if (battle.state === 'cleared') {
        entry.stats.bestFloor = Math.max(entry.stats.bestFloor, entry.floor + 1)
      }
      saveAccount(entry)
    }

    function startFloor(entry, floor) {
      syncAccount(entry)
      const build = BUILDS[entry.buildId]
      entry.floor = floor
      entry.phase = 'fight'
      entry.fx = []
      entry.acc = 0
      entry.battle = createBattle({
        floor,
        build: [...build.cards, ...entry.drafted],
        attrs: entry.attrs,
        points: entry.points,
        cores: entry.cores,
        level: entry.level,
        xp: entry.xp,
        xpNext: entry.xpNext,
        pending: entry.pending,
        seed: entry.seed++,
        pool: build.pool,
        families: build.families,
        pity: entry.pity,
        drafted: entry.drafted,
      })
      entry.pity = null
      drainTokens(entry)
    }

    function createEntry(key, seed) {
      const account = loadAccount(key)
      const entry = {
        key,
        battle: null,
        floor: 1,
        best: 1,
        buildId: 'lab',
        attrs: account.attrs,
        points: account.points,
        cores: account.cores,
        stats: account.stats,
        level: 1,
        xp: 0,
        xpNext: 6,
        pending: 0,
        tokenQueue: 0,
        tokenSeen: new Map(),
        surgeMeter: 0,
        pity: null,
        dropped: null,
        phase: 'fight',
        lastResult: null,
        resultTimer: 0,
        fx: [],
        acc: 0,
        drafted: [],
        seed: seed === undefined ? (Date.now() % 100000) + 1 : seed,
        running: false,
        online: true,
        consumed: 0,
        raf: 0,
        last: 0,
        subs: 0,
      }
      startFloor(entry, 1)
      return entry
    }

    function resetRun(entry, floor) {
      entry.drafted = []
      entry.level = 1
      entry.xp = 0
      entry.xpNext = 6
      entry.pending = 0
      entry.battle = null
      startFloor(entry, floor)
    }

    function advance(entry) {
      const cleared = entry.lastResult !== null && entry.lastResult.kind === 'cleared'
      if (!cleared) {
        // 失败不再回第 1 层：停在失败层，保留 build 与属性，
        // 下一次三选一保底给一张能解致死锁的卡。
        const def = floorDef(entry.floor)
        entry.pity = def.locks.length > 0 ? def.locks[0] : null
        syncAccount(entry)
        // 槽位满时没有地方放保底卡：弃置最早的一张，换一次重抽机会
        if (entry.drafted.length >= 3) entry.dropped = entry.drafted.shift()
        entry.pending = 1
        entry.battle = null
        startFloor(entry, entry.floor)
        return
      }
      // 没选的三选一跨层保留，否则玩家一不留神就丢了这次升级。
      const carried = entry.battle === null ? null : entry.battle.offer
      const carriedPending = entry.battle === null ? 0 : entry.battle.pending
      const next = entry.floor + 1
      if (next > MAX_FLOOR) {
        resetRun(entry, 1)
        return
      }
      startFloor(entry, next)
      if (carried !== null && entry.battle !== null && entry.battle.offer === null) {
        entry.battle.offer = carried
        entry.battle.pending = Math.max(1, carriedPending)
      }
    }

    function pickCard(entry, id) {
      const battle = entry.battle
      if (battle === null) return false
      if (!chooseCard(battle, id)) return false
      entry.drafted.push(id)
      entry.stats.drafts += 1
      saveAccount(entry)
      return true
    }

    function toggleCore(entry, id) {
      if (!unlockedCores(entry.stats).includes(id)) return false
      const index = entry.cores.indexOf(id)
      if (index >= 0) entry.cores.splice(index, 1)
      else if (entry.cores.length < 3) entry.cores.push(id)
      else return false
      saveAccount(entry)
      resetRun(entry, 1)
      return true
    }

    function spend(entry, id) {
      const battle = entry.battle
      if (battle === null) return false
      if (!spendPoint(battle, id)) return false
      entry.attrs = { ...battle.attrs }
      entry.points = battle.points
      saveAccount(entry)
      return true
    }

    function tick(entry, dt) {
      for (const f of entry.fx) {
        f.life -= dt
        f.r += dt * 46
      }
      if (entry.fx.length > 0) entry.fx = entry.fx.filter((f) => f.life > 0)

      if (entry.phase === 'result') {
        entry.resultTimer -= dt
        if (entry.resultTimer <= 0) advance(entry)
        return
      }

      const battle = entry.battle
      if (battle === null) return
      drainTokens(entry)
      const events = step(battle, dt)
      for (const ev of events) {
        if (ev.type === 'pulse') entry.fx.push({ x: ev.x, y: ev.y, r: 6, life: 0.4 })
        else if (ev.type === 'kill') entry.fx.push({ x: ev.x, y: ev.y, r: 2, life: 0.28 })
      }
      if (battle.state !== 'fighting') {
        entry.lastResult = {
          kind: battle.state,
          floor: entry.floor,
          kills: battle.kills,
          cells: battle.player.cells,
        }
        entry.phase = 'result'
        entry.resultTimer = battle.state === 'cleared' ? CLEAR_PAUSE : FAIL_PAUSE
        if (battle.state === 'cleared') entry.best = Math.max(entry.best, entry.floor)
      }
    }

    function startTicker(entry) {
      if (entry.raf !== 0) return
      entry.last = performance.now()
      const loop = (now) => {
        entry.raf = window.requestAnimationFrame(loop)
        const dt = Math.min(0.1, (now - entry.last) / 1000)
        entry.last = now
        entry.acc += dt
        let guard = 0
        while (entry.acc >= STEP && guard < 8) {
          tick(entry, STEP)
          entry.acc -= STEP
          guard += 1
        }
        if (guard >= 8) entry.acc = 0
      }
      entry.raf = window.requestAnimationFrame(loop)
    }

    function acquireEntry(key) {
      let entry = ENTRIES.get(key)
      if (entry === undefined) {
        entry = createEntry(key)
        ENTRIES.set(key, entry)
      }
      entry.subs += 1
      startTicker(entry)
      return entry
    }

    function releaseEntry(key) {
      const entry = ENTRIES.get(key)
      if (entry === undefined) return
      entry.subs = Math.max(0, entry.subs - 1)
      if (entry.subs === 0 && entry.raf !== 0) {
        window.cancelAnimationFrame(entry.raf)
        entry.raf = 0
      }
    }

    // ---- 绘制 ----

    function drawEnemy(c, e) {
      const size = Math.round(4 + Math.min(6, e.cells / 4))
      const half = Math.floor(size / 2)
      const x = Math.round(e.x) - half
      const y = Math.round(e.y) - half
      const style = e.locks.includes('carapace')
        ? COLORS.carapace
        : e.locks.includes('split')
          ? COLORS.split
          : COLORS.enemy
      const lit = e.flash > 0
      const phased = (e.invuln ?? 0) > 0
      if (phased) c.globalAlpha = 0.45
      c.fillStyle = lit ? '#ffffff' : style.rim
      c.fillRect(x, y, size, size)
      c.fillStyle = lit ? '#ffffff' : style.body
      c.fillRect(x + 1, y + 1, Math.max(1, size - 2), Math.max(1, size - 2))

      // 格数条
      const barW = Math.max(3, size)
      c.fillStyle = '#101820'
      c.fillRect(x, y - 4, barW, 1)
      c.fillStyle = style.body
      const filled = Math.max(1, Math.round((e.cells / e.maxCells) * barW))
      c.fillRect(x, y - 4, Math.min(barW, filled), 1)

      // 锁标记
      if (e.locks.includes('carapace')) {
        c.fillStyle = '#8fd8ff'
        c.fillRect(x - 2, y - 2, 1, 2)
      }
      // 灼烧标记
      if (e.status.burn > 0) {
        c.fillStyle = COLORS.burn
        c.fillRect(x + size + 1, y, 1, 1)
        if (e.status.burn >= 3) c.fillRect(x + size + 1, y + 2, 1, 1)
      }
      if ((e.mark ?? 0) > 0) {
        c.fillStyle = '#ff6b6b'
        c.fillRect(x + Math.floor(size / 2), y - 6, 1, 1)
      }
      if (phased) c.globalAlpha = 1
      if ((e.shield ?? 0) > 0) {
        c.fillStyle = '#9fd8ff'
        c.fillRect(x - 1, y - 1, size + 2, 1)
        c.fillRect(x - 1, y + size, size + 2, 1)
        c.fillRect(x - 1, y - 1, 1, size + 2)
        c.fillRect(x + size, y - 1, 1, size + 2)
      }
    }

    function drawSummon(c, s) {
      const x = Math.round(s.x) - 2
      const y = Math.round(s.y) - 2
      c.fillStyle = COLORS.summon.rim
      c.fillRect(x, y, 4, 4)
      c.fillStyle = COLORS.summon.body
      c.fillRect(x + 1, y + 1, 2, 2)
    }

    function drawPlayer(c, p) {
      const x = Math.round(p.x) - 3
      const y = Math.round(p.y) - 3
      c.fillStyle = COLORS.playerDark
      c.fillRect(x, y + 5, 6, 1)
      c.fillStyle = COLORS.player
      c.fillRect(x, y, 6, 5)
      c.fillStyle = COLORS.eye
      c.fillRect(x + 1, y + 2, 1, 1)
      c.fillRect(x + 4, y + 2, 1, 1)
    }

    function draw(c, entry) {
      c.setTransform(2, 0, 0, 2, 0, 0)
      c.imageSmoothingEnabled = false
      c.fillStyle = COLORS.bg
      c.fillRect(0, 0, W, H)
      c.fillStyle = COLORS.grid
      for (let x = 8; x < W; x += 8) for (let y = 8; y < H; y += 8) c.fillRect(x, y, 1, 1)
      c.fillStyle = COLORS.frame
      c.fillRect(0, 0, W, 1)
      c.fillRect(0, H - 1, W, 1)
      c.fillRect(0, 0, 1, H)
      c.fillRect(W - 1, 0, 1, H)

      const battle = entry.battle
      if (battle === null) return

      for (const f of entry.fx) {
        const alpha = Math.max(0, f.life * 2.4)
        c.fillStyle = 'rgba(255,209,102,' + alpha.toFixed(2) + ')'
        for (let i = 0; i < 10; i += 1) {
          const a = (i / 10) * Math.PI * 2
          c.fillRect(Math.round(f.x + Math.cos(a) * f.r), Math.round(f.y + Math.sin(a) * f.r), 1, 1)
        }
      }

      for (const trail of battle.trails) {
        c.globalAlpha = Math.max(0.15, Math.min(1, trail.ttl / 2))
        c.fillStyle = trail.card.kind === 'shock' ? '#9fd8ff' : '#ff9f45'
        c.fillRect(Math.round(trail.x) - 2, Math.round(trail.y) - 2, 4, 4)
      }
      c.globalAlpha = 1
      for (const trap of battle.traps) {
        c.fillStyle = trap.card.kind === 'frost' ? '#9fd8ff' : '#e35d5d'
        c.fillRect(Math.round(trap.x) - 1, Math.round(trap.y) - 1, 3, 3)
      }

      for (const e of battle.enemies) drawEnemy(c, e)
      for (const s of battle.summons) drawSummon(c, s)
      c.fillStyle = COLORS.bullet
      for (const b of battle.bullets) c.fillRect(Math.round(b.x), Math.round(b.y), 1, 1)
      drawPlayer(c, battle.player)

      if (battle.player.shield > 0) {
        c.fillStyle = '#9fd8ff'
        for (let i = 0; i < 8; i += 1) {
          const a = (i / 8) * Math.PI * 2
          c.fillRect(
            Math.round(battle.player.x + Math.cos(a) * 7),
            Math.round(battle.player.y + Math.sin(a) * 7),
            1,
            1,
          )
        }
      }
    }

    // ---- 诊断 ----

    const LOCK_NAMES = {
      carapace: '甲壳',
      split: '分裂',
      regen: '再生',
      shield: '护盾',
      anchor: '锚定',
      cleanse: '净化',
      devour: '吞噬',
      phase: '相位',
      reflect: '反射',
      generator: '发生器',
    }

    const DAMAGE_LABELS = {
      burn: '灼烧',
      wall: '撞墙',
      boom: '尸爆',
      fuse: '引信',
      burst: '护盾爆',
      combo: '连击',
      bullet: '弹丸',
    }

    function damageReport(entry) {
      const battle = entry.battle
      if (battle === null) return ''
      const entries = Object.entries(battle.stats.damage)
      if (entries.length === 0) return ''
      entries.sort((a, b) => b[1] - a[1])
      const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1
      return entries
        .slice(0, 3)
        .map(([id, value]) => {
          const card = cardById(id)
          const name = card !== undefined ? card.name : DAMAGE_LABELS[id] ?? id
          return name + ' ' + Math.round((value / total) * 100) + '%'
        })
        .join(' / ')
    }

    function diagnose(entry) {
      const r = entry.lastResult
      if (r === null) return ''
      if (r.kind === 'cleared') return '进入第 ' + (entry.floor + 1) + ' 层'
      const def = floorDef(r.floor)
      const lock = def.locks.length > 0 ? def.locks[0] : null
      if (lock !== null) {
        return '死因：' + (LOCK_NAMES[lock] ?? lock) + ' · 重试保底给解卡'
      }
      return TIME_LIMIT + ' 秒内没清完：输出不够。'
    }

    // ---- 界面 ----

    function formatTokens(n) {
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    function PetBody(props) {
      const sessionId = props !== null && props !== undefined && props.sessionId !== undefined
        ? String(props.sessionId)
        : ''
      const canvasRef = React.useRef(null)
      const entryRef = React.useRef(null)
      const [key, setKey] = React.useState(null)
      const bump = React.useReducer((n) => n + 1, 0)[1]

      React.useEffect(() => {
        if (key === null) return undefined
        const entry = acquireEntry(key)
        entryRef.current = entry
        bump()
        return () => {
          entryRef.current = null
          releaseEntry(key)
        }
      }, [key, bump])

      React.useEffect(() => {
        let raf = 0
        const loop = () => {
          raf = window.requestAnimationFrame(loop)
          const entry = entryRef.current
          const canvas = canvasRef.current
          if (entry === null || canvas === null) return
          const c = canvas.getContext('2d')
          if (c !== null) draw(c, entry)
        }
        raf = window.requestAnimationFrame(loop)
        return () => window.cancelAnimationFrame(raf)
      }, [])

      React.useEffect(() => {
        const id = window.setInterval(() => bump(), 200)
        return () => window.clearInterval(id)
      }, [bump])

      React.useEffect(() => {
        let disposed = false
        let failures = 0
        let keyRef = null
        const poll = async () => {
          if (disposed) return
          try {
            const res = await window.fetch('/dsh-pet/usage', { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error('status ' + res.status)
            const data = await res.json()
            const table = data !== null && typeof data === 'object' ? data.sessions : null
            if (table === null || typeof table !== 'object') throw new Error('bad payload')
            const own = table[sessionId]
            const nextKey =
              own !== undefined && typeof own.workspaceKey === 'string' && own.workspaceKey.length > 0
                ? own.workspaceKey
                : 'session:' + sessionId
            if (nextKey !== keyRef) {
              keyRef = nextKey
              setKey(nextKey)
            }
            const entry = entryRef.current
            if (entry === null) return
            failures = 0
            entry.online = true
            let running = false
            let consumed = 0
            for (const [sid, row] of Object.entries(table)) {
              if (row === null || typeof row !== 'object') continue
              if (row.workspaceKey !== nextKey) continue
              if (row.running === true) running = true
              if (typeof row.totalTokens === 'number') consumed += row.totalTokens
              const out = typeof row.outputTokens === 'number' ? row.outputTokens : 0
              const seen = entry.tokenSeen.get(sid)
              if (seen === undefined) {
                // 第一次见到这个会话只记基线，不把历史 token 一次性倒进战场
                entry.tokenSeen.set(sid, out)
              } else if (out > seen) {
                entry.tokenSeen.set(sid, out)
                pushTokens(entry, out - seen)
              }
            }
            entry.running = running
            entry.consumed = consumed
          } catch {
            failures += 1
            const entry = entryRef.current
            if (entry !== null && failures >= 3) entry.online = false
          }
        }
        poll()
        const id = window.setInterval(poll, POLL_MS)
        return () => {
          disposed = true
          window.clearInterval(id)
        }
      }, [sessionId])

      const entry = entryRef.current
      if (entry === null) {
        return h('div', { className: 'dsh-pet' },
          h('style', { key: 'style' }, CSS),
          h('div', { className: 'dsh-pet-top' }, h('span', { className: 'dsh-pet-muted' }, '连接中…')),
        )
      }

      const battle = entry.battle
      const cells = battle === null ? 0 : battle.player.cells
      const maxCells = battle === null ? 1 : battle.player.maxCells
      const pct = Math.max(0, Math.min(100, (cells / maxCells) * 100))
      const build = BUILDS[entry.buildId]
      const attrs = battle !== null ? battle.attrs : entry.attrs
      const points = battle !== null ? battle.points : entry.points
      const unlocked = unlockedCores(entry.stats)
      const result = entry.phase === 'result' ? entry.lastResult : null
      const lockName = battle !== null && battle.def.locks.length > 0 ? battle.def.locks[0] : '—'
      const modifier = battle !== null ? battle.modifier : floorModifier(entry.floor)

      return h('div', { className: 'dsh-pet' },
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'dsh-pet-top' },
          h('span', { className: 'dsh-pet-floor' }, '第 ' + entry.floor + ' 层'),
          h('span', { className: 'dsh-pet-muted' }, 'Lv.' + (battle === null ? 1 : battle.level)),
          h('span', { className: 'dsh-pet-muted' }, '最佳 ' + entry.best),
          h('span', { className: 'dsh-pet-muted' }, '锁 ' + lockName),
          modifier !== null ? h('span', { className: 'dsh-pet-hot' }, MODIFIERS[modifier].name) : null,
          h('span', { className: 'dsh-pet-spacer' }),
          h('span', { className: 'dsh-pet-muted' }, build.label),
          h('span', { className: 'dsh-pet-dot' + (entry.online ? ' on' : '') }),
        ),
        h('div', { className: 'dsh-pet-stage' },
          h('canvas', { ref: canvasRef, width: W * 2, height: H * 2, className: 'dsh-pet-canvas' }),
          result !== null
            ? h('div', { className: 'dsh-pet-overlay' },
                h('div', {
                  className: 'dsh-pet-overlay-title ' + (result.kind === 'cleared' ? 'good' : 'bad'),
                }, result.kind === 'cleared' ? '清层' : result.kind === 'dead' ? '阵亡' : '超时'),
                h('div', { className: 'dsh-pet-overlay-sub' }, diagnose(entry)),
                h('div', { className: 'dsh-pet-overlay-sub' }, damageReport(entry)),
              )
            : null,
          result === null && battle !== null && battle.offer !== null
            ? h('div', { className: 'dsh-pet-offer' },
                h('div', { className: 'dsh-pet-offer-title' },
                  '升级 · 三选一（剩余 ' + battle.pending + '）'),
                battle.offer.map((id) => {
                  const card = CARDS[id]
                  return h('button', {
                    key: id,
                    type: 'button',
                    className: 'dsh-pet-card',
                    onClick: () => {
                      if (pickCard(entry, id)) bump()
                    },
                  },
                    h('span', { className: 'dsh-pet-card-name' }, card.name),
                    h('span', { className: 'dsh-pet-card-desc' }, card.desc),
                  )
                }),
              )
            : null,
        ),
        h('div', { className: 'dsh-pet-cells' }, h('i', { style: { width: pct + '%' } })),
        h('div', { className: 'dsh-pet-attrs' },
          h('div', { className: 'dsh-pet-attrs-head' },
            h('span', null, '属性'),
            h('span', { className: 'dsh-pet-points' }, '可分配 ' + points),
          ),
          h('div', { className: 'dsh-pet-attr-grid' },
            ATTRIBUTES.map((attr) =>
              h('button', {
                key: attr.id,
                type: 'button',
                className: 'dsh-pet-attr',
                title: attr.desc,
                disabled: points <= 0 || attrs[attr.id] >= attr.max,
                onClick: () => {
                  if (spend(entry, attr.id)) bump()
                },
              },
                h('span', null, attr.label),
                h('span', { className: 'dsh-pet-attr-val' }, attrs[attr.id] + '/' + attr.max),
              ),
            ),
          ),
        ),
        unlocked.length > 0
          ? h('div', { className: 'dsh-pet-cores' },
              h('div', { className: 'dsh-pet-cores-head' },
                h('span', null, '核心'),
                h('span', { className: 'dsh-pet-muted' }, entry.cores.length + '/3'),
              ),
              h('div', { className: 'dsh-pet-core-pool' },
                CORES.map((core) => {
                  const def = CORE_CARDS[core.id]
                  const ready = unlocked.includes(core.id)
                  const on = entry.cores.includes(core.id)
                  return h('button', {
                    key: core.id,
                    type: 'button',
                    className: 'dsh-pet-core' + (on ? ' on' : ''),
                    title: ready ? def.desc : '未解锁：' + core.condText,
                    disabled: !ready,
                    onClick: () => {
                      if (toggleCore(entry, core.id)) bump()
                    },
                  }, def.name)
                }),
              ),
            )
          : null,
        h('div', { className: 'dsh-pet-bottom' },
          h('span', null, '格 ' + Math.max(0, cells) + '/' + maxCells),
          h('span', null, '槽 ' + (battle === null ? 0 : battle.slots.length) + '/' + MAX_SLOTS),
          h('span', null, '击杀 ' + (battle === null ? 0 : battle.kills)),
          h('span', null, '敌 ' + (battle === null ? 0 : battle.enemies.length)),
          h('span', null, '压力 +' + (battle === null ? 0 : battle.extra)),
          battle !== null && battle.surge ? h('span', { className: 'dsh-pet-hot' }, '过载') : null,
          battle !== null && battle.player.shield > 0
            ? h('span', null, '盾 ' + Math.ceil(battle.player.shield))
            : null,
          h('span', { className: 'dsh-pet-spacer' }),
          h('span', null, formatTokens(entry.consumed) + ' token'),
        ),
      )
    }

    const TRIGGER_STYLE = {
      width: 26,
      height: 26,
      padding: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      border: '1px solid transparent',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      fontSize: 14,
      lineHeight: 1,
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        const PetTrigger = () =>
          h('button', {
            type: 'button',
            className: 'dsh-pet-trigger',
            title: '打开宠物',
            'aria-label': '打开宠物',
            style: TRIGGER_STYLE,
            onClick: () => {
              ctx.sidebarRight.openTab(KIND)
            },
          }, h('span', { 'aria-hidden': true }, '🐾'))

        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: KIND,
            title: () => '宠物',
            keepMounted: true,
            guide: [{ id: 'pet', title: '宠物', description: '按层推进的自动战斗' }],
          }),
        )

        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID }, PetBody),
          ),
        )

        ctx.effect(() =>
          ctx.slots.inject('conversation.input.right', () =>
            ctx.slots.register(
              { name: 'conversation.input.right', id: 'dsh-pet-trigger', order: 40 },
              PetTrigger,
            ),
          ),
        )
      },
      // 供 node --test 验证接入路径；运行时不使用。
      __debug: {
        createEntry,
        tick,
        startFloor,
        draw,
        BUILDS,
        pickCard,
        awardXp,
        chooseCard,
        spend,
        pushTokens,
        toggleCore,
        unlockedCores,
        advance,
        damageReport,
      },
    }
  },
})
