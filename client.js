window.__ModuleLoader__.load({
  id: 'dsh-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // <core>
    // 由 tools/build-client.mjs 从 src/game/ 生成，不要手改这一段。
    // ---- skills/schema.js ----
    // 技能系统的静态契约：能力、效果类型、边界。
    //
    // 处理器名单由 actions/contracts.js 与 modifiers/index.js 提供，注册表直接读取
    // 这些实现契约，避免"白名单里有名字、运行时却没有实现"的两份真相。

    /** 能力表示技能可承诺的行为，不是标签。 */
    const CAPABILITIES = Object.freeze([
      'hit', // 能造成命中，属性可以挂上去
      'projectile', // 会产生独立弹体
      'targeted', // 会选定一个目标
      'ranged', // 在远处造成效果，可用于分裂等远程语义修饰
      'area', // 有可调整的影响范围
      'aura', // 以宠物为中心周期性生效
      'impact', // 在目标位置产生一次爆发
      'melee', // 需要接近目标才能生效
      'arc', // 扇形 / 弧形覆盖
      'orbit', // 产生环绕自身的持续实体
      'path', // 沿路径前进并继续命中后续目标
      'sustain', // 产生固定在场上、周期性生效的区域
      'sword', // 共享剑器表现与兼容语义
      'trigger', // 等待敌人进入触发范围
      'heavy', // 强力命中，可触发碎裂
      'homing', // 飞行轨迹会有限度地修正向锁定目标
    ]);

    const EFFECT_TYPES = Object.freeze(['applyStatus']);

    const REACTION_EVENTS = Object.freeze(['statusApplied', 'hitResolved', 'entityDied']);

    const REACTION_HANDLERS = Object.freeze(['spreadFire', 'conductive', 'shatter']);

    /** 战斗风格可选的移动策略；风格只提供默认值。 */
    const MOVEMENT_STRATEGIES = Object.freeze(['approach', 'keepDistance', 'auto']);

    /** 一局内的构筑上限；第一版原型按设计稿只开放两个技能。 */
    const BUILD_LIMITS = Object.freeze({
      maxSkills: 2,
      maxReserve: 3,
    });

    /** 运行时的安全护栏。超限必须可诊断，不能静默随机丢弃。 */
    const RUNTIME_LIMITS = Object.freeze({
      maxCommandDepth: 8,
      maxCommandsPerRoot: 96,
      maxCommandsPerStep: 1600,
      maxTicksPerStep: 8,
      maxProjectiles: 64,
      maxOrbitSwords: 3,
      maxArcSwords: 3,
      maxTraps: 4,
      maxSwordPieces: 12,
      maxSwordArrays: 2,
      maxEntities: 96,
      maxStatusInstances: 512,
    });

    // ---- skills/constants.js ----
    // 共享常量：场地尺寸由战斗世界、移动决策和渲染共同使用。
    // 单独成文件避免 movement / runtime / arena 互相导入造成循环。

    const ARENA = Object.freeze({ w: 160, h: 144 });

    // ---- skills/format.js ----
    // 数值格式化：编译、描述、脚本共用，避免每个模块各写一套取整规则。

    function fmtNumber(value) {
      if (!Number.isFinite(value)) return String(value);
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    }

    function percentText(scale) {
      return fmtNumber(Math.round(scale * 100));
    }

    // ---- attributes.js ----
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
    const ATTRIBUTES = Object.freeze({
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

    const ATTRIBUTE_IDS = Object.freeze(Object.keys(ATTRIBUTES));

    /** 每投入 1 点的换算。所有战斗风格共用同一份。 */
    const POINT_EFFECTS = Object.freeze({
      strength: Object.freeze({ armor: 2 }),
      agility: Object.freeze({ attackSpeed: 0.01, critChance: 0.005 }),
      intellect: Object.freeze({ damageBonus: 0.02 }),
      vitality: Object.freeze({ maxLife: 1 }),
    });

    /** 未装备任何物品时也保留的基础值。 */
    const COMBAT_BASE = Object.freeze({
      maxLife: 24,
      armor: 0,
      damageBonus: 0,
      attackSpeed: 0,
      critChance: 0.05,
      critDamage: 0.5,
    });

    const COMBAT_CAPS = Object.freeze({
      armorReduction: 0.6,
      attackSpeed: 1,
      critChance: 1,
    });

    /**
     * 伤害通道：决定这一条伤害能不能暴击。
     * 元素标签由命令自带，条件伤害按标签匹配，与通道无关。
     */
    const DAMAGE_CHANNELS = Object.freeze({
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

    function emptyAttributes() {
      const out = {};
      for (const id of ATTRIBUTE_IDS) out[id] = 0;
      return out;
    }

    /** 把存档 / UI 输入收敛成"四项非负整数"；未知字段丢弃。 */
    function normalizeAttributes(raw) {
      const out = emptyAttributes();
      if (raw === null || typeof raw !== 'object') return out;
      for (const id of ATTRIBUTE_IDS) out[id] = normalizeCount(raw[id]);
      return out;
    }

    function spentPoints(attributes) {
      const attrs = normalizeAttributes(attributes);
      let total = 0;
      for (const id of ATTRIBUTE_IDS) total += attrs[id];
      return total;
    }

    /** 等级对应的总点数：1 级 0 点，每升一级 +1。 */
    function totalPointsFor(level) {
      return Math.max(0, Math.floor(finite(level, 1)) - 1);
    }

    /** 存档迁移用：按等级推算还没花掉的点数，已投入的部分扣掉。 */
    function unspentPointsFor(level, attributes) {
      return Math.max(0, totalPointsFor(level) - spentPoints(attributes));
    }

    function armorReductionOf(armor) {
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
    function createCombatStats(attributes, bonuses = {}) {
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
    const DEFAULT_COMBAT = createCombatStats();

    /** 命中上下文里满足条件的伤害加成之和；同一条规则只算一次。 */
    function conditionalBonus(combat, context = {}) {
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
    function resolveDamage(combat, options = {}) {
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
    function mitigateDamage(amount, combat) {
      const raw = Math.max(0, finite(amount));
      const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
      const reduction = clampCombat(finite(stats.armorReduction), 0, COMBAT_CAPS.armorReduction);
      return raw * (1 - reduction);
    }

    /** 攻击速度只作用于施放冷却，不改变实体内部计时。 */
    function effectiveCooldown(baseCooldown, combat) {
      const base = Math.max(0, finite(baseCooldown));
      const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
      const speed = clampCombat(finite(stats.attackSpeed), 0, COMBAT_CAPS.attackSpeed);
      return base / (1 + speed);
    }

    function percentValue(scale) {
      const pct = Math.round(finite(scale) * 1000) / 10;
      return (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)) + '%';
    }

    function formatCombatValue(key, value) {
      if (key === 'armor' || key === 'maxLife') return String(Math.round(finite(value)));
      if (key === 'damageBonus') return '+' + percentValue(value);
      return percentValue(value);
    }

    /** 一条战斗属性的可读文本，例如「护甲 6 → 8」。 */
    function describeCombat(key, before, after) {
      const label = COMBAT_LABELS[key] ?? key;
      return `${label} ${formatCombatValue(key, before)} → ${formatCombatValue(key, after)}`;
    }

    /**
     * 投入 1 点后的预览：升级界面用它显示「力量 3 → 4，护甲 6 → 8」。
     * 返回 null 表示未知属性。
     */
    function previewAttribute(attributes, id, bonuses = {}) {
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
    function describeCombatStats(combat) {
      const stats = combat === null || combat === undefined ? DEFAULT_COMBAT : combat;
      return [
        '护甲 ' + formatCombatValue('armor', stats.armor),
        '伤害 ' + formatCombatValue('damageBonus', stats.damageBonus),
        '攻速 ' + formatCombatValue('attackSpeed', stats.attackSpeed),
        '暴击 ' + formatCombatValue('critChance', stats.critChance) +
          ' ×' + String(Math.round((1 + finite(stats.critDamage)) * 100) / 100),
      ].join(' · ');
    }

    // ---- skills/content/statuses.js ----
    // 状态定义：层数、时长、重复施加策略与周期处理器都由定义说明，不隐式继承。
    //
    // 第一版原型只有三种共享状态：
    //   burn   灼烧：持续损失生命
    //   chill  寒冷：降低移动速度
    //   charge 充能：可被后续雷电效果消耗
    //
    // 数值是原型参数，集中放在这里，便于用 tools/balance-sim.mjs 校准。

    const STATUS_DEFS = [
      {
        id: 'burn',
        kind: 'status',
        label: '灼烧',
        color: '#ff9f45',
        cap: 5,
        duration: 6,
        stacking: 'add-refresh',
        tickSeconds: 1.5,
        damagePerStack: 1,
        desc: '每 1.5 秒按层数损失生命，最多 5 层',
      },
      {
        id: 'chill',
        kind: 'status',
        label: '寒冷',
        color: '#9fd8ff',
        cap: 5,
        duration: 5,
        stacking: 'add-refresh',
        slowPerStack: 0.08,
        maxSlow: 0.4,
        desc: '每层降低 8% 移动速度，最多 5 层',
      },
      {
        id: 'charge',
        kind: 'status',
        label: '充能',
        color: '#ffe066',
        cap: 3,
        duration: 8,
        stacking: 'add-refresh',
        desc: '可被下一次雷电命中消耗，引发导电',
      },
    ];

    // ---- skills/content/actions.js ----
    // 动作定义：决定技能如何接触目标。
    //
    // handler 必须与 actions/contracts.js 的契约一致，具体行为在 actions/*.js。
    // 动作单独存在（属性、修饰都为空）时就是可用技能。
    // movement.preferredRange 是移动决策层的输入，不是动作自己抢夺移动控制。

    const ACTION_DEFS = [
      {
        id: 'projectile',
        kind: 'action',
        handler: 'projectile',
        label: '飞弹',
        color: '#ffd166',
        capabilities: ['hit', 'projectile', 'targeted', 'ranged'],
        params: {
          cooldown: 0.9,
          damage: 2,
          speed: 180,
          range: 104,
          radius: 3.5,
          life: 1.4,
          maxTargets: 1,
        },
        movement: { preferredRange: 90 },
        desc: '朝射程内最近的敌人发射弹体。',
      },
      {
        id: 'aura',
        kind: 'action',
        handler: 'aura',
        label: '光环',
        color: '#8fd8ff',
        capabilities: ['hit', 'area', 'aura'],
        params: {
          cooldown: 1.1,
          damage: 1,
          radius: 30,
          maxTargets: 3,
        },
        movement: { preferredRange: 24 },
        desc: '周期性影响宠物附近的敌人。',
      },
      {
        id: 'impact',
        kind: 'action',
        handler: 'impact',
        label: '冲击',
        color: '#ff8f6b',
        capabilities: ['hit', 'area', 'impact', 'targeted', 'ranged', 'heavy'],
        params: {
          cooldown: 3.0,
          damage: 5,
          range: 84,
          radius: 24,
          maxTargets: 8,
        },
        movement: { preferredRange: 68 },
        desc: '在敌群中心引爆一次强力范围效果。',
      },
      {
        id: 'swing',
        kind: 'action',
        handler: 'swing',
        label: '挥斩',
        color: '#ffb347',
        capabilities: ['hit', 'targeted', 'area', 'melee', 'arc', 'heavy'],
        params: {
          cooldown: 1.1,
          damage: 3,
          radius: 30,
          angle: 110,
          maxTargets: 3,
        },
        movement: { preferredRange: 14 },
        desc: '靠近目标后挥出扇形攻击。',
      },
      {
        id: 'arcSword',
        kind: 'action',
        handler: 'arcSword',
        label: '弧光飞剑',
        color: '#b6f0d2',
        capabilities: ['hit', 'projectile', 'targeted', 'sword', 'homing'],
        params: {
          cooldown: 1.2,
          damage: 2,
          range: 104,
          flightTime: 0.55,
          life: 0.9,
          hitRadius: 6,
          maxHits: 1,
          maxActive: 3,
          maxCorrection: 18,
        },
        movement: { preferredRange: 78 },
        desc: '从侧后方划出弧线，追击射程内最近的敌人。',
      },
      {
        id: 'orbitSword',
        kind: 'action',
        handler: 'orbitSword',
        label: '御剑',
        color: '#a0e7c8',
        capabilities: ['hit', 'orbit', 'melee'],
        params: {
          cooldown: 3.2,
          damage: 2,
          orbitRadius: 12,
          hitRadius: 8,
          angularSpeed: 2.2,
          duration: 7,
          hitInterval: 0.55,
          maxActive: 2,
          maxTargets: 2,
        },
        movement: { preferredRange: 12 },
        desc: '召唤飞剑环绕自身，接触敌人时造成伤害。',
      },
      {
        id: 'swordPierce',
        kind: 'action',
        handler: 'swordPierce',
        label: '飞剑穿敌',
        color: '#9fd8ff',
        capabilities: ['hit', 'projectile', 'targeted', 'path', 'sword'],
        params: {
          cooldown: 2.4,
          damage: 3,
          speed: 240,
          range: 120,
          radius: 9,
          life: 1.2,
          maxHits: 3,
        },
        movement: { preferredRange: 70 },
        desc: '朝目标方向放出穿透飞剑，沿途命中有限敌人。',
      },
      {
        id: 'swordArray',
        kind: 'action',
        handler: 'swordArray',
        label: '剑阵',
        color: '#c9b3ff',
        capabilities: ['hit', 'area', 'sustain', 'sword'],
        params: {
          cooldown: 8,
          damage: 2,
          radius: 36,
          range: 80,
          duration: 5,
          tickInterval: 0.8,
          maxTargets: 4,
          maxActive: 1,
        },
        movement: { preferredRange: 60 },
        desc: '在目标位置布下剑阵，持续伤害范围内敌人。',
      },
      {
        id: 'trap',
        kind: 'action',
        handler: 'trap',
        label: '陷阱',
        color: '#c9b3ff',
        capabilities: ['hit', 'area', 'trigger'],
        params: {
          cooldown: 4.5,
          damage: 4,
          radius: 20,
          range: 64,
          triggerRadius: 20,
          duration: 9,
          armTime: 0.3,
          maxActive: 3,
          maxTargets: 4,
        },
        movement: { preferredRange: 55 },
        desc: '在脚下布置陷阱，敌人靠近时引爆。',
      },
    ];

    // ---- skills/content/elements.js ----
    // 属性定义：命中时附带什么效果。
    //
    // 属性只声明 requires 与 onHit。相同属性装到不同动作上沿用同一套规则，
    // 不存在"毒飞弹 / 毒光环"这类组合代码。

    const ELEMENT_DEFS = [
      {
        id: 'fire',
        kind: 'element',
        label: '火焰',
        color: '#ff9f45',
        requires: ['hit'],
        bonusDamage: 0,
        onHit: [{ type: 'applyStatus', status: 'burn', stacks: 1 }],
        desc: '命中造成伤害并施加灼烧。',
      },
      {
        id: 'frost',
        kind: 'element',
        label: '冰霜',
        color: '#9fd8ff',
        requires: ['hit'],
        bonusDamage: 0,
        onHit: [{ type: 'applyStatus', status: 'chill', stacks: 1 }],
        desc: '命中造成伤害并施加寒冷。',
      },
      {
        id: 'thunder',
        kind: 'element',
        label: '雷电',
        color: '#ffe066',
        requires: ['hit'],
        bonusDamage: 1,
        onHit: [{ type: 'applyStatus', status: 'charge', stacks: 1 }],
        desc: '命中造成更高伤害并施加充能。',
      },
    ];

    // ---- skills/content/modifiers.js ----
    // 修饰定义：改变技能行为，声明能力要求，不直接修改其他技能实例。
    //
    // split  需要 targeted：首次命中后向附近目标产生较弱效果
    // echo   需要 hit：一次效果结束后延迟触发一次较弱效果
    // expand 需要 area：扩大影响范围，同时降低触发频率
    // pull   需要 area：把命中目标向效果中心拉近

    const MODIFIER_DEFS = [
      {
        id: 'split',
        kind: 'modifier',
        label: '分裂',
        color: '#c9b3ff',
        requires: ['ranged'],
        transform: { type: 'split', count: 2, damageScale: 0.5, radius: 40 },
        desc: '首次命中后向附近目标产生较弱的后续效果。',
      },
      {
        id: 'echo',
        kind: 'modifier',
        label: '回响',
        color: '#a0e7c8',
        requires: ['hit'],
        transform: { type: 'echo', delay: 0.7, damageScale: 0.5 },
        desc: '技能效果结束后延迟触发一次较弱效果。',
      },
      {
        id: 'expand',
        kind: 'modifier',
        label: '扩大',
        color: '#ffd166',
        requires: ['area'],
        transform: { type: 'expand', radiusScale: 1.45, cooldownScale: 1.25 },
        desc: '影响范围更大，但触发更慢。',
      },
      {
        id: 'pull',
        kind: 'modifier',
        label: '牵引',
        color: '#8fd8ff',
        requires: ['area'],
        transform: { type: 'pull', strength: 16 },
        desc: '命中时把敌人向效果中心拉近。',
      },
      {
        id: 'detonate',
        kind: 'modifier',
        label: '引爆',
        color: '#ff6b6b',
        requires: ['hit'],
        transform: {
          type: 'detonate',
          damagePerStack: 2,
          radius: 24,
          maxTargets: 3,
          cooldownScale: 1.2,
        },
        desc: '消耗目标已有状态，在目标处造成范围伤害。',
      },
    ];

    // ---- skills/content/reactions.js ----
    // 共享反应定义：订阅语义事件，声明条件、消耗和产生的命令。
    //
    // 三个初版反应都有显式终止条件：
    //   传火：传过去的灼烧不能再触发传火
    //   导电：雷击不施加充能，也不能再触发导电
    //   碎裂：碎裂伤害没有 heavy 标签，不能再触发碎裂
    // 数值与范围都在这里，不能靠递归副作用隐式决定。

    const REACTION_DEFS = [
      {
        id: 'spreadFire',
        kind: 'reaction',
        handler: 'spreadFire',
        label: '传火',
        event: 'entityDied',
        priority: 10,
        color: '#ff9f45',
        config: { radius: 40, targets: 2, transferRatio: 0.5, minStacks: 1, maxStacks: 5, maxChain: 4 },
        desc: '灼烧中的敌人被击败时，把一部分灼烧传给附近敌人。',
      },
      {
        id: 'conductive',
        kind: 'reaction',
        handler: 'conductive',
        label: '导电',
        event: 'hitResolved',
        priority: 20,
        color: '#ffe066',
        config: { consume: 3, radius: 44, targets: 3, damage: 3 },
        desc: '带充能的敌人再次受到雷电命中时，消耗充能并对附近敌人造成雷击。',
      },
      {
        id: 'shatter',
        kind: 'reaction',
        handler: 'shatter',
        label: '碎裂',
        event: 'hitResolved',
        priority: 30,
        color: '#9fd8ff',
        config: { status: 'chill', threshold: 3, radius: 28, targets: 4, damage: 3 },
        desc: '寒冷达到 3 层的敌人受到强力命中时，消耗寒冷并对周围造成范围伤害。',
      },
    ];

    // ---- skills/content/styles.js ----
    // 战斗风格目录：只提供起始构筑、默认移动偏好与视觉主题，不拥有独立结算。
    //
    // 解锁条件使用账户累计战绩（bestFloor）。新玩家先能选近战与远程；剑修、陷阱师
    // 随最高层数开放。战斗核心不按风格 ID 判断伤害规则。

    const STYLE_DEFS = [
      {
        id: 'ranged',
        kind: 'style',
        label: '远程射手',
        visualTheme: 'ranged',
        movementPreference: 'keepDistance',
        defaultStyle: true,
        unlockedBy: { bestFloor: 1 },
        startingBuild: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
        desc: '用弹体与射程处理目标，默认保持距离。',
      },
      {
        id: 'melee',
        kind: 'style',
        label: '近战斗士',
        visualTheme: 'melee',
        movementPreference: 'approach',
        unlockedBy: { bestFloor: 1 },
        startingBuild: [{ id: 'skill-1', action: 'swing', element: null, modifier: null }],
        desc: '靠近敌人用扇形挥斩覆盖近身目标。',
      },
      {
        id: 'sword',
        kind: 'style',
        label: '剑修',
        visualTheme: 'sword',
        movementPreference: 'keepDistance',
        unlockedBy: { bestFloor: 3 },
        startingBuild: [{ id: 'skill-1', action: 'arcSword', element: null, modifier: null }],
        desc: '驭使飞剑从中距离划出弧线追击，敌人贴近时后撤；也可改装穿敌、剑阵或环身御剑。',
      },
      {
        id: 'trapper',
        kind: 'style',
        label: '陷阱师',
        visualTheme: 'trap',
        movementPreference: 'keepDistance',
        unlockedBy: { bestFloor: 5 },
        startingBuild: [{ id: 'skill-1', action: 'trap', element: null, modifier: null }],
        desc: '把陷阱留在敌人必经之路，再引其踏入。',
      },
    ];

    // ---- skills/actions/contracts.js ----
    // 动作契约：验证参数、生成描述、声明移动提示。
    //
    // 这里只依赖格式化工具，不导入运行时或世界。注册表用它校验内容，编译器和
    // 升级界面用它生成最终描述；具体行为在 actions/*.js 中实现。

    const isPositiveNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const isNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

    function requireNumbers(def, keys, errors) {
      for (const key of keys) {
        if (!isPositiveNumber(def.params?.[key])) errors.push(`${def.id}: params.${key} 必须大于 0`);
      }
    }

    function requireInteger(def, keys, errors) {
      for (const key of keys) {
        const value = def.params?.[key];
        if (!(Number.isInteger(value) && value > 0)) errors.push(`${def.id}: params.${key} 必须是正整数`);
      }
    }

    function baseErrors(def) {
      const errors = [];
      if (def.params === undefined || def.params === null || typeof def.params !== 'object') {
        errors.push(`${def.id}: 缺少 params 对象`);
        return errors;
      }
      if (!isPositiveNumber(def.params.cooldown)) errors.push(`${def.id}: params.cooldown 必须大于 0`);
      if (!isNonNegativeNumber(def.params.damage)) errors.push(`${def.id}: params.damage 不能为负`);
      if (def.movement === undefined || !isPositiveNumber(def.movement.preferredRange)) {
        errors.push(`${def.id}: movement.preferredRange 必须大于 0`);
      }
      return errors;
    }

    const ACTION_CONTRACTS = Object.freeze({
      projectile: Object.freeze({
        id: 'projectile',
        capabilities: ['hit', 'projectile', 'targeted', 'ranged'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['speed', 'range', 'radius', 'life'], errors);
          requireInteger(def, ['maxTargets'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒向 ${fmtNumber(plan.range)} 范围内的敌人发射弹体`;
        },
      }),

      aura: Object.freeze({
        id: 'aura',
        capabilities: ['hit', 'area', 'aura'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['radius'], errors);
          requireInteger(def, ['maxTargets'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒影响身边 ${fmtNumber(plan.radius)} 范围内的至多 ${plan.maxTargets} 个敌人`;
        },
      }),

      impact: Object.freeze({
        id: 'impact',
        capabilities: ['hit', 'area', 'impact', 'targeted', 'ranged', 'heavy'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['range', 'radius'], errors);
          requireInteger(def, ['maxTargets'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒在 ${fmtNumber(plan.range)} 范围内的敌人处引爆 ${fmtNumber(plan.radius)} 范围冲击`;
        },
      }),

      swing: Object.freeze({
        id: 'swing',
        capabilities: ['hit', 'targeted', 'area', 'melee', 'arc', 'heavy'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['radius'], errors);
          requireInteger(def, ['maxTargets'], errors);
          const angle = def.params?.angle;
          if (!(typeof angle === 'number' && Number.isFinite(angle) && angle > 0 && angle <= 360)) {
            errors.push(`${def.id}: params.angle 必须在 (0,360]`);
          }
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒朝目标方向挥出 ${fmtNumber(plan.angle)}° 扇形，命中 ${fmtNumber(plan.radius)} 范围内至多 ${plan.maxTargets} 个敌人`;
        },
      }),

      arcSword: Object.freeze({
        id: 'arcSword',
        capabilities: ['hit', 'projectile', 'targeted', 'sword', 'homing'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['range', 'flightTime', 'life', 'hitRadius', 'maxCorrection'], errors);
          requireInteger(def, ['maxHits', 'maxActive'], errors);
          if (
            isPositiveNumber(def.params?.flightTime) &&
            isPositiveNumber(def.params?.life) &&
            def.params.life < def.params.flightTime
          ) {
            errors.push(`${def.id}: params.life 不能小于 params.flightTime`);
          }
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒向 ${fmtNumber(plan.range)} 范围内最近的敌人放出弧光飞剑，仅命中首个目标；弧线追踪有限，可被其他敌人拦截`;
        },
      }),

      orbitSword: Object.freeze({
        id: 'orbitSword',
        capabilities: ['hit', 'orbit', 'melee'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['orbitRadius', 'hitRadius', 'angularSpeed', 'duration', 'hitInterval'], errors);
          requireInteger(def, ['maxActive'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒召唤 1 柄飞剑环绕自身 ${fmtNumber(plan.orbitRadius)} 半径，持续 ${fmtNumber(plan.duration)} 秒；同一目标每 ${fmtNumber(plan.hitInterval)} 秒至多受一次命中`;
        },
      }),

      swordPierce: Object.freeze({
        id: 'swordPierce',
        capabilities: ['hit', 'projectile', 'targeted', 'path', 'sword'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['speed', 'range', 'radius', 'life'], errors);
          requireInteger(def, ['maxHits'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒向 ${fmtNumber(plan.range)} 范围内的敌人放出穿透飞剑，沿途至多命中 ${plan.maxHits} 个敌人`;
        },
      }),

      swordArray: Object.freeze({
        id: 'swordArray',
        capabilities: ['hit', 'area', 'sustain', 'sword'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['radius', 'range', 'duration', 'tickInterval'], errors);
          requireInteger(def, ['maxTargets', 'maxActive'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒在 ${fmtNumber(plan.range)} 范围内敌人处布下持续 ${fmtNumber(plan.duration)} 秒的剑阵，每 ${fmtNumber(plan.tickInterval)} 秒影响 ${fmtNumber(plan.radius)} 范围内至多 ${plan.maxTargets} 个敌人`;
        },
      }),

      trap: Object.freeze({
        id: 'trap',
        capabilities: ['hit', 'area', 'trigger'],
        validate(def) {
          const errors = baseErrors(def);
          requireNumbers(def, ['radius', 'range', 'triggerRadius', 'duration', 'armTime'], errors);
          requireInteger(def, ['maxActive'], errors);
          return errors;
        },
        describe(plan) {
          return `每 ${fmtNumber(plan.cooldown)} 秒在脚下布置持续 ${fmtNumber(plan.duration)} 秒的陷阱；敌人进入 ${fmtNumber(plan.triggerRadius)} 范围后引爆 ${fmtNumber(plan.radius)} 范围`;
        },
      }),
    });

    const ACTION_HANDLER_IDS = Object.freeze(Object.keys(ACTION_CONTRACTS));

    function actionContract(id) {
      return ACTION_CONTRACTS[id];
    }

    // ---- skills/modifiers/index.js ----
    // 修饰阶段处理器：编译参数、命中后命令、描述。
    //
    // 结算器只把统一的上下文交给当前修饰，不按修饰类型写分支。未来开放多修饰时
    // 按 MODIFIER_PHASES 的优先级排序；本次每个技能仍只有一个修饰槽。

    const MODIFIER_PHASES = Object.freeze({
      compile: 10,
      cast: 20,
      onHit: 30,
      onEnd: 40,
    });

    const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

    function splitTargets(ctx, transform) {
      const target = ctx.target;
      const center = {
        x: ctx.payload.centerX ?? target.x,
        y: ctx.payload.centerY ?? target.y,
      };
      return {
        center,
        targets: ctx.queryTargets(center, transform.radius, transform.count, target.id),
      };
    }

    const MODIFIER_HANDLERS = Object.freeze({
      split: Object.freeze({
        phase: MODIFIER_PHASES.onHit,
        validate(transform, id, errors) {
          if (!(Number.isInteger(transform.count) && transform.count > 0)) {
            errors.push(`${id}: split.count 必须是正整数`);
          }
          if (!positive(transform.damageScale) || transform.damageScale > 1) {
            errors.push(`${id}: split.damageScale 必须在 (0,1]`);
          }
          if (!positive(transform.radius)) errors.push(`${id}: split.radius 必须大于 0`);
        },
        describe(plan, transform) {
          return `首次命中后向附近 ${transform.count} 个目标造成 ${percentText(transform.damageScale)}% 伤害`;
        },
        onHit(ctx) {
          const transform = ctx.transform;
          if (!ctx.command.tags.includes('primary') || ctx.payload.noSplit === true) return;
          const key = ctx.payload.castId ?? ctx.command.eventId;
          if (!ctx.once('splitCasts', key)) return;
          const { center, targets } = splitTargets(ctx, transform);
          for (const other of targets) {
            ctx.enqueue({
              type: 'hit',
              targetId: other.id,
              sourceEntityId: ctx.command.sourceEntityId,
              skillInstanceId: ctx.command.skillInstanceId,
              tags: [
                ...ctx.command.tags.filter((tag) => tag !== 'primary'),
                'split',
                'secondary',
              ],
              payload: {
                ...ctx.payload,
                damageScale: (ctx.payload.damageScale ?? 1) * transform.damageScale,
                noSplit: true,
                noEcho: true,
                // 分裂是派生命中：从基础伤害出发单独结算属性，可以暴击。
                channel: 'derived',
                centerX: center.x,
                centerY: center.y,
              },
            });
          }
        },
      }),

      echo: Object.freeze({
        phase: MODIFIER_PHASES.onHit,
        validate(transform, id, errors) {
          if (!positive(transform.delay)) errors.push(`${id}: echo.delay 必须大于 0`);
          if (!positive(transform.damageScale) || transform.damageScale > 1) {
            errors.push(`${id}: echo.damageScale 必须在 (0,1]`);
          }
        },
        describe(plan, transform) {
          return `${fmtNumber(transform.delay)} 秒后再次造成 ${percentText(transform.damageScale)}% 伤害`;
        },
        onHit(ctx) {
          const transform = ctx.transform;
          if (!ctx.command.tags.includes('primary') || ctx.payload.noEcho === true) return;
          const key = ctx.payload.castId ?? ctx.command.eventId;
          if (!ctx.once('echoCasts', key)) return;
          const tags = [...ctx.command.tags.filter((tag) => tag !== 'primary' && tag !== 'echo'), 'echo'];
          const payload = {
            ...ctx.payload,
            damageScale: (ctx.payload.damageScale ?? 1) * transform.damageScale,
            noEcho: true,
            noSplit: true,
            // 回响同样是派生命中：单独结算属性，可以暴击。
            channel: 'derived',
          };
          // 单目标飞剑沿用弹体的同目标延迟命中语义；不复制飞剑实体。
          if (ctx.payload.action === 'projectile' || ctx.payload.action === 'arcSword') {
            ctx.scheduleLater(transform.delay, {
              type: 'hit',
              targetId: ctx.target.id,
              sourceEntityId: ctx.command.sourceEntityId,
              skillInstanceId: ctx.command.skillInstanceId,
              tags,
              payload,
            });
            return;
          }
          ctx.scheduleLater(transform.delay, {
            type: 'areaHit',
            sourceEntityId: ctx.command.sourceEntityId,
            skillInstanceId: ctx.command.skillInstanceId,
            tags,
            payload: {
              ...payload,
              centerX: ctx.payload.centerX ?? ctx.target.x,
              centerY: ctx.payload.centerY ?? ctx.target.y,
            },
          });
        },
      }),

      expand: Object.freeze({
        phase: MODIFIER_PHASES.compile,
        validate(transform, id, errors) {
          if (!positive(transform.radiusScale) || transform.radiusScale < 1) {
            errors.push(`${id}: expand.radiusScale 必须 >= 1`);
          }
          if (!positive(transform.cooldownScale) || transform.cooldownScale < 1) {
            errors.push(`${id}: expand.cooldownScale 必须 >= 1`);
          }
        },
        describe(plan, transform) {
          return `范围变为 ${fmtNumber(plan.radius)}，冷却变为 ${fmtNumber(plan.cooldown)} 秒`;
        },
        compile(numbers, transform) {
          return {
            ...numbers,
            radius: numbers.radius * transform.radiusScale,
            cooldown: numbers.cooldown * transform.cooldownScale,
          };
        },
      }),

      pull: Object.freeze({
        phase: MODIFIER_PHASES.onHit,
        validate(transform, id, errors) {
          if (!positive(transform.strength)) errors.push(`${id}: pull.strength 必须大于 0`);
        },
        describe(plan, transform) {
          return `命中时把敌人向效果中心拉近 ${fmtNumber(transform.strength)}`;
        },
        onHit(ctx) {
          if (ctx.target.cells <= 0) return;
          ctx.enqueue({
            type: 'move',
            targetId: ctx.target.id,
            sourceEntityId: ctx.command.sourceEntityId,
            skillInstanceId: ctx.command.skillInstanceId,
            tags: ['pull'],
            payload: {
              centerX: ctx.payload.centerX ?? ctx.target.x,
              centerY: ctx.payload.centerY ?? ctx.target.y,
              strength: ctx.transform.strength,
            },
          });
        },
      }),

      detonate: Object.freeze({
        phase: MODIFIER_PHASES.onHit,
        validate(transform, id, errors) {
          if (!positive(transform.damagePerStack)) errors.push(`${id}: detonate.damagePerStack 必须大于 0`);
          if (!positive(transform.radius)) errors.push(`${id}: detonate.radius 必须大于 0`);
          if (!(Number.isInteger(transform.maxTargets) && transform.maxTargets > 0)) {
            errors.push(`${id}: detonate.maxTargets 必须是正整数`);
          }
          if (!positive(transform.cooldownScale) || transform.cooldownScale < 1) {
            errors.push(`${id}: detonate.cooldownScale 必须 >= 1`);
          }
        },
        describe(plan, transform) {
          return `消耗目标全部状态，对附近至多 ${transform.maxTargets} 个目标造成每层 ${fmtNumber(transform.damagePerStack)} 伤害；冷却变为 ${fmtNumber(plan.cooldown)} 秒`;
        },
        compile(numbers, transform) {
          return { ...numbers, cooldown: numbers.cooldown * transform.cooldownScale };
        },
        onHit(ctx) {
          if (!ctx.command.tags.includes('primary') || ctx.payload.noDetonate === true) return;
          const stacks = ctx.countStatuses(ctx.target);
          if (stacks <= 0) return;
          const key = ctx.payload.castId ?? ctx.command.eventId;
          if (!ctx.once('detonateCasts', key)) return;
          const consumed = ctx.consumeStatuses(ctx.target);
          if (consumed <= 0) return;
          if (!ctx.world.stats.modifiers) ctx.world.stats.modifiers = {};
          ctx.world.stats.modifiers.detonate = (ctx.world.stats.modifiers.detonate ?? 0) + 1;
          const center = {
            x: ctx.payload.centerX ?? ctx.target.x,
            y: ctx.payload.centerY ?? ctx.target.y,
          };
          const targets = ctx.queryTargets(center, ctx.transform.radius, ctx.transform.maxTargets);
          ctx.emitVisual({
            type: 'detonate',
            x: center.x,
            y: center.y,
            radius: ctx.transform.radius,
            color: '#ff6b6b',
            skillId: ctx.command.skillInstanceId,
          });
          targets.forEach((target, index) => {
            ctx.enqueue({
              type: 'hit',
              targetId: target.id,
              sourceEntityId: ctx.command.sourceEntityId,
              skillInstanceId: ctx.command.skillInstanceId,
              tags: [
                ...ctx.command.tags.filter((tag) => tag !== 'primary' && tag !== 'heavy'),
                'detonate',
                'noDetonate',
              ],
              payload: {
                ...ctx.payload,
                damage: consumed * ctx.transform.damagePerStack,
                damageScale: 1,
                element: null,
                heavy: false,
                modifier: null,
                modifierTransform: null,
                noDetonate: true,
                noSplit: true,
                noEcho: true,
                // 引爆伤害是修饰产生的独立命中，与分裂/回响同属派生通道。
                channel: 'derived',
                centerX: center.x,
                centerY: center.y,
              },
            });
          });
        },
      }),
    });

    const MODIFIER_HANDLER_IDS = Object.freeze(Object.keys(MODIFIER_HANDLERS));

    function modifierHandler(type) {
      return MODIFIER_HANDLERS[type];
    }

    /** 注册表调用：校验 transform 结构与参数。 */
    function validateModifier(def) {
      const errors = [];
      const transform = def.transform;
      if (transform === undefined || transform === null || typeof transform !== 'object') {
        errors.push(`${def.id}: 缺少 transform 对象`);
        return errors;
      }
      const handler = MODIFIER_HANDLERS[transform.type];
      if (handler === undefined) {
        errors.push(`${def.id}: 未知修饰变换 ${JSON.stringify(transform)}`);
        return errors;
      }
      handler.validate(transform, def.id, errors);
      return errors;
    }

    /** 编译期：返回最终数值（目前只有扩大改变范围与冷却）。 */
    function compileModifier(modifier, numbers) {
      if (modifier === null || modifier === undefined) return numbers;
      const handler = MODIFIER_HANDLERS[modifier.transform.type];
      if (handler === undefined || typeof handler.compile !== 'function') return numbers;
      return handler.compile(numbers, modifier.transform);
    }

    /** 描述期：由处理器提供最终数值描述，未知处理器返回空串（注册表已拒绝）。 */
    function describeModifier(modifier, plan) {
      if (modifier === null || modifier === undefined) return '';
      const handler = MODIFIER_HANDLERS[modifier.transform.type];
      if (handler === undefined || typeof handler.describe !== 'function') return '';
      return handler.describe(plan, modifier.transform);
    }

    /** 命中后阶段：结算器只负责准备上下文。 */
    function applyModifierOnHit(modifier, context) {
      if (modifier === null || modifier === undefined) return;
      const handler = MODIFIER_HANDLERS[modifier.transform.type];
      if (handler === undefined || typeof handler.onHit !== 'function') return;
      handler.onHit(context);
    }

    // ---- skills/registry.js ----
    // 内容注册表：按类别保存定义并拒绝重复 ID、未知处理器、缺失引用、非法参数。
    //
    // 定义是数据，不是函数；运行时只通过稳定 ID 查找，不允许 UI 或战斗层按
    // 中文名称匹配。注册表冻结后不再变化，冷却、层数等实例状态只存在于战斗状态。
    //
    // 动作契约来自 actions/contracts.js，修饰契约来自 modifiers/index.js；
    // 注册表不再维护第二份处理器白名单。

    const KINDS = Object.freeze({
      action: ACTION_DEFS,
      element: ELEMENT_DEFS,
      modifier: MODIFIER_DEFS,
      status: STATUS_DEFS,
      reaction: REACTION_DEFS,
      style: STYLE_DEFS,
    });

    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
    const isPositive = (value) => isFiniteNumber(value) && value > 0;
    const isNonNegative = (value) => isFiniteNumber(value) && value >= 0;

    function deepFreeze(value) {
      if (value === null || typeof value !== 'object') return value;
      for (const key of Object.keys(value)) deepFreeze(value[key]);
      return Object.freeze(value);
    }

    const ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

    function checkCommon(def, listName, seen, errors) {
      if (!isObject(def)) {
        errors.push(`${listName}: 定义必须是对象`);
        return false;
      }
      if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) {
        errors.push(`${listName}: 非法 ID ${JSON.stringify(def.id)}`);
        return false;
      }
      if (seen.has(def.id)) {
        errors.push(`${listName}: 重复 ID ${def.id}`);
        return false;
      }
      if (typeof def.label !== 'string' || def.label.length === 0) {
        errors.push(`${listName}.${def.id}: 缺少 label`);
        return false;
      }
      if (typeof def.kind !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, def.kind)) {
        errors.push(`${listName}.${def.id}: 非法 kind ${JSON.stringify(def.kind)}`);
        return false;
      }
      return true;
    }

    function checkCapabilities(def, errors, { required = false } = {}) {
      if (def.capabilities === undefined && !required) return;
      if (!Array.isArray(def.capabilities) || def.capabilities.length === 0) {
        errors.push(`${def.id}: capabilities 必须是非空数组`);
        return;
      }
      const seen = new Set();
      for (const cap of def.capabilities) {
        if (!CAPABILITIES.includes(cap)) errors.push(`${def.id}: 未知能力 ${String(cap)}`);
        if (seen.has(cap)) errors.push(`${def.id}: 能力重复 ${String(cap)}`);
        seen.add(cap);
      }
    }

    function checkRequires(def, errors) {
      if (!Array.isArray(def.requires) || def.requires.length === 0) {
        errors.push(`${def.id}: requires 必须是非空数组`);
        return;
      }
      const seen = new Set();
      for (const cap of def.requires) {
        if (!CAPABILITIES.includes(cap)) errors.push(`${def.id}: 未知能力 ${String(cap)}`);
        if (seen.has(cap)) errors.push(`${def.id}: requires 重复 ${String(cap)}`);
        seen.add(cap);
      }
    }

    function checkAction(def, errors) {
      const contract = ACTION_CONTRACTS[def.handler];
      if (contract === undefined) {
        errors.push(`${def.id}: 未知动作处理器 ${String(def.handler)}`);
        return;
      }
      checkCapabilities(def, errors, { required: true });
      if (!def.capabilities.includes('hit')) errors.push(`${def.id}: 动作必须声明 hit 能力`);
      for (const cap of contract.capabilities ?? []) {
        if (!def.capabilities.includes(cap)) {
          errors.push(`${def.id}: 动作处理器 ${def.handler} 需要声明 ${cap} 能力`);
        }
      }
      for (const message of contract.validate(def)) errors.push(message);
    }

    function checkElement(def, errors, statuses) {
      checkRequires(def, errors);
      if (def.bonusDamage !== undefined && !isNonNegative(def.bonusDamage)) {
        errors.push(`${def.id}: bonusDamage 不能为负`);
      }
      if (!Array.isArray(def.onHit) || def.onHit.length === 0) {
        errors.push(`${def.id}: onHit 必须是非空数组`);
        return;
      }
      for (const effect of def.onHit) {
        if (!isObject(effect) || !EFFECT_TYPES.includes(effect.type)) {
          errors.push(`${def.id}: 未知命中效果 ${JSON.stringify(effect)}`);
          continue;
        }
        if (effect.type === 'applyStatus') {
          if (!statuses.has(effect.status)) errors.push(`${def.id}: 未知状态 ${String(effect.status)}`);
          if (!(Number.isInteger(effect.stacks) && effect.stacks > 0)) {
            errors.push(`${def.id}: applyStatus.stacks 必须是正整数`);
          }
        }
      }
    }

    function checkModifier(def, errors) {
      checkRequires(def, errors);
      for (const message of validateModifier(def)) errors.push(message);
    }

    function checkStatus(def, errors) {
      if (!(Number.isInteger(def.cap) && def.cap > 0)) errors.push(`${def.id}: cap 必须是正整数`);
      if (!isPositive(def.duration)) errors.push(`${def.id}: duration 必须大于 0`);
      if (!['add-refresh'].includes(def.stacking)) errors.push(`${def.id}: 未知重复施加策略 ${String(def.stacking)}`);
      if (def.tickSeconds !== undefined) {
        if (!isPositive(def.tickSeconds)) errors.push(`${def.id}: tickSeconds 必须大于 0`);
        if (!isNonNegative(def.damagePerStack)) errors.push(`${def.id}: damagePerStack 不能为负`);
      }
      if (def.slowPerStack !== undefined && !isNonNegative(def.slowPerStack)) {
        errors.push(`${def.id}: slowPerStack 不能为负`);
      }
      if (def.maxSlow !== undefined && !(isNonNegative(def.maxSlow) && def.maxSlow < 1)) {
        errors.push(`${def.id}: maxSlow 必须在 [0,1)`);
      }
    }

    function checkReaction(def, errors, statuses) {
      if (!REACTION_HANDLERS.includes(def.handler)) errors.push(`${def.id}: 未知反应处理器 ${String(def.handler)}`);
      if (!REACTION_EVENTS.includes(def.event)) errors.push(`${def.id}: 未知语义事件 ${String(def.event)}`);
      if (!isFiniteNumber(def.priority)) errors.push(`${def.id}: priority 必须是数字`);
      if (!isObject(def.config)) {
        errors.push(`${def.id}: 缺少 config 对象`);
        return;
      }
      for (const [key, value] of Object.entries(def.config)) {
        if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${def.id}: config.${key} 不是有限数字`);
      }
      if (typeof def.config.status === 'string' && !statuses.has(def.config.status)) {
        errors.push(`${def.id}: config.status 引用了未知状态 ${String(def.config.status)}`);
      }
    }

    function checkStyle(def, errors, byKind) {
      if (!MOVEMENT_STRATEGIES.includes(def.movementPreference)) {
        errors.push(`${def.id}: 未知移动偏好 ${String(def.movementPreference)}`);
      }
      if (typeof def.visualTheme !== 'string' || def.visualTheme.length === 0) {
        errors.push(`${def.id}: 缺少 visualTheme`);
      }
      if (
        !isObject(def.unlockedBy) ||
        !(Number.isInteger(def.unlockedBy.bestFloor) && def.unlockedBy.bestFloor >= 1)
      ) {
        errors.push(`${def.id}: unlockedBy.bestFloor 必须是正整数`);
      }
      if (!Array.isArray(def.startingBuild) || def.startingBuild.length === 0) {
        errors.push(`${def.id}: startingBuild 必须是非空数组`);
        return;
      }
      if (def.startingBuild.length > BUILD_LIMITS.maxSkills) {
        errors.push(`${def.id}: startingBuild 超过技能上限`);
      }
      for (const skill of def.startingBuild) {
        if (!isObject(skill)) {
          errors.push(`${def.id}: startingBuild 的槽位必须是对象`);
          continue;
        }
        const action = byKind.action?.get(skill.action);
        if (action === undefined) {
          errors.push(`${def.id}: 起始动作不存在 ${String(skill.action)}`);
          continue;
        }
        for (const slot of ['element', 'modifier']) {
          const id = skill[slot];
          if (id === null || id === undefined) continue;
          const component = byKind[slot]?.get(id);
          if (component === undefined) {
            errors.push(`${def.id}: 起始${slot === 'element' ? '属性' : '修饰'}不存在 ${String(id)}`);
            continue;
          }
          const missing = component.requires.filter((cap) => !action.capabilities.includes(cap));
          if (missing.length > 0) {
            errors.push(`${def.id}: 起始${slot === 'element' ? '属性' : '修饰'} ${id} 与动作 ${action.id} 不兼容`);
          }
        }
      }
    }

    /**
     * 校验一组内容定义。返回结构化错误；空数组表示通过。
     * 注册表加载时也调用它，因此内容错误会在启动阶段暴露，而不是战斗中途。
     */
    function validateContent(lists = KINDS) {
      const errors = [];
      const seen = new Set();
      const byKind = {};

      for (const [kind, list] of Object.entries(lists)) {
        if (!Array.isArray(list)) {
          errors.push(`${kind}: 定义表必须是数组`);
          byKind[kind] = new Map();
          continue;
        }
        byKind[kind] = new Map();
        for (const def of list) {
          if (!checkCommon(def, kind, seen, errors)) continue;
          if (def.kind !== kind) {
            errors.push(`${kind}.${def.id}: kind 应为 ${kind}，实际是 ${def.kind}`);
            continue;
          }
          seen.add(def.id);
          byKind[kind].set(def.id, def);
        }
      }

      const checks = {
        action: (def) => checkAction(def, errors),
        element: (def) => checkElement(def, errors, byKind.status ?? new Map()),
        modifier: (def) => checkModifier(def, errors),
        status: (def) => checkStatus(def, errors),
        reaction: (def) => checkReaction(def, errors, byKind.status ?? new Map()),
        style: (def) => checkStyle(def, errors, byKind),
      };
      for (const [kind, table] of Object.entries(byKind)) {
        const check = checks[kind];
        if (check === undefined) continue;
        for (const def of table.values()) check(def);
      }

      return errors;
    }

    /** 由内容表构建不可变注册表。内容错误直接抛错，避免半残内容进入战斗。 */
    function buildContent(lists = KINDS) {
      const errors = validateContent(lists);
      if (errors.length > 0) {
        throw new Error('技能内容注册失败：\n- ' + errors.join('\n- '));
      }
      const byKind = {};
      const defs = new Map();
      for (const [kind, list] of Object.entries(lists)) {
        const table = new Map();
        for (const def of list) {
          const frozen = deepFreeze(def);
          table.set(frozen.id, frozen);
          defs.set(frozen.id, frozen);
        }
        byKind[kind] = table;
      }
      const order = {};
      for (const [kind, table] of Object.entries(byKind)) order[kind] = [...table.keys()];
      return deepFreeze({ defs, byKind, order });
    }

    const CONTENT = buildContent();

    function contentById(id) {
      if (typeof id !== 'string') return undefined;
      return CONTENT.defs.get(id);
    }

    function contentByKind(kind) {
      return CONTENT.byKind[kind] ?? new Map();
    }

    function contentList(kind) {
      return (CONTENT.order[kind] ?? []).map((id) => CONTENT.byKind[kind].get(id));
    }

    function isKind(id, kind) {
      const def = contentById(id);
      return def !== undefined && def.kind === kind;
    }

    // ---- skills/actions/projectile.js ----
    // 飞弹：检查目标与实体上限，创建带计划快照的弹体实体。

    const projectileAction = Object.freeze({
      canCast(context) {
        const plan = context.plan;
        if (context.entityCount('projectile') >= RUNTIME_LIMITS.maxProjectiles) return false;
        return context.queryNearest(context.world.player, plan.range) !== null;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        const target = context.queryNearest(player, plan.range);
        if (target === null) return false;
        const entity = context.spawnEntity({
          kind: 'projectile',
          x: player.x,
          y: player.y,
          targetId: target.id,
          plan,
          skillInstanceId: plan.id,
          castId: context.castId,
          speed: plan.speed,
          hitRadius: plan.action.params.radius ?? 3,
          life: plan.life,
        });
        if (entity === null) return false;
        context.emitVisual({
          type: 'shot',
          x: player.x,
          y: player.y,
          skillId: plan.id,
          element: plan.element === null ? null : plan.element.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        return true;
      },
    });

    // ---- skills/actions/aura.js ----
    // 光环：周期性选择身边有限目标，逐个提交统一命中。

    const auraAction = Object.freeze({
      canCast(context) {
        return context.queryTargets(context.world.player, context.plan.radius, context.plan.maxTargets).length > 0;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        const targets = context.queryTargets(player, plan.radius, plan.maxTargets);
        if (targets.length === 0) return false;
        context.emitVisual({
          type: 'pulse',
          x: player.x,
          y: player.y,
          radius: plan.radius,
          element: plan.element === null ? null : plan.element.id,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        targets.forEach((target, index) => {
          context.hit({
            targetId: target.id,
            center: player,
            extraTags: ['aura'],
            primary: index === 0,
          });
        });
        return true;
      },
    });

    // ---- skills/actions/impact.js ----
    // 冲击：在选定目标位置产生一次范围强力命中，带 heavy 标签。

    const impactAction = Object.freeze({
      canCast(context) {
        return context.queryNearest(context.world.player, context.plan.range) !== null;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        const target = context.queryNearest(player, plan.range);
        if (target === null) return false;
        const center = { x: target.x, y: target.y };
        const targets = context.queryTargets(center, plan.radius, plan.maxTargets);
        if (targets.length === 0) return false;
        context.emitVisual({
          type: 'impact',
          x: center.x,
          y: center.y,
          radius: plan.radius,
          element: plan.element === null ? null : plan.element.id,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        targets.forEach((other, index) => {
          context.hit({
            targetId: other.id,
            center,
            extraTags: ['impact'],
            primary: index === 0,
          });
        });
        return true;
      },
    });

    // ---- skills/actions/swing.js ----
    // 挥斩：靠近目标后朝其方向挥出扇形，命中扇区内有限敌人。

    const angleDelta = (a, b) => {
      let d = a - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d);
    };

    const swingAction = Object.freeze({
      canCast(context) {
        return context.queryNearest(context.world.player, context.plan.radius) !== null;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        const target = context.queryNearest(player, plan.radius);
        if (target === null) return false;
        const facing = Math.atan2(target.y - player.y, target.x - player.x);
        const half = ((plan.angle ?? 90) * Math.PI) / 360;
        const candidates = context.queryTargets(player, plan.radius, Math.max(plan.maxTargets * 4, 8));
        const hits = candidates
          .filter((enemy) => angleDelta(Math.atan2(enemy.y - player.y, enemy.x - player.x), facing) <= half)
          .slice(0, plan.maxTargets);
        if (hits.length === 0) return false;
        context.emitVisual({
          type: 'swing',
          x: player.x,
          y: player.y,
          radius: plan.radius,
          angle: facing,
          half,
          element: plan.element === null ? null : plan.element.id,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        hits.forEach((enemy, index) => {
          context.hit({
            targetId: enemy.id,
            center: player,
            extraTags: ['swing', 'arc'],
            primary: index === 0,
          });
        });
        return true;
      },
    });

    // ---- skills/actions/arcSword.js ----
    // 弧光飞剑：从角色背侧沿弧线飞向锁定目标，末段有限追踪，单目标命中。
    //
    // 施放瞬间锁定方向与目标位置；角色与目标重合时沿用该技能上一次有效朝向，
    // 从未有过朝向时固定向右。左右交替由成功施放次数决定，不额外保存随机状态。

    const START_BACK = 8;
    const START_SIDE = 5;
    const CONTROL1_BACK = 18;
    const CONTROL1_SIDE = 20;
    const CONTROL2_BACK = 18;
    const CONTROL2_SIDE = 12;

    function normalize(x, y) {
      const length = Math.hypot(x, y);
      if (length < 1e-6) return null;
      return { x: x / length, y: y / length };
    }

    const arcSwordAction = Object.freeze({
      canCast(context) {
        return context.queryNearest(context.world.player, context.plan.range) !== null;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        const limit = Math.min(plan.maxActive, RUNTIME_LIMITS.maxArcSwords);
        if (context.entityCount('arcSword') >= limit) {
          context.diagnoseOnce('arc-sword-limit', { limit });
          return false;
        }
        const target = context.queryNearest(player, plan.range);
        if (target === null) return false;

        const direct = normalize(target.x - player.x, target.y - player.y);
        let aimX;
        let aimY;
        if (direct !== null) {
          aimX = direct.x;
          aimY = direct.y;
          context.skill.lastAimX = aimX;
          context.skill.lastAimY = aimY;
        } else if (
          Number.isFinite(context.skill.lastAimX) &&
          Number.isFinite(context.skill.lastAimY)
        ) {
          aimX = context.skill.lastAimX;
          aimY = context.skill.lastAimY;
        } else {
          aimX = 1;
          aimY = 0;
        }

        const sideX = -aimY;
        const sideY = aimX;
        const side = context.skill.castCount % 2 === 0 ? 1 : -1;
        const startX = player.x - aimX * START_BACK + sideX * START_SIDE * side;
        const startY = player.y - aimY * START_BACK + sideY * START_SIDE * side;
        const control1X = player.x - aimX * CONTROL1_BACK + sideX * CONTROL1_SIDE * side;
        const control1Y = player.y - aimY * CONTROL1_BACK + sideY * CONTROL1_SIDE * side;
        const endX = target.x;
        const endY = target.y;
        const control2X = endX - aimX * CONTROL2_BACK + sideX * CONTROL2_SIDE * side;
        const control2Y = endY - aimY * CONTROL2_BACK + sideY * CONTROL2_SIDE * side;
        const initial = normalize(control1X - startX, control1Y - startY) ?? { x: aimX, y: aimY };

        const entity = context.spawnEntity({
          kind: 'arcSword',
          x: startX,
          y: startY,
          plan,
          skillInstanceId: plan.id,
          castId: context.castId,
          targetId: target.id,
          startX,
          startY,
          control1X,
          control1Y,
          baseEndX: endX,
          baseEndY: endY,
          baseControl2X: control2X,
          baseControl2Y: control2Y,
          endX,
          endY,
          control2X,
          control2Y,
          elapsed: 0,
          flightTime: plan.flightTime,
          life: plan.life,
          hitRadius: plan.hitRadius,
          maxHits: plan.maxHits,
          maxCorrection: plan.maxCorrection,
          hitCount: 0,
          dirX: initial.x,
          dirY: initial.y,
          side,
        });
        if (entity === null) return false;
        context.emitVisual({
          type: 'arcSwordCast',
          x: startX,
          y: startY,
          angle: Math.atan2(initial.y, initial.x),
          side,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        return true;
      },
    });

    // ---- skills/actions/orbitSword.js ----
    // 御剑：召唤环绕自身的飞剑实体。环绕、碰撞与命中间隔由 entities/orbitSword.js 推进。

    const orbitSwordAction = Object.freeze({
      canCast(context) {
        return context.entityCount('orbitSword') < context.plan.maxActive;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        if (context.entityCount('orbitSword') >= plan.maxActive) return false;
        const entity = context.spawnEntity({
          kind: 'orbitSword',
          x: player.x,
          y: player.y,
          plan,
          skillInstanceId: plan.id,
          castId: context.castId,
          angle: context.rng() * Math.PI * 2,
          orbitRadius: plan.orbitRadius,
          hitRadius: plan.hitRadius,
          angularSpeed: plan.angularSpeed,
          life: plan.duration,
          hitInterval: plan.hitInterval,
          maxTargets: plan.maxTargets,
          nextHit: new Map(),
        });
        if (entity === null) return false;
        context.emitVisual({
          type: 'swordSummon',
          x: player.x,
          y: player.y,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        return true;
      },
    });

    // ---- skills/actions/swordPierce.js ----
    // 飞剑穿敌：朝目标方向放出直线飞行的穿透飞剑，沿途每个敌人只命中一次。

    const swordPierceAction = Object.freeze({
      canCast(context) {
        if (context.entityCount('piercingSword') >= RUNTIME_LIMITS.maxSwordPieces) return false;
        return context.queryNearest(context.world.player, context.plan.range) !== null;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        const target = context.queryNearest(player, plan.range);
        if (target === null) return false;
        if (context.entityCount('piercingSword') >= RUNTIME_LIMITS.maxSwordPieces) return false;
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const length = Math.hypot(dx, dy) || 1;
        const angle = Math.atan2(dy, dx);
        const entity = context.spawnEntity({
          kind: 'piercingSword',
          x: player.x,
          y: player.y,
          plan,
          skillInstanceId: plan.id,
          castId: context.castId,
          dirX: dx / length,
          dirY: dy / length,
          angle,
          speed: plan.speed,
          hitRadius: plan.radius,
          life: plan.life,
          range: plan.range,
          maxHits: plan.maxHits,
          hitIds: [],
          traveled: 0,
        });
        if (entity === null) return false;
        context.emitVisual({
          type: 'swordShot',
          x: player.x,
          y: player.y,
          angle,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        return true;
      },
    });

    // ---- skills/actions/swordArray.js ----
    // 剑阵：在目标位置创建固定区域，周期性对范围内有限目标提交命中。

    const swordArrayAction = Object.freeze({
      canCast(context) {
        if (context.entityCount('swordArray') >= context.plan.maxActive) return false;
        return context.queryNearest(context.world.player, context.plan.range) !== null;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        if (context.entityCount('swordArray') >= plan.maxActive) return false;
        const target = context.queryNearest(player, plan.range);
        if (target === null) return false;
        if (context.entityCount('swordArray') >= RUNTIME_LIMITS.maxSwordArrays) return false;
        const entity = context.spawnEntity({
          kind: 'swordArray',
          x: target.x,
          y: target.y,
          plan,
          skillInstanceId: plan.id,
          castId: context.castId,
          radius: plan.radius,
          life: plan.duration,
          tickInterval: plan.tickInterval,
          tickTimer: plan.tickInterval,
          maxTargets: plan.maxTargets,
        });
        if (entity === null) return false;
        context.emitVisual({
          type: 'swordArray',
          x: target.x,
          y: target.y,
          radius: plan.radius,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        return true;
      },
    });

    // ---- skills/actions/trap.js ----
    // 陷阱：在脚下放置等待触发的实体。触发与清理由 entities/trap.js 推进。

    const trapAction = Object.freeze({
      canCast(context) {
        return context.entityCount('trap') < context.plan.maxActive;
      },

      cast(context) {
        const plan = context.plan;
        const player = context.world.player;
        if (context.entityCount('trap') >= plan.maxActive) return false;
        const target = context.queryNearest(player, plan.range);
        const center = target === null ? { x: player.x, y: player.y } : { x: target.x, y: target.y };
        const entity = context.spawnEntity({
          kind: 'trap',
          x: center.x,
          y: center.y,
          plan,
          skillInstanceId: plan.id,
          castId: context.castId,
          radius: plan.radius,
          triggerRadius: plan.triggerRadius,
          armTime: plan.armTime,
          life: plan.duration,
          maxTargets: plan.maxTargets,
          armedAt: context.time + plan.armTime,
        });
        if (entity === null) return false;
        context.emitVisual({
          type: 'trapPlaced',
          x: center.x,
          y: center.y,
          skillId: plan.id,
          color: plan.element === null ? plan.action.color : plan.element.color,
        });
        return true;
      },
    });

    // ---- skills/actions/index.js ----
    // 动作实现表：契约与运行时处理器在同一处合并，任何一边缺失都会在加载时失败。
    //
    // registry.js 只读 contracts.js（避免把世界依赖带进内容校验），runtime.js 读
    // 本文件；测试会核对两边的 ID 集合一致。

    const HANDLERS = Object.freeze({
      projectile: projectileAction,
      aura: auraAction,
      impact: impactAction,
      swing: swingAction,
      arcSword: arcSwordAction,
      orbitSword: orbitSwordAction,
      swordPierce: swordPierceAction,
      swordArray: swordArrayAction,
      trap: trapAction,
    });

    for (const id of Object.keys(ACTION_CONTRACTS)) {
      if (HANDLERS[id] === undefined) throw new Error(`缺少动作处理器实现：${id}`);
    }
    for (const id of Object.keys(HANDLERS)) {
      if (ACTION_CONTRACTS[id] === undefined) throw new Error(`缺少动作契约：${id}`);
    }

    const ACTION_IMPLEMENTATIONS = Object.freeze(
      Object.fromEntries(
        Object.keys(HANDLERS).map((id) => [
          id,
          Object.freeze({ contract: ACTION_CONTRACTS[id], handler: HANDLERS[id] }),
        ]),
      ),
    );

    const IMPLEMENTED_ACTION_IDS = Object.freeze(Object.keys(ACTION_IMPLEMENTATIONS));

    function actionImplementation(id) {
      return ACTION_IMPLEMENTATIONS[id];
    }

    // ---- skills/compile.js ----
    // 构筑编译：build → 校验 → 不可变 SkillPlan。
    //
    // 运行时不再反复扫描构筑；冷却、伤害、范围、命中效果和描述都来自同一份
    // 编译结果。动作描述由 actions/contracts.js 提供，修饰描述由 modifiers/index.js
    // 提供；未知处理器直接失败，不再静默回退成另一种动作的文案。
    //
    // 失败返回结构化错误（code / path / message），调用方可以逐条显示。

    const BUILD_VERSION = 3;

    const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

    function freezePlan(plan) {
      Object.freeze(plan.effects);
      Object.freeze(plan.tags);
      Object.freeze(plan.capabilities);
      Object.freeze(plan.descriptionData);
      return Object.freeze(plan);
    }

    function emptyBuild() {
      return {
        version: BUILD_VERSION,
        skills: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
        reserve: [],
      };
    }

    /** 把任意存档/UI 输入收敛成合法形状；不在这里判断内容是否存在。 */
    function normalizeBuild(input) {
      const src = isPlainObject(input) ? input : {};
      const rawSkills = Array.isArray(src.skills) ? src.skills : [];
      const skills = [];
      for (let index = 0; index < rawSkills.length; index += 1) {
        const raw = isPlainObject(rawSkills[index]) ? rawSkills[index] : {};
        const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `skill-${index + 1}`;
        skills.push({
          id,
          action: typeof raw.action === 'string' && raw.action.length > 0 ? raw.action : null,
          element: typeof raw.element === 'string' && raw.element.length > 0 ? raw.element : null,
          modifier: typeof raw.modifier === 'string' && raw.modifier.length > 0 ? raw.modifier : null,
        });
      }
      const rawReserve = Array.isArray(src.reserve) ? src.reserve : [];
      const reserve = [];
      for (const id of rawReserve) {
        if (typeof id !== 'string' || id.length === 0) continue;
        if (reserve.includes(id)) continue;
        if (reserve.length >= BUILD_LIMITS.maxReserve) break;
        reserve.push(id);
      }
      return { version: BUILD_VERSION, skills, reserve };
    }

    function elementPhrase(element, damage) {
      if (element === null) return `；命中造成 ${fmtNumber(damage)} 伤害`;
      const effects = element.onHit
        .filter((effect) => effect.type === 'applyStatus')
        .map((effect) => {
          const status = contentById(effect.status);
          return `${effect.stacks} 层${status === undefined ? effect.status : status.label}`;
        });
      const suffix = effects.length > 0 ? `并施加 ${effects.join('、')}` : '';
      return `；命中造成 ${fmtNumber(damage)} 伤害${suffix}`;
    }

    function compileSkill(skill, index, errors) {
      const path = `skills[${index}]`;
      const action = contentById(skill.action);
      if (action === undefined) {
        errors.push({
          code: 'unknown-action',
          path: `${path}.action`,
          id: skill.action,
          message: `技能 ${index + 1} 的动作不存在：${String(skill.action)}`,
        });
        return null;
      }
      if (action.kind !== 'action') {
        errors.push({
          code: 'wrong-category',
          path: `${path}.action`,
          id: skill.action,
          message: `${action.id} 不是动作`,
        });
        return null;
      }
      const contract = ACTION_CONTRACTS[action.handler];
      if (contract === undefined) {
        errors.push({
          code: 'unknown-handler',
          path: `${path}.action`,
          id: action.id,
          message: `${action.id} 没有动作处理器契约`,
        });
        return null;
      }

      const caps = new Set(action.capabilities);
      let element = null;
      if (skill.element !== null) {
        const def = contentById(skill.element);
        if (def === undefined) {
          errors.push({
            code: 'unknown-element',
            path: `${path}.element`,
            id: skill.element,
            message: `技能 ${index + 1} 的属性不存在：${String(skill.element)}`,
          });
        } else if (def.kind !== 'element') {
          errors.push({
            code: 'wrong-category',
            path: `${path}.element`,
            id: skill.element,
            message: `${def.id} 不是属性`,
          });
        } else {
          const missing = def.requires.filter((cap) => !caps.has(cap));
          if (missing.length > 0) {
            errors.push({
              code: 'capability-mismatch',
              path: `${path}.element`,
              id: def.id,
              message: `${def.label}需要 ${missing.join('、')} 能力，${action.label}不具备`,
            });
          } else {
            element = def;
          }
        }
      }

      let modifier = null;
      if (skill.modifier !== null) {
        const def = contentById(skill.modifier);
        if (def === undefined) {
          errors.push({
            code: 'unknown-modifier',
            path: `${path}.modifier`,
            id: skill.modifier,
            message: `技能 ${index + 1} 的修饰不存在：${String(skill.modifier)}`,
          });
        } else if (def.kind !== 'modifier') {
          errors.push({
            code: 'wrong-category',
            path: `${path}.modifier`,
            id: skill.modifier,
            message: `${def.id} 不是修饰`,
          });
        } else {
          const missing = def.requires.filter((cap) => !caps.has(cap));
          if (missing.length > 0) {
            errors.push({
              code: 'capability-mismatch',
              path: `${path}.modifier`,
              id: def.id,
              message: `${def.label}需要 ${missing.join('、')} 能力，${action.label}不具备`,
            });
          } else {
            modifier = def;
          }
        }
      }

      const damage = action.params.damage + (element === null ? 0 : element.bonusDamage ?? 0);
      const baseNumbers = { ...action.params, damage };
      const numbers = compileModifier(modifier, baseNumbers);
      const planLike = {
        ...numbers,
        action,
        element,
        modifier,
        maxTargets: numbers.maxTargets ?? 1,
      };

      const actionText = contract.describe(planLike);
      if (typeof actionText !== 'string' || actionText.length === 0) {
        errors.push({
          code: 'undescribable-action',
          path: `${path}.action`,
          id: action.id,
          message: `${action.id} 的处理器没有提供描述`,
        });
        return null;
      }
      const elementText = elementPhrase(element, damage);
      const modifierText = describeModifier(modifier, planLike);
      if (modifier !== null && (typeof modifierText !== 'string' || modifierText.length === 0)) {
        errors.push({
          code: 'undescribable-modifier',
          path: `${path}.modifier`,
          id: modifier.id,
          message: `${modifier.id} 的处理器没有提供描述`,
        });
        return null;
      }
      const label = `${element === null ? '' : element.label}${action.label}`;
      const description =
        `${label}：${actionText}${elementText}` +
        (modifier === null ? '' : `；${modifier.label}：${modifierText}`) +
        '。';
      const descriptionData = Object.freeze({
        label,
        action: actionText,
        element: Object.freeze({
          damage,
          effects: Object.freeze(
            element === null ? [] : element.onHit.map((effect) => Object.freeze({ ...effect })),
          ),
        }),
        modifier: modifier === null ? null : Object.freeze({ id: modifier.id, text: modifierText }),
        numbers: Object.freeze({
          cooldown: numbers.cooldown,
          damage,
          radius: numbers.radius ?? 0,
          range: numbers.range ?? 0,
          maxTargets: numbers.maxTargets ?? 1,
          angle: numbers.angle ?? 0,
        }),
      });

      const plan = freezePlan({
        id: skill.id,
        index,
        action,
        element,
        modifier,
        capabilities: Object.freeze([...action.capabilities]),
        params: Object.freeze({ ...numbers }),
        cooldown: numbers.cooldown,
        damage,
        speed: numbers.speed ?? 0,
        range: numbers.range ?? 0,
        radius: numbers.radius ?? 0,
        flightTime: numbers.flightTime ?? 0,
        maxCorrection: numbers.maxCorrection ?? 0,
        maxTargets: numbers.maxTargets ?? 1,
        life: numbers.life ?? 0,
        angle: numbers.angle ?? 0,
        orbitRadius: numbers.orbitRadius ?? 0,
        hitRadius: numbers.hitRadius ?? 0,
        angularSpeed: numbers.angularSpeed ?? 0,
        duration: numbers.duration ?? 0,
        hitInterval: numbers.hitInterval ?? 0,
        maxActive: numbers.maxActive ?? 1,
        maxHits: numbers.maxHits ?? 0,
        tickInterval: numbers.tickInterval ?? 0,
        triggerRadius: numbers.triggerRadius ?? 0,
        armTime: numbers.armTime ?? 0,
        movement: Object.freeze({ ...action.movement }),
        heavy: action.capabilities.includes('heavy'),
        transform: modifier === null ? null : modifier.transform,
        effects: Object.freeze(
          element === null ? [] : element.onHit.map((effect) => Object.freeze({ ...effect })),
        ),
        tags: Object.freeze(
          [action.id, element === null ? null : element.id, modifier === null ? null : modifier.id].filter(
            (tag) => tag !== null,
          ),
        ),
        label,
        description,
        descriptionData,
      });
      return plan;
    }

    /**
     * 编译构筑。
     * @returns {{ok:boolean, build:object, plans:Array, errors:Array, warnings:Array}}
     */
    function compileBuild(input) {
      const build = normalizeBuild(input);
      const errors = [];
      const warnings = [];

      if (build.skills.length === 0) {
        errors.push({
          code: 'missing-action',
          path: 'skills',
          message: '至少需要一个带动作的技能',
        });
      }
      if (build.skills.length > BUILD_LIMITS.maxSkills) {
        errors.push({
          code: 'too-many-skills',
          path: 'skills',
          message: `最多只能装备 ${BUILD_LIMITS.maxSkills} 个技能`,
        });
      }

      const ids = new Set();
      const plans = [];
      for (let index = 0; index < build.skills.length; index += 1) {
        const skill = build.skills[index];
        if (ids.has(skill.id)) {
          errors.push({
            code: 'duplicate-skill-id',
            path: `skills[${index}].id`,
            id: skill.id,
            message: `技能实例 ID 重复：${skill.id}`,
          });
        }
        ids.add(skill.id);
        if (index >= BUILD_LIMITS.maxSkills) continue;
        const plan = compileSkill(skill, index, errors);
        if (plan !== null) plans.push(plan);
      }

      for (const id of build.reserve) {
        if (contentById(id) === undefined) {
          warnings.push({
            code: 'unknown-reserve',
            path: 'reserve',
            id,
            message: `备用栏里的组件已不存在：${id}`,
          });
        }
      }

      return {
        ok: errors.length === 0,
        build,
        plans,
        errors,
        warnings,
      };
    }

    /** 只取第一个技能计划，供 UI 空槽提示与测试使用。 */
    function firstPlan(plans) {
      return Array.isArray(plans) && plans.length > 0 ? plans[0] : null;
    }

    /**
     * 存档修复：移除已删除的组件，清空不兼容的槽位，丢弃非法备用栏条目。
     * 返回被移除的 ID，供 UI 显示"存档已修复"提示。
     */
    function pruneBuild(input) {
      const build = normalizeBuild(input);
      const removed = [];
      const skills = [];
      const usedIds = new Set();
      for (const raw of build.skills) {
        if (skills.length >= BUILD_LIMITS.maxSkills) {
          removed.push(raw.action ?? raw.id);
          continue;
        }
        const action = contentById(raw.action);
        if (action === undefined || action.kind !== 'action') {
          if (raw.action !== null) removed.push(raw.action);
          continue;
        }
        let skillId = raw.id;
        if (usedIds.has(skillId)) {
          let number = skills.length + 1;
          while (usedIds.has(`skill-${number}`)) number += 1;
          skillId = `skill-${number}`;
          removed.push(raw.id);
        }
        usedIds.add(skillId);
        const caps = new Set(action.capabilities);
        const skill = { id: skillId, action: raw.action, element: null, modifier: null };
        if (raw.element !== null) {
          const def = contentById(raw.element);
          if (def !== undefined && def.kind === 'element' && def.requires.every((cap) => caps.has(cap))) {
            skill.element = raw.element;
          } else {
            removed.push(raw.element);
          }
        }
        if (raw.modifier !== null) {
          const def = contentById(raw.modifier);
          if (def !== undefined && def.kind === 'modifier' && def.requires.every((cap) => caps.has(cap))) {
            skill.modifier = raw.modifier;
          } else {
            removed.push(raw.modifier);
          }
        }
        skills.push(skill);
      }
      const reserve = [];
      for (const id of build.reserve) {
        if (contentById(id) === undefined) removed.push(id);
        else reserve.push(id);
      }
      const next = skills.length > 0 ? skills : emptyBuild().skills;
      return { build: { version: BUILD_VERSION, skills: next, reserve }, removed };
    }

    /** 内容目录里所有可选 ID，按类别；UI 只读。 */
    function contentCatalog() {
      return CONTENT.order;
    }

    // ---- skills/status.js ----
    // 状态实例：层数、到期时间、周期跳动与来源。
    //
    // 定义（上限/时长/跳动）在 content/statuses.js；这里只处理实例状态。
    // 重复施加策略固定为"加层并刷新整体持续时间"，由定义声明，不隐式继承。

    function createStatuses() {
      return {};
    }

    function statusDef(id) {
      const def = contentById(id);
      if (def === undefined || def.kind !== 'status') {
        throw new Error(`unknown status: ${String(id)}`);
      }
      return def;
    }

    function getStatusInstance(entity, id) {
      if (entity === null || entity === undefined || entity.statuses === undefined) return null;
      return entity.statuses[id] ?? null;
    }

    function stacksOf(entity, id) {
      const instance = getStatusInstance(entity, id);
      return instance === null ? 0 : instance.stacks;
    }

    function ensureStatuses(entity) {
      if (entity.statuses === undefined || entity.statuses === null) entity.statuses = createStatuses();
      return entity.statuses;
    }

    /**
     * 施加状态。返回 {before, after, applied, refreshed}。
     * 来源放在实例上，周期伤害与传火都能继承技能归因。
     */
    function applyStatus(entity, id, stacks, meta = {}) {
      const def = statusDef(id);
      const table = ensureStatuses(entity);
      let instance = table[id];
      const before = instance === undefined ? 0 : instance.stacks;
      if (stacks <= 0) {
        return { def, before, after: before, applied: 0, refreshed: instance !== undefined };
      }
      if (instance === undefined) {
        instance = {
          id,
          stacks: 0,
          remaining: def.duration,
          tickTimer: def.tickSeconds ?? 0,
          source: { ...meta },
        };
        table[id] = instance;
      }
      const after = Math.min(def.cap, before + stacks);
      instance.stacks = after;
      instance.remaining = def.duration;
      instance.source = { ...meta };
      if (before === 0) instance.tickTimer = def.tickSeconds ?? 0;
      return { def, before, after, applied: after - before, refreshed: true };
    }

    /** 消耗层数（反应使用），返回实际消耗量。 */
    function consumeStatus(entity, id, stacks = Infinity) {
      const instance = getStatusInstance(entity, id);
      if (instance === null) return 0;
      const consumed = Math.min(instance.stacks, Math.max(0, stacks));
      instance.stacks -= consumed;
      if (instance.stacks <= 0) delete entity.statuses[id];
      return consumed;
    }

    function removeStatus(entity, id) {
      if (entity.statuses === undefined) return;
      delete entity.statuses[id];
    }

    function statusSnapshot(entity) {
      return {
        burn: stacksOf(entity, 'burn'),
        chill: stacksOf(entity, 'chill'),
        charge: stacksOf(entity, 'charge'),
      };
    }

    /** 寒冷降低移动速度；每层数值来自状态定义。 */
    function slowFactor(entity) {
      const instance = getStatusInstance(entity, 'chill');
      if (instance === null) return 1;
      const def = statusDef('chill');
      return 1 - Math.min(def.maxSlow ?? 0.4, instance.stacks * (def.slowPerStack ?? 0));
    }

    /**
     * 推进所有实体的状态计时，返回这一帧的周期伤害。
     * 周期伤害只产生命令，不在这里直接改生命。
     */
    function tickStatuses(world, dt) {
      const ticks = [];
      const entities = world.enemies;
      if (!Array.isArray(entities)) return ticks;
      for (const entity of entities) {
        if (entity.cells <= 0 || entity.statuses === undefined) continue;
        for (const [id, instance] of Object.entries(entity.statuses)) {
          const def = statusDef(id);
          instance.remaining -= dt;
          if (instance.remaining <= 0) {
            delete entity.statuses[id];
            continue;
          }
          if (def.tickSeconds === undefined) continue;
          instance.tickTimer -= dt;
          let guard = 0;
          while (instance.tickTimer <= 0 && guard < RUNTIME_LIMITS.maxTicksPerStep) {
            instance.tickTimer += def.tickSeconds;
            guard += 1;
            const damage = instance.stacks * (def.damagePerStack ?? 0);
            if (damage <= 0) continue;
            ticks.push({
              targetId: entity.id,
              statusId: id,
              stacks: instance.stacks,
              damage,
              sourceEntityId: instance.source?.sourceEntityId ?? null,
              skillInstanceId: instance.source?.skillInstanceId ?? null,
              element: instance.source?.element ?? null,
              rootEventId: instance.source?.rootEventId ?? null,
            });
          }
        }
      }
      return ticks;
    }

    // ---- skills/reactions.js ----
    // 共享反应：读取语义事件快照，只提交命令，不直接结算。
    //
    // 反应按显式优先级、再按稳定 ID 排序；同一事件对同一反应至多触发一次。
    // 每个处理器必须返回终止理由明确的命令，例如传火后的灼烧带 canSpread=false。

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function aliveEnemies(world) {
      return world.enemies.filter((enemy) => enemy.cells > 0);
    }

    function nearby(world, from, radius, count, excludeId = -1) {
      return aliveEnemies(world)
        .filter((enemy) => enemy.id !== excludeId)
        .map((enemy) => ({ enemy, d: dist(from, enemy) }))
        .filter((entry) => entry.d <= radius)
        .sort((a, b) => a.d - b.d || a.enemy.id - b.enemy.id)
        .slice(0, count)
        .map((entry) => entry.enemy);
    }

    function spreadFire(world, event, def) {
      if (event.burnStacks <= 0) return null;
      if ((event.burnSpreadDepth ?? 0) >= def.config.maxChain) return null;
      const targets = nearby(world, event, def.config.radius, def.config.targets, event.targetId);
      if (targets.length === 0) return null;
      const stacks = Math.max(
        def.config.minStacks,
        Math.min(def.config.maxStacks, Math.floor(event.burnStacks * def.config.transferRatio)),
      );
      const commands = targets.map((target) => ({
        type: 'applyStatus',
        targetId: target.id,
        sourceEntityId: event.targetId,
        skillInstanceId: event.burnSkillInstanceId ?? event.skillInstanceId ?? null,
        tags: ['reaction', 'spreadFire', 'fire'],
        payload: {
          status: 'burn',
          stacks,
          meta: {
            sourceEntityId: event.targetId,
            skillInstanceId: event.burnSkillInstanceId ?? event.skillInstanceId ?? null,
            element: 'fire',
            rootEventId: event.rootEventId ?? null,
            canSpread: true,
            spreadDepth: (event.burnSpreadDepth ?? 0) + 1,
          },
        },
      }));
      return { commands, triggered: { id: def.id, x: event.x, y: event.y } };
    }

    function conductive(world, event, def) {
      if (event.type !== 'hitResolved') return null;
      if (!event.tags.includes('thunder') || event.tags.includes('noConductive')) return null;
      if ((event.beforeCharge ?? 0) < 1) return null;
      const target = world.enemies.find((enemy) => enemy.id === event.targetId);
      if (target === undefined || target.deathHandled) return null;
      if (stacksOf(target, 'charge') <= 0) return null;
      consumeStatus(target, 'charge', def.config.consume);
      const targets = nearby(world, target, def.config.radius, def.config.targets, target.id);
      if (targets.length === 0) {
        return { commands: [], triggered: { id: def.id, x: target.x, y: target.y } };
      }
      const commands = targets.map((other) => ({
        type: 'hit',
        targetId: other.id,
        sourceEntityId: target.id,
        skillInstanceId: event.skillInstanceId ?? null,
        tags: ['reaction', 'conductive', 'lightning', 'thunder', 'noConductive', 'noCharge'],
        payload: {
          damage: def.config.damage,
          damageScale: 1,
          element: null,
          heavy: false,
          // 反应伤害吃通用与条件加成，不暴击。
          channel: 'reaction',
          sourceTag: 'reaction:conductive',
        },
      }));
      return { commands, triggered: { id: def.id, x: target.x, y: target.y } };
    }

    function shatter(world, event, def) {
      if (event.type !== 'hitResolved') return null;
      if (!event.tags.includes('heavy') || event.tags.includes('noShatter')) return null;
      const target = world.enemies.find((enemy) => enemy.id === event.targetId);
      if (target === undefined || target.deathHandled) return null;
      if (stacksOf(target, def.config.status) < def.config.threshold) return null;
      consumeStatus(target, def.config.status, Infinity);
      const targets = nearby(world, target, def.config.radius, def.config.targets);
      const commands = targets.map((other) => ({
        type: 'hit',
        targetId: other.id,
        sourceEntityId: target.id,
        skillInstanceId: event.skillInstanceId ?? null,
        tags: ['reaction', 'shatter', 'frost', 'noShatter'],
        payload: {
          damage: def.config.damage,
          damageScale: 1,
          element: null,
          heavy: false,
          // 反应伤害吃通用与条件加成，不暴击。
          channel: 'reaction',
          sourceTag: 'reaction:shatter',
        },
      }));
      return { commands, triggered: { id: def.id, x: target.x, y: target.y } };
    }

    const REACTION_IMPL = Object.freeze({ spreadFire, conductive, shatter });

    /**
     * 评估一个语义事件。
     * @returns {{commands:Array, triggered:Array<{id:string,x:number,y:number}>}}
     */
    function evaluateReactions(world, event) {
      const commands = [];
      const triggered = [];
      if (event === null || event === undefined) return { commands, triggered };
      const list = contentList('reaction')
        .filter((def) => def.event === event.type)
        .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const def of list) {
        if (event.firedReactions !== undefined && event.firedReactions.has(def.id)) continue;
        const handler = REACTION_IMPL[def.handler];
        if (handler === undefined) continue;
        const result = handler(world, event, def);
        if (result === null) continue;
        if (event.firedReactions === undefined) event.firedReactions = new Set();
        event.firedReactions.add(def.id);
        for (const command of result.commands) commands.push({ ...command, reactionId: def.id });
        if (result.triggered !== undefined) triggered.push(result.triggered);
      }
      return { commands, triggered };
    }

    // ---- skills/resolve.js ----
    // 命中结算与命令队列。
    //
    // 结算顺序（docs/skill-architecture.md）：
    //   1. 校验来源与目标仍有效，记录命中快照
    //   2. 应用基础伤害，生命归零只标记，不立刻移除
    //   3. 应用属性效果与修饰命令，检查共享反应
    //   4. 死亡统一在命令队列处理完后结算，读取死亡时状态快照
    //   5. 后续命令按 FIFO 入队处理，不递归调用结算器
    //
    // 每个命令携带 eventId / rootEventId / depth，派生命令继承根事件与技能归因。
    // 深度与每根事件命令数都有上限，超限写入诊断，不静默随机丢弃。

    const DEFAULT_BOUNDS = Object.freeze({ w: 160, h: 144 });

    /**
     * 伤害通道：命中命令可以显式标注，缺省时按命令类型与标签推断。
     * 直接命中与派生命中（分裂、回响）可以暴击；持续伤害与反应伤害不暴击。
     */
    function damageChannelOf(command) {
      const explicit = command?.payload?.channel;
      if (typeof explicit === 'string') return explicit;
      if (command.type === 'statusDamage') return 'dot';
      if (Array.isArray(command.tags) && command.tags.includes('reaction')) return 'reaction';
      return 'direct';
    }

    function combatRngOf(world) {
      if (typeof world.combatRng === 'function') return world.combatRng;
      if (typeof world.rng === 'function') return world.rng;
      return null;
    }

    function boundsOf(world) {
      return world.bounds ?? DEFAULT_BOUNDS;
    }

    function ensureResolutionState(world) {
      if (!Array.isArray(world.commands)) world.commands = [];
      if (!Array.isArray(world.delayed)) world.delayed = [];
      if (!(world.rootBudget instanceof Map)) world.rootBudget = new Map();
      if (!(world.splitCasts instanceof Set)) world.splitCasts = new Set();
      if (!(world.echoCasts instanceof Set)) world.echoCasts = new Set();
      if (!Array.isArray(world.diagnostics)) world.diagnostics = [];
      if (typeof world.nextEventId !== 'number') world.nextEventId = 1;
      if (!world.stats) world.stats = { damage: {}, bySkill: {}, reactions: {}, kills: 0 };
      if (!world.stats.damage) world.stats.damage = {};
      if (!world.stats.bySkill) world.stats.bySkill = {};
      if (!world.stats.reactions) world.stats.reactions = {};
      if (!world.stats.casts) world.stats.casts = {};
      if (!world.stats.modifiers) world.stats.modifiers = {};
      if (typeof world.stats.overflow !== 'number') world.stats.overflow = 0;
      if (typeof world.stats.crits !== 'number') world.stats.crits = 0;
      if (typeof world.stats.critExtra !== 'number') world.stats.critExtra = 0;
      if (typeof world.stats.mitigated !== 'number') world.stats.mitigated = 0;
      if (!Array.isArray(world.events)) world.events = [];
    }

    function diagnose(world, code, detail) {
      if (!Array.isArray(world.diagnostics)) world.diagnostics = [];
      if (world.diagnostics.length >= 64) return;
      world.diagnostics.push({ code, t: world.time ?? 0, ...detail });
    }

    function reactionStat(world, id) {
      if (world.stats.reactions[id] === undefined) world.stats.reactions[id] = { count: 0, damage: 0 };
      return world.stats.reactions[id];
    }

    /** 入队一个命令；派生命令由调用方填写 rootEventId 与 depth。 */
    function enqueue(world, partial) {
      ensureResolutionState(world);
      const depth = partial.depth ?? 0;
      if (depth > RUNTIME_LIMITS.maxCommandDepth) {
        diagnose(world, 'command-depth', { depth, type: partial.type });
        return false;
      }
      const eventId = world.nextEventId;
      world.nextEventId += 1;
      const rootEventId = partial.rootEventId ?? eventId;
      const used = world.rootBudget.get(rootEventId) ?? 0;
      if (used >= RUNTIME_LIMITS.maxCommandsPerRoot) {
        diagnose(world, 'command-budget', { rootEventId, type: partial.type });
        return false;
      }
      world.rootBudget.set(rootEventId, used + 1);
      world.commands.push({
        eventId,
        rootEventId,
        depth,
        type: partial.type,
        targetId: partial.targetId ?? null,
        sourceEntityId: partial.sourceEntityId ?? null,
        skillInstanceId: partial.skillInstanceId ?? null,
        reactionId: partial.reactionId ?? null,
        tags: Array.isArray(partial.tags) ? [...partial.tags] : [],
        payload: partial.payload ?? {},
      });
      return true;
    }

    function enqueueReactionCommands(world, parent, result) {
      for (const command of result.commands) {
        enqueue(world, {
          ...command,
          rootEventId: parent.rootEventId,
          depth: parent.depth + 1,
        });
      }
      for (const marker of result.triggered) {
        const stat = reactionStat(world, marker.id);
        stat.count += 1;
        world.events.push({ type: 'reaction', id: marker.id, x: marker.x, y: marker.y });
      }
    }

    function findEnemy(world, id) {
      if (id === null || id === undefined) return undefined;
      return world.enemies.find((enemy) => enemy.id === id);
    }

    function recordDamage(world, command, amount) {
      if (!(amount > 0)) return;
      const key = command.skillInstanceId ?? command.payload.sourceTag ?? 'other';
      world.stats.damage[key] = (world.stats.damage[key] ?? 0) + amount;
      if (command.skillInstanceId !== null && command.skillInstanceId !== undefined) {
        world.stats.bySkill[command.skillInstanceId] =
          (world.stats.bySkill[command.skillInstanceId] ?? 0) + amount;
      }
      if (command.reactionId !== null && command.reactionId !== undefined) {
        reactionStat(world, command.reactionId).damage += amount;
      }
    }

    /**
     * 扣血只做有符号结算；伤害数值已经由 resolveDamage 折算过属性与暴击。
     * 统计同时记录有效伤害、溢出、暴击次数与被暴击多打出的部分。
     */
    function applyDamage(world, enemy, resolved, command) {
      const amount = resolved.amount ?? resolved;
      if (!(amount > 0)) return 0;
      const before = Math.max(0, enemy.cells);
      const effective = Math.min(before, amount);
      const overflow = amount - effective;
      enemy.cells -= amount;
      enemy.flash = 0.12;
      if (!world.stats) world.stats = {};
      world.stats.overflow = (world.stats.overflow ?? 0) + overflow;
      if (resolved.crit === true) {
        world.stats.crits = (world.stats.crits ?? 0) + 1;
        world.stats.critExtra = (world.stats.critExtra ?? 0) + effective * (1 - 1 / resolved.critMultiplier);
      }
      recordDamage(world, command, effective);
      return effective;
    }

    function targetsInRadius(world, center, radius, count, excludeId = -1) {
      return world.enemies
        .filter((enemy) => enemy.cells > 0 && !enemy.dead && enemy.id !== excludeId)
        .map((enemy) => ({ enemy, d: Math.hypot(enemy.x - center.x, enemy.y - center.y) }))
        .filter((entry) => entry.d <= radius + entry.enemy.r)
        .sort((a, b) => a.d - b.d || a.enemy.id - b.enemy.id)
        .slice(0, count)
        .map((entry) => entry.enemy);
    }

    function scheduleDelayed(world, command) {
      ensureResolutionState(world);
      if (!Array.isArray(world.delayedSeq)) world.delayedSeq = 0;
      world.delayedSeq += 1;
      world.delayed.push({ due: world.time + command.delay, seq: world.delayedSeq, command });
    }

    /** 把到期的延迟命令移进队列；echo 在这里真正入队。 */
    function advanceDelayed(world) {
      ensureResolutionState(world);
      if (world.delayed.length === 0) return 0;
      const due = [];
      const keep = [];
      for (const item of world.delayed) {
        if (item.due <= world.time) due.push(item);
        else keep.push(item);
      }
      world.delayed = keep;
      due.sort((a, b) => a.due - b.due || a.seq - b.seq);
      for (const item of due) enqueue(world, item.command);
      return due.length;
    }

    function executeHit(world, command) {
      const target = findEnemy(world, command.targetId);
      if (target === undefined || target.dead || target.cells <= 0) return;
      const payload = command.payload;
      const element = payload.element === null || payload.element === undefined
        ? null
        : contentById(payload.element);
      const beforeCharge = stacksOf(target, 'charge');
      // 属性在公共伤害入口统一应用：通用加成、条件加成与暴击都由这里折算。
      const resolved = resolveDamage(world.combat, {
        amount: (payload.damage ?? 0) * (payload.damageScale ?? 1),
        channel: damageChannelOf(command),
        element: element === null ? null : element.id,
        tags: command.tags,
        target,
        rng: combatRngOf(world),
      });
      const dealt = applyDamage(world, target, resolved, command);

      // 死亡目标仍完成本次状态施加：先结算效果，再标记待死亡。
      if (element !== null) {
        for (const effect of element.onHit) {
          if (effect.type !== 'applyStatus') continue;
          const result = applyStatus(target, effect.status, effect.stacks, {
            sourceEntityId: command.sourceEntityId,
            skillInstanceId: command.skillInstanceId,
            element: element.id,
            rootEventId: command.rootEventId,
            canSpread: true,
          });
          world.events.push({
            type: 'status',
            status: effect.status,
            x: target.x,
            y: target.y,
            stacks: result.after,
            applied: result.applied,
            element: element.id,
          });
          const applied = evaluateReactions(world, {
            type: 'statusApplied',
            targetId: target.id,
            statusId: effect.status,
            stacks: result.after,
            applied: result.applied,
            eventId: command.eventId,
            rootEventId: command.rootEventId,
            skillInstanceId: command.skillInstanceId,
          });
          enqueueReactionCommands(world, command, applied);
        }
      }

      world.events.push({
        type: 'hit',
        x: target.x,
        y: target.y,
        cells: dealt,
        element: element === null ? null : element.id,
        skillId: command.skillInstanceId,
        depth: command.depth,
        reaction: command.reactionId,
        channel: resolved.channel,
        crit: resolved.crit,
      });

      const reactions = evaluateReactions(world, {
        type: 'hitResolved',
        targetId: target.id,
        tags: command.tags,
        element: element === null ? null : element.id,
        beforeCharge,
        eventId: command.eventId,
        rootEventId: command.rootEventId,
        skillInstanceId: command.skillInstanceId,
      });
      enqueueReactionCommands(world, command, reactions);

      applyModifier(world, command, target, payload);

      if (target.cells <= 0) target.dead = true;
    }

    function applyModifier(world, command, target, payload) {
      const raw = payload.modifier;
      if (raw === null || raw === undefined) return;
      // 兼容旧命令/测试里直接传入 transform 的写法；新计划统一传修饰定义。
      const modifier = raw.transform !== undefined ? raw : { id: raw.type, transform: raw };
      if (modifier.transform === undefined) return;
      const context = {
        world,
        command,
        target,
        payload,
        transform: modifier.transform,
        enqueue: (partial) =>
          enqueue(world, {
            ...partial,
            rootEventId: command.rootEventId,
            depth: command.depth + 1,
          }),
        scheduleLater: (delay, later) =>
          scheduleDelayed(world, {
            ...later,
            delay,
            rootEventId: command.rootEventId,
            depth: command.depth + 1,
          }),
        queryTargets: (center, radius, count, excludeId) =>
          targetsInRadius(world, center, radius, count, excludeId),
        countStatuses: (target) =>
          Object.values(target.statuses ?? {}).reduce((sum, instance) => sum + instance.stacks, 0),
        consumeStatuses: (target) => {
          let total = 0;
          for (const id of Object.keys(target.statuses ?? {})) {
            total += consumeStatus(target, id, Infinity);
          }
          return total;
        },
        emitVisual: (event) => world.events.push(event),
        once: (setName, key) => {
          if (!(world[setName] instanceof Set)) world[setName] = new Set();
          if (world[setName].has(key)) return false;
          world[setName].add(key);
          return true;
        },
      };
      applyModifierOnHit(modifier, context);
    }

    function executeAreaHit(world, command) {
      const payload = command.payload;
      const center = { x: payload.centerX ?? 0, y: payload.centerY ?? 0 };
      const targets = targetsInRadius(world, center, payload.radius ?? 0, payload.maxTargets ?? 8);
      targets.forEach((target, index) => {
        enqueue(world, {
          type: 'hit',
          targetId: target.id,
          sourceEntityId: command.sourceEntityId,
          skillInstanceId: command.skillInstanceId,
          rootEventId: command.rootEventId,
          depth: command.depth + 1,
          tags: index === 0 ? [...command.tags, 'primary'] : command.tags,
          payload: { ...payload, centerX: center.x, centerY: center.y },
        });
      });
    }

    function executeStatusDamage(world, command) {
      const target = findEnemy(world, command.targetId);
      if (target === undefined || target.dead || target.cells <= 0) return;
      // 持续伤害吃通用与条件加成，不暴击；通道显式标注为 dot。
      const resolved = resolveDamage(world.combat, {
        amount: command.payload.damage ?? 0,
        channel: damageChannelOf(command),
        element: command.payload.element ?? null,
        tags: command.tags,
        target,
        rng: combatRngOf(world),
      });
      const dealt = applyDamage(world, target, resolved, command);
      world.events.push({
        type: 'burn',
        status: command.payload.statusId,
        x: target.x,
        y: target.y,
        cells: dealt,
        channel: resolved.channel,
      });
      if (target.cells <= 0) target.dead = true;
    }

    function executeApplyStatus(world, command) {
      const target = findEnemy(world, command.targetId);
      if (target === undefined || target.dead || target.cells <= 0) return;
      const payload = command.payload;
      const result = applyStatus(target, payload.status, payload.stacks, {
        ...(payload.meta ?? {}),
        rootEventId: command.rootEventId,
        canSpread: payload.meta?.canSpread ?? true,
      });
      world.events.push({
        type: 'status',
        status: payload.status,
        x: target.x,
        y: target.y,
        stacks: result.after,
        applied: result.applied,
        reaction: command.reactionId,
      });
      const reactions = evaluateReactions(world, {
        type: 'statusApplied',
        targetId: target.id,
        statusId: payload.status,
        stacks: result.after,
        applied: result.applied,
        eventId: command.eventId,
        rootEventId: command.rootEventId,
        skillInstanceId: command.skillInstanceId,
      });
      enqueueReactionCommands(world, command, reactions);
    }

    function executeMove(world, command) {
      const target = findEnemy(world, command.targetId);
      if (target === undefined || target.dead || target.cells <= 0) return;
      const payload = command.payload;
      const dx = payload.centerX - target.x;
      const dy = payload.centerY - target.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.001) return;
      const step = Math.min(d, payload.strength ?? 0);
      const bounds = boundsOf(world);
      target.x = Math.max(target.r, Math.min(bounds.w - target.r, target.x + (dx / d) * step));
      target.y = Math.max(target.r, Math.min(bounds.h - target.r, target.y + (dy / d) * step));
      world.events.push({ type: 'pull', x: target.x, y: target.y });
    }

    function executeCommand(world, command) {
      switch (command.type) {
        case 'hit':
          executeHit(world, command);
          break;
        case 'areaHit':
          executeAreaHit(world, command);
          break;
        case 'statusDamage':
          executeStatusDamage(world, command);
          break;
        case 'applyStatus':
          executeApplyStatus(world, command);
          break;
        case 'move':
          executeMove(world, command);
          break;
        default:
          diagnose(world, 'unknown-command', { type: String(command.type) });
          break;
      }
    }

    /** FIFO 处理当前队列。返回处理数量；超预算时清空并留下诊断。 */
    function processCommands(world) {
      ensureResolutionState(world);
      let processed = 0;
      while (world.commands.length > 0) {
        if (processed >= RUNTIME_LIMITS.maxCommandsPerStep) {
          diagnose(world, 'step-budget', { pending: world.commands.length, processed });
          world.commands.length = 0;
          break;
        }
        const command = world.commands.shift();
        processed += 1;
        executeCommand(world, command);
      }
      return processed;
    }

    /** 死亡时读取状态快照并提交反应命令；由战斗层在移除实体前调用。 */
    function queueDeathReactions(world, enemy) {
      ensureResolutionState(world);
      const burn = getStatusInstance(enemy, 'burn');
      const event = {
        type: 'entityDied',
        targetId: enemy.id,
        x: enemy.x,
        y: enemy.y,
        burnStacks: burn === null ? 0 : burn.stacks,
        burnCanSpread: true,
        burnSpreadDepth: burn === null ? 0 : burn.source?.spreadDepth ?? 0,
        burnSkillInstanceId: burn === null ? null : burn.source?.skillInstanceId ?? null,
        rootEventId: burn === null ? null : burn.source?.rootEventId ?? null,
        skillInstanceId: burn === null ? null : burn.source?.skillInstanceId ?? null,
        eventId: world.nextEventId,
      };
      world.nextEventId += 1;
      const result = evaluateReactions(world, event);
      const parent = {
        rootEventId: event.eventId,
        depth: 0,
        skillInstanceId: event.skillInstanceId,
      };
      enqueueReactionCommands(world, parent, result);
      return result;
    }

    // ---- skills/world.js ----
    // 战斗世界接口：动作与实体处理器只通过这里查询目标、创建实体、提交命中。
    //
    // 处理器不直接改敌人生命、状态或其他技能，也不读取 registry 的具体内容。
    // 这样属性、反应、伤害归因继续由公共结算处理。

    const ENTITY_LIMITS = Object.freeze({
      projectile: RUNTIME_LIMITS.maxProjectiles,
      orbitSword: RUNTIME_LIMITS.maxOrbitSwords,
      arcSword: RUNTIME_LIMITS.maxArcSwords,
      trap: RUNTIME_LIMITS.maxTraps,
      piercingSword: RUNTIME_LIMITS.maxSwordPieces,
      swordArray: RUNTIME_LIMITS.maxSwordArrays,
    });

    function livingEnemies(world) {
      return world.enemies.filter((enemy) => enemy.cells > 0 && !enemy.dead && !enemy.deathHandled);
    }

    function enemiesInRadius(world, center, radius, count, excludeId = -1) {
      return livingEnemies(world)
        .filter((enemy) => enemy.id !== excludeId)
        .map((enemy) => ({ enemy, d: Math.hypot(enemy.x - center.x, enemy.y - center.y) }))
        .filter((entry) => entry.d <= radius + entry.enemy.r)
        .sort((a, b) => a.d - b.d || a.enemy.id - b.enemy.id)
        .slice(0, count)
        .map((entry) => entry.enemy);
    }

    function nearestEnemy(world, from, range, excludeId = -1) {
      let best = null;
      let bestD = range;
      for (const enemy of livingEnemies(world)) {
        if (enemy.id === excludeId) continue;
        const d = Math.hypot(enemy.x - from.x, enemy.y - from.y) - enemy.r;
        if (d < bestD || (d === bestD && best !== null && enemy.id < best.id)) {
          best = enemy;
          bestD = d;
        }
      }
      return best;
    }

    function countEntities(world, kind) {
      if (!Array.isArray(world.entities)) return 0;
      return world.entities.filter((entity) => entity.kind === kind && !entity.dead).length;
    }

    /** 同一诊断码只记录一次，避免每帧重试把诊断环填满。 */
    function diagnoseOnce(world, code, detail) {
      if (!Array.isArray(world.diagnostics)) world.diagnostics = [];
      if (world.diagnostics.some((entry) => entry.code === code)) return;
      diagnose(world, code, detail);
    }

    function segmentCircleEntry(x0, y0, x1, y1, cx, cy, radius) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const fx = x0 - cx;
      const fy = y0 - cy;
      const c = fx * fx + fy * fy - radius * radius;
      if (c <= 0) return 0;
      const a = dx * dx + dy * dy;
      if (a <= 1e-12) return null;
      const b = 2 * (fx * dx + fy * dy);
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) return null;
      const root = Math.sqrt(discriminant);
      const t = (-b - root) / (2 * a);
      if (t < 0 || t > 1) return null;
      return t;
    }

    /**
     * 线段扫掠：返回沿途接触的敌人，按最早交点、再按敌人 ID 排序。
     * 供弧光飞剑这类高速实体使用，避免按点判定时穿过敌人。
     */
    function sweepEnemies(world, x0, y0, x1, y1, radius) {
      const hits = [];
      for (const enemy of livingEnemies(world)) {
        const t = segmentCircleEntry(x0, y0, x1, y1, enemy.x, enemy.y, enemy.r + radius);
        if (t !== null) hits.push({ enemy, t });
      }
      hits.sort((a, b) => a.t - b.t || a.enemy.id - b.enemy.id);
      return hits;
    }

    function spawnEntity(world, spec) {
      ensureResolutionState(world);
      if (!Array.isArray(world.entities)) world.entities = [];
      const limit = ENTITY_LIMITS[spec.kind] ?? RUNTIME_LIMITS.maxEntities;
      const activeCount = world.entities.filter((entity) => !entity.dead).length;
      if (activeCount >= RUNTIME_LIMITS.maxEntities || countEntities(world, spec.kind) >= limit) {
        diagnose(world, 'entity-limit', { kind: spec.kind, limit });
        return null;
      }
      const entity = {
        ownerId: world.player.id,
        bornAt: world.time,
        dead: false,
        ...spec,
        id: world.nextId++,
      };
      world.entities.push(entity);
      return entity;
    }

    function removeEntity(world, entity) {
      entity.dead = true;
    }

    /**
     * 提交一次统一命中。payload 字段与 resolve.js 的共享契约一致；
     * 属性、强力标签和修饰都由这里统一带入，处理器不自己拼状态。
     */
    function enqueueHit(world, plan, opts) {
      ensureResolutionState(world);
      const tags = [...plan.tags];
      if (plan.heavy) tags.push('heavy');
      for (const tag of opts.extraTags ?? []) {
        if (!tags.includes(tag)) tags.push(tag);
      }
      tags.push(opts.primary === false ? 'secondary' : 'primary');
      enqueue(world, {
        type: 'hit',
        targetId: opts.targetId,
        sourceEntityId: opts.sourceEntityId ?? world.player.id,
        skillInstanceId: plan.id,
        tags,
        payload: {
          damage: plan.damage,
          damageScale: opts.damageScale ?? 1,
          element: plan.element === null ? null : plan.element.id,
          heavy: plan.heavy,
          modifier: plan.modifier,
          modifierTransform: plan.transform,
          castId: opts.castId ?? null,
          action: plan.action.handler,
          // 技能直接命中：吃通用与条件加成，可以暴击。
          channel: 'direct',
          centerX: opts.center?.x ?? 0,
          centerY: opts.center?.y ?? 0,
          radius: plan.radius,
          maxTargets: plan.maxTargets,
        },
      });
    }

    function emitVisual(world, event) {
      ensureResolutionState(world);
      world.events.push(event);
    }

    /** 动作和实体共享的基础上下文；具体处理器再附加 plan / entity。 */
    function createWorldContext(world) {
      return {
        world,
        get time() {
          return world.time;
        },
        rng: world.rng,
        queryTargets: (center, radius, count, excludeId) =>
          enemiesInRadius(world, center, radius, count, excludeId),
        queryNearest: (from, range, excludeId) => nearestEnemy(world, from, range, excludeId),
        sweepEnemies: (x0, y0, x1, y1, radius) => sweepEnemies(world, x0, y0, x1, y1, radius),
        entityCount: (kind) => countEntities(world, kind),
        diagnose: (code, detail) => diagnose(world, code, detail),
        diagnoseOnce: (code, detail) => diagnoseOnce(world, code, detail),
        spawnEntity: (spec) => spawnEntity(world, spec),
        emitVisual: (event) => emitVisual(world, event),
        scheduleLater: (delay, command) => scheduleDelayed(world, { ...command, delay }),
        enqueue: (command) => enqueue(world, command),
        bounds: ARENA,
      };
    }

    function createActionContext(world, skill, plan, castId) {
      const base = createWorldContext(world);
      return {
        ...base,
        skill,
        plan,
        castId,
        hit: (opts) =>
          enqueueHit(world, plan, {
            ...opts,
            castId: opts.castId ?? castId,
          }),
      };
    }

    function createEntityContext(world, entity) {
      const base = createWorldContext(world);
      const plan = entity.plan;
      return {
        ...base,
        entity,
        plan,
        castId: entity.castId,
        hit: (opts) =>
          enqueueHit(world, plan, {
            ...opts,
            sourceEntityId: entity.id,
            castId: opts.castId ?? entity.castId,
          }),
      };
    }

    // ---- skills/entities/projectile.js ----
    // 飞弹实体：追踪目标、推进、碰撞并提交统一命中。
    // 计划快照在发射时固定；改装后的新施放使用新计划。

    const projectileEntity = Object.freeze({
      update(context, dt) {
        const entity = context.entity;
        const world = context.world;
        const target = world.enemies.find(
          (enemy) => enemy.id === entity.targetId && enemy.cells > 0 && !enemy.dead && !enemy.deathHandled,
        );
        if (target === undefined) {
          entity.life -= dt;
          if (entity.life <= 0) entity.dead = true;
          return;
        }
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const distance = Math.hypot(dx, dy) || 1;
        const travel = entity.speed * dt;
        if (distance <= travel + entity.hitRadius + target.r) {
          context.hit({
            targetId: target.id,
            center: { x: target.x, y: target.y },
            extraTags: ['projectile'],
          });
          entity.dead = true;
          return;
        }
        entity.x += (dx / distance) * travel;
        entity.y += (dy / distance) * travel;
        entity.life -= dt;
        if (entity.life <= 0) entity.dead = true;
      },
    });

    // ---- skills/entities/orbitSword.js ----
    // 环绕飞剑实体：维护角度、半径、生命周期和逐目标命中间隔。
    // 碰撞只提交统一命中，属性与反应仍走公共结算。

    const orbitSwordEntity = Object.freeze({
      update(context, dt) {
        const entity = context.entity;
        const world = context.world;
        entity.life -= dt;
        if (entity.life <= 0) {
          if (entity.nextHit instanceof Map) entity.nextHit.clear();
          entity.dead = true;
          return;
        }
        if (!(entity.nextHit instanceof Map)) entity.nextHit = new Map();
        entity.angle += entity.angularSpeed * dt;
        entity.x = world.player.x + Math.cos(entity.angle) * entity.orbitRadius;
        entity.y = world.player.y + Math.sin(entity.angle) * entity.orbitRadius;

        const candidates = context.queryTargets(
          entity,
          entity.hitRadius,
          Math.max(entity.maxTargets * 4, 8),
        );
        let hits = 0;
        for (const enemy of candidates) {
          if (hits >= entity.maxTargets) break;
          const readyAt = entity.nextHit.get(enemy.id) ?? 0;
          if (world.time < readyAt) continue;
          context.hit({
            targetId: enemy.id,
            center: { x: entity.x, y: entity.y },
            extraTags: ['orbit'],
            primary: hits === 0,
          });
          entity.nextHit.set(enemy.id, world.time + entity.hitInterval);
          hits += 1;
        }

        // 目标失效后清理命中记录，避免 Map 随波次无限增长。
        const aliveIds = new Set(
          world.enemies
            .filter((enemy) => enemy.cells > 0 && !enemy.dead && !enemy.deathHandled)
            .map((enemy) => enemy.id),
        );
        for (const id of entity.nextHit.keys()) {
          if (!aliveIds.has(id)) entity.nextHit.delete(id);
        }
      },
    });

    // ---- skills/entities/arcSword.js ----
    // 弧光飞剑实体：三次贝塞尔弧线 + 末段有限追踪 + 线段扫掠碰撞。
    //
    // 进度按时间归一化：0→1 对应 flightTime。前 70% 锁定施放时终点，后 30%
    // 把终点向目标当前位置修正，累计位移不超过 maxCorrection，控制点二同步平移。
    // 目标失效后保留最后有效终点，不重新索敌。命中只提交一次共享命中并结束。

    const TRACK_START = 0.7;
    const MAX_PARAM_STEP = 0.08;

    function arcSwordPoint(entity, t) {
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      return {
        x: a * entity.startX + b * entity.control1X + c * entity.control2X + d * entity.endX,
        y: a * entity.startY + b * entity.control1Y + c * entity.control2Y + d * entity.endY,
      };
    }

    function arcSwordTarget(world, targetId) {
      for (const enemy of world.enemies) {
        if (enemy.id !== targetId) continue;
        if (enemy.cells <= 0 || enemy.dead || enemy.deathHandled) return null;
        return enemy;
      }
      return null;
    }

    function arcSwordUpdateEnd(context, entity) {
      const target = arcSwordTarget(context.world, entity.targetId);
      if (target === null) return;
      const dx = target.x - entity.baseEndX;
      const dy = target.y - entity.baseEndY;
      const distance = Math.hypot(dx, dy);
      const cap = Number.isFinite(entity.maxCorrection) ? entity.maxCorrection : 18;
      const scale = distance > cap ? cap / distance : 1;
      const offsetX = dx * scale;
      const offsetY = dy * scale;
      entity.endX = entity.baseEndX + offsetX;
      entity.endY = entity.baseEndY + offsetY;
      entity.control2X = entity.baseControl2X + offsetX;
      entity.control2Y = entity.baseControl2Y + offsetY;
    }

    const arcSwordEntity = Object.freeze({
      update(context, dt) {
        const entity = context.entity;
        const flightTime = entity.flightTime > 0 ? entity.flightTime : 0.55;
        const previousElapsed = Math.max(0, entity.elapsed);
        entity.elapsed += dt;
        entity.life -= dt;
        const tPrev = Math.min(1, previousElapsed / flightTime);
        const tNext = Math.min(1, entity.elapsed / flightTime);

        if (tNext > TRACK_START) arcSwordUpdateEnd(context, entity);

        const delta = tNext - tPrev;
        const steps = Math.max(1, Math.ceil(delta / MAX_PARAM_STEP));
        let fromX = entity.x;
        let fromY = entity.y;
        let toX = fromX;
        let toY = fromY;

        for (let index = 1; index <= steps; index += 1) {
          const t = tPrev + (delta * index) / steps;
          const point = arcSwordPoint(entity, t);
          toX = point.x;
          toY = point.y;
          const moveX = toX - fromX;
          const moveY = toY - fromY;
          const moved = Math.hypot(moveX, moveY);
          if (moved > 1e-6) {
            entity.dirX = moveX / moved;
            entity.dirY = moveY / moved;
          }
          const contacts = context.sweepEnemies(fromX, fromY, toX, toY, entity.hitRadius);
          if (contacts.length > 0) {
            const contact = contacts[0];
            const hitX = fromX + moveX * contact.t;
            const hitY = fromY + moveY * contact.t;
            entity.x = hitX;
            entity.y = hitY;
            context.hit({
              targetId: contact.enemy.id,
              center: { x: hitX, y: hitY },
              extraTags: ['arcSword'],
              primary: true,
            });
            entity.hitCount += 1;
            entity.dead = true;
            break;
          }
          fromX = toX;
          fromY = toY;
        }

        if (!entity.dead) {
          entity.x = toX;
          entity.y = toY;
        }
        if (entity.hitCount >= entity.maxHits) entity.dead = true;
        if (entity.life <= 0) entity.dead = true;
        if (tNext >= 1) entity.dead = true;
      },
    });

    // ---- skills/entities/piercingSword.js ----
    // 穿透飞剑实体：直线飞行，沿途每个目标至多命中一次，达到命中数或射程后清理。

    const piercingSwordEntity = Object.freeze({
      update(context, dt) {
        const entity = context.entity;
        entity.life -= dt;
        const travel = entity.speed * dt;
        entity.traveled += travel;
        entity.x += entity.dirX * travel;
        entity.y += entity.dirY * travel;
        if (entity.life <= 0 || entity.traveled > entity.range) {
          entity.dead = true;
          return;
        }
        if (!Array.isArray(entity.hitIds)) entity.hitIds = [];
        const candidates = context.queryTargets(
          entity,
          entity.hitRadius,
          Math.max(entity.maxHits * 4, 8),
        );
        for (const enemy of candidates) {
          if (entity.hitIds.length >= entity.maxHits) break;
          if (entity.hitIds.includes(enemy.id)) continue;
          context.hit({
            targetId: enemy.id,
            center: { x: entity.x, y: entity.y },
            extraTags: ['swordPierce', 'path'],
            primary: entity.hitIds.length === 0,
          });
          entity.hitIds.push(enemy.id);
        }
        if (entity.hitIds.length >= entity.maxHits) entity.dead = true;
      },
    });

    // ---- skills/entities/swordArray.js ----
    // 剑阵实体：固定在目标位置，按间隔对范围内有限目标提交命中，到期清理。

    const swordArrayEntity = Object.freeze({
      update(context, dt) {
        const entity = context.entity;
        entity.life -= dt;
        if (entity.life <= 0) {
          entity.dead = true;
          return;
        }
        entity.tickTimer -= dt;
        if (entity.tickTimer > 0) return;
        entity.tickTimer += entity.tickInterval;
        const targets = context.queryTargets(entity, entity.radius, entity.maxTargets);
        if (targets.length === 0) return;
        context.emitVisual({
          type: 'swordArrayPulse',
          x: entity.x,
          y: entity.y,
          radius: entity.radius,
          skillId: entity.plan.id,
          color: entity.plan.element === null ? entity.plan.action.color : entity.plan.element.color,
        });
        targets.forEach((enemy, index) => {
          context.hit({
            targetId: enemy.id,
            center: { x: entity.x, y: entity.y },
            extraTags: ['swordArray', 'sustain'],
            primary: index === 0,
          });
        });
      },
    });

    // ---- skills/entities/trap.js ----
    // 陷阱实体：等待敌人进入触发范围，触发后提交范围命中并销毁。
    // 与飞剑不同，它不移动，也不自主选敌。

    const trapEntity = Object.freeze({
      update(context, dt) {
        const entity = context.entity;
        entity.life -= dt;
        if (entity.life <= 0) {
          entity.dead = true;
          return;
        }
        if (context.time < entity.armedAt) return;
        const trigger = context.queryTargets(entity, entity.triggerRadius, 1);
        if (trigger.length === 0) return;
        const targets = context.queryTargets(entity, entity.radius, entity.maxTargets);
        context.emitVisual({
          type: 'trapTrigger',
          x: entity.x,
          y: entity.y,
          radius: entity.radius,
          color: entity.plan.element === null ? entity.plan.action.color : entity.plan.element.color,
          skillId: entity.plan.id,
        });
        targets.forEach((enemy, index) => {
          context.hit({
            targetId: enemy.id,
            center: { x: entity.x, y: entity.y },
            extraTags: ['trap'],
            primary: index === 0,
          });
        });
        entity.dead = true;
      },
    });

    // ---- skills/entities/index.js ----
    // 持续实体生命周期分派：固定步推进、稳定 ID 顺序、清理与只读视图。
    //
    // 新实体在本帧施放后同帧首次推进；这条规则由测试锁定，避免以后改变时序却
    // 没有可见说明。遍历和候选目标都使用稳定 ID / 距离加 ID 排序。

    const ENTITY_HANDLERS = Object.freeze({
      projectile: projectileEntity,
      orbitSword: orbitSwordEntity,
      arcSword: arcSwordEntity,
      piercingSword: piercingSwordEntity,
      swordArray: swordArrayEntity,
      trap: trapEntity,
    });

    function updateEntities(world, dt) {
      if (!Array.isArray(world.entities)) world.entities = [];
      world.entities.sort((a, b) => a.id - b.id);
      for (const entity of world.entities) {
        if (entity.dead) continue;
        const handler = ENTITY_HANDLERS[entity.kind];
        if (handler === undefined) {
          diagnose(world, 'unknown-entity', { kind: String(entity.kind), id: entity.id });
          entity.dead = true;
          continue;
        }
        handler.update(createEntityContext(world, entity), dt);
      }
      world.entities = world.entities.filter((entity) => !entity.dead);
      // 客户端和既有测试使用只读分类视图；权威列表仍是 world.entities。
      world.projectiles = world.entities.filter((entity) => entity.kind === 'projectile');
      world.orbitSwords = world.entities.filter((entity) => entity.kind === 'orbitSword');
      world.arcSwords = world.entities.filter((entity) => entity.kind === 'arcSword');
      world.piercingSwords = world.entities.filter((entity) => entity.kind === 'piercingSword');
      world.swordArrays = world.entities.filter((entity) => entity.kind === 'swordArray');
      world.traps = world.entities.filter((entity) => entity.kind === 'trap');
    }

    // ---- skills/runtime.js ----
    // 技能冷却与动作调度：只负责"到期 → 检查 → 施放 → 启动冷却"。
    //
    // 具体行为在 actions/*.js；动作通过 action context 查询目标、创建实体和提交
    // 命中。没有目标或实体上限时 canCast 返回 false，技能保持就绪，下一固定步重试。

    function castDueSkills(world, dt) {
      ensureResolutionState(world);
      if (!world.stats.casts) world.stats.casts = {};
      for (const skill of world.skills) {
        if (skill.timer > 0) skill.timer = Math.max(0, skill.timer - dt);
        if (skill.timer > 0) continue;
        const plan = skill.plan;
        const implementation = actionImplementation(plan.action.handler);
        if (implementation === undefined) {
          diagnose(world, 'unknown-action-handler', { handler: plan.action.handler, skillId: plan.id });
          skill.timer = plan.cooldown;
          continue;
        }
        const castId = `${plan.id}:${skill.castCount}`;
        const context = createActionContext(world, skill, plan, castId);
        if (!implementation.handler.canCast(context)) continue;
        if (!implementation.handler.cast(context)) continue;
        skill.castCount += 1;
        // 攻击速度只缩短施放冷却，实体内部计时（灼烧跳伤、飞剑接触间隔）不受影响。
        skill.timer = effectiveCooldown(plan.cooldown, world.combat);
        world.stats.casts[plan.id] = (world.stats.casts[plan.id] ?? 0) + 1;
      }
    }

    /** 新建技能实例：开局给一小段预热，避免同时开火。 */
    function createSkillInstances(plans, combat = null) {
      return plans.map((plan) => ({
        id: plan.id,
        plan,
        timer: effectiveCooldown(plan.cooldown * 0.35, combat),
        castCount: 0,
      }));
    }

    /**
     * 编辑构筑后的重编译接入点。
     * 已存在的实体保留自己的 plan 快照；冷却按技能实例 ID 继承。
     */
    function replaceSkillInstances(world, plans) {
      const previous = new Map(world.skills.map((skill) => [skill.plan.id, skill]));
      world.skills = plans.map((plan) => {
        const old = previous.get(plan.id);
        const cooldown = effectiveCooldown(plan.cooldown, world.combat);
        return {
          id: plan.id,
          plan,
          timer: old === undefined ? effectiveCooldown(plan.cooldown * 0.35, world.combat) : Math.min(old.timer, cooldown),
          castCount: old === undefined ? 0 : old.castCount,
        };
      });
    }

    function resetSkillCooldowns(world) {
      for (const skill of world.skills) skill.timer = 0;
    }

    function skillColor(plan) {
      if (plan === null || plan === undefined) return '#7f93a3';
      return plan.element === null ? plan.action.color : plan.element.color;
    }

    // ---- skills/draft.js ----
    // 构筑编辑与升级候选：放置规则、替换、备用栏与三选一。
    //
    // 放置只做"哪个技能的哪个槽位"的判断；是否合法仍由 compile.js 复核，
    // 所以 UI 预览与真正装入不会给出不同结果。

    const SLOT_OF_KIND = Object.freeze({ element: 'element', modifier: 'modifier' });

    function cloneBuild(input) {
      const build = normalizeBuild(input);
      return {
        version: build.version,
        skills: build.skills.map((skill) => ({ ...skill })),
        reserve: [...build.reserve],
      };
    }

    function actionOf(skill) {
      const def = contentById(skill.action);
      return def !== undefined && def.kind === 'action' ? def : null;
    }

    function placementLabel(build, placement) {
      const skill = build.skills[placement.skillIndex];
      const action = skill === undefined ? null : actionOf(skill);
      const name = action === null ? `技能 ${placement.skillIndex + 1}` : action.label;
      if (placement.kind === 'action') {
        return placement.replacing ? `${name} · 动作槽（替换）` : `新技能 ${placement.skillIndex + 1}`;
      }
      return `${name} · ${placement.kind === 'element' ? '属性' : '修饰'}槽`;
    }

    /** 空槽位：动作创建新技能，属性/修饰填入兼容的空槽。 */
    function placementsFor(input, id) {
      const build = normalizeBuild(input);
      const def = contentById(id);
      if (def === undefined) return [];
      if (def.kind === 'action') {
        if (build.skills.length >= BUILD_LIMITS.maxSkills) return [];
        if (build.skills.some((skill) => skill.action === id)) return [];
        return [{ kind: 'action', skillIndex: build.skills.length, replacing: false }];
      }
      const slot = SLOT_OF_KIND[def.kind];
      if (slot === undefined) return [];
      const out = [];
      build.skills.forEach((skill, skillIndex) => {
        const action = actionOf(skill);
        if (action === null) return;
        if (skill[slot] !== null) return;
        if (!def.requires.every((cap) => action.capabilities.includes(cap))) return;
        out.push({ kind: def.kind, skillIndex, replacing: false });
      });
      return out;
    }

    /**
     * 替换槽位：已经装了同类组件时，玩家可以换掉它。
     * 动作只在两个技能槽都满时提供替换，替换会改变该技能的运行身份。
     */
    function replacementsFor(input, id) {
      const build = normalizeBuild(input);
      const def = contentById(id);
      if (def === undefined) return [];
      if (def.kind === 'action') {
        if (build.skills.length < BUILD_LIMITS.maxSkills) return [];
        if (build.skills.some((skill) => skill.action === id)) return [];
        return build.skills.map((skill, skillIndex) => ({
          kind: 'action',
          skillIndex,
          replacing: true,
        }));
      }
      const slot = SLOT_OF_KIND[def.kind];
      if (slot === undefined) return [];
      const out = [];
      build.skills.forEach((skill, skillIndex) => {
        const action = actionOf(skill);
        if (action === null) return;
        if (skill[slot] === null) return;
        if (skill[slot] === id) return;
        if (!def.requires.every((cap) => action.capabilities.includes(cap))) return;
        out.push({ kind: def.kind, skillIndex, replacing: true });
      });
      return out;
    }

    function upgradeSlots(build, id) {
      const placements = placementsFor(build, id);
      if (placements.length > 0) return placements;
      return replacementsFor(build, id);
    }

    /** 装入组件。替换下来的旧组件进入备用栏；备用栏满时丢弃最旧的一个。 */
    function installChoice(input, id, placement) {
      const build = cloneBuild(input);
      const def = contentById(id);
      if (def === undefined) return { ok: false, reason: 'unknown-component', build };
      if (placement === undefined || placement === null) {
        const first = upgradeSlots(build, id)[0];
        if (first === undefined) return { ok: false, reason: 'no-slot', build };
        placement = first;
      }
      const warnings = [];
      if (def.kind === 'action') {
        if (placement.kind !== 'action') return { ok: false, reason: 'wrong-slot', build };
        const reserve = build.reserve;
        const incomingIndex = reserve.indexOf(id);
        if (incomingIndex >= 0) reserve.splice(incomingIndex, 1);

        if (placement.replacing === true) {
          const skill = build.skills[placement.skillIndex];
          if (skill === undefined) return { ok: false, reason: 'no-skill', build };
          const moved = [];
          let nextElement = skill.element;
          let nextModifier = skill.modifier;
          const caps = new Set(def.capabilities);
          if (nextElement !== null) {
            const element = contentById(nextElement);
            if (element === undefined || !element.requires.every((cap) => caps.has(cap))) {
              moved.push(nextElement);
              nextElement = null;
            }
          }
          if (nextModifier !== null) {
            const modifier = contentById(nextModifier);
            if (modifier === undefined || !modifier.requires.every((cap) => caps.has(cap))) {
              moved.push(nextModifier);
              nextModifier = null;
            }
          }
          if (skill.action !== null) moved.push(skill.action);
          const free = BUILD_LIMITS.maxReserve - reserve.length;
          if (moved.length > free) {
            return {
              ok: false,
              reason: 'reserve-full',
              build,
              moved,
              free,
              required: moved.length,
            };
          }
          for (const component of moved) {
            if (!reserve.includes(component)) reserve.push(component);
          }
          skill.action = id;
          skill.element = nextElement;
          skill.modifier = nextModifier;
          return {
            ok: true,
            build,
            warnings,
            moved,
            retained: [nextElement, nextModifier].filter((component) => component !== null),
          };
        }

        if (build.skills.length >= BUILD_LIMITS.maxSkills) {
          return { ok: false, reason: 'too-many-skills', build };
        }
        if (build.skills.some((skill) => skill.action === id)) {
          return { ok: false, reason: 'duplicate-action', build };
        }
        let number = build.skills.length + 1;
        const used = new Set(build.skills.map((skill) => skill.id));
        while (used.has(`skill-${number}`)) number += 1;
        build.skills.push({ id: `skill-${number}`, action: id, element: null, modifier: null });
      } else {
        if (placement.kind !== def.kind) return { ok: false, reason: 'wrong-slot', build };
        const slot = SLOT_OF_KIND[def.kind];
        const skill = build.skills[placement.skillIndex];
        if (skill === undefined || slot === undefined) return { ok: false, reason: 'no-skill', build };
        const action = actionOf(skill);
        if (action === null || !def.requires.every((cap) => action.capabilities.includes(cap))) {
          return { ok: false, reason: 'capability-mismatch', build };
        }
        const previous = skill[slot];
        // 原子替换：先取出本次装配组件，再放入旧组件；只有取出后仍无空位才丢弃最旧项。
        const incomingIndex = build.reserve.indexOf(id);
        if (incomingIndex >= 0) build.reserve.splice(incomingIndex, 1);
        skill[slot] = id;
        if (previous !== null) {
          if (build.reserve.length >= BUILD_LIMITS.maxReserve) {
            const dropped = build.reserve.shift();
            warnings.push({ code: 'reserve-full', message: `备用栏已满，丢弃 ${dropped}` });
          }
          build.reserve.push(previous);
        }
      }
      return { ok: true, build, warnings };
    }

    /** 把备用栏组件装回构筑；优先空槽，其次替换同类槽位。 */
    function equipReserveComponent(input, id) {
      const build = normalizeBuild(input);
      if (!build.reserve.includes(id)) return { ok: false, reason: 'not-in-reserve', build };
      const slots = upgradeSlots(build, id);
      if (slots.length === 0) return { ok: false, reason: 'no-slot', build };
      return installChoice(build, id, slots[0]);
    }

    function candidatesFor(build, kind) {
      const defs = contentList(kind);
      return defs.filter((def) => {
        const slots = upgradeSlots(build, def.id);
        if (slots.length === 0) return false;
        return slots.some((slot) => installChoice(build, def.id, slot).ok);
      });
    }

    function shuffled(list, rng) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    }

    function stageKinds(build, draftCount) {
      const hasSkillRoom = build.skills.length < BUILD_LIMITS.maxSkills;
      if (draftCount === 0) return ['element'];
      if (draftCount <= 2) return ['modifier', 'element'];
      const hasActionOption = candidatesFor(build, 'action').length > 0;
      if (hasSkillRoom || hasActionOption) return ['action', 'modifier', 'element'];
      return ['modifier', 'element'];
    }

    function stageLabel(build, draftCount) {
      if (draftCount === 0) return '选择属性';
      if (draftCount <= 2) return '选择修饰';
      if (build.skills.length < BUILD_LIMITS.maxSkills) return '选择动作';
      if (candidatesFor(build, 'action').length > 0) return '强化或更换动作';
      return '强化技能';
    }

    /**
     * 生成三选一候选。优先覆盖本阶段开放的类型，再随机补齐。
     * 池子为空时返回空数组，由战斗层保留 pending，稍后再试。
     */
    function offerUpgrades(input, rng, { draftCount = 0, count = 3 } = {}) {
      const build = normalizeBuild(input);
      const kinds = stageKinds(build, draftCount);
      const pools = {};
      for (const kind of kinds) pools[kind] = shuffled(candidatesFor(build, kind), rng);
      const picked = [];
      const seen = new Set();
      let guard = 0;
      while (picked.length < count && guard < 64) {
        guard += 1;
        let added = false;
        for (const kind of kinds) {
          if (picked.length >= count) break;
          const pool = pools[kind];
          if (pool.length === 0) continue;
          while (pool.length > 0 && seen.has(pool[0].id)) pool.shift();
          if (pool.length === 0) continue;
          const def = pool.shift();
          picked.push(def.id);
          seen.add(def.id);
          added = true;
        }
        if (!added) break;
      }
      return picked;
    }

    /** 选择界面里的一张候选：装入后的完整描述。 */
    function choiceInfo(build, id, placement) {
      const def = contentById(id);
      if (def === undefined) return null;
      const slots = upgradeSlots(build, id);
      const target = placement ?? slots[0] ?? null;
      let description = def.desc;
      let label = def.label;
      let blocked = false;
      let note = '';
      let moved = [];
      let retained = [];
      if (target !== null) {
        const installed = installChoice(build, id, target);
        if (installed.ok) {
          const compiled = compileBuild(installed.build);
          const plan = compiled.plans[target.skillIndex];
          if (plan !== undefined) {
            description = plan.description;
            label = plan.label;
          }
          moved = installed.moved ?? [];
          retained = installed.retained ?? [];
          if (moved.length > 0) {
            note = '将移入备用栏：' + moved.map((component) => contentById(component)?.label ?? component).join('、');
          }
        } else {
          blocked = true;
          moved = installed.moved ?? [];
          if (installed.reason === 'reserve-full') {
            note = `备用栏空间不足：需要 ${installed.required ?? moved.length} 格，只有 ${installed.free ?? 0} 格`;
          } else if (installed.reason === 'capability-mismatch') {
            note = '当前动作不支持该组件';
          } else if (installed.reason === 'duplicate-action') {
            note = '该动作已经在构筑中';
          } else {
            note = '无法装入该位置';
          }
        }
      }
      return {
        id,
        kind: def.kind,
        label,
        baseLabel: def.label,
        description,
        color: def.color ?? '#dbe7f0',
        slots,
        target,
        blocked,
        note,
        moved,
        retained,
      };
    }

    // ---- skills/styles.js ----
    // 战斗风格读取：起始构筑、默认移动偏好、解锁与视觉主题。
    // 风格只引用组件，不拥有独立结算代码。

    function listStyles() {
      return contentList('style');
    }

    function styleById(id) {
      const def = contentById(id);
      return def !== undefined && def.kind === 'style' ? def : undefined;
    }

    function defaultStyle() {
      const styles = listStyles();
      return styles.find((style) => style.defaultStyle === true) ?? styles[0];
    }

    function isStyleUnlocked(style, stats) {
      if (style === undefined) return false;
      const needed = style.unlockedBy?.bestFloor ?? 1;
      return (stats?.bestFloor ?? 1) >= needed;
    }

    function availableStyles(stats) {
      return listStyles().filter((style) => isStyleUnlocked(style, stats));
    }

    /** 未知或被锁定的风格安全回退到默认风格，不覆盖已保存构筑。 */
    function resolveStyle(id, stats) {
      const style = styleById(id);
      if (style !== undefined && isStyleUnlocked(style, stats)) return style;
      return defaultStyle();
    }

    /** 由风格生成一轮的起始构筑；已有存档的构筑不会被隐式替换。 */
    function buildFromStyle(style) {
      const source = style ?? defaultStyle();
      const skills = source.startingBuild.map((skill, index) => ({
        id: typeof skill.id === 'string' && skill.id.length > 0 ? skill.id : `skill-${index + 1}`,
        action: skill.action,
        element: skill.element ?? null,
        modifier: skill.modifier ?? null,
      }));
      return { version: BUILD_VERSION, skills, reserve: [] };
    }

    // ---- movement.js ----
    // 常规移动决策与位移请求裁决。
    //
    // 技能只提供 movement.preferredRange，不直接争夺玩家移动。策略层在每步做一次
    // 统一选择；多个并列目标按 ID 打破平局。位移请求首版只保证场地内落点与确定性，
    // 不宣称完整危险评估。

    const CENTER_PULL = 56;
    const PLAYER_MARGIN = 6;

    const clampValue = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

    function preferredRanges(plans) {
      const ranges = [];
      for (const plan of plans) {
        const value = plan.movement?.preferredRange;
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) ranges.push(value);
      }
      return ranges.length > 0 ? ranges : [40];
    }

    function desiredRange(plans, strategy) {
      const ranges = preferredRanges(plans);
      const min = Math.min(...ranges);
      const max = Math.max(...ranges);
      if (strategy === 'approach') return min;
      if (strategy === 'keepDistance') return max;
      // auto：混合构筑取折中距离，先保留近战可接近的机会，也不过度贴近。
      return Math.round((min + max) / 2);
    }

    function createMovementState(plans, strategy = 'auto') {
      const chosen = MOVEMENT_STRATEGIES.includes(strategy) ? strategy : 'auto';
      return { strategy: chosen, desiredRange: desiredRange(plans, chosen) };
    }

    function refreshMovementState(world) {
      world.movement = createMovementState(world.plans, world.movement?.strategy ?? 'auto');
      return world.movement;
    }

    function nearestLiving(world) {
      let best = null;
      let bestD = Infinity;
      for (const enemy of world.enemies) {
        if (enemy.cells <= 0 || enemy.dead || enemy.deathHandled) continue;
        const d = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
        if (d < bestD || (d === bestD && best !== null && enemy.id < best.id)) {
          best = enemy;
          bestD = d;
        }
      }
      return best;
    }

    /** 玩家常规移动：由策略统一决定保持距离、接近或折中。 */
    function movePlayer(world, dt) {
      const player = world.player;
      const desired = world.movement?.desiredRange ?? 40;
      const nearest = nearestLiving(world);
      let vx = 0;
      let vy = 0;
      if (nearest !== null) {
        const dx = player.x - nearest.x;
        const dy = player.y - nearest.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < desired - 8) {
          vx += dx / d;
          vy += dy / d;
        } else if (d > desired + 8) {
          vx -= dx / d;
          vy -= dy / d;
        } else {
          vx += -dy / d;
          vy += dx / d;
        }
      }
      const cx = ARENA.w / 2 - player.x;
      const cy = ARENA.h / 2 - player.y;
      const cd = Math.hypot(cx, cy) || 1;
      if (cd > CENTER_PULL) {
        vx += (cx / cd) * 0.7;
        vy += (cy / cd) * 0.7;
      }
      let len = Math.hypot(vx, vy);
      if (len < 0.001 && nearest !== null) {
        vx = player.x - nearest.x || 1;
        vy = player.y - nearest.y;
        len = Math.hypot(vx, vy);
      }
      if (len < 0.001) return;
      let directionX = vx / len;
      let directionY = vy / len;
      const distance = nearest && Math.hypot(player.x - nearest.x, player.y - nearest.y);
      if (nearest && distance < desired - 8) {
        // 预判周围方向，同时考虑墙和所有存活敌人，避免退向死角或另一只敌人。
        const intendedX = directionX;
        const intendedY = directionY;
        const baseAngle = Math.atan2(directionY, directionX);
        const living = world.enemies.filter((enemy) => enemy.cells > 0 && !enemy.dead && !enemy.deathHandled);
        let bestScore = -Infinity;
        for (let i = 0; i < 16; i += 1) {
          const offset = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
          const angle = baseAngle + offset * Math.PI / 8;
          const x = clampValue(player.x + Math.cos(angle) * 12, PLAYER_MARGIN, ARENA.w - PLAYER_MARGIN);
          const y = clampValue(player.y + Math.sin(angle) * 12, PLAYER_MARGIN, ARENA.h - PLAYER_MARGIN);
          const mx = x - player.x;
          const my = y - player.y;
          const progress = Math.hypot(mx, my);
          let clearance = Infinity;
          for (const enemy of living) {
            clearance = Math.min(clearance, Math.hypot(x - enemy.x, y - enemy.y) - (enemy.r ?? enemy.radius ?? 0));
          }
          const score = clearance + progress * 0.3 + (mx * intendedX + my * intendedY) * 0.15;
          if (score > bestScore) {
            bestScore = score;
            directionX = progress > 0 ? mx / progress : 0;
            directionY = progress > 0 ? my / progress : 0;
          }
        }
      }
      player.x = clampValue(player.x + directionX * player.speed * dt, PLAYER_MARGIN, ARENA.w - PLAYER_MARGIN);
      player.y = clampValue(player.y + directionY * player.speed * dt, PLAYER_MARGIN, ARENA.h - PLAYER_MARGIN);
    }

    function compareRequests(a, b) {
      return b.priority - a.priority || a.sourceId - b.sourceId || a.seq - b.seq;
    }

    /**
     * 提交临时位移请求。request: { sourceId, priority, x, y, distance? }
     * 首版按优先级、来源 ID、入队顺序裁决，落点限制在场地内。
     */
    function requestDisplacement(world, request) {
      if (!Array.isArray(world.displacements)) world.displacements = [];
      if (typeof world.nextDisplacementSeq !== 'number') world.nextDisplacementSeq = 1;
      const seq = world.nextDisplacementSeq;
      world.nextDisplacementSeq += 1;
      const priority = Number.isFinite(request.priority) ? request.priority : 0;
      world.displacements.push({ ...request, priority, seq, applied: false });
      return seq;
    }

    /** 每步一次性裁决位移请求；无效请求直接丢弃，不消耗技能冷却。 */
    function resolveDisplacements(world) {
      if (!Array.isArray(world.displacements) || world.displacements.length === 0) return [];
      const requests = world.displacements.sort(compareRequests);
      world.displacements = [];
      const applied = [];
      for (const request of requests) {
        if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) continue;
        if (!(Number.isFinite(request.distance) && request.distance > 0)) continue;
        const startX = world.player.x;
        const startY = world.player.y;
        const dx = request.x - startX;
        const dy = request.y - startY;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) continue;
        const step = Math.min(d, request.distance);
        world.player.x = clampValue(startX + (dx / d) * step, PLAYER_MARGIN, ARENA.w - PLAYER_MARGIN);
        world.player.y = clampValue(startY + (dy / d) * step, PLAYER_MARGIN, ARENA.h - PLAYER_MARGIN);
        request.applied = true;
        applied.push(request);
      }
      return applied;
    }

    // ---- enemies.js ----
    // 敌人定义：通过行为、位置和数量制造不同问题，不要求玩家拥有唯一解法。
    //
    // 敌人不读取具体技能 ID；只使用统一的伤害、状态、移动和死亡接口。
    // 第一版原型使用设计稿里的三种敌人：群游者、重甲兽、游击者。

    const ENEMY_TYPES = Object.freeze({
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

    function enemyType(id) {
      const def = ENEMY_TYPES[id];
      if (def === undefined) throw new Error(`unknown enemy type: ${String(id)}`);
      return def;
    }

    /**
     * 按层成长；同一层的不同敌人共享倍率，保持相对关系。
     * 第 1–15 层沿用原系数；深层改走更缓的曲线，否则体魄与技能成长追不上
     * 指数式的生命膨胀，99 层会变成纯数值墙。
     */
    function enemyCellsAt(floor, type) {
      const def = enemyType(type);
      const depth = Math.max(1, Math.floor(Number(floor) || 1));
      const growth = depth <= 15
        ? 0.13 * (depth - 1)
        : 0.13 * 14 + 0.045 * (depth - 15);
      return Math.max(1, Math.round(def.cells * (1 + growth)));
    }

    function enemyDamageAt(floor, type) {
      const def = enemyType(type);
      const depth = Math.max(1, Math.floor(Number(floor) || 1));
      let bonus = depth >= 10 ? 1 : 0;
      if (depth >= 30) bonus += 1;
      if (depth >= 55) bonus += 1;
      if (depth >= 80) bonus += 1;
      return def.damage + bonus;
    }

    /** 层定义给出权重表，刷新时按权重循环取类型，保证同层混合稳定可复现。 */
    function bagOf(mix) {
      const bag = [];
      for (const [type, weight] of Object.entries(mix)) {
        const times = Math.max(0, Math.floor(weight));
        for (let i = 0; i < times; i += 1) bag.push(type);
      }
      return bag;
    }

    // ---- floors.js ----
    // 层数表：敌人数量、类型与层修饰符。
    //
    // 旧文档里的"锁"（甲壳、分裂、锚定……）已随旧卡牌系统一起舍弃。
    // 现在每一层只描述敌人构成与压力，不再要求特定卡牌组合。

    const FLOOR_SECONDS = 26;
    const TIME_LIMIT = 45;

    /** 层修饰符：让同一套 build 在不同层表现不同。 */
    const MODIFIERS = Object.freeze({
      crowded: Object.freeze({ name: '拥挤', desc: '敌人 +50%，生命 −30%' }),
      frenzy: Object.freeze({ name: '狂暴', desc: '敌人移速 +30%，伤害 +1' }),
      elite: Object.freeze({ name: '精英', desc: '最后一只敌人强化，清层后额外给一次三选一' }),
      boss: Object.freeze({ name: '最终怪物', desc: '末位 Boss 大幅强化，击败后给两次三选一' }),
    });

    const FLOOR_MODIFIERS = Object.freeze({ 4: 'crowded', 7: 'frenzy', 10: 'elite', 13: 'elite' });

    function floorModifier(floor) {
      return FLOOR_MODIFIERS[floor] ?? null;
    }

    const FLOORS = Object.freeze([
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

    const MAX_FLOOR = 15;

    /** 地图系统的最深层数；第 99 层为最终 Boss。 */
    const MAP_DEPTH = 99;

    /**
     * 深层构成。地图会把第 1–99 层都当作可能的战斗层，所以第 16 层起不再逐层手写，
     * 而是沿用第 15 层的数量与混合继续平滑成长。数量在 16 只封顶：
     * 45 秒时限与护甲减伤共同决定上限，避免深层变成纯数值墙。
     */
    function deepFloorPlan(floor) {
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

    function floorDef(n) {
      const def = FLOORS.find((entry) => entry.floor === n);
      if (def !== undefined) return def;
      if (Number.isInteger(n) && n >= 16 && n <= MAP_DEPTH) return deepFloorPlan(n);
      throw new Error(`floor not in table: ${n}`);
    }

    function enemyTotal(def, { modifier, extra = 0 } = {}) {
      let base = def.count;
      if (modifier === 'crowded') base = Math.round(base * 1.5);
      return base + extra;
    }

    function spawnSeconds(def) {
      return FLOOR_SECONDS / def.count;
    }

    // ---- map/rng.js ----
    // 地图随机数：显式种子 + 哈希派生。
    //
    // 地图生成不使用 Math.random()。所有结构、类型与内容都从主种子经
    // hashSeed(...) 派生，同版本生成器、配置和内容池使用相同种子时结果完全一致。
    // 固定算法：FNV-1a（32 位）哈希 + mulberry32 序列，参数属于存档兼容范围，
    // 修改会改变同种子生成的地图，必须同时提升 MAP_VERSION。

    const MAP_RNG_VERSION = 1;

    /** 把任意串与多个部分拼成稳定的 32 位种子。 */
    function hashSeed(...parts) {
      let hash = 0x811c9dc5;
      for (const part of parts) {
        const text = String(part);
        for (let i = 0; i < text.length; i += 1) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        // 分隔符：避免 ("ab","c") 与 ("a","bc") 派生出同一序列。
        hash ^= 0x1f;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash >>> 0;
    }

    /** mulberry32：固定序列、无隐藏状态、跨平台一致。 */
    function createRng(seed) {
      let state = Number(seed) >>> 0;
      return function rng() {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /** 闭区间整数。 */
    function rngInt(rng, min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi <= lo) return lo;
      return lo + Math.floor(rng() * (hi - lo + 1));
    }

    function rngPick(rng, list) {
      if (!Array.isArray(list) || list.length === 0) return undefined;
      return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
    }

    /** 按权重取一项：entries 形如 [[value, weight], ...]，权重必须为正。 */
    function pickWeighted(rng, entries) {
      let total = 0;
      for (const entry of entries) {
        const weight = Number(entry[1]);
        if (Number.isFinite(weight) && weight > 0) total += weight;
      }
      if (total <= 0) return entries.length === 0 ? undefined : entries[0][0];
      let roll = rng() * total;
      for (const entry of entries) {
        const weight = Number(entry[1]);
        if (!Number.isFinite(weight) || weight <= 0) continue;
        roll -= weight;
        if (roll <= 0) return entry[0];
      }
      return entries[entries.length - 1][0];
    }

    function rngShuffle(rng, list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    }

    // ---- map/config.js ----
    // 地图配置：层数、宽度、类型权重、保底间隔与奖励基数。
    //
    // 数值来自 docs/map-system-design.md 与 docs/map-generation-design.md，
    // 属于待试玩验证的原型参数。改动权重或间隔会改变同种子生成的地图，
    // 必须同步提升 MAP_VERSION，并在分享种子时标明版本。
    //
    // 由 45% 普通 / 20% 事件 / 12% 休息 / 10% 商店 / 13% 精英的参考权重估算，
    // 一局约经历 44 场普通战斗与 13 场精英战斗。

    const MAP_VERSION = 1;

    /** 地点类型：全部对 UI 暴露图标、颜色与说明，不只靠颜色区分。 */
    const NODE_TYPES = Object.freeze({
      normal: Object.freeze({
        id: 'normal',
        label: '普通怪物',
        icon: '⚔',
        color: '#9fb2c2',
        desc: '稳定成长：胜利后获得金币与经验，可能拿到小型成长',
      }),
      elite: Object.freeze({
        id: 'elite',
        label: '精英怪物',
        icon: '◆',
        color: '#ffd166',
        desc: '高风险高回报：敌人有额外强化，胜利后金币更多并补一次构筑选择',
      }),
      rest: Object.freeze({
        id: 'rest',
        label: '休息点',
        icon: '☾',
        color: '#6ee7a8',
        desc: '二选一：恢复 30% 最大生命，或获得一次构筑强化',
      }),
      event: Object.freeze({
        id: 'event',
        label: '事件点',
        icon: '?',
        color: '#8fd8ff',
        desc: '带代价的选择：选项会展示已知代价，也可以直接离开',
      }),
      shop: Object.freeze({
        id: 'shop',
        label: '商店',
        icon: '$',
        color: '#c9b3ff',
        desc: '把金币换成恢复、组件或属性点，可以只看不买',
      }),
      boss: Object.freeze({
        id: 'boss',
        label: '最终怪物',
        icon: '☠',
        color: '#e35d5d',
        desc: '第 99 层的最终考验：规则固定，至少两种应对思路',
      }),
    });

    const NODE_TYPE_IDS = Object.freeze(['normal', 'elite', 'rest', 'event', 'shop', 'boss']);

    /** 自动路线偏好。手动接管随时可用。 */
    const AUTO_MODES = Object.freeze({
      manual: Object.freeze({ id: 'manual', label: '手动', desc: '每到分叉都停下，由玩家自己选择' }),
      steady: Object.freeze({ id: 'steady', label: '稳健', desc: '低生命优先休息，尽量避开精英' }),
      balanced: Object.freeze({ id: 'balanced', label: '均衡', desc: '兼顾恢复、商店与成长，状态好时才考虑精英' }),
      risky: Object.freeze({ id: 'risky', label: '冒险', desc: '优先精英和高风险事件' }),
    });

    const AUTO_MODE_IDS = Object.freeze(['manual', 'steady', 'balanced', 'risky']);

    const BASE_CONFIG = {
      version: MAP_VERSION,
      depth: 99,
      width: { min: 3, max: 5 },
      weights: { normal: 45, elite: 13, rest: 12, event: 20, shop: 10 },
      // 休息点与商店用「锚点」保证每条路线都经过：随机权重无法满足
      // 「任意连续 12 层至少一个休息点」这类逐路线约束（12% 权重下一条 12 层
      // 路线仍有两成概率没有休息点）。row 模式整排同类型（长地图用，保证成立），
      // node 模式只在锚点层放一个节点（层数很少的原型用，靠事后修正补足）。
      anchors: {
        mode: 'row',
        restSpacing: { min: 7, max: 10 },
        shopSpacing: { min: 8, max: 11 },
        minSeparation: 2,
      },
      guards: { eliteFrom: 4, restGap: 12, shopGap: 18, maxElitePerFloor: 2 },
      attempts: 24,
      repairPasses: 16,
      reward: { normal: 22, elite: 58, boss: 220, spread: 0.3, eliteDraft: 1 },
      rest: { healRatio: 0.3 },
      shop: { items: 3 },
      auto: { lookahead: 3, pauseLowLife: 0.2, pauseAllElite: 0.35 },
    };

    function mergeSection(base, extra) {
      const out = {};
      for (const key of Object.keys(base)) {
        const value = base[key];
        out[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
          ? { ...value }
          : value;
      }
      if (extra === null || typeof extra !== 'object') return out;
      for (const key of Object.keys(extra)) {
        if (extra[key] === undefined) continue;
        out[key] = extra[key];
      }
      return out;
    }

    /**
     * 生成一份完整配置。允许按段覆盖，但版本号始终取 MAP_VERSION：
     * 版本是生成规则的唯一标识，不接受外部随意指定。
     */
    function mapConfig(overrides = {}) {
      const src = overrides === null || typeof overrides !== 'object' ? {} : overrides;
      const config = {
        version: MAP_VERSION,
        depth: Math.max(3, Math.floor(Number(src.depth ?? BASE_CONFIG.depth)) || BASE_CONFIG.depth),
        width: mergeSection(BASE_CONFIG.width, src.width),
        weights: mergeSection(BASE_CONFIG.weights, src.weights),
        anchors: mergeSection(BASE_CONFIG.anchors, src.anchors),
        guards: mergeSection(BASE_CONFIG.guards, src.guards),
        attempts: Math.max(1, Math.floor(Number(src.attempts ?? BASE_CONFIG.attempts)) || 1),
        repairPasses: Math.max(1, Math.floor(Number(src.repairPasses ?? BASE_CONFIG.repairPasses)) || 1),
        reward: mergeSection(BASE_CONFIG.reward, src.reward),
        rest: mergeSection(BASE_CONFIG.rest, src.rest),
        shop: mergeSection(BASE_CONFIG.shop, src.shop),
        auto: mergeSection(BASE_CONFIG.auto, src.auto),
      };
      config.width.min = Math.max(1, Math.floor(config.width.min));
      config.width.max = Math.max(config.width.min, Math.floor(config.width.max));
      config.guards.eliteFrom = Math.max(2, Math.floor(config.guards.eliteFrom));
      // 休息 / 商店间隔必须能放进当前深度，否则原型地图永远无法满足保底。
      const span = config.depth - 2;
      config.guards.restGap = Math.max(2, Math.min(Math.floor(config.guards.restGap), span));
      config.guards.shopGap = Math.max(2, Math.min(Math.floor(config.guards.shopGap), span));
      config.guards.maxElitePerFloor = Math.max(1, Math.floor(config.guards.maxElitePerFloor));
      config.reward.normal = Math.max(0, Math.floor(config.reward.normal));
      config.reward.elite = Math.max(0, Math.floor(config.reward.elite));
      config.reward.boss = Math.max(0, Math.floor(config.reward.boss));
      config.reward.spread = Math.max(0, Math.min(1, Number(config.reward.spread) || 0));
      config.rest.healRatio = Math.max(0, Math.min(1, Number(config.rest.healRatio) || 0));
      config.shop.items = Math.max(1, Math.floor(config.shop.items));
      return Object.freeze(config);
    }

    /** 11 层原型：第 1 层普通战斗，第 10 层休息，第 11 层测试 Boss。 */
    function prototypeConfig(overrides = {}) {
      return mapConfig({
        depth: 11,
        width: { min: 3, max: 4 },
        anchors: {
          mode: 'node',
          restSpacing: { min: 3, max: 4 },
          shopSpacing: { min: 5, max: 7 },
          minSeparation: 1,
        },
        reward: { ...BASE_CONFIG.reward, boss: 90 },
        ...overrides,
      });
    }

    /** 默认配置（99 层）。 */
    const MAP_CONFIG = mapConfig();

    /** 存档里保存的配置快照：只保留影响生成的字段。 */
    function snapshotMapConfig(config) {
      const cfg = mapConfig(config);
      return {
        version: cfg.version,
        depth: cfg.depth,
        width: { ...cfg.width },
        weights: { ...cfg.weights },
        anchors: {
          mode: cfg.anchors.mode,
          restSpacing: { ...cfg.anchors.restSpacing },
          shopSpacing: { ...cfg.anchors.shopSpacing },
          minSeparation: cfg.anchors.minSeparation,
        },
        guards: { ...cfg.guards },
        reward: { ...cfg.reward },
        rest: { ...cfg.rest },
        shop: { ...cfg.shop },
      };
    }

    /** 每层的固定规则：第 1 层普通战斗，倒数第 2 层休息，最后一层 Boss。 */
    function fixedNodeType(floor, config) {
      if (floor <= 1) return 'normal';
      if (floor === config.depth) return 'boss';
      if (floor === config.depth - 1) return 'rest';
      return null;
    }

    // ---- map/topology.js ----
    // 地图结构：分层有向图。
    //
    // 第 1 层只有起点，第 2–depth-2 层每层 3–5 个节点，倒数第 2 层单个休息点，
    // 最后一层单个最终 Boss。连线只指向下一层，允许分叉与汇合，不允许横移或跳层。
    // 构建阶段就保证：每个节点至少有一条入边（起点除外）、至少一条出边（Boss 除外）。

    function nodeId(floor, column) {
      return `${floor}-${column}`;
    }

    /** 每层宽度：起点、休息、Boss 固定 1，其余在配置区间内取，并偏好与上一层相近。 */
    function floorWidths(rng, config) {
      const widths = new Array(config.depth + 1).fill(1);
      let previous = rngInt(rng, config.width.min, config.width.max);
      for (let floor = 2; floor <= config.depth - 2; floor += 1) {
        // 70% 沿用上一层宽度，避免整张图锯齿状抖动。
        const next = rng() < 0.7 ? previous : rngInt(rng, config.width.min, config.width.max);
        widths[floor] = next;
        previous = next;
      }
      return widths;
    }

    const mapClamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

    /**
     * 按「比例映射 + 覆盖补边」连线：
     * 1. 每个源节点先连到比例位置对应的目标节点；
     * 2. 45% 概率再连到相邻目标，形成分叉；
     * 3. 任何没有入边的目标补一条最近源的边，避免孤立节点。
     */
    function buildTopology(rng, config) {
      const widths = floorWidths(rng, config);
      const byFloor = new Map();
      const nodes = [];
      for (let floor = 1; floor <= config.depth; floor += 1) {
        const width = widths[floor];
        const row = [];
        for (let column = 0; column < width; column += 1) {
          const node = {
            id: nodeId(floor, column),
            floor,
            column,
            type: null,
            next: [],
            content: {},
          };
          row.push(node);
          nodes.push(node);
        }
        byFloor.set(floor, row);
      }

      for (let floor = 1; floor < config.depth; floor += 1) {
        const from = byFloor.get(floor);
        const to = byFloor.get(floor + 1);
        const positions = from.map((source) => (from.length === 1 ? 0 : (source.column + 0.5) / from.length));
        const incoming = new Set();

        from.forEach((source, index) => {
          const base = mapClamp(Math.round(positions[index] * (to.length - 1)), 0, to.length - 1);
          const targets = new Set([base]);
          if (to.length > 1 && rng() < 0.45) {
            const offset = rng() < 0.5 ? -1 : 1;
            targets.add(mapClamp(base + offset, 0, to.length - 1));
          }
          for (const target of [...targets].sort((a, b) => a - b)) {
            source.next.push(to[target].id);
            incoming.add(target);
          }
        });

        // 覆盖补边：没有入边的目标节点接回最近源，保证不会产生无法进入的节点。
        for (let target = 0; target < to.length; target += 1) {
          if (incoming.has(target)) continue;
          let bestIndex = 0;
          let bestDistance = Infinity;
          positions.forEach((position, index) => {
            const distance = Math.abs(position * (to.length - 1) - target);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestIndex = index;
            }
          });
          from[bestIndex].next.push(to[target].id);
          incoming.add(target);
        }
      }

      return { nodes, byFloor, width: widths };
    }

    /** 按层分组的只读视图；nodes 顺序即生成顺序。 */
    function groupNodesByFloor(nodes, depth) {
      const byFloor = new Map();
      for (let floor = 1; floor <= depth; floor += 1) byFloor.set(floor, []);
      for (const node of nodes) {
        if (!byFloor.has(node.floor)) byFloor.set(node.floor, []);
        byFloor.get(node.floor).push(node);
      }
      for (const row of byFloor.values()) row.sort((a, b) => a.column - b.column);
      return byFloor;
    }

    // ---- map/validate.js ----
    // 地图验证：结构、可达性、固定层与「每条有效路线」的保底约束。
    //
    // 保底不能只看某一层有没有休息点：必须覆盖每条从起点到终点的路线。
    // 这里用逐层传播状态集合来精确判定 —— 每个节点保留所有可能到达的状态
    // （距离上次休息 / 商店的层数、上一节点是否精英），并按 Pareto 支配剪枝。
    // 只保留「最优历史」会漏判，所以剪枝只丢弃被完全支配的状态。

    function indexNodeMap(nodes) {
      const map = new Map();
      for (const node of nodes) map.set(node.id, node);
      return map;
    }

    function floorRows(nodes, depth) {
      return groupNodesByFloor(nodes, depth);
    }

    const encodeState = (state) => `${state.restGap},${state.shopGap},${state.prevElite ? 1 : 0}`;

    /** 同 prevElite 下，restGap 与 shopGap 都不大于另一状态时才被支配。 */
    function pushState(store, state, limit = 48) {
      for (const existing of store.values()) {
        if (
          existing.prevElite === state.prevElite &&
          existing.restGap <= state.restGap &&
          existing.shopGap <= state.shopGap
        ) return;
      }
      for (const [key, existing] of [...store]) {
        if (
          existing.prevElite === state.prevElite &&
          state.restGap <= existing.restGap &&
          state.shopGap <= existing.shopGap
        ) store.delete(key);
      }
      if (store.size >= limit) {
        // 兜底：状态数上限只为防止病态图，正常地图远达不到。
        const first = store.keys().next();
        if (!first.done) store.delete(first.value);
      }
      store.set(encodeState(state), state);
    }

    /**
     * 逐层传播所有路线的状态，返回每个节点的后状态集合与违规列表。
     * 只处理从起点可达的节点；不可达节点由 validateMap 单独报错。
     */
    function routeStates(nodes, config) {
      const rows = floorRows(nodes, config.depth);
      const states = new Map();
      const violations = new Map();
      const incoming = new Map();

      const startRow = rows.get(1) ?? [];
      for (const node of startRow) {
        incoming.set(node.id, [{ restGap: 0, shopGap: 0, prevElite: false }]);
      }

      for (let floor = 1; floor <= config.depth; floor += 1) {
        const row = rows.get(floor) ?? [];
        for (const node of row) {
          const list = incoming.get(node.id);
          if (list === undefined || list.length === 0) continue;
          const post = new Map();
          for (const state of list) {
            const restGap = node.type === 'rest' ? 0 : state.restGap + 1;
            const shopGap = node.type === 'shop' ? 0 : state.shopGap + 1;
            const prevElite = node.type === 'elite';
            if (restGap >= config.guards.restGap) {
              violations.set('rest:' + node.id, { kind: 'rest-gap', nodeId: node.id, value: restGap });
            }
            if (shopGap >= config.guards.shopGap) {
              violations.set('shop:' + node.id, { kind: 'shop-gap', nodeId: node.id, value: shopGap });
            }
            if (state.prevElite && prevElite) {
              violations.set('elite:' + node.id, { kind: 'elite-chain', nodeId: node.id });
            }
            if (prevElite && node.floor < config.guards.eliteFrom) {
              violations.set('early:' + node.id, { kind: 'elite-early', nodeId: node.id });
            }
            pushState(post, { restGap, shopGap, prevElite });
          }
          states.set(node.id, [...post.values()]);
          for (const nextId of node.next) {
            const bucket = incoming.get(nextId) ?? [];
            for (const state of post.values()) bucket.push(state);
            // 入边最多 5 条、状态已被支配剪枝，这里只做去重上限保护。
            incoming.set(nextId, bucket.length > 96 ? bucket.slice(-96) : bucket);
          }
        }
      }

      return { states, violations: [...violations.values()], rows };
    }

    function forwardReach(nodes, startId) {
      const byId = indexNodeMap(nodes);
      const seen = new Set();
      const stack = [startId];
      while (stack.length > 0) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const node = byId.get(id);
        if (node === undefined) continue;
        for (const nextId of node.next) stack.push(nextId);
      }
      return seen;
    }

    function backwardReach(nodes, endId) {
      const parents = new Map();
      for (const node of nodes) {
        for (const nextId of node.next) {
          const list = parents.get(nextId) ?? [];
          list.push(node.id);
          parents.set(nextId, list);
        }
      }
      const seen = new Set();
      const stack = [endId];
      while (stack.length > 0) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        for (const prevId of parents.get(id) ?? []) stack.push(prevId);
      }
      return seen;
    }

    /** 统计从起点到终点的有效路线数量（饱和计数，避免天文数字溢出）。 */
    function countRoutes(nodes, config) {
      const rows = floorRows(nodes, config.depth);
      const counts = new Map();
      for (const node of rows.get(1) ?? []) counts.set(node.id, 1);
      for (let floor = 1; floor < config.depth; floor += 1) {
        for (const node of rows.get(floor) ?? []) {
          const value = counts.get(node.id) ?? 0;
          if (value === 0) continue;
          for (const nextId of node.next) {
            counts.set(nextId, Math.min(1e9, (counts.get(nextId) ?? 0) + value));
          }
        }
      }
      const bossRow = rows.get(config.depth) ?? [];
      return bossRow.reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0);
    }

    /** 结构 + 类型 + 保底验证。返回可诊断的错误列表，不做隐式修正。 */
    function validateMap(nodes, config) {
      const errors = [];
      const byId = indexNodeMap(nodes);
      const rows = floorRows(nodes, config.depth);

      if (!Array.isArray(nodes) || nodes.length === 0) {
        return { ok: false, errors: [{ code: 'empty-map', message: '地图没有节点' }], stats: null };
      }
      if (byId.size !== nodes.length) {
        errors.push({ code: 'duplicate-id', message: '节点 ID 不唯一' });
      }

      const startRow = rows.get(1) ?? [];
      const bossRow = rows.get(config.depth) ?? [];
      const preBossRow = rows.get(config.depth - 1) ?? [];
      if (startRow.length !== 1) {
        errors.push({ code: 'start-count', message: `第 1 层应只有 1 个节点，实际 ${startRow.length}` });
      }
      if (bossRow.length !== 1) {
        errors.push({ code: 'boss-count', message: `第 ${config.depth} 层应只有 1 个节点，实际 ${bossRow.length}` });
      }
      if (preBossRow.length !== 1) {
        errors.push({
          code: 'rest-count',
          message: `第 ${config.depth - 1} 层应只有 1 个休息节点，实际 ${preBossRow.length}`,
        });
      }

      for (let floor = 1; floor <= config.depth; floor += 1) {
        const row = rows.get(floor) ?? [];
        if (row.length === 0) {
          errors.push({ code: 'floor-empty', message: `第 ${floor} 层没有节点`, floor });
          continue;
        }
        const columns = new Set();
        for (const node of row) {
          if (node.floor !== floor) {
            errors.push({ code: 'floor-mismatch', message: `节点 ${node.id} 的层数不一致`, nodeId: node.id });
          }
          if (!Number.isInteger(node.column) || node.column < 0 || columns.has(node.column)) {
            errors.push({ code: 'bad-column', message: `节点 ${node.id} 的列号非法`, nodeId: node.id });
          }
          columns.add(node.column);
          if (NODE_TYPES[node.type] === undefined) {
            errors.push({ code: 'bad-type', message: `节点 ${node.id} 类型未知：${String(node.type)}`, nodeId: node.id });
          }
          if (!Array.isArray(node.next)) {
            errors.push({ code: 'bad-next', message: `节点 ${node.id} 缺少连线数组`, nodeId: node.id });
            continue;
          }
          const seen = new Set();
          for (const nextId of node.next) {
            if (seen.has(nextId)) {
              errors.push({ code: 'duplicate-edge', message: `节点 ${node.id} 有重复连线 ${nextId}`, nodeId: node.id });
            }
            seen.add(nextId);
            const target = byId.get(nextId);
            if (target === undefined) {
              errors.push({ code: 'dangling-edge', message: `节点 ${node.id} 指向不存在的 ${nextId}`, nodeId: node.id });
              continue;
            }
            if (target.floor !== node.floor + 1) {
              errors.push({ code: 'edge-floor', message: `节点 ${node.id} 跨越了层数指向 ${nextId}`, nodeId: node.id });
            }
          }
          if (floor < config.depth && node.next.length === 0) {
            errors.push({ code: 'dead-end', message: `节点 ${node.id} 没有通往下一层的路`, nodeId: node.id });
          }
        }
        if (floor < config.depth) {
          const elites = row.filter((node) => node.type === 'elite');
          if (elites.length === row.length && row.length > 0) {
            errors.push({ code: 'all-elite', message: `第 ${floor} 层全部是精英`, floor });
          }
          if (elites.length > config.guards.maxElitePerFloor) {
            errors.push({
              code: 'elite-cap',
              message: `第 ${floor} 层精英过多（${elites.length} > ${config.guards.maxElitePerFloor}）`,
              floor,
            });
          }
        }
      }

      for (const node of nodes) {
        const fixed = fixedNodeType(node.floor, config);
        if (fixed !== null && node.type !== fixed) {
          errors.push({
            code: 'fixed-type',
            message: `第 ${node.floor} 层必须是 ${fixed}，实际 ${String(node.type)}`,
            nodeId: node.id,
          });
        }
      }

      if (errors.length > 0) {
        return { ok: false, errors, stats: null };
      }

      const startId = startRow[0].id;
      const bossId = bossRow[0].id;
      const forward = forwardReach(nodes, startId);
      const backward = backwardReach(nodes, bossId);
      for (const node of nodes) {
        if (!forward.has(node.id)) {
          errors.push({ code: 'unreachable', message: `节点 ${node.id} 无法从起点到达`, nodeId: node.id });
        } else if (!backward.has(node.id)) {
          errors.push({ code: 'no-exit', message: `节点 ${node.id} 无法通往 Boss`, nodeId: node.id });
        }
      }

      const route = routeStates(nodes, config);
      for (const violation of route.violations) {
        errors.push({
          code: 'route-' + violation.kind,
          message: constraintMessage(violation, config),
          nodeId: violation.nodeId,
        });
      }

      const typeCounts = {};
      for (const node of nodes) typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
      const edges = nodes.reduce((sum, node) => sum + node.next.length, 0);

      return {
        ok: errors.length === 0,
        errors,
        stats: {
          floors: config.depth,
          nodes: nodes.length,
          edges,
          routes: countRoutes(nodes, config),
          typeCounts,
        },
      };
    }

    function constraintMessage(violation, config) {
      if (violation.kind === 'rest-gap') {
        return `连续 ${config.guards.restGap} 层没有休息点（${violation.nodeId}）`;
      }
      if (violation.kind === 'shop-gap') {
        return `连续 ${config.guards.shopGap} 层没有商店（${violation.nodeId}）`;
      }
      if (violation.kind === 'elite-chain') return `路线连续经过两个精英（${violation.nodeId}）`;
      if (violation.kind === 'elite-early') return `前 ${config.guards.eliteFrom - 1} 层不允许出现精英（${violation.nodeId}）`;
      return violation.kind;
    }

    /**
     * 汇总需要修正的类型问题。修正方向只做「更安全」的转换：
     * 精英 → 普通 / 事件，普通 → 休息 / 商店，不会把已满足的约束改坏。
     */
    function collectTypeProblems(nodes, config) {
      const rows = floorRows(nodes, config.depth);
      const problems = [];
      const seen = new Set();
      const push = (problem) => {
        const key = problem.kind + ':' + problem.nodeId;
        if (seen.has(key)) return;
        seen.add(key);
        problems.push(problem);
      };

      const route = routeStates(nodes, config);
      for (const violation of route.violations) {
        if (violation.kind === 'rest-gap') push({ kind: 'rest-gap', nodeId: violation.nodeId, fix: 'rest' });
        else if (violation.kind === 'shop-gap') push({ kind: 'shop-gap', nodeId: violation.nodeId, fix: 'shop' });
        else push({ kind: violation.kind, nodeId: violation.nodeId, fix: 'normal' });
      }

      for (let floor = 1; floor <= config.depth; floor += 1) {
        const row = rows.get(floor) ?? [];
        if (row.length === 0) continue;
        const fixed = fixedNodeType(floor, config);
        if (fixed !== null) {
          for (const node of row) {
            if (node.type !== fixed) push({ kind: 'fixed-type', nodeId: node.id, fix: fixed });
          }
          continue;
        }
        const elites = row.filter((node) => node.type === 'elite');
        if (elites.length === row.length) {
          const target = elites[elites.length - 1];
          push({ kind: 'all-elite', nodeId: target.id, fix: 'event' });
        } else if (elites.length > config.guards.maxElitePerFloor) {
          for (const node of elites.slice(config.guards.maxElitePerFloor)) {
            push({ kind: 'elite-cap', nodeId: node.id, fix: 'normal' });
          }
        }
        for (const node of row) {
          if (node.type === 'elite' && floor < config.guards.eliteFrom) {
            push({ kind: 'elite-early', nodeId: node.id, fix: 'normal' });
          }
        }
      }

      return problems;
    }

    // ---- map/types.js ----
    // 地图类型分配与保底修正。
    //
    // 分配顺序：固定层（起点 / 休息 / Boss）→ 按权重抽取 → 初步限制（前几层无精英、
    // 每层精英上限）→ 迭代修正（针对每条路线的休息 / 商店间隔与连续精英）。
    // 修正只做更安全的类型转换，且不改写固定层。

    /** 可随机分配的类型；boss 只出现在固定层。 */
    const ASSIGNABLE_TYPES = Object.freeze(['normal', 'elite', 'rest', 'event', 'shop']);

    /**
     * 类型分配：
     * 1. 固定层强制（起点 / 休息 / Boss）；
     * 2. 锚点整排（restFloors / shopFloors）——保证每条路线都经过休息与商店；
     * 3. 其余楼层按权重抽取普通 / 精英 / 事件（有锚点时不再抽休息与商店）；
     * 4. 初步限制：前几层无精英、每层精英上限。
     */
    function assignNodeTypes(nodes, rng, config, anchors = null) {
      const rows = floorRows(nodes, config.depth);
      const mode = anchors?.mode === 'node' ? 'node' : 'row';
      const restFloors = anchors?.restFloors ?? new Set();
      const shopFloors = anchors?.shopFloors ?? new Set();
      const restColumns = anchors?.restColumns ?? new Map();
      const shopColumns = anchors?.shopColumns ?? new Map();
      const randomTypes = mode === 'row'
        ? ASSIGNABLE_TYPES.filter((id) => id !== 'rest' && id !== 'shop')
        : ASSIGNABLE_TYPES;
      for (const node of nodes) {
        const fixed = fixedNodeType(node.floor, config);
        if (fixed !== null) {
          node.type = fixed;
          continue;
        }
        if (restFloors.has(node.floor) && (mode === 'row' || restColumns.get(node.floor) === node.column)) {
          node.type = 'rest';
          continue;
        }
        if (shopFloors.has(node.floor) && (mode === 'row' || shopColumns.get(node.floor) === node.column)) {
          node.type = 'shop';
          continue;
        }
        const entries = randomTypes.map((id) => [id, config.weights[id]]);
        node.type = pickWeighted(rng, entries) ?? 'normal';
      }
      for (const row of rows.values()) {
        let elites = 0;
        for (const node of row) {
          if (node.type !== 'elite') continue;
          elites += 1;
          if (elites > config.guards.maxElitePerFloor || node.floor < config.guards.eliteFrom) {
            node.type = 'normal';
            elites = Math.min(elites, config.guards.maxElitePerFloor);
          }
        }
      }
      return nodes;
    }

    /**
     * 迭代修正类型直到所有路线满足保底。返回是否收敛；
     * 未收敛时由 generateMap 换一次重试种子或使用保底模板。
     */
    function repairNodeTypes(nodes, config) {
      const byId = new Map(nodes.map((node) => [node.id, node]));
      for (let pass = 0; pass < config.repairPasses; pass += 1) {
        const problems = collectTypeProblems(nodes, config);
        if (problems.length === 0) return true;
        const applied = new Set();
        for (const problem of problems) {
          const node = byId.get(problem.nodeId);
          if (node === undefined || applied.has(node.id)) continue;
          if (fixedNodeType(node.floor, config) !== null) continue;
          node.type = problem.fix;
          applied.add(node.id);
        }
        if (applied.size === 0) return false;
      }
      return collectTypeProblems(nodes, config).length === 0;
    }

    /** 类型分布的简短摘要，供报告与存档诊断使用。 */
    function typeSummary(nodes) {
      const counts = {};
      for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
      return Object.keys(NODE_TYPES)
        .filter((id) => counts[id] !== undefined)
        .map((id) => `${NODE_TYPES[id].label} ${counts[id]}`)
        .join(' · ');
    }

    // ---- map/content.js ----
    // 节点内容：战斗构成、事件选项、商店货架与金币奖励。
    //
    // 内容在生成地图时一次性算好并写进 node.content，存档原样保存。
    // 这样玩家走过的路线、商店操作或战斗随机数调用都不会改变其他节点的内容。
    // 节点内容种子 = hash(主种子, 节点 ID, "content")，与拓扑重试种子无关。

    /** 事件模板：cost 与 effects 都是数据，结算在 map/run.js。 */
    const MAP_EVENT_TEMPLATES = Object.freeze([
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
    const MAP_SHOP_ITEMS = Object.freeze([
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
    function generateNodeContent(node, rng, config) {
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
    function fillNodeContent(nodes, seed, config) {
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
    function nodeBattlePlan(node) {
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
    function nodeSummary(node) {
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
    function pickEventTemplate(rng) {
      return pickWeighted(rng, MAP_EVENT_TEMPLATES.map((template) => [template, 1])) ?? MAP_EVENT_TEMPLATES[0];
    }

    /** 商店价格区间，供报告与平衡模拟使用。 */
    function shopPriceRange(floor, config) {
      const items = MAP_SHOP_ITEMS.slice(0, config.shop.items);
      const lowest = Math.min(...items.map((item) => item.price + floor * item.scale));
      const highest = Math.max(...items.map((item) => item.price + floor * item.scale));
      return { lowest: Math.round(lowest), highest: Math.round(highest) };
    }

    function eventGoldCostRange(floor) {
      const scale = 1 + floor * 0.04;
      return {
        lowest: Math.round(Math.min(16, 28, 36) * scale),
        highest: Math.round(Math.max(16, 28, 36) * scale),
      };
    }

    // ---- map/generate.js ----
    // 地图生成：尝试 → 修正 → 验证 → 保底模板。
    //
    // 每次新游戏用主种子生成整张地图。相同种子、版本与配置必须得到完全一致的
    // 结果；不同种子产生不同路线。生成失败时先换确定性重试种子，超过上限后使用
    // 同样经过验证的保底模板，绝不无限循环。

    /**
     * 锚点层：整排同类型的休息 / 商店。
     *
     * 为什么需要：随机权重无法满足逐路线约束。12% 休息权重下，一条长度为 12 的
     * 路线仍有约 22% 概率完全没有休息点；靠事后修补会把休息点挤成一串相邻层。
     * 因此休息与商店改为「整排锚点 + 层间距抖动」：任何路线每层必经过一个节点，
     * 所以只要锚点层间距不超过保底间隔，逐路线约束就成立，同时保留了层间距的随机性。
     */
    function planAnchorFloors(rng, config, byFloor = null) {
      const mode = config.anchors?.mode === 'node' ? 'node' : 'row';
      const occupied = new Set([1, config.depth - 1, config.depth]);
      const restFloors = new Set();
      const shopFloors = new Set();
      const restColumns = new Map();
      const shopColumns = new Map();
      const separation = Math.max(1, Math.floor(config.anchors?.minSeparation ?? 2));
      const tooClose = (floor) => {
        for (let offset = -separation; offset <= separation; offset += 1) {
          if (occupied.has(floor + offset)) return true;
        }
        return false;
      };
      const fill = (target, columns, spacing) => {
        const min = Math.max(1, Math.floor(spacing.min));
        const max = Math.max(min, Math.floor(spacing.max));
        let floor = 2 + rngInt(rng, min, max);
        while (floor <= config.depth - 2) {
          if (!tooClose(floor)) {
            target.add(floor);
            occupied.add(floor);
            if (mode === 'node') {
              const width = (byFloor?.get(floor) ?? []).length || config.width.min;
              columns.set(floor, rngInt(rng, 0, width - 1));
            }
            floor += rngInt(rng, min, max);
          } else {
            floor += 1;
          }
        }
      };
      fill(restFloors, restColumns, config.anchors.restSpacing);
      fill(shopFloors, shopColumns, config.anchors.shopSpacing);
      return { mode, restFloors, shopFloors, restColumns, shopColumns };
    }

    /**
     * 保底模板：确定性的「走廊」图。
     * 每隔 (restGap-1) 层整层休息、每隔 (shopGap-1) 层整层商店，其余普通怪，
     * 因此每条有效路线都必然满足间隔约束；精英只在允许的楼层出现。
     */
    function buildTemplateNodes(seed, config) {
      const rng = createRng(hashSeed(seed, 'template'));
      const { nodes, byFloor } = buildTopology(rng, config);
      // 比保底间隔更紧的步长，给「休息与商店同时到期」留出回旋余地。
      const restStep = Math.max(1, config.guards.restGap - 2);
      const shopStep = Math.max(1, config.guards.shopGap - 3);
      let lastRest = 1; // 第 1 层是普通战斗
      let lastShop = 1;
      let lastAnchor = 'shop';
      for (let floor = 2; floor <= config.depth - 2; floor += 1) {
        const restDue = floor - lastRest >= restStep;
        const shopDue = floor - lastShop >= shopStep;
        let type = 'normal';
        if (restDue && shopDue) {
          // 两者同时到期时交替，避免某一类被长期饿死；间距留了 2–3 层余量。
          type = lastAnchor === 'rest' ? 'shop' : 'rest';
        } else if (restDue) {
          type = 'rest';
        } else if (shopDue) {
          type = 'shop';
        }
        for (const node of byFloor.get(floor) ?? []) node.type = type;
        if (type === 'rest') {
          lastRest = floor;
          lastAnchor = 'rest';
        } else if (type === 'shop') {
          lastShop = floor;
          lastAnchor = 'shop';
        }
      }
      for (const node of nodes) {
        if (node.floor === 1) node.type = 'normal';
        else if (node.floor === config.depth) node.type = 'boss';
        else if (node.floor === config.depth - 1) node.type = 'rest';
      }
      return { nodes, byFloor };
    }

    function makeMap(seed, cfg, nodes, byFloor, meta) {
      return {
        mapVersion: cfg.version,
        seed,
        depth: cfg.depth,
        config: snapshotMapConfig(cfg),
        nodes,
        startId: byFloor.get(1)[0].id,
        bossId: byFloor.get(cfg.depth)[0].id,
        attempts: meta.attempts,
        fallback: meta.fallback === true,
        valid: meta.valid,
        errors: meta.errors ?? [],
        stats: meta.stats ?? null,
        diagnostics: meta.diagnostics ?? [],
      };
    }

    function generateMap({ seed = 1, config = {} } = {}) {
      const cfg = mapConfig(config === null || config === undefined ? {} : config);
      const diagnostics = [];
      const attempts = Math.max(1, cfg.attempts);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const attemptSeed = hashSeed(seed, 'attempt', attempt, cfg.version, cfg.depth);
        const topologyRng = createRng(hashSeed(attemptSeed, 'topology'));
        const typeRng = createRng(hashSeed(attemptSeed, 'node-types'));
        const anchorRng = createRng(hashSeed(attemptSeed, 'anchors'));
        const built = buildTopology(topologyRng, cfg);
        const nodes = built.nodes;
        const anchors = planAnchorFloors(anchorRng, cfg, built.byFloor);
        assignNodeTypes(nodes, typeRng, cfg, anchors);
        repairNodeTypes(nodes, cfg);
        const result = validateMap(nodes, cfg);
        diagnostics.push({
          attempt,
          ok: result.ok,
          errors: result.errors.slice(0, 3).map((error) => error.code),
        });
        if (result.ok) {
          fillNodeContent(nodes, seed, cfg);
          return makeMap(seed, cfg, nodes, built.byFloor, {
            attempts: attempt + 1,
            fallback: false,
            valid: true,
            stats: result.stats,
            diagnostics,
          });
        }
      }

      // 保底模板：结构与内容都确定，仍然走完整验证。
      const built = buildTemplateNodes(seed, cfg);
      repairNodeTypes(built.nodes, cfg);
      fillNodeContent(built.nodes, seed, cfg);
      const result = validateMap(built.nodes, cfg);
      return makeMap(seed, cfg, built.nodes, built.byFloor, {
        attempts,
        fallback: true,
        valid: result.ok,
        errors: result.errors,
        stats: result.stats,
        diagnostics,
      });
    }

    /** 生成结果的简短诊断文本，报告和存档提示共用。 */
    function describeGeneration(map) {
      if (map === null || map === undefined) return '没有地图';
      const parts = [`种子 ${map.seed}`, `v${map.mapVersion}`, `${map.depth} 层`];
      if (map.stats !== null && map.stats !== undefined) parts.push(`${map.stats.nodes} 节点`);
      parts.push(map.fallback ? '保底模板' : `第 ${map.attempts} 次尝试通过`);
      return parts.join(' · ');
    }

    // ---- map/run.js ----
    // 地图进度：本局状态、节点进入 / 结算、自动路线与存档。
    //
    // 地图只负责「下一步去哪、这一站给什么」，战斗仍然由 arena 负责。
    // 生命与金币跨节点保留，节点奖励只在完成时发放一次；失败重试不重复发奖。

    const RUN_INDEX = new WeakMap();

    function nodeIndex(run) {
      let map = RUN_INDEX.get(run);
      if (map === undefined) {
        map = indexNodeMap(run.nodes);
        RUN_INDEX.set(run, map);
      }
      return map;
    }

    function mapNode(run, id) {
      if (run === null || run === undefined) return null;
      return nodeIndex(run).get(id) ?? null;
    }

    function currentNode(run) {
      if (run === null || run === undefined) return null;
      return mapNode(run, run.currentNodeId);
    }

    function nodeStatus(run, id) {
      const state = run.nodeStates[id];
      return state === undefined ? 'unvisited' : state.status;
    }

    /** 当前可进入的下一层节点；当前节点还没结算时没有可选项。 */
    function availableNodeIds(run) {
      const node = currentNode(run);
      if (node === null) return [];
      if (nodeStatus(run, node.id) !== 'done') return [];
      return node.next.filter((id) => nodeStatus(run, id) === 'unvisited');
    }

    function availableNodes(run) {
      const ids = availableNodeIds(run);
      const out = [];
      for (const id of ids) {
        const node = mapNode(run, id);
        if (node !== null) out.push(node);
      }
      return out;
    }

    function createMapRun({
      seed = 1,
      config = {},
      map = null,
      gold = 0,
      life = null,
      lifeMax = 24,
      autoMode = 'balanced',
    } = {}) {
      const cfg = mapConfig(config === null || config === undefined ? {} : config);
      const generated = map ?? generateMap({ seed, config: cfg });
      const startId = generated.startId;
      const run = {
        mapVersion: generated.mapVersion,
        seed: generated.seed,
        depth: generated.depth,
        config: generated.config ?? snapshotMapConfig(cfg),
        nodes: generated.nodes,
        startId,
        bossId: generated.bossId,
        currentNodeId: startId,
        visited: [startId],
        nodeStates: { [startId]: { status: 'active' } },
        gold: Math.max(0, Math.floor(Number(gold) || 0)),
        lifeMax: Math.max(1, Math.floor(Number(lifeMax) || 24)),
        life: null,
        autoMode: AUTO_MODE_IDS.includes(autoMode) ? autoMode : 'balanced',
        failures: 0,
        finished: false,
        notice: '',
        generation: {
          attempts: generated.attempts ?? 1,
          fallback: generated.fallback === true,
          valid: generated.valid !== false,
        },
      };
      run.life = life === null || life === undefined
        ? run.lifeMax
        : Math.max(1, Math.min(run.lifeMax, Math.round(Number(life) || run.lifeMax)));
      return run;
    }

    /** 进入一个可选的下一层节点。返回 null 表示当前不可选。 */
    function beginNode(run, id) {
      if (nodeStatus(run, id) !== 'unvisited') return null;
      if (!availableNodeIds(run).includes(id)) return null;
      const node = mapNode(run, id);
      if (node === null) return null;
      run.currentNodeId = id;
      run.visited.push(id);
      run.nodeStates[id] = { status: 'active' };
      return node;
    }

    /** 非战斗节点的安全离开：不领取奖励，直接标记完成。 */
    function leaveNode(run, id = run.currentNodeId) {
      const node = mapNode(run, id);
      if (node === null || nodeStatus(run, id) !== 'active') return false;
      run.nodeStates[id] = { ...(run.nodeStates[id] ?? {}), status: 'done' };
      return true;
    }

    /**
     * 完成当前节点：写回生命、发放节点金币与奖励。
     * 同一节点只会发奖一次（重复调用返回 alreadyDone）。
     */
    function completeNode(run, id = run.currentNodeId, { life = null } = {}) {
      const node = mapNode(run, id);
      if (node === null) return null;
      const state = run.nodeStates[id] ?? { status: 'unvisited' };
      if (Number.isFinite(Number(life))) {
        run.life = Math.max(1, Math.min(run.lifeMax, Math.round(Number(life))));
      }
      if (state.status === 'done') return { node, alreadyDone: true, gold: 0, effects: [] };
      const reward = Math.max(0, Math.floor(Number(node.content?.gold) || 0));
      run.gold += reward;
      run.failures = 0;
      const effects = [];
      const draft = Math.max(0, Math.floor(Number(node.content?.draft) || 0));
      if (draft > 0) effects.push({ kind: 'draft', count: draft });
      run.nodeStates[id] = { ...state, status: 'done' };
      if (node.type === 'boss') run.finished = true;
      return { node, alreadyDone: false, gold: reward, effects };
    }

    /** 战斗失败：保留节点与构筑，只累计失败次数；奖励不会重复发放。 */
    function retryNode(run, id = run.currentNodeId) {
      if (nodeStatus(run, id) !== 'active') return run.failures;
      run.failures += 1;
      run.life = run.lifeMax;
      return run.failures;
    }

    function canPay(run, cost) {
      if (cost === null || cost === undefined) return true;
      if (Number.isFinite(cost.gold) && run.gold < cost.gold) return false;
      if (Number.isFinite(cost.lifeRatio)) {
        const price = Math.ceil(run.lifeMax * cost.lifeRatio);
        if (run.life - price < 1) return false;
      }
      return true;
    }

    function applyEffects(run, effects) {
      const external = [];
      for (const effect of effects ?? []) {
        if (effect === null || typeof effect !== 'object') continue;
        if (effect.kind === 'gold') {
          run.gold = Math.max(0, run.gold + Math.floor(Number(effect.amount) || 0));
        } else if (effect.kind === 'life') {
          run.life += Math.floor(Number(effect.amount) || 0);
        } else if (effect.kind === 'lifeRatio') {
          run.life += Math.round(run.lifeMax * (Number(effect.value) || 0));
        } else if (effect.kind === 'draft' || effect.kind === 'attributePoint') {
          external.push({ kind: effect.kind, count: Math.max(1, Math.floor(Number(effect.count) || 1)) });
        }
      }
      run.life = Math.max(1, Math.min(run.lifeMax, Math.round(run.life)));
      return external;
    }

    // ---- 休息点 ----

    function restOptions(run, id = run.currentNodeId) {
      const node = mapNode(run, id);
      const ratio = Number(node?.content?.healRatio) || 0.3;
      const heal = Math.max(1, Math.round(run.lifeMax * ratio));
      const healed = Math.min(run.lifeMax, run.life + heal);
      return [
        {
          id: 'heal',
          label: '恢复生命',
          desc: `恢复 ${heal} 点：${run.life} → ${healed}`,
          available: run.life < run.lifeMax,
          reason: run.life < run.lifeMax ? '' : '生命已满',
          effect: { kind: 'life', amount: heal },
        },
        {
          id: 'upgrade',
          label: '构筑强化',
          desc: '获得一次三选一，下一次战斗开始时生效',
          available: true,
          reason: '',
          effect: { kind: 'draft', count: 1 },
        },
        {
          id: 'leave',
          label: '安全离开',
          desc: '不做选择，继续前进',
          available: true,
          reason: '',
          effect: null,
        },
      ];
    }

    function resolveRest(run, id, choiceId) {
      const node = mapNode(run, id);
      if (node === null || node.type !== 'rest' || nodeStatus(run, id) !== 'active') {
        return { ok: false, reason: 'not-rest' };
      }
      const option = restOptions(run, id).find((entry) => entry.id === choiceId);
      if (option === undefined) return { ok: false, reason: 'unknown-option' };
      if (!option.available) return { ok: false, reason: option.reason || 'unavailable' };
      const effects = option.effect === null ? [] : applyEffects(run, [option.effect]);
      run.nodeStates[id] = { ...(run.nodeStates[id] ?? {}), status: 'done', choice: choiceId };
      return { ok: true, choice: choiceId, effects, message: option.label };
    }

    // ---- 事件点 ----

    function eventView(run, id = run.currentNodeId) {
      const node = mapNode(run, id);
      if (node === null || node.type !== 'event') return null;
      const content = node.content ?? {};
      const options = (content.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        costText: option.costText,
        resultText: option.resultText,
        text: option.text,
        available: nodeStatus(run, id) === 'active' && canPay(run, option.cost),
        reason: canPay(run, option.cost) ? '' : '资源不足',
      }));
      return {
        id: node.id,
        label: content.label ?? '事件',
        desc: content.desc ?? '',
        options,
      };
    }

    function resolveEvent(run, id, optionId) {
      const node = mapNode(run, id);
      if (node === null || node.type !== 'event' || nodeStatus(run, id) !== 'active') {
        return { ok: false, reason: 'not-event' };
      }
      const option = (node.content?.options ?? []).find((entry) => entry.id === optionId);
      if (option === undefined) return { ok: false, reason: 'unknown-option' };
      if (!canPay(run, option.cost)) return { ok: false, reason: 'cannot-pay' };
      const cost = option.cost ?? {};
      if (Number.isFinite(cost.gold)) run.gold = Math.max(0, run.gold - cost.gold);
      if (Number.isFinite(cost.lifeRatio)) {
        run.life = Math.max(1, run.life - Math.ceil(run.lifeMax * cost.lifeRatio));
      }
      const effects = applyEffects(run, option.effects);
      run.nodeStates[id] = { ...(run.nodeStates[id] ?? {}), status: 'done', choice: optionId };
      return { ok: true, choice: optionId, effects, text: option.text ?? '', message: option.label };
    }

    // ---- 商店 ----

    function shopView(run, id = run.currentNodeId) {
      const node = mapNode(run, id);
      if (node === null || node.type !== 'shop') return null;
      const purchases = run.nodeStates[id]?.purchases ?? [];
      return {
        id: node.id,
        items: (node.content?.items ?? []).map((item) => {
          const sold = purchases.includes(item.index);
          return {
            index: item.index,
            id: item.id,
            label: item.label,
            desc: item.desc,
            price: item.price,
            sold,
            available: !sold && nodeStatus(run, id) === 'active' && run.gold >= item.price,
          };
        }),
      };
    }

    function buyShopItem(run, id, index) {
      const node = mapNode(run, id);
      if (node === null || node.type !== 'shop' || nodeStatus(run, id) !== 'active') {
        return { ok: false, reason: 'not-shop' };
      }
      const item = (node.content?.items ?? []).find((entry) => entry.index === index);
      if (item === undefined) return { ok: false, reason: 'unknown-item' };
      const state = run.nodeStates[id] ?? { status: 'active' };
      const purchases = state.purchases ?? [];
      if (purchases.includes(index)) return { ok: false, reason: 'sold' };
      if (run.gold < item.price) return { ok: false, reason: 'no-gold' };
      run.gold -= item.price;
      const effects = applyEffects(run, [item.effect]);
      run.nodeStates[id] = { ...state, purchases: [...purchases, index] };
      return { ok: true, item, effects, message: item.label };
    }

    function leaveShop(run, id = run.currentNodeId) {
      return leaveNode(run, id);
    }

    // ---- 自动路线 ----

    const TYPE_SCORES = {
      steady: { normal: 3, rest: 6, event: 2, shop: 3, elite: -6, boss: 0 },
      balanced: { normal: 3, rest: 4, event: 3, shop: 3, elite: 1.5, boss: 0 },
      risky: { normal: 2, rest: 0, event: 3.5, shop: 2, elite: 5, boss: 0 },
    };

    function lookaheadTypes(run, node, steps) {
      const seen = new Set();
      const found = new Map();
      let frontier = node.next.map((id) => ({ id, depth: 1 }));
      while (frontier.length > 0) {
        const next = [];
        for (const entry of frontier) {
          if (entry.depth > steps) continue;
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          const target = mapNode(run, entry.id);
          if (target === null) continue;
          found.set(target.type, (found.get(target.type) ?? 0) + 1);
          for (const id of target.next) next.push({ id, depth: entry.depth + 1 });
        }
        frontier = next;
      }
      return found;
    }

    function scoreNode(run, node, mode, context) {
      const table = TYPE_SCORES[mode] ?? TYPE_SCORES.balanced;
      let score = table[node.type] ?? 0;
      const learned = lookaheadTypes(run, node, run.config?.auto?.lookahead ?? 3);
      const hasRestAhead = (learned.get('rest') ?? 0) > 0;

      if (node.type === 'rest' && context.lifeRatio < 0.55) score += 3;
      if (node.type === 'elite' && context.lifeRatio < 0.45) score -= 4;
      if (node.type === 'shop' && context.gold >= 70) score += 2;
      if (node.type === 'event' && context.lifeRatio < 0.3) score -= 1;
      if (mode !== 'risky' && (learned.get('elite') ?? 0) > 0 && context.lifeRatio < 0.5) score -= 1.5;
      if (context.lifeRatio < 0.6 && !hasRestAhead && node.type !== 'rest') score -= 1;
      if (mode === 'risky' && node.type === 'rest' && context.lifeRatio > 0.75) score -= 2;
      return score;
    }

    function pauseReason(run, options, context) {
      const limits = run.config?.auto ?? {};
      const lowLife = limits.pauseLowLife ?? 0.2;
      const allEliteLimit = limits.pauseAllElite ?? 0.35;
      if (options.length === 0) return 'no-options';
      if (context.lifeRatio <= lowLife && options.every((node) => node.type !== 'rest')) {
        return 'low-life-no-rest';
      }
      if (context.lifeRatio < allEliteLimit && options.every((node) => node.type === 'elite')) {
        return 'all-elite-low-life';
      }
      return null;
    }

    /**
     * 自动路线：返回 { nodeId, paused, reason, scores }。
     * manual 模式永远返回 paused=true（reason='manual'），由玩家自己点。
     * 自动时至少考虑未来 2–3 层的连线，而不是只看眼前一个节点。
     */
    function pickNextNode(run, profile = {}) {
      const mode = AUTO_MODE_IDS.includes(run.autoMode) ? run.autoMode : 'balanced';
      if (mode === 'manual') return { nodeId: null, paused: true, reason: 'manual', scores: [] };
      if (run.finished === true) return { nodeId: null, paused: true, reason: 'finished', scores: [] };
      const options = availableNodes(run);
      if (options.length === 0) return { nodeId: null, paused: true, reason: 'no-options', scores: [] };
      if (options.length === 1) {
        return { nodeId: options[0].id, paused: false, reason: 'single', scores: [] };
      }
      const lifeMax = Math.max(1, Number(profile.lifeMax ?? run.lifeMax) || run.lifeMax);
      const life = Math.max(0, Number(profile.life ?? run.life) || 0);
      const context = { lifeRatio: lifeMax > 0 ? life / lifeMax : 1, gold: run.gold };
      const scored = options.map((node) => ({
        node,
        score: scoreNode(run, node, mode, context),
      }));
      scored.sort((a, b) => (b.score - a.score) || (a.node.column - b.node.column));
      const blocked = pauseReason(run, options, context);
      if (blocked !== null) {
        return {
          nodeId: null,
          paused: true,
          reason: blocked,
          scores: scored.map((entry) => ({ nodeId: entry.node.id, score: entry.score })),
        };
      }
      return {
        nodeId: scored[0].node.id,
        paused: false,
        reason: mode,
        scores: scored.map((entry) => ({ nodeId: entry.node.id, score: entry.score })),
      };
    }

    function autoReasonText(reason) {
      if (reason === 'manual') return '手动路线：等你选择下一站';
      if (reason === 'no-options') return '当前没有可选节点';
      if (reason === 'finished') return '本局已经结束';
      if (reason === 'single') return '唯一路线，自动前进';
      if (reason === 'steady') return '稳健：优先恢复，避开精英';
      if (reason === 'balanced') return '均衡：兼顾恢复、商店与成长';
      if (reason === 'risky') return '冒险：优先精英与高风险事件';
      if (reason === 'low-life-no-rest') return '自动暂停：生命偏低且下一站没有休息点';
      if (reason === 'all-elite-low-life') return '自动暂停：可选节点全是精英且生命偏低';
      return '';
    }

    // ---- 存档 ----

    function serializeMapRun(run) {
      if (run === null || run === undefined) return null;
      return {
        mapVersion: run.mapVersion,
        seed: run.seed,
        depth: run.depth,
        config: run.config,
        nodes: run.nodes,
        startId: run.startId,
        bossId: run.bossId,
        currentNodeId: run.currentNodeId,
        visited: [...run.visited],
        nodeStates: run.nodeStates,
        gold: run.gold,
        life: run.life,
        lifeMax: run.lifeMax,
        autoMode: run.autoMode,
        failures: run.failures,
        finished: run.finished,
      };
    }

    /** 读档：结构不合法（版本不符、缺节点、指针指向不存在的节点）返回 null。 */
    function restoreMapRun(raw) {
      if (raw === null || raw === undefined || typeof raw !== 'object') return null;
      if (raw.mapVersion !== MAP_VERSION) return null;
      if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) return null;
      const cfg = mapConfig({ ...(raw.config ?? {}), depth: raw.depth ?? raw.config?.depth });
      const byId = indexNodeMap(raw.nodes);
      if (!byId.has(raw.startId) || !byId.has(raw.bossId)) return null;
      const currentNodeId = byId.has(raw.currentNodeId) ? raw.currentNodeId : raw.startId;
      const validation = validateMap(raw.nodes, cfg);
      if (!validation.ok) return null;
      const nodeStates = {};
      for (const [id, state] of Object.entries(raw.nodeStates ?? {})) {
        if (!byId.has(id) || state === null || typeof state !== 'object') continue;
        nodeStates[id] = { ...state };
      }
      const run = {
        mapVersion: raw.mapVersion,
        seed: raw.seed,
        depth: raw.depth,
        config: snapshotMapConfig(cfg),
        nodes: raw.nodes,
        startId: raw.startId,
        bossId: raw.bossId,
        currentNodeId,
        visited: Array.isArray(raw.visited) ? raw.visited.filter((id) => byId.has(id)) : [raw.startId],
        nodeStates,
        gold: Math.max(0, Math.floor(Number(raw.gold) || 0)),
        lifeMax: Math.max(1, Math.floor(Number(raw.lifeMax) || 24)),
        life: null,
        autoMode: AUTO_MODE_IDS.includes(raw.autoMode) ? raw.autoMode : 'balanced',
        failures: Math.max(0, Math.floor(Number(raw.failures) || 0)),
        finished: raw.finished === true,
        notice: '',
        generation: { attempts: 1, fallback: false, valid: true },
      };
      run.life = Math.max(1, Math.min(run.lifeMax, Math.round(Number(raw.life) || run.lifeMax)));
      return run;
    }

    /** 进度摘要：UI 顶部、存档卡片与报告共用。 */
    function mapRunSummary(run) {
      if (run === null || run === undefined) return null;
      const node = currentNode(run);
      return {
        seed: run.seed,
        depth: run.depth,
        floor: node === null ? 1 : node.floor,
        percent: Math.round(((node === null ? 1 : node.floor) / run.depth) * 100),
        currentId: run.currentNodeId,
        currentType: node === null ? null : node.type,
        currentLabel: node === null ? '' : NODE_TYPES[node.type]?.label ?? '',
        currentSummary: nodeSummary(node),
        status: nodeStatus(run, run.currentNodeId),
        gold: run.gold,
        life: run.life,
        lifeMax: run.lifeMax,
        autoMode: run.autoMode,
        autoLabel: AUTO_MODES[run.autoMode]?.label ?? '',
        failures: run.failures,
        finished: run.finished,
        visited: [...run.visited],
        generation: { ...(run.generation ?? {}) },
      };
    }

    /** 战斗节点的战斗构成；非战斗节点返回 null。 */
    function nodePlan(node) {
      return nodeBattlePlan(node);
    }

    function setAutoMode(run, mode) {
      if (!AUTO_MODE_IDS.includes(mode)) return false;
      run.autoMode = mode;
      return true;
    }

    // ---- arena.js ----
    // 战斗世界：位置、刷怪、走位、经验、抽选与胜负。
    //
    // 技能裁决全部在 src/game/skills/：这里只负责实体位置、敌人 AI 和战斗循环，
    // 并按架构规定的固定步长顺序调用运行时。相同初始状态、seed 和 dt 序列
    // 必须产生同一结果。

    const MAX_EXTRA = 18;
    const MAX_SKILLS = 2;

    const PLAYER_SPEED = 52;
    const PLAYER_RADIUS = 3;
    const CONTACT_PAD = 1.5;
    const ENEMY_ATTACK_INTERVAL = 1.6;
    const ENEMY_SPEED_PER_FLOOR = 0.6;
    const XP_PER_KILL_CAP = 6;

    // 暴击使用独立 RNG 流：刷怪与抽选继续走 battle.rng，加入暴击不会改变已有种子
    // 的刷怪顺序与三选一候选。
    const COMBAT_RNG_SALT = 0x9e3779b9;

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function mulberry32(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function spawnPoint(rng) {
      const edge = Math.floor(rng() * 4);
      if (edge === 0) return { x: rng() * ARENA.w, y: -6 };
      if (edge === 1) return { x: ARENA.w + 6, y: rng() * ARENA.h };
      if (edge === 2) return { x: rng() * ARENA.w, y: ARENA.h + 6 };
      return { x: -6, y: rng() * ARENA.h };
    }

    function normalizeCompile(build) {
      const pruned = pruneBuild(build);
      const compiled = compileBuild(pruned.build);
      if (pruned.removed.length > 0) {
        compiled.warnings.push({
          code: 'pruned-build',
          path: 'skills',
          message: '已移除失效组件：' + pruned.removed.join('、'),
        });
      }
      if (compiled.plans.length > 0) return compiled;
      const fallback = compileBuild(emptyBuild());
      return {
        ...fallback,
        errors: [
          ...compiled.errors,
          {
            code: 'empty-build',
            path: 'skills',
            message: '构筑没有可运行的动作，已临时使用基础飞弹',
          },
        ],
        warnings: [...compiled.warnings, ...fallback.warnings],
      };
    }

    function createBattle({
      floor = 1,
      build = emptyBuild(),
      seed = 1,
      extra = 0,
      level = 1,
      xp = 0,
      xpNext = 8,
      pending = 0,
      draftCount = 0,
      movementStrategy = 'auto',
      styleId = null,
      attributes = {},
      attributePoints = 0,
      bonuses = {},
      // 地图节点给出的战斗构成：{ def, modifier }。传入时不再查 15 层表。
      plan = null,
      // 地图跨节点保留的生命；不传则满生命开始。
      life = null,
    } = {}) {
      const def = plan !== null && plan !== undefined && plan.def !== undefined ? plan.def : floorDef(floor);
      const compiled = normalizeCompile(build);
      const modifier = plan !== null && plan !== undefined
        ? (plan.modifier ?? null)
        : floorModifier(floor);
      const allocated = normalizeAttributes(attributes);
      const combat = createCombatStats(allocated, bonuses);
      const carried = life === null || life === undefined ? Number.NaN : Number(life);
      const startCells = Number.isFinite(carried)
        ? Math.max(1, Math.min(combat.maxLife, Math.round(carried)))
        : combat.maxLife;
      const player = {
        id: 'player',
        kind: 'player',
        x: ARENA.w / 2,
        y: ARENA.h / 2,
        radius: PLAYER_RADIUS,
        cells: startCells,
        maxCells: combat.maxLife,
        speed: PLAYER_SPEED,
      };
      const battle = {
        def,
        floor,
        modifier,
        styleId,
        build: compiled.build,
        plans: compiled.plans,
        compileErrors: compiled.errors,
        compileWarnings: compiled.warnings,
        skills: createSkillInstances(compiled.plans, combat),
        player,
        attributes: allocated,
        attributePoints: Math.max(0, Math.floor(Number(attributePoints) || 0)),
        bonuses: bonuses === null || typeof bonuses !== 'object' ? {} : { ...bonuses },
        combat,
        enemies: [],
        entities: [],
        projectiles: [],
        orbitSwords: [],
        arcSwords: [],
        piercingSwords: [],
        swordArrays: [],
        traps: [],
        enemyShots: [],
        commands: [],
        delayed: [],
        displacements: [],
        nextDisplacementSeq: 1,
        rootBudget: new Map(),
        splitCasts: new Set(),
        echoCasts: new Set(),
        events: [],
        diagnostics: [],
        time: 0,
        state: 'fighting',
        rng: mulberry32(seed),
        seed,
        combatRng: mulberry32((seed ^ COMBAT_RNG_SALT) >>> 0),
        nextId: 1,
        nextEventId: 1,
        bounds: ARENA,
        stats: {
          damage: {},
          bySkill: {},
          reactions: {},
          casts: {},
          modifiers: {},
          overflow: 0,
          kills: 0,
          killsByType: {},
          crits: 0,
          critExtra: 0,
          mitigated: 0,
        },
        movement: createMovementState(compiled.plans, movementStrategy),
        total: 0,
        spawned: 0,
        kills: 0,
        extra: Math.min(MAX_EXTRA, Math.max(0, extra)),
        level,
        xp,
        xpNext,
        pending,
        draftCount,
        offer: null,
        surge: false,
        lastStage: stageLabel(compiled.build, draftCount),
      };
      battle.total = enemyTotal(def, { modifier, extra: battle.extra });
      if (battle.pending > 0) rollOffer(battle);
      return battle;
    }

    function enemySequence(battle) {
      return bagOf(battle.def.mix);
    }

    function spawnTick(battle) {
      const total = enemyTotal(battle.def, { modifier: battle.modifier, extra: battle.extra });
      battle.total = total;
      const interval = FLOOR_SECONDS / total;
      const bag = enemySequence(battle);
      while (battle.spawned < total && battle.time >= battle.spawned * interval) {
        const index = battle.spawned;
        const type = bag.length === 0 ? 'swarm' : bag[index % bag.length];
        const typeDef = enemyType(type);
        const finalSpawn = index === total - 1;
        const isElite = finalSpawn && (battle.modifier === 'elite' || battle.modifier === 'boss');
        const isBoss = finalSpawn && battle.modifier === 'boss';
        let cells = enemyCellsAt(battle.floor, type);
        if (battle.modifier === 'crowded') cells = Math.round(cells * 0.7);
        if (isBoss) cells = Math.round(cells * 3.4);
        else if (isElite) cells = Math.round(cells * 2.5);
        const at = spawnPoint(battle.rng);
        const radius = typeDef.radius + (isBoss ? 2 : isElite ? 1 : 0);
        const enemy = {
          id: battle.nextId++,
          kind: 'enemy',
          type,
          x: at.x,
          y: at.y,
          cells,
          maxCells: cells,
          radius,
          r: radius,
          speed: typeDef.speed * (1 + battle.floor * ENEMY_SPEED_PER_FLOOR * 0.02) * (battle.modifier === 'frenzy' ? 1.3 : 1) * (isBoss ? 1.12 : 1),
          damage: enemyDamageAt(battle.floor, type) + (battle.modifier === 'frenzy' ? 1 : 0) + (isBoss ? 2 : isElite ? 1 : 0),
          behavior: typeDef.behavior,
          preferredRange: typeDef.preferredRange ?? 0,
          shot: typeDef.shot ?? null,
          attackTimer: typeDef.attackInterval,
          statuses: {},
          dead: false,
          deathHandled: false,
          flash: 0,
          elite: isElite && !isBoss,
          boss: isBoss,
        };
        battle.enemies.push(enemy);
        battle.spawned += 1;
        if (battle.spawned === total && isBoss) battle.events.push({ type: 'boss', x: enemy.x, y: enemy.y });
        else if (battle.spawned === total && isElite) battle.events.push({ type: 'elite', x: enemy.x, y: enemy.y });
      }
    }

    function moveEnemy(battle, enemy, dt) {
      const player = battle.player;
      const speed = enemy.speed * slowFactor(enemy);
      if (enemy.behavior === 'kite') {
        const d = distance(enemy, player) || 1;
        const ideal = enemy.preferredRange;
        let vx = 0;
        let vy = 0;
        if (d < ideal - 6) {
          vx = (enemy.x - player.x) / d;
          vy = (enemy.y - player.y) / d;
        } else if (d > ideal + 6) {
          vx = (player.x - enemy.x) / d;
          vy = (player.y - enemy.y) / d;
        } else {
          vx = -(player.y - enemy.y) / d;
          vy = (player.x - enemy.x) / d;
        }
        enemy.x = clamp(enemy.x + vx * speed * dt, enemy.r, ARENA.w - enemy.r);
        enemy.y = clamp(enemy.y + vy * speed * dt, enemy.r, ARENA.h - enemy.r);
        return;
      }
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = enemy.r + PLAYER_RADIUS + CONTACT_PAD;
      if (d <= reach) return;
      const step = Math.min(speed * dt, d - reach);
      enemy.x += (dx / d) * step;
      enemy.y += (dy / d) * step;
    }

    function enemiesMove(battle, dt) {
      for (const enemy of battle.enemies) {
        if (enemy.cells <= 0 || enemy.dead) continue;
        enemy.flash = Math.max(0, enemy.flash - dt);
        moveEnemy(battle, enemy, dt);
      }
    }

    function hurtPlayer(battle, amount) {
      if (!(amount > 0) || battle.state !== 'fighting') return;
      // 护甲对当前所有敌人伤害统一生效；内部保留小数，界面显示时再取整。
      const taken = mitigateDamage(amount, battle.combat);
      if (!(taken > 0)) return;
      if (!battle.stats) battle.stats = {};
      battle.stats.mitigated = (battle.stats.mitigated ?? 0) + Math.max(0, amount - taken);
      battle.player.cells -= taken;
      battle.events.push({
        type: 'hurt',
        x: battle.player.x,
        y: battle.player.y,
        cells: taken,
        raw: amount,
      });
      if (battle.player.cells <= 0) {
        battle.player.cells = 0;
        battle.state = 'dead';
      }
    }

    function enemiesAttack(battle, dt) {
      const player = battle.player;
      for (const enemy of battle.enemies) {
        if (enemy.cells <= 0 || enemy.dead || battle.state !== 'fighting') continue;
        const d = distance(enemy, player);
        const inRange = enemy.behavior === 'kite' ? d <= 96 : d <= enemy.r + PLAYER_RADIUS + CONTACT_PAD + 1;
        if (!inRange) continue;
        enemy.attackTimer -= dt;
        if (enemy.attackTimer > 0) continue;
        enemy.attackTimer = enemy.behavior === 'kite' ? 2.4 : ENEMY_ATTACK_INTERVAL;
        if (enemy.behavior === 'kite' && enemy.shot !== null) {
          const dx = player.x - enemy.x;
          const dy = player.y - enemy.y;
          const length = Math.hypot(dx, dy) || 1;
          battle.enemyShots.push({
            id: battle.nextId++,
            x: enemy.x,
            y: enemy.y,
            vx: (dx / length) * enemy.shot.speed,
            vy: (dy / length) * enemy.shot.speed,
            life: enemy.shot.life,
            radius: enemy.shot.radius,
            damage: enemy.damage,
          });
          battle.events.push({ type: 'enemyShot', x: enemy.x, y: enemy.y });
          continue;
        }
        hurtPlayer(battle, enemy.damage);
      }
    }

    function updateEnemyShots(battle, dt) {
      const alive = [];
      for (const shot of battle.enemyShots) {
        shot.x += shot.vx * dt;
        shot.y += shot.vy * dt;
        shot.life -= dt;
        if (Math.hypot(shot.x - battle.player.x, shot.y - battle.player.y) <= shot.radius + PLAYER_RADIUS) {
          hurtPlayer(battle, shot.damage);
          continue;
        }
        if (shot.life > 0) alive.push(shot);
      }
      battle.enemyShots = alive;
    }

    function awardXp(battle, amount) {
      battle.xp += amount;
      while (battle.xp >= battle.xpNext) {
        battle.xp -= battle.xpNext;
        battle.level += 1;
        battle.xpNext = 6 + battle.level * 2;
        // 每次升级 +1 基础属性点；与技能三选一互相独立，同一次升级可以各拿一份。
        battle.attributePoints = (battle.attributePoints ?? 0) + 1;
        if (battle.level % 2 === 0) battle.pending += 1;
        battle.events.push({ type: 'levelUp', level: battle.level, points: battle.attributePoints });
      }
      rollOffer(battle);
    }

    function rollOffer(battle) {
      if (battle.offer !== null || battle.pending <= 0) return;
      const offer = offerUpgrades(battle.build, battle.rng, { draftCount: battle.draftCount });
      if (offer.length === 0) return;
      battle.offer = offer;
      battle.lastStage = stageLabel(battle.build, battle.draftCount);
      battle.events.push({ type: 'offer' });
    }

    function deathRound(battle) {
      const dead = battle.enemies.filter((enemy) => enemy.cells <= 0 && !enemy.deathHandled);
      if (dead.length === 0) return false;
      for (const enemy of dead) {
        enemy.deathHandled = true;
        battle.kills += 1;
        battle.stats.kills += 1;
        battle.stats.killsByType[enemy.type] = (battle.stats.killsByType[enemy.type] ?? 0) + 1;
        battle.events.push({ type: 'kill', x: enemy.x, y: enemy.y, id: enemy.id, enemyType: enemy.type });
        queueDeathReactions(battle, enemy);
        if (enemy.boss) {
          battle.pending += 2;
          battle.events.push({ type: 'bossDown', x: enemy.x, y: enemy.y });
        } else if (enemy.elite) {
          battle.pending += 1;
          battle.events.push({ type: 'eliteDown', x: enemy.x, y: enemy.y });
        }
        const xp = enemy.boss ? enemyType(enemy.type).xp * 5 : enemy.elite ? enemyType(enemy.type).xp * 3 : enemyType(enemy.type).xp;
        awardXp(battle, Math.min(XP_PER_KILL_CAP, xp));
      }
      battle.enemies = battle.enemies.filter((enemy) => !enemy.deathHandled);
      return true;
    }

    function processAllCommands(battle) {
      processCommands(battle);
      let rounds = 0;
      while (deathRound(battle) && rounds < 8) {
        rounds += 1;
        processCommands(battle);
      }
      if (rounds >= 8) diagnose(battle, 'death-rounds', { rounds });
    }

    function statusTicks(battle, dt) {
      const ticks = tickStatuses(battle, dt);
      for (const tick of ticks) {
        enqueue(battle, {
          type: 'statusDamage',
          targetId: tick.targetId,
          sourceEntityId: tick.sourceEntityId,
          skillInstanceId: tick.skillInstanceId,
          rootEventId: tick.rootEventId ?? undefined,
          tags: ['status', tick.statusId],
          // 持续伤害吃通用与条件加成，但不暴击。
          payload: { damage: tick.damage, statusId: tick.statusId, channel: 'dot', element: tick.element },
        });
      }
    }

    function checkEnd(battle) {
      if (battle.state !== 'fighting') return;
      if (battle.player.cells <= 0) {
        battle.state = 'dead';
        return;
      }
      const total = enemyTotal(battle.def, { modifier: battle.modifier, extra: battle.extra });
      if (battle.spawned >= total && battle.enemies.length === 0) {
        battle.state = 'cleared';
        if (battle.surge) {
          battle.surge = false;
          battle.pending += 1;
          rollOffer(battle);
          battle.events.push({ type: 'surgeReward' });
        }
        return;
      }
      if (battle.time >= TIME_LIMIT) battle.state = 'timeout';
    }

    /** 推进一帧，返回这一帧产生的事件。 */
    function step(battle, dt) {
      if (battle.state !== 'fighting') return [];
      ensureResolutionState(battle);
      battle.events = [];
      battle.time += dt;

      // 1. 推进状态计时，周期伤害变成命令
      statusTicks(battle, dt);

      // 2. 刷怪与位置（常规移动由独立策略层统一处理）
      spawnTick(battle);
      movePlayer(battle, dt);
      enemiesMove(battle, dt);

      // 3. 到期技能产生动作，位移请求裁决，实体推进与碰撞
      castDueSkills(battle, dt);
      resolveDisplacements(battle);
      updateEntities(battle, dt);
      advanceDelayed(battle);

      // 4. 处理命中、反应与后续命令
      processAllCommands(battle);

      // 5. 敌人攻击与敌方弹体
      if (battle.state === 'fighting') {
        enemiesAttack(battle, dt);
        updateEnemyShots(battle, dt);
      }

      checkEnd(battle);
      return battle.events;
    }

    /** 一直跑到结束，返回同一场战斗。dt 固定，保证可复现。 */
    function runToEnd(battle, { dt = 1 / 60, maxSeconds = 120 } = {}) {
      while (battle.state === 'fighting' && battle.time < maxSeconds) step(battle, dt);
      return battle;
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

    /** 切换移动策略；不改变已有构筑。 */
    function setMovementStrategy(battle, strategy) {
      battle.movement = createMovementState(battle.plans, strategy);
      return battle.movement.strategy;
    }

    /**
     * 重算战斗属性。属性点分配、装备变化后调用；
     * 已经飞出去的实体与延迟命令在命中结算时才读取，不做额外快照。
     */
    function recomputeCombat(battle) {
      const combat = createCombatStats(battle.attributes, battle.bonuses ?? {});
      battle.combat = combat;
      battle.player.maxCells = combat.maxLife;
      if (battle.player.cells > combat.maxLife) battle.player.cells = combat.maxLife;
      return combat;
    }

    /**
     * 自由分配基础属性点。
     * 最大生命提升时，当前生命同步增加相同数值（docs/character-attributes-design.md）。
     * 返回 false 表示属性未知或点数不足。
     */
    function allocateAttribute(battle, id, points = 1) {
      if (!ATTRIBUTE_IDS.includes(id)) return false;
      const spend = Math.max(1, Math.floor(Number(points) || 1));
      const available = Math.max(0, Math.floor(Number(battle.attributePoints) || 0));
      if (available < spend) return false;
      const attributes = normalizeAttributes(battle.attributes);
      attributes[id] += spend;
      battle.attributes = attributes;
      battle.attributePoints = available - spend;
      const beforeMax = battle.player.maxCells;
      const combat = recomputeCombat(battle);
      const gain = combat.maxLife - beforeMax;
      // 阵亡状态不再补血：本层已经结束，重试会从满生命开始。
      if (gain > 0 && battle.state !== 'dead') {
        battle.player.cells = Math.min(combat.maxLife, battle.player.cells + gain);
      }
      battle.events.push({ type: 'attribute', id, points: spend, value: attributes[id], combat });
      return true;
    }

    /** 属性与战斗属性的可读快照，供 UI、报告与测试读取。 */
    function attributeSummary(battle) {
      const attributes = normalizeAttributes(battle.attributes);
      const combat = battle.combat ?? createCombatStats(attributes, battle.bonuses ?? {});
      return {
        attributes: { ...attributes },
        spent: Object.values(attributes).reduce((sum, value) => sum + value, 0),
        points: Math.max(0, Math.floor(Number(battle.attributePoints) || 0)),
        combat,
        previews: ATTRIBUTE_IDS.map((id) => previewAttribute(attributes, id, battle.bonuses ?? {})),
        text: describeCombatStats(combat),
      };
    }

    /** 选中一张升级：装入组件、重编译、保留飞行中的计划快照。 */
    function chooseUpgrade(battle, id, placement) {
      if (battle.offer === null || !battle.offer.includes(id)) return false;
      const installed = installChoice(battle.build, id, placement);
      if (!installed.ok) {
        battle.lastUpgradeError = installed.reason ?? 'install-failed';
        return false;
      }
      const compiled = compileBuild(installed.build);
      if (!compiled.ok || compiled.plans.length === 0) return false;
      battle.build = compiled.build;
      battle.plans = compiled.plans;
      replaceSkillInstances(battle, compiled.plans);
      refreshMovementState(battle);
      battle.compileErrors = compiled.errors;
      battle.compileWarnings = [...compiled.warnings, ...(installed.warnings ?? [])];
      battle.offer = null;
      battle.pending = Math.max(0, battle.pending - 1);
      battle.draftCount += 1;
      battle.lastUpgradeError = null;
      battle.events.push({ type: 'upgrade', id });
      rollOffer(battle);
      return true;
    }

    /** 把备用栏组件装回战斗。 */
    function equipReserve(battle, id) {
      const result = equipReserveComponent(battle.build, id);
      if (!result.ok) return false;
      const compiled = compileBuild(result.build);
      if (!compiled.ok || compiled.plans.length === 0) return false;
      battle.build = compiled.build;
      battle.plans = compiled.plans;
      replaceSkillInstances(battle, compiled.plans);
      refreshMovementState(battle);
      battle.compileErrors = compiled.errors;
      battle.compileWarnings = [...compiled.warnings, ...(result.warnings ?? [])];
      battle.events.push({ type: 'upgrade', id });
      return true;
    }

    /** 当前技能计划的可读摘要，供 UI 与报告使用。 */
    function planSummary(battle) {
      return battle.plans.map((plan) => ({
        id: plan.id,
        label: plan.label,
        description: plan.description,
        color: plan.element === null ? plan.action.color : plan.element.color,
      }));
    }

    function upgradeChoices(battle) {
      if (battle.offer === null) return [];
      return battle.offer.map((id) => contentById(id)).filter((def) => def !== undefined);
    }
// </core>

    const VIEW_W = ARENA.w
    const VIEW_H = ARENA.h
    const STEP_SECONDS = 1 / 60
    const POLL_INTERVAL = 800
    const PAUSE_CLEAR = 1.1
    const PAUSE_FAIL = 3.2
    const TOKENS_PER_SPAWN = 500
    const TYPE_ID = 'dsh-pet'
    const KIND = 'pet'

    const COLORS = {
      bg: '#0a0d12',
      grid: '#18222e',
      frame: '#1c2733',
      player: '#cfe3ef',
      playerDark: '#7fa3b8',
      eye: '#0a0d12',
      bullet: '#ffd166',
      burn: '#ff9f45',
      chill: '#9fd8ff',
      charge: '#ffe066',
      enemyShot: '#e35d5d',
    }

    const KIND_LABELS = { action: '动作', element: '属性', modifier: '修饰' }
    const STATUS_ORDER = ['burn', 'chill', 'charge']

    const CSS = [
      '.dsh-pet{display:flex;flex-direction:column;gap:6px;padding:8px;color:#dbe7f0;font-size:11px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;height:100%;box-sizing:border-box;overflow-y:auto}',
      '.dsh-pet-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
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
      'justify-content:center;gap:4px;padding:8px;text-align:center;background:rgba(8,12,18,.74)}',
      '.dsh-pet-overlay-title{font-size:15px;letter-spacing:.18em}',
      '.dsh-pet-overlay-title.bad{color:#e35d5d}',
      '.dsh-pet-overlay-title.good{color:#6ee7a8}',
      '.dsh-pet-overlay-sub{font-size:10px;color:#9fb2c2;line-height:1.5}',
      '.dsh-pet-cells{height:4px;background:#18212b;border-radius:2px;overflow:hidden}',
      '.dsh-pet-body-rest{display:flex;flex-direction:column;gap:6px}',
      '.dsh-pet-cells i{display:block;height:100%;background:#6ee7a8;transition:width .12s linear}',
      '.dsh-pet-fold{display:flex;flex-direction:column;gap:2px}',
      '.dsh-pet-fold-head{display:flex;align-items:center;gap:4px;width:100%;font:inherit;font-size:10px;',
      'color:#7f93a3;background:transparent;border:1px solid #1d2935;border-radius:4px;padding:2px 5px;',
      'cursor:pointer;text-align:left}',
      '.dsh-pet-fold-head:hover{background:#111a24;border-color:#2a3a4a}',
      '.dsh-pet-fold-head.open{border-color:#2a3a4a;background:#0e151d}',
      '.dsh-pet-fold-caret{width:9px;flex:none;color:#6c8091}',
      '.dsh-pet-fold-title{color:#cfe3ef}',
      '.dsh-pet-fold-summary{margin-left:auto;font-size:9px;color:#7f93a3;white-space:nowrap;overflow:hidden;',
      'text-overflow:ellipsis}',
      '.dsh-pet-fold-body{display:flex;flex-direction:column;gap:3px;padding:4px 5px;background:#0e151d;',
      'border:1px solid #1d2935;border-radius:4px}',
      '.dsh-pet-attrs{display:flex;flex-direction:column;gap:2px}',
      '.dsh-pet-attrs-hint{font-size:8px;color:#6c8091;line-height:1.4}',
      '.dsh-pet-attr-row{display:flex;align-items:center;gap:4px;font-size:9px;line-height:1.3}',
      '.dsh-pet-attr-name{color:#cfe3ef;width:26px;flex:none}',
      '.dsh-pet-attr-points{color:#ffd166;font-weight:700;width:16px;text-align:right;flex:none}',
      '.dsh-pet-attr-btn{font:inherit;font-size:9px;line-height:1;color:#0a0d12;background:#6ee7a8;',
      'border:1px solid #6ee7a8;border-radius:3px;padding:2px 4px;cursor:pointer;flex:none}',
      '.dsh-pet-attr-btn:hover:not(:disabled){background:#8ff0bd}',
      '.dsh-pet-attr-btn:disabled{background:#1a2733;border-color:#24313d;color:#5f7282;cursor:default}',
      '.dsh-pet-attr-effect{color:#7f93a3;margin-left:auto;text-align:right}',
      '.dsh-pet-attrs-points{color:#ffd166;font-size:9px;flex:none}',
      '.dsh-pet-combat{font-size:9px;color:#a0e7c8;line-height:1.4}',
      '.dsh-pet-bottom{display:flex;gap:8px;color:#6c8091;font-size:10px;flex-wrap:wrap}',
      '.dsh-pet-hot{color:#e35d5d}',
      '.dsh-pet-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;gap:2px;pointer-events:none;animation:bannerIn .28s ease-out both}',
      '.dsh-pet-banner-text{font-size:16px;letter-spacing:.18em;color:#fff;text-shadow:0 0 6px rgba(255,209,102,.85)}',
      '.dsh-pet-banner-sub{font-size:10px;letter-spacing:.24em;color:#ffd166}',
      '@keyframes bannerIn{from{opacity:0;transform:scale(1.35)}to{opacity:1;transform:scale(1)}}',
      '@keyframes pointsPulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '.dsh-pet-points.ready{animation:pointsPulse 1.1s ease-in-out infinite}',
      '.dsh-pet-overlay{animation:overlayIn .16s ease-out}',
      '@keyframes overlayIn{from{opacity:0}to{opacity:1}}',
      '.dsh-pet-offer{position:absolute;left:5px;right:5px;bottom:5px;display:flex;flex-direction:column;gap:3px;',
      'background:rgba(10,14,20,.95);border:1px solid #2a3a4a;border-radius:5px;padding:5px;max-height:92%;overflow-y:auto}',
      '.dsh-pet-offer-title{font-size:9px;color:#ffd166;letter-spacing:.08em;display:flex;gap:6px;align-items:center}',
      '.dsh-pet-card{display:flex;flex-direction:column;gap:1px;text-align:left;font:inherit;font-size:10px;',
      'color:#dbe7f0;background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:3px 5px;cursor:pointer}',
      '.dsh-pet-card:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-card-head{display:flex;align-items:center;gap:5px}',
      '.dsh-pet-card-name{color:#ffd166;font-weight:700}',
      '.dsh-pet-card-desc{color:#8fa4b5;font-size:9px;line-height:1.4}',
      '.dsh-pet-kind{font-size:8px;color:#0a0d12;border-radius:3px;padding:0 3px;letter-spacing:.04em}',
      '.dsh-pet-slotpick{display:flex;flex-wrap:wrap;gap:3px;padding:2px 0 1px}',
      '.dsh-pet-slotpick button{font:inherit;font-size:9px;color:#cfe3ef;background:#1a2733;',
      'border:1px solid #31465a;border-radius:3px;padding:2px 5px;cursor:pointer}',
      '.dsh-pet-slotpick button:hover{background:#233748}',
      '.dsh-pet-build{display:flex;flex-direction:column;gap:2px}',
      '.dsh-pet-skill{background:#0e151d;border:1px solid #1d2935;border-radius:4px;padding:3px 5px;',
      'display:flex;flex-direction:column;gap:2px}',
      '.dsh-pet-skill-head{display:flex;justify-content:space-between;gap:6px;align-items:center}',
      '.dsh-pet-skill-name{color:#ffd166;font-weight:700;font-size:10px}',
      '.dsh-pet-skill-desc{color:#7f93a3;font-size:9px;line-height:1.4}',
      '.dsh-pet-slots{display:flex;gap:3px;flex-wrap:wrap}',
      '.dsh-pet-slot{font-size:9px;border-radius:3px;padding:1px 4px;border:1px solid #24313d;',
      'background:#111a24;color:#cfe3ef}',
      '.dsh-pet-slot.empty{color:#5f7282;border-style:dashed;background:transparent}',
      '.dsh-pet-reserve{display:flex;flex-wrap:wrap;gap:3px;align-items:center}',
      '.dsh-pet-chip{font:inherit;font-size:9px;color:#cfe3ef;background:#111a24;border:1px solid #24313d;',
      'border-radius:3px;padding:1px 5px;cursor:pointer}',
      '.dsh-pet-chip:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-chip:disabled{opacity:.4;cursor:default}',
      '.dsh-pet-notice{font-size:9px;color:#ffd166;background:#161f16;border:1px solid #2f4a2f;',
      'border-radius:4px;padding:2px 5px;cursor:pointer;line-height:1.4}',
      '.dsh-pet-style-row{display:flex;flex-wrap:wrap;gap:3px;align-items:center}',
      '.dsh-pet-style{font:inherit;font-size:9px;color:#cfe3ef;background:#111a24;border:1px solid #24313d;',
      'border-radius:3px;padding:1px 5px;cursor:pointer}',
      '.dsh-pet-style:hover:not(:disabled){background:#16222e;border-color:#3a5470}',
      '.dsh-pet-style.on{color:#0a0d12;background:#ffd166;border-color:#ffd166}',
      '.dsh-pet-style:disabled{opacity:.35;cursor:default}',
      '.dsh-pet-reactions{color:#a0e7c8;font-size:9px}',
      '.dsh-pet-menu{flex:1;min-height:0;display:flex;flex-direction:column;gap:5px;',
      'padding:8px;background:rgba(6,10,16,.95);overflow-y:auto;text-align:left;animation:overlayIn .16s ease-out}',
      '.dsh-pet-menu-title{font-size:16px;letter-spacing:.18em;color:#ffd166;text-align:center;margin-top:2px}',
      '.dsh-pet-menu-sub{font-size:9px;color:#8fa4b5;text-align:center;line-height:1.5;margin-bottom:2px}',
      '.dsh-pet-menu-actions{display:flex;gap:4px;flex-wrap:wrap}',
      '.dsh-pet-menu-btn{font:inherit;font-size:10px;color:#cfe3ef;background:#111a24;border:1px solid #2a3a4a;',
      'border-radius:4px;padding:4px 7px;cursor:pointer}',
      '.dsh-pet-menu-btn:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-menu-btn.primary{color:#0a0d12;background:#ffd166;border-color:#ffd166;font-weight:700}',
      '.dsh-pet-menu-btn.primary:hover{background:#ffe08a}',
      '.dsh-pet-menu-btn.on{color:#0a0d12;background:#6ee7a8;border-color:#6ee7a8;font-weight:700}',
      '.dsh-pet-menu-btn.on:hover{background:#8ff0bd}',
      '.dsh-pet-menu-btn.danger{color:#ffb4b4;border-color:#573030}',
      '.dsh-pet-menu-btn:disabled{opacity:.35;cursor:default}',
      '.dsh-pet-menu-head{font-size:9px;color:#7f93a3;letter-spacing:.08em;margin-top:1px}',
      '.dsh-pet-menu-debug{border-top:1px solid #1d2935;padding-top:4px;margin-top:1px;',
      'display:flex;flex-direction:column;gap:3px}',
      '.dsh-pet-menu-debug-row{display:flex;align-items:center;gap:5px;justify-content:space-between}',
      '.dsh-pet-menu-hint{font-size:8px;color:#7f93a3;line-height:1.4}',
      '.dsh-pet-menu-slot{background:#0e151d;border:1px solid #1d2935;border-radius:4px;padding:4px 5px;',
      'display:flex;flex-direction:column;gap:3px}',
      '.dsh-pet-menu-slot.on{border-color:#3f5a36;background:#111b16}',
      '.dsh-pet-menu-slot.empty{opacity:.72}',
      '.dsh-pet-menu-slot-head{display:flex;align-items:center;gap:5px}',
      '.dsh-pet-menu-slot-name{color:#ffd166;font-weight:700;font-size:10px}',
      '.dsh-pet-menu-slot-time{margin-left:auto;color:#6c8091;font-size:9px}',
      '.dsh-pet-menu-tag{font-size:8px;color:#0a0d12;background:#6ee7a8;border-radius:3px;padding:0 3px}',
      '.dsh-pet-menu-slot-desc{font-size:9px;color:#9fb2c2;line-height:1.45}',
      '.dsh-pet-menu-slot-actions{display:flex;gap:3px;flex-wrap:wrap;align-items:center}',
      '.dsh-pet-menu-slot-actions .dsh-pet-menu-btn{font-size:9px;padding:2px 6px}',
      '.dsh-pet-menu-warn{font-size:9px;color:#ffb4b4;line-height:1.35}',
      '.dsh-pet-menu-msg{font-size:9px;color:#a0e7c8;line-height:1.4}',
      '.dsh-pet-menu-label{font-size:9px;color:#7f93a3;margin-top:2px}',
      '.dsh-pet-menu-slotpick{font:inherit;font-size:9px;color:#cfe3ef;background:#111a24;border:1px solid #24313d;',
      'border-radius:3px;padding:3px 5px;cursor:pointer;text-align:left;line-height:1.4}',
      '.dsh-pet-menu-slotpick:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-menu-slotpick.on{color:#ffd166;border-color:#ffd166;background:#1a1d16}',
      '.dsh-pet-menu-slotpick:disabled{opacity:.35;cursor:default}',
      '.dsh-pet-menu-foot{font-size:8px;color:#5f7282;line-height:1.45;margin-top:auto;padding-top:2px}',
      '.dsh-pet-map{display:flex;flex-direction:column;gap:3px}',
      '.dsh-pet-map-body{display:flex;flex-direction:column;gap:1px;max-height:168px;overflow-y:auto;',
      'padding:3px 4px;background:#0b1219;border:1px solid #1d2935;border-radius:4px}',
      '.dsh-pet-map-floor{display:flex;align-items:center;gap:2px;font-size:8px;color:#4f6272;',
      'line-height:1.3;min-height:14px}',
      '.dsh-pet-map-floor.cur{color:#ffd166}',
      '.dsh-pet-map-floor-n{width:14px;flex:none;text-align:right}',
      '.dsh-pet-node{font:inherit;font-size:8px;line-height:1.2;color:#8296a8;background:#0e151d;',
      'border:1px solid #1b2733;border-radius:3px;padding:0 3px;cursor:pointer;white-space:nowrap}',
      '.dsh-pet-node:hover{border-color:#3a5470}',
      '.dsh-pet-node.visited{color:#cfe3ef;border-color:#2a3a4a;background:#111a24}',
      '.dsh-pet-node.cur{color:#0a0d12;background:#ffd166;border-color:#ffd166;font-weight:700}',
      '.dsh-pet-node.pick{color:#0a0d12;background:#6ee7a8;border-color:#6ee7a8;font-weight:700}',
      '.dsh-pet-node.pick:hover{background:#8ff0bd}',
      '.dsh-pet-node.dim{opacity:.4}',
      '.dsh-pet-node.inspected{outline:1px dashed #8fd8ff;outline-offset:1px}',
      '.dsh-pet-map-detail{font-size:8px;color:#9fb2c2;line-height:1.5;background:#0e151d;',
      'border:1px solid #1d2935;border-radius:4px;padding:3px 5px}',
      '.dsh-pet-map-notice{font-size:9px;color:#ffd166;line-height:1.4}',
      '.dsh-pet-choices{display:flex;flex-wrap:wrap;gap:3px;align-items:center;font-size:9px;color:#7f93a3}',
      '.dsh-pet-choice{font:inherit;font-size:9px;color:#0a0d12;background:#6ee7a8;border:1px solid #6ee7a8;',
      'border-radius:3px;padding:1px 5px;cursor:pointer}',
      '.dsh-pet-choice:hover{background:#8ff0bd}',
      '.dsh-pet-mode{display:flex;gap:2px;flex-wrap:wrap;align-items:center;font-size:8px;color:#7f93a3}',
      '.dsh-pet-mode button{font:inherit;font-size:8px;color:#9fb2c2;background:#111a24;',
      'border:1px solid #24313d;border-radius:3px;padding:1px 4px;cursor:pointer}',
      '.dsh-pet-mode button:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-mode button.on{color:#0a0d12;background:#8fd8ff;border-color:#8fd8ff;font-weight:700}',
      '.dsh-pet-node-panel{position:absolute;left:5px;right:5px;bottom:5px;display:flex;flex-direction:column;',
      'gap:3px;background:rgba(10,14,20,.96);border:1px solid #2a3a4a;border-radius:5px;padding:5px;',
      'max-height:94%;overflow-y:auto}',
      '.dsh-pet-node-head{font-size:10px;color:#ffd166;display:flex;gap:5px;align-items:center;flex-wrap:wrap}',
      '.dsh-pet-node-desc{font-size:9px;color:#8fa4b5;line-height:1.45}',
      '.dsh-pet-node-option{display:flex;flex-direction:column;gap:1px;text-align:left;font:inherit;font-size:9px;',
      'color:#dbe7f0;background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:3px 5px;cursor:pointer}',
      '.dsh-pet-node-option:hover:not(:disabled){background:#16222e;border-color:#3a5470}',
      '.dsh-pet-node-option:disabled{opacity:.45;cursor:default}',
      '.dsh-pet-node-option b{color:#ffd166;font-size:10px;font-weight:700}',
      '.dsh-pet-node-option span{color:#7f93a3;font-size:9px;line-height:1.4}',
    ].join('')

    // ---- 存档 ----

    // 一个工作区三个存档槽位。槽位 1 沿用 v5 原键，额外槽位加后缀，
    // 因此旧版存档仍能直接读取，不需要破坏性迁移。
    const SAVE_PREFIX = 'dsh.pet.v5.'
    const PREVIOUS_PREFIX = 'dsh.pet.v4.'
    const LEGACY_PREFIX = 'dsh.pet.v3.'
    const BACKUP_SUFFIX = '.bak'
    const ACTIVE_SUFFIX = '.active'
    const SLOT_SUFFIX = '.slot'
    const SAVE_SLOTS = 3
    const DEBUG_KEY = 'dsh.pet.debug'

    const toInt = (value, min, fallback) => {
      const n = Math.floor(Number(value))
      return Number.isFinite(n) && n >= min ? n : fallback
    }

    function normalizeSlot(value) {
      const n = Math.floor(Number(value))
      return Number.isFinite(n) && n >= 0 && n < SAVE_SLOTS ? n : 0
    }

    function saveKey(key, slot) {
      const index = normalizeSlot(slot)
      return SAVE_PREFIX + key + (index === 0 ? '' : SLOT_SUFFIX + (index + 1))
    }

    function activeSlotKey(key) {
      return SAVE_PREFIX + key + ACTIVE_SUFFIX
    }

    function emptyStats() {
      return { kills: 0, bestFloor: 1, maxFloorKills: 0, drafts: 0 }
    }

    function emptyAccount() {
      const style = defaultStyle()
      return {
        build: buildFromStyle(style),
        style: style.id,
        movement: style.movementPreference,
        stats: emptyStats(),
        floor: 1,
        best: 1,
        level: 1,
        xp: 0,
        xpNext: 8,
        pending: 0,
        draftCount: 0,
        attributes: emptyAttributes(),
        attributePoints: 0,
        notice: '',
        map: null,
      }
    }

    function readStore(key) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return null
        const raw = store.getItem(key)
        if (raw === null) return null
        return JSON.parse(raw)
      } catch {
        return null
      }
    }

    function removeStore(key) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return false
        if (typeof store.removeItem === 'function') store.removeItem(key)
        else if (typeof store.setItem === 'function') store.setItem(key, '')
        return true
      } catch {
        return false
      }
    }

    /** 开发者调试开关：本机全局，不写入存档、不计入累计战绩。 */
    function debugEnabled() {
      const value = readStore(DEBUG_KEY)
      return value === true || value === 1 || value === '1'
    }

    function setDebugEnabled(value) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return false
        store.setItem(DEBUG_KEY, JSON.stringify(value === true))
        return true
      } catch {
        return false
      }
    }

    function styleAvailable(style, stats) {
      if (style === undefined) return false
      return debugEnabled() || isStyleUnlocked(style, stats)
    }

    /** 存档里的风格解析；开发者模式可以保留原本锁定的风格。 */
    function resolveAccountStyle(id, stats) {
      const style = styleById(id)
      if (style !== undefined && styleAvailable(style, stats)) return style
      return defaultStyle()
    }

    function backupSave(key, slot, saved) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return
        store.setItem(saveKey(key, slot) + BACKUP_SUFFIX, JSON.stringify(saved))
      } catch {
        // 备份失败不能阻止读档；原存档在修复前仍未被覆盖
      }
    }

    function normalizeMovement(value, style) {
      return MOVEMENT_STRATEGIES.includes(value) ? value : style.movementPreference
    }

    function applyOwnedBuild(key, slot, account, saved, style, { backup } = {}) {
      const hasBuild =
        saved.build !== null && typeof saved.build === 'object' && Array.isArray(saved.build.skills)
      if (hasBuild) {
        const pruned = pruneBuild(saved.build)
        account.build = pruned.build
        if (pruned.removed.length > 0) {
          if (backup === true) backupSave(key, slot, saved)
          account.notice = '旧构筑里有已移除的组件，已安全清空：' + pruned.removed.join('、')
        }
      } else {
        account.build = buildFromStyle(style)
      }
    }

    function normalizeStats(raw) {
      const src = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        kills: toInt(src.kills, 0, 0),
        bestFloor: toInt(src.bestFloor, 1, 1),
        maxFloorKills: toInt(src.maxFloorKills, 0, 0),
        drafts: toInt(src.drafts, 0, 0),
      }
    }

    function mergeStats(a, b) {
      const left = normalizeStats(a)
      const right = normalizeStats(b)
      return {
        kills: Math.max(left.kills, right.kills),
        bestFloor: Math.max(left.bestFloor, right.bestFloor),
        maxFloorKills: Math.max(left.maxFloorKills, right.maxFloorKills),
        drafts: Math.max(left.drafts, right.drafts),
      }
    }

    /**
     * 属性存档迁移：没有属性字段的旧档，已投入按 0 算，可分配点数按等级准确推算
     * （1 级 0 点，每升 1 级 +1）。旧档没有花过点，所以这不是补发，而是还原。
     */
    function readAttributes(saved, level) {
      const attributes = normalizeAttributes(saved.attributes)
      const fallback = unspentPointsFor(level, attributes)
      const stored = saved.attributePoints === undefined || saved.attributePoints === null
        ? fallback
        : toInt(saved.attributePoints, 0, fallback)
      return { attributes, attributePoints: Math.max(0, stored) }
    }

    /**
     * 旧存档迁移：把玩家放到存档记录的那一层。
     * 地图本身由种子重新生成（旧档没有地图数据），进度从该层继续。
     */
    function migrateMapRun(floor, seed, lifeMax = 24) {
      const run = createMapRun({ seed, lifeMax, autoMode: 'balanced' })
      const targetFloor = Math.max(1, Math.min(run.depth - 1, Math.floor(Number(floor) || 1)))
      const row = run.nodes
        .filter((node) => node.floor === targetFloor)
        .sort((a, b) => a.column - b.column)
      const node = row[0] ?? run.nodes.find((entry) => entry.id === run.startId)
      if (node === undefined) return run
      run.currentNodeId = node.id
      run.visited = [node.id]
      run.nodeStates = { [node.id]: { status: 'active' } }
      run.life = run.lifeMax
      return run
    }

    /** 读档里的地图；版本或结构不符时按存档层数重新生成，而不是让整份存档失效。 */
    function readMapState(saved) {
      const restored = restoreMapRun(saved.map)
      if (restored !== null) return { map: restored, notice: '' }
      const floor = Math.max(1, Math.min(MAP_DEPTH - 1, toInt(saved.floor, 1, 1)))
      const seed = hashSeed('dsh-pet-map', Number(saved.savedAt) || 0, floor)
      const hadMap = saved.map !== undefined && saved.map !== null
      return {
        map: migrateMapRun(floor, seed),
        notice: hadMap ? '地图存档无法读取，已按存档层数重新生成' : '',
      }
    }

    function loadAccount(key, slot = 0, options = {}) {
      const index = normalizeSlot(slot)
      const backup = options === null || options === undefined || options.backup !== false
      const account = emptyAccount()
      const saved = readStore(saveKey(key, index))
      if (saved !== null && typeof saved === 'object') {
        account.stats = normalizeStats(saved.stats)
        const style = resolveAccountStyle(saved.style, account.stats)
        account.style = style.id
        account.movement = normalizeMovement(saved.movement, style)
        account.floor = Math.min(MAX_FLOOR, toInt(saved.floor, 1, 1))
        account.best = Math.max(account.floor, toInt(saved.best, 1, account.floor))
        account.stats.bestFloor = Math.max(account.stats.bestFloor, account.best)
        account.level = toInt(saved.level, 1, 1)
        account.xp = toInt(saved.xp, 0, 0)
        account.xpNext = Math.max(1, toInt(saved.xpNext, 1, 8))
        account.pending = toInt(saved.pending, 0, 0)
        account.draftCount = toInt(saved.draftCount, 0, 0)
        const growth = readAttributes(saved, account.level)
        account.attributes = growth.attributes
        account.attributePoints = growth.attributePoints
        applyOwnedBuild(key, index, account, saved, style, { backup })
        const mapState = readMapState(saved)
        account.map = mapState.map
        if (mapState.notice !== '') {
          account.notice = account.notice === '' ? mapState.notice : account.notice + ' ' + mapState.notice
        }
        const summary = mapRunSummary(account.map)
        account.floor = summary.floor
        account.best = Math.max(account.best, summary.floor)
        return account
      }

      // 旧版迁移只发生在第一个槽位，额外槽位永远是干净的新存档。
      if (index !== 0) return account

      const previous = readStore(PREVIOUS_PREFIX + key)
      if (previous !== null && typeof previous === 'object') {
        // v4 账户迁移：构筑与进度原样保留，只补齐风格与移动策略；v4 键不删除。
        account.stats = normalizeStats(previous.stats)
        const style = resolveAccountStyle(previous.style, account.stats)
        account.style = style.id
        account.movement = normalizeMovement(previous.movement, style)
        account.floor = Math.min(MAX_FLOOR, toInt(previous.floor, 1, 1))
        account.best = Math.max(account.floor, toInt(previous.best, 1, account.floor))
        account.stats.bestFloor = Math.max(account.stats.bestFloor, account.best)
        account.level = toInt(previous.level, 1, 1)
        account.xp = toInt(previous.xp, 0, 0)
        account.xpNext = Math.max(1, toInt(previous.xpNext, 1, 8))
        account.pending = toInt(previous.pending, 0, 0)
        account.draftCount = toInt(previous.draftCount, 0, 0)
        const growth = readAttributes(previous, account.level)
        account.attributes = growth.attributes
        account.attributePoints = growth.attributePoints
        applyOwnedBuild(key, index, account, previous, style, { backup: false })
        account.map = readMapState(previous).map
        account.floor = mapRunSummary(account.map).floor
        const pruneNotice = account.notice
        account.notice =
          'v4 存档已迁移到 v5：构筑与进度保留，新增风格/移动策略使用默认值。' +
          (pruneNotice === '' ? '' : ' ' + pruneNotice)
        return account
      }

      const legacy = readStore(LEGACY_PREFIX + key)
      if (legacy !== null && typeof legacy === 'object') {
        // 旧卡牌/属性/核心不硬映射为新组件：只保留与旧系统无冲突的累计战绩。
        account.stats = normalizeStats(legacy.stats)
        account.best = account.stats.bestFloor
        account.map = migrateMapRun(1, hashSeed('dsh-pet-map', 'legacy', account.best))
        account.floor = 1
        account.notice = '旧版存档已迁移：旧构筑与属性不再适用，只保留累计战绩。'
      }
      return account
    }

    function saveAccount(entry) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return
        const slot = normalizeSlot(entry.slot)
        entry.slot = slot
        store.setItem(
          saveKey(entry.key, slot),
          JSON.stringify({
            version: 7,
            slot,
            savedAt: Date.now(),
            style: entry.style,
            movement: entry.movement,
            build: entry.build,
            stats: entry.stats,
            floor: entry.floor,
            best: entry.best,
            level: entry.level,
            xp: entry.xp,
            xpNext: entry.xpNext,
            pending: entry.pending,
            draftCount: entry.draftCount,
            attributes: normalizeAttributes(entry.attributes),
            attributePoints: Math.max(0, Math.floor(Number(entry.attributePoints) || 0)),
            map: serializeMapRun(entry.map),
          }),
        )
        store.setItem(activeSlotKey(entry.key), String(slot))
      } catch {
        // 存档失败不能打断战斗
      }
    }

    /** 手动保存前把战斗内已经结算的成长同步到账户字段。 */
    function saveProgress(entry) {
      const battle = entry.battle
      if (battle !== null) {
        entry.build = battle.build
        entry.level = battle.level
        entry.xp = battle.xp
        entry.xpNext = battle.xpNext
        entry.pending = battle.pending
        entry.draftCount = battle.draftCount
        entry.attributes = { ...battle.attributes }
        entry.attributePoints = battle.attributePoints
        if (entry.map !== null) {
          entry.map.lifeMax = battle.combat.maxLife
          entry.map.life = Math.max(1, Math.min(entry.map.lifeMax, Math.ceil(battle.player.cells)))
        }
      }
      saveAccount(entry)
    }

    function slotHasSave(key, slot) {
      const index = normalizeSlot(slot)
      if (readStore(saveKey(key, index)) !== null) return true
      if (index !== 0) return false
      return readStore(PREVIOUS_PREFIX + key) !== null || readStore(LEGACY_PREFIX + key) !== null
    }

    function makeSaveInfo(key, slot, saved, legacyLabel) {
      const stats = normalizeStats(saved.stats)
      const style = resolveAccountStyle(saved.style, stats)
      const floor = Math.min(MAP_DEPTH, toInt(saved.floor, 1, 1))
      const best = Math.max(floor, toInt(saved.best, 1, Math.max(1, stats.bestFloor)))
      const level = toInt(saved.level, 1, 1)
      const growth = readAttributes(saved, level)
      const map = saved.map !== null && typeof saved.map === 'object' ? saved.map : null
      const depth = map !== null && Number.isFinite(map.depth) ? map.depth : MAP_DEPTH
      const gold = map !== null && Number.isFinite(map.gold) ? Math.max(0, Math.floor(map.gold)) : 0
      return {
        slot,
        empty: false,
        legacy: legacyLabel !== '',
        legacyLabel,
        style: style.id,
        styleLabel: style.label,
        floor,
        depth,
        gold,
        best,
        level,
        kills: stats.kills,
        drafts: stats.drafts,
        attributePoints: growth.attributePoints,
        skills: saved.build !== null && typeof saved.build === 'object' && Array.isArray(saved.build.skills)
          ? saved.build.skills.length
          : 0,
        savedAt: Number.isFinite(Number(saved.savedAt)) ? Number(saved.savedAt) : 0,
      }
    }

    /** 只读摘要：列表与开局界面不触发构筑修复或写盘。 */
    function saveInfo(key, slot) {
      const index = normalizeSlot(slot)
      const saved = readStore(saveKey(key, index))
      if (saved !== null && typeof saved === 'object' && !Array.isArray(saved)) {
        return makeSaveInfo(key, index, saved, '')
      }
      if (index !== 0) return { slot: index, empty: true, savedAt: 0 }
      const previous = readStore(PREVIOUS_PREFIX + key)
      if (previous !== null && typeof previous === 'object') {
        return makeSaveInfo(key, 0, previous, 'v4')
      }
      const legacy = readStore(LEGACY_PREFIX + key)
      if (legacy !== null && typeof legacy === 'object') {
        const stats = normalizeStats(legacy.stats)
        return {
          slot: 0,
          empty: false,
          legacy: true,
          legacyLabel: 'v3',
          style: defaultStyle().id,
          styleLabel: defaultStyle().label,
          floor: 1,
          best: Math.max(1, stats.bestFloor),
          level: 1,
          kills: stats.kills,
          drafts: stats.drafts,
          skills: 0,
          savedAt: 0,
        }
      }
      return { slot: 0, empty: true, savedAt: 0 }
    }

    function listSaveSlots(key) {
      const slots = []
      for (let slot = 0; slot < SAVE_SLOTS; slot += 1) slots.push(saveInfo(key, slot))
      return slots
    }

    function latestSlot(key) {
      let best = -1
      let bestAt = -1
      for (let slot = 0; slot < SAVE_SLOTS; slot += 1) {
        const info = saveInfo(key, slot)
        if (info.empty) continue
        if (best < 0 || info.savedAt >= bestAt) {
          best = slot
          bestAt = info.savedAt
        }
      }
      return best
    }

    function activeSlot(key) {
      const value = readStore(activeSlotKey(key))
      const slot = Number(value)
      return Number.isInteger(slot) && slot >= 0 && slot < SAVE_SLOTS ? slot : -1
    }

    /** 自动保存目标优先；标记丢失或指向空槽时退回最近存档。 */
    function preferredSlot(key) {
      const active = activeSlot(key)
      if (active >= 0 && slotHasSave(key, active)) return active
      return latestSlot(key)
    }

    function removeSave(key, slot) {
      const index = normalizeSlot(slot)
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return false
        removeStore(saveKey(key, index))
        removeStore(saveKey(key, index) + BACKUP_SUFFIX)
        if (index === 0) {
          // 明确删除存档时，连同旧版源档一起清理，避免删除后旧档又“复活”。
          removeStore(PREVIOUS_PREFIX + key)
          removeStore(LEGACY_PREFIX + key)
        }
        const active = readStore(activeSlotKey(key))
        if (active !== null && Number(active) === index) removeStore(activeSlotKey(key))
        return true
      } catch {
        return false
      }
    }

    const ENTRIES = new Map()

    // ---- 战斗循环 ----

    function drainTokens(entry) {
      const battle = entry.battle
      if (battle === null || entry.phase !== 'fight') return
      while (entry.tokenQueue >= TOKENS_PER_SPAWN) {
        if (addPressure(battle, 1) === 0) {
          entry.tokenQueue = 0
          return
        }
        entry.tokenQueue -= TOKENS_PER_SPAWN
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

    function settleBattle(entry) {
      const battle = entry.battle
      if (battle === null || battle.settled) return
      battle.settled = true
      entry.stats.kills += battle.kills
      entry.stats.maxFloorKills = Math.max(entry.stats.maxFloorKills, battle.kills)
      entry.build = battle.build
      entry.level = battle.level
      entry.xp = battle.xp
      entry.xpNext = battle.xpNext
      entry.pending = battle.pending
      entry.draftCount = battle.draftCount
      entry.attributes = { ...battle.attributes }
      entry.attributePoints = battle.attributePoints
      entry.stats.bestFloor = Math.max(entry.stats.bestFloor, entry.best)
      if (entry.map !== null) {
        // 生命跨节点保留：战败时先记 1，再由 retryNode 恢复到满生命。
        entry.map.lifeMax = battle.combat.maxLife
        entry.map.life = Math.max(1, Math.min(entry.map.lifeMax, Math.ceil(battle.player.cells)))
      }
      saveAccount(entry)
    }

    function resetVisuals(entry) {
      entry.fx = []
      entry.swingFx = []
      entry.particles = []
      entry.playerTrail = []
      entry.trailTimer = 0
      entry.spawnAt = new Map()
      entry.bulletPrev = new Map()
      entry.arcTrail = new Map()
      entry.shake = 0
      entry.flash = 0
      entry.muzzle = 0
      entry.hurtT = 0
      entry.acc = 0
    }

    /**
     * 开一场战斗。plan 来自地图节点（普通 / 精英 / Boss），
     * 不传时退回旧的 15 层表（测试、无头模拟与预览脚本仍然可用）。
     */
    function beginBattle(entry, { floor, plan = null, label = '' }) {
      const run = entry.map
      entry.floor = floor
      entry.phase = 'fight'
      entry.lastResult = null
      entry.resultTimer = 0
      entry.choosing = null
      entry.mapNotice = ''
      entry.retryHold = false
      resetVisuals(entry)
      const modifier = plan === null ? floorModifier(floor) : plan.modifier
      entry.banner = {
        text: '第 ' + floor + ' 层',
        sub: [label, modifier !== null ? MODIFIERS[modifier]?.name ?? '' : ''].filter((part) => part !== '').join(' · '),
        t: 1.3,
      }
      const battle = createBattle({
        floor,
        plan,
        build: entry.build,
        seed: entry.seed++,
        level: entry.level,
        xp: entry.xp,
        xpNext: entry.xpNext,
        pending: entry.pending,
        draftCount: entry.draftCount,
        movementStrategy: entry.movement,
        styleId: entry.style,
        attributes: entry.attributes,
        attributePoints: entry.attributePoints,
        life: run === null ? null : run.life,
      })
      entry.battle = battle
      const issue = battle.compileErrors[0] ?? battle.compileWarnings[0]
      if (issue !== undefined) entry.notice = issue.message
      entry.build = battle.build
      entry.pending = battle.pending
      entry.draftCount = battle.draftCount
      entry.attributes = { ...battle.attributes }
      entry.attributePoints = battle.attributePoints
      // 生命上限随属性成长；跨节点保留的当前生命不超过上限。
      if (run !== null) {
        run.lifeMax = battle.combat.maxLife
        run.life = Math.max(1, Math.min(run.lifeMax, Math.ceil(battle.player.cells)))
      }
      drainTokens(entry)
      saveAccount(entry)
    }

    /** 旧的按层开战入口：地图之外的脚本与测试仍走这里。 */
    function startFloor(entry, floor) {
      beginBattle(entry, { floor })
    }

    function isBattleNode(node) {
      return node !== null && (node.type === 'normal' || node.type === 'elite' || node.type === 'boss')
    }

    function startNodeBattle(entry, node) {
      beginBattle(entry, {
        floor: node.floor,
        plan: nodePlan(node),
        label: NODE_TYPES[node.type]?.label ?? '',
      })
    }

    /**
     * 进入地图的当前节点：战斗节点开打，其余节点进入交互面板。
     * 非战斗节点不会创建战斗世界，tick 在 'node' 阶段等待选择。
     */
    function startMapNode(entry) {
      const run = entry.map
      const node = currentNode(run)
      if (run === null || node === null) {
        startFloor(entry, entry.floor)
        return
      }
      entry.floor = node.floor
      entry.best = Math.max(entry.best, node.floor)
      entry.stats.bestFloor = Math.max(entry.stats.bestFloor, node.floor)
      entry.mapInspect = null
      if (isBattleNode(node)) {
        startNodeBattle(entry, node)
        return
      }
      entry.battle = null
      entry.phase = 'node'
      entry.lastResult = null
      entry.resultTimer = 0
      entry.choosing = null
      entry.mapNotice = ''
      entry.autoHold = null
      entry.nodeTimer = run.autoMode === 'manual' ? 0 : 1.2
      entry.banner = {
        text: '第 ' + node.floor + ' 层',
        sub: NODE_TYPES[node.type]?.label ?? '',
        t: 1.1,
      }
      saveAccount(entry)
    }

    /** 选择一个可选节点并进入。返回 false 表示该节点当前不可选。 */
    function chooseMapNode(entry, nodeId) {
      const run = entry.map
      if (run === null) return false
      const node = beginNode(run, nodeId)
      if (node === null) return false
      startMapNode(entry)
      return true
    }

    /** 自动 / 手动推进到下一站；自动路线暂停时停在 'map' 阶段等玩家。 */
    function advanceMap(entry) {
      const run = entry.map
      if (run === null) return false
      if (run.finished === true) {
        finishRun(entry)
        return true
      }
      const pick = pickNextNode(run)
      if (pick.paused || pick.nodeId === null) {
        entry.battle = null
        entry.phase = 'map'
        entry.choosing = null
        entry.mapNotice = autoReasonText(pick.reason)
        return false
      }
      return chooseMapNode(entry, pick.nodeId)
    }

    function finishRun(entry) {
      const depth = entry.map === null ? MAX_FLOOR : entry.map.depth
      entry.best = Math.max(entry.best, depth)
      entry.stats.bestFloor = Math.max(entry.stats.bestFloor, depth)
      entry.notice = '通关：第 ' + depth + ' 层最终怪物已击破，开始新的一局'
      resetRun(entry)
    }

    /** 连续失败后玩家手动重试当前节点。奖励早已结算过，不会重复发放。 */
    function retryCurrentBattle(entry) {
      const run = entry.map
      const node = run === null ? null : currentNode(run)
      if (node === null || !isBattleNode(node)) return false
      if (nodeStatus(run, node.id) !== 'active') return false
      entry.retryHold = false
      entry.mapNotice = ''
      startNodeBattle(entry, node)
      return true
    }

    /** 把地图效果（三选一、属性点）写进账户字段，下一次战斗生效。返回可读摘要。 */
    function applyMapEffects(entry, effects) {
      const notes = []
      for (const effect of effects ?? []) {
        if (effect.kind === 'draft') {
          const count = Math.max(1, Math.floor(Number(effect.count) || 1))
          entry.pending += count
          notes.push('获得 ' + count + ' 次三选一')
        } else if (effect.kind === 'attributePoint') {
          const count = Math.max(1, Math.floor(Number(effect.count) || 1))
          entry.attributePoints += count
          notes.push('获得 ' + count + ' 点属性点')
        }
      }
      if (entry.map !== null) entry.map.life = Math.max(1, Math.min(entry.map.lifeMax, entry.map.life))
      return notes.join(' · ')
    }

    function mapNodeAction(entry, action) {
      const run = entry.map
      if (run === null) return false
      const node = currentNode(run)
      if (node === null) return false
      const result = action(run, node.id)
      if (result === null || result.ok !== true) {
        const reason = result === null ? '' : result.reason ?? ''
        entry.mapNotice =
          reason === 'no-gold' ? '金币不足'
            : reason === 'cannot-pay' ? '资源不足，选不了这一项'
              : reason === 'sold' ? '这件已经买过了'
                : reason === '' ? '' : '无法执行：' + reason
        return false
      }
      const gains = applyMapEffects(entry, result.effects)
      entry.autoHold = null
      const label = NODE_TYPES[node.type]?.label ?? '节点'
      const parts = [label + '：' + (result.message ?? '已结算')]
      if (result.text !== undefined && result.text !== '') parts.push(result.text)
      if (gains !== '') parts.push(gains)
      entry.notice = parts.join(' · ')
      entry.mapNotice = result.message ?? ''
      saveAccount(entry)
      return true
    }

    function restChoice(entry, id) {
      const ok = mapNodeAction(entry, (run, nodeId) => resolveRest(run, nodeId, id))
      if (ok) advanceMap(entry)
      return ok
    }

    function eventChoice(entry, optionId) {
      const ok = mapNodeAction(entry, (run, nodeId) => resolveEvent(run, nodeId, optionId))
      if (ok) advanceMap(entry)
      return ok
    }

    function shopBuy(entry, index) {
      const ok = mapNodeAction(entry, (run, nodeId) => buyShopItem(run, nodeId, index))
      if (ok && entry.battle === null) entry.phase = 'node'
      return ok
    }

    function shopLeave(entry) {
      const run = entry.map
      if (run === null) return false
      if (!leaveShop(run, run.currentNodeId)) return false
      entry.mapNotice = ''
      advanceMap(entry)
      return true
    }

    /** 自动路线在非战斗节点的选择：休息回血、事件只选无代价项、商店只买治疗。 */
    function autoResolveNode(entry) {
      const run = entry.map
      const node = currentNode(run)
      if (run === null || node === null) return false
      if (entry.autoHold === node.id) return false
      if (node.type === 'rest') {
        const options = restOptions(run, node.id)
        const heal = options.find((option) => option.id === 'heal' && option.available)
        const upgrade = options.find((option) => option.id === 'upgrade' && option.available)
        const choice = run.life < run.lifeMax * 0.7 && heal !== undefined
          ? 'heal'
          : upgrade !== undefined ? 'upgrade' : 'leave'
        return restChoice(entry, choice)
      }
      if (node.type === 'event') {
        const view = eventView(run, node.id)
        const safe = view === null ? undefined : view.options.find((option) => (
          option.available && option.costText === '无代价'
        ))
        if (safe === undefined) {
          entry.autoHold = node.id
          entry.mapNotice = '事件没有可直接选择的安全选项，已暂停自动推进'
          return false
        }
        return eventChoice(entry, safe.id)
      }
      if (node.type === 'shop') {
        const view = shopView(run, node.id)
        const heal = view === null ? undefined : view.items.find((item) => item.id === 'heal' && item.available)
        if (heal !== undefined && run.life < run.lifeMax * 0.6) {
          shopBuy(entry, heal.index)
        }
        return shopLeave(entry)
      }
      return false
    }

    function setMapAutoMode(entry, mode) {
      const run = entry.map
      if (run === null || setAutoMode(run, mode) !== true) return false
      entry.autoHold = null
      entry.phase = run.autoMode === 'manual' ? entry.phase : entry.phase
      entry.mapNotice = autoReasonText(run.autoMode)
      if (entry.phase === 'map' || entry.phase === 'node') {
        entry.nodeTimer = entry.phase === 'node' ? 1.2 : 0
      }
      saveAccount(entry)
      return true
    }

    function createEntry(key, seed, options = {}) {
      // 传 autostart:false 时只准备账户数据，等玩家在大厅选择继续或新游戏；
      // 测试与无头模拟仍默认直接开打。
      const autostart = options === null || options === undefined || options.autostart !== false
      const found = preferredSlot(key)
      const slot = found < 0 ? 0 : found
      const account = loadAccount(key, slot, { backup: autostart })
      const entry = {
        key,
        slot,
        battle: null,
        floor: account.floor,
        best: account.best,
        build: account.build,
        style: account.style,
        movement: account.movement,
        stats: account.stats,
        level: account.level,
        xp: account.xp,
        xpNext: account.xpNext,
        pending: account.pending,
        draftCount: account.draftCount,
        attributes: { ...account.attributes },
        attributePoints: account.attributePoints,
        notice: account.notice,
        map: account.map,
        // 地图栏默认折叠：只显示当前节点与下一站，展开后可滚动查看完整地图。
        mapOpen: false,
        mapShowAll: false,
        mapInspect: null,
        mapNotice: '',
        autoHold: null,
        // 连续失败 3 次后暂停自动重试，等玩家调整构筑后手动重试。
        retryHold: false,
        nodeTimer: 0,
        mapTimer: 0,
        tokenQueue: 0,
        tokenSeen: new Map(),
        surgeMeter: 0,
        phase: autostart ? 'fight' : 'menu',
        menu: null,
        lastResult: null,
        resultTimer: 0,
        choosing: null,
        // 属性栏默认折叠，只保留一行标题；点击展开后再分配点数。
        attributesOpen: false,
        // 构筑栏同样默认折叠，展开后才显示技能详情与备用栏。
        buildOpen: false,
        fx: [],
        swingFx: [],
        particles: [],
        playerTrail: [],
        trailTimer: 0,
        time: 0,
        shake: 0,
        flash: 0,
        flashColor: '#ffffff',
        banner: null,
        spawnAt: new Map(),
        bulletPrev: new Map(),
        arcTrail: new Map(),
        muzzle: 0,
        hurtT: 0,
        moving: false,
        acc: 0,
        seed: seed === undefined ? (Date.now() % 100000) + 1 : seed,
        mapSeed: seed === undefined ? (Date.now() % 100000) + 1 : seed,
        running: false,
        online: true,
        consumed: 0,
        raf: 0,
        last: 0,
        subs: 0,
      }
      // 没有存档或存档没有地图时，用当前 seed 生成一张新地图再开局。
      if (entry.map === null && autostart) {
        entry.map = createMapRun({ seed: entry.mapSeed, autoMode: 'balanced' })
        entry.floor = 1
      }
      if (autostart) startMapNode(entry)
      return entry
    }

    function resetRun(entry) {
      const style = styleById(entry.style) ?? defaultStyle()
      entry.style = style.id
      entry.build = buildFromStyle(style)
      entry.level = 1
      entry.xp = 0
      entry.xpNext = 8
      entry.pending = 0
      entry.draftCount = 0
      // 通关重开 / 切换风格会重置本轮成长；阵亡重试不走这里，属性点保留。
      entry.attributes = emptyAttributes()
      entry.attributePoints = 0
      entry.choosing = null
      entry.battle = null
      // 新游戏重新生成地图：种子递增，路线与遭遇都换一套。
      const autoMode = entry.map === null ? 'balanced' : entry.map.autoMode
      entry.mapSeed = (entry.mapSeed ?? entry.seed ?? 1) + 1
      entry.map = createMapRun({ seed: entry.mapSeed, autoMode })
      entry.floor = 1
      entry.mapOpen = false
      entry.mapShowAll = false
      entry.mapInspect = null
      entry.mapNotice = ''
      entry.autoHold = null
      entry.retryHold = false
      entry.nodeTimer = 0
      entry.mapTimer = 0
      startMapNode(entry)
    }

    function applyAccount(entry, account) {
      entry.floor = account.floor
      entry.best = account.best
      entry.build = account.build
      entry.style = account.style
      entry.movement = account.movement
      entry.stats = account.stats
      entry.level = account.level
      entry.xp = account.xp
      entry.xpNext = account.xpNext
      entry.pending = account.pending
      entry.draftCount = account.draftCount
      entry.attributes = { ...account.attributes }
      entry.attributePoints = account.attributePoints
      entry.notice = account.notice
      entry.map = account.map
      entry.autoHold = null
      entry.retryHold = false
      entry.mapInspect = null
      entry.mapNotice = ''
      entry.nodeTimer = 0
      entry.mapTimer = 0
    }

    /** 新游戏继承当前与目标存档的累计战绩，只重置本轮进度。 */
    function startNewGame(entry, slot, styleId) {
      const index = normalizeSlot(slot)
      const target = loadAccount(entry.key, index)
      const merged = mergeStats(entry.stats, target.stats)
      const best = Math.max(1, entry.best, target.best, merged.bestFloor)
      merged.bestFloor = best
      const wanted = styleById(styleId) ?? styleById(entry.style) ?? defaultStyle()
      const style = styleAvailable(wanted, merged) ? wanted : defaultStyle()
      entry.slot = index
      entry.stats = merged
      entry.best = best
      entry.style = style.id
      entry.movement = style.movementPreference
      entry.tokenQueue = 0
      entry.surgeMeter = 0
      entry.choosing = null
      entry.menu = null
      entry.battle = null
      resetRun(entry)
      entry.notice = '新游戏开始：' + style.label + ' · 第 1 层'
      return true
    }

    function loadSlot(entry, slot) {
      const index = normalizeSlot(slot)
      if (!slotHasSave(entry.key, index)) return false
      const account = loadAccount(entry.key, index)
      const merged = mergeStats(entry.stats, account.stats)
      const best = Math.max(1, entry.best, account.best, merged.bestFloor)
      merged.bestFloor = best
      account.stats = merged
      account.best = best
      entry.slot = index
      entry.battle = null
      entry.phase = 'menu'
      entry.lastResult = null
      entry.resultTimer = 0
      entry.choosing = null
      entry.menu = null
      entry.tokenQueue = 0
      entry.surgeMeter = 0
      applyAccount(entry, account)
      const notice = account.notice
      startMapNode(entry)
      if (notice !== '') entry.notice = notice
      return true
    }

    function continueGame(entry) {
      if (entry.battle !== null) {
        entry.menu = null
        if (entry.phase === 'menu') entry.phase = 'fight'
        return true
      }
      if (entry.map !== null && entry.phase !== 'menu') {
        entry.menu = null
        startMapNode(entry)
        return true
      }
      const slot = preferredSlot(entry.key)
      if (slot < 0) return false
      return loadSlot(entry, slot)
    }

    function resetPreview(entry) {
      const account = emptyAccount()
      entry.battle = null
      entry.phase = 'menu'
      entry.slot = 0
      entry.tokenQueue = 0
      entry.surgeMeter = 0
      entry.lastResult = null
      entry.resultTimer = 0
      entry.choosing = null
      entry.banner = null
      entry.menu = null
      applyAccount(entry, account)
    }

    function deleteSave(entry, slot) {
      const index = normalizeSlot(slot)
      const wasCurrent = normalizeSlot(entry.slot) === index
      if (!removeSave(entry.key, index)) return false
      const menu = entry.menu
      if (wasCurrent) resetPreview(entry)
      if (menu !== null) {
        entry.menu = menu
        menu.screen = 'home'
        menu.confirmDelete = -1
        menu.newSlot = null
        menu.newStyle = null
        menu.message = wasCurrent ? '已删除当前存档，本轮进度已放弃' : '已删除存档 ' + (index + 1)
      }
      return true
    }

    function openMenu(entry) {
      if (entry.menu === null) {
        entry.menu = { screen: 'home', newSlot: null, newStyle: null, confirmDelete: -1, message: '' }
      } else {
        entry.menu.screen = 'home'
        entry.menu.confirmDelete = -1
      }
    }

    function openNewGameMenu(entry, slot) {
      if (entry.menu === null) openMenu(entry)
      const menu = entry.menu
      const slots = listSaveSlots(entry.key)
      const empty = slots.find((info) => info.empty)
      menu.screen = 'new'
      menu.newSlot = slot === undefined || slot === null
        ? (empty === undefined ? normalizeSlot(entry.slot) : empty.slot)
        : normalizeSlot(slot)
      menu.newStyle = entry.style
      menu.confirmDelete = -1
      menu.message = ''
    }

    function setStyle(entry, id) {
      const style = styleById(id)
      if (style === undefined || !styleAvailable(style, entry.stats)) return false
      entry.style = style.id
      entry.movement = style.movementPreference
      resetRun(entry)
      saveAccount(entry)
      return true
    }

    function setMovement(entry, strategy) {
      if (!MOVEMENT_STRATEGIES.includes(strategy)) return false
      entry.movement = strategy
      if (entry.battle !== null) setMovementStrategy(entry.battle, strategy)
      saveAccount(entry)
      return true
    }

    /**
     * 结算上一场战斗并决定下一站。
     * 有地图时：胜利 → 完成节点、发一次奖 → 自动 / 手动选下一站；
     * 失败 → 保留当前节点与构筑，补一次三选一后重试，不重复发奖。
     */
    function advance(entry) {
      const result = entry.lastResult
      settleBattle(entry)
      const run = entry.map
      const node = run === null ? null : currentNode(run)
      if (result !== null && result.kind === 'cleared') {
        if (run !== null && node !== null) {
          const battle = entry.battle
          const life = battle === null ? run.life : battle.player.cells
          const done = completeNode(run, node.id, { life })
          if (done !== null && done.alreadyDone !== true) {
            const gains = applyMapEffects(entry, done.effects)
            entry.gold = run.gold
            entry.notice = (NODE_TYPES[node.type]?.label ?? '节点') + '完成 · +' + done.gold + ' 金币' +
              (gains === '' ? '' : ' · ' + gains)
            entry.stats.bestFloor = Math.max(entry.stats.bestFloor, node.floor)
            entry.best = Math.max(entry.best, node.floor)
          }
          entry.battle = null
          if (run.finished === true) {
            finishRun(entry)
            return
          }
          advanceMap(entry)
          return
        }
        const next = entry.floor + 1
        entry.battle = null
        if (next > MAX_FLOOR) {
          resetRun(entry)
          return
        }
        startFloor(entry, next)
        return
      }
      if (run !== null && node !== null) {
        entry.battle = null
        entry.pending = Math.max(1, entry.pending + 1)
        const failures = retryNode(run, node.id)
        if (failures >= 3) {
          // 连续失败时暂停自动重试，避免后台无限重复；玩家可以调整构筑后手动重试。
          entry.retryHold = true
          entry.phase = 'map'
          entry.choosing = null
          entry.mapNotice = '连续失败 ' + failures + ' 次：已暂停自动重试，调整构筑后点「重试当前节点」'
          saveAccount(entry)
          return
        }
        startNodeBattle(entry, node)
        return
      }
      entry.battle = null
      entry.pending = Math.max(1, entry.pending + 1)
      startFloor(entry, entry.floor)
    }

    function pickUpgrade(entry, id, placement) {
      const battle = entry.battle
      if (battle === null) return false
      if (!chooseUpgrade(battle, id, placement)) {
        const reason = battle.lastUpgradeError
        if (reason === 'reserve-full') entry.notice = '备用栏空间不足，无法替换动作或组件'
        else if (reason === 'capability-mismatch') entry.notice = '该动作不支持当前属性或修饰'
        else if (reason === 'duplicate-action') entry.notice = '该动作已经在构筑中'
        else if (reason !== undefined && reason !== null) entry.notice = '无法装入该位置：' + reason
        return false
      }
      entry.build = battle.build
      entry.pending = battle.pending
      entry.draftCount = battle.draftCount
      entry.stats.drafts += 1
      entry.choosing = null
      const warning = (battle.compileWarnings ?? [])[0]
      if (warning !== undefined) entry.notice = warning.message
      saveAccount(entry)
      return true
    }

    function equipFromReserve(entry, id) {
      const battle = entry.battle
      if (battle === null) return false
      if (!equipReserve(battle, id)) return false
      entry.build = battle.build
      const warning = (battle.compileWarnings ?? [])[0]
      if (warning !== undefined) entry.notice = warning.message
      saveAccount(entry)
      return true
    }

    /** 把 1 点基础属性投进指定属性；与技能三选一互不竞争。 */
    function spendAttributePoint(entry, id) {
      const battle = entry.battle
      if (battle === null) return false
      if (!allocateAttribute(battle, id)) {
        entry.notice = '没有可分配的属性点'
        return false
      }
      entry.attributes = { ...battle.attributes }
      entry.attributePoints = battle.attributePoints
      saveAccount(entry)
      return true
    }

    const MAX_PARTICLES = 220

    function addParticles(entry, x, y, count, color, speed, life, gravity = 0) {
      for (let i = 0; i < count; i += 1) {
        if (entry.particles.length >= MAX_PARTICLES) entry.particles.shift()
        const angle = Math.random() * Math.PI * 2
        const magnitude = speed * (0.35 + Math.random() * 0.8)
        entry.particles.push({
          x,
          y,
          vx: Math.cos(angle) * magnitude,
          vy: Math.sin(angle) * magnitude,
          gravity,
          life,
          maxLife: life,
          color,
          size: Math.random() < 0.3 ? 2 : 1,
        })
      }
    }

    function ring(entry, x, y, radius, life, color) {
      entry.fx.push({ x, y, r: radius, life, maxLife: life, color })
    }

    function juice(entry, ev) {
      const color = ev.element === undefined || ev.element === null
        ? null
        : (contentById(ev.element)?.color ?? null)
      switch (ev.type) {
        case 'hit':
          addParticles(entry, ev.x, ev.y, ev.cells >= 3 ? 5 : 3, color ?? '#ffe9b0', 44, 0.28, 30)
          if (ev.cells >= 3) entry.shake = Math.max(entry.shake, 1.4)
          if (ev.crit === true) {
            // 暴击：额外亮色碎片与轻微顿帧感，让"这一次更疼"读得出来。
            addParticles(entry, ev.x, ev.y, 4, '#ffffff', 58, 0.26, 20)
            ring(entry, ev.x, ev.y, 3, 0.22, '#ffe066')
            entry.shake = Math.max(entry.shake, 2)
          }
          break
        case 'status':
          addParticles(entry, ev.x, ev.y, 1, contentById(ev.status)?.color ?? '#ff9f45', 16, 0.4, -18)
          break
        case 'burn':
          addParticles(entry, ev.x, ev.y, 1, '#ff9f45', 12, 0.5, -22)
          break
        case 'kill':
          addParticles(entry, ev.x, ev.y, 5, '#ffd166', 52, 0.35, 40)
          ring(entry, ev.x, ev.y, 2, 0.3, '#ffd166')
          break
        case 'shot':
          entry.muzzle = 0.06
          break
        case 'pulse':
          ring(entry, ev.x, ev.y, ev.radius, 0.42, ev.color ?? '#ffd166')
          addParticles(entry, ev.x, ev.y, 3, ev.color ?? '#ffd166', 30, 0.3, 0)
          break
        case 'swing':
          entry.swingFx.push({
            x: ev.x,
            y: ev.y,
            angle: ev.angle,
            half: ev.half,
            radius: ev.radius,
            color: ev.color ?? '#ffb347',
            life: 0.2,
          })
          addParticles(entry, ev.x, ev.y, 4, ev.color ?? '#ffb347', 34, 0.24, 0)
          entry.shake = Math.max(entry.shake, 0.8)
          break
        case 'swordSummon':
          ring(entry, ev.x, ev.y, 10, 0.4, ev.color ?? '#a0e7c8')
          addParticles(entry, ev.x, ev.y, 3, ev.color ?? '#a0e7c8', 26, 0.3, 0)
          break
        case 'swordShot':
          entry.muzzle = 0.06
          addParticles(entry, ev.x, ev.y, 2, ev.color ?? '#9fd8ff', 30, 0.22, 0)
          break
        case 'arcSwordCast':
          entry.muzzle = 0.06
          ring(entry, ev.x, ev.y, 5, 0.2, ev.color ?? '#b6f0d2')
          addParticles(entry, ev.x, ev.y, 2, ev.color ?? '#b6f0d2', 24, 0.2, 0)
          break
        case 'swordArray':
          ring(entry, ev.x, ev.y, ev.radius, 0.45, ev.color ?? '#c9b3ff')
          addParticles(entry, ev.x, ev.y, 5, ev.color ?? '#c9b3ff', 30, 0.32, 0)
          break
        case 'swordArrayPulse':
          ring(entry, ev.x, ev.y, ev.radius, 0.28, ev.color ?? '#c9b3ff')
          break
        case 'detonate':
          ring(entry, ev.x, ev.y, ev.radius, 0.4, '#ff6b6b')
          addParticles(entry, ev.x, ev.y, 7, '#ff6b6b', 44, 0.32, 20)
          entry.shake = Math.max(entry.shake, 1.6)
          break
        case 'trapPlaced':
          ring(entry, ev.x, ev.y, 6, 0.32, ev.color ?? '#c9b3ff')
          addParticles(entry, ev.x, ev.y, 2, ev.color ?? '#c9b3ff', 16, 0.3, 0)
          break
        case 'trapTrigger':
          ring(entry, ev.x, ev.y, ev.radius, 0.48, ev.color ?? '#c9b3ff')
          addParticles(entry, ev.x, ev.y, 8, ev.color ?? '#c9b3ff', 48, 0.35, 30)
          entry.shake = Math.max(entry.shake, 2)
          break
        case 'impact':
          ring(entry, ev.x, ev.y, ev.radius, 0.5, ev.color ?? '#ff8f6b')
          addParticles(entry, ev.x, ev.y, 10, ev.color ?? '#ff8f6b', 62, 0.4, 50)
          entry.shake = Math.max(entry.shake, 3)
          break
        case 'reaction':
          addParticles(entry, ev.x, ev.y, 6, contentById(ev.id)?.color ?? '#a0e7c8', 46, 0.36, 10)
          ring(entry, ev.x, ev.y, 4, 0.32, contentById(ev.id)?.color ?? '#a0e7c8')
          break
        case 'pull':
          addParticles(entry, ev.x, ev.y, 1, '#8fd8ff', 14, 0.22, 0)
          break
        case 'hurt':
          entry.shake = Math.max(entry.shake, 2.4)
          entry.flash = Math.max(entry.flash, 0.35)
          entry.flashColor = '#e35d5d'
          entry.hurtT = 0.2
          break
        case 'enemyShot':
          addParticles(entry, ev.x, ev.y, 1, COLORS.enemyShot, 14, 0.2, 0)
          break
        case 'levelUp':
          entry.banner = { text: '升级', sub: 'Lv.' + ev.level, t: 1.1 }
          break
        case 'surge':
          entry.banner = { text: '过载潮', sub: 'token 压力', t: 1.6 }
          entry.flash = Math.max(entry.flash, 0.45)
          entry.flashColor = '#ff9f45'
          entry.shake = Math.max(entry.shake, 3)
          break
        case 'elite':
          entry.banner = { text: '精英', sub: '强化敌人', t: 1.2 }
          entry.flash = Math.max(entry.flash, 0.3)
          entry.flashColor = '#ffd166'
          break
        case 'eliteDown':
          entry.banner = { text: '精英击破', sub: '额外选择', t: 1.2 }
          break
        case 'surgeReward':
          entry.banner = { text: '过载清场', sub: '额外选择', t: 1.2 }
          break
        default:
          break
      }
    }

    function tick(entry, dt) {
      // 大厅 / 暂停菜单打开时冻结战斗，避免玩家看菜单时还在掉血。
      if (entry.menu !== null) return
      entry.time += dt
      if (entry.shake > 0) entry.shake = Math.max(0, entry.shake - dt * 20)
      if (entry.flash > 0) entry.flash = Math.max(0, entry.flash - dt * 2.6)
      if (entry.muzzle > 0) entry.muzzle = Math.max(0, entry.muzzle - dt)
      if (entry.hurtT > 0) entry.hurtT = Math.max(0, entry.hurtT - dt)
      if (entry.banner !== null) {
        entry.banner.t -= dt
        if (entry.banner.t <= 0) entry.banner = null
      }
      for (const p of entry.particles) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.9
        p.vy = p.vy * 0.9 + p.gravity * dt
        p.life -= dt
      }
      if (entry.particles.length > 0) {
        entry.particles = entry.particles.filter((p) => p.life > 0)
      }
      for (const t of entry.playerTrail) t.life -= dt
      if (entry.playerTrail.length > 0) {
        entry.playerTrail = entry.playerTrail.filter((t) => t.life > 0)
      }
      for (const f of entry.fx) {
        f.life -= dt
        f.r += dt * 46
      }
      if (entry.fx.length > 0) entry.fx = entry.fx.filter((f) => f.life > 0)
      for (const f of entry.swingFx ?? []) f.life -= dt
      if ((entry.swingFx ?? []).length > 0) {
        entry.swingFx = entry.swingFx.filter((f) => f.life > 0)
      }

      if (entry.phase === 'result') {
        entry.resultTimer -= dt
        if (entry.resultTimer <= 0) advance(entry)
        return
      }

      // 地图阶段：自动路线自己往前走，手动路线等玩家点节点。
      if (entry.phase === 'map') {
        if (entry.retryHold === true) return
        entry.mapTimer -= dt
        if (entry.mapTimer > 0) return
        entry.mapTimer = 0.5
        advanceMap(entry)
        return
      }

      // 非战斗节点：自动路线 1.2 秒后替玩家做安全选择；无法判断时暂停。
      if (entry.phase === 'node') {
        const run = entry.map
        const node = run === null ? null : currentNode(run)
        if (run === null || node === null) return
        if (run.autoMode === 'manual') return
        if (entry.autoHold === node.id) return
        entry.nodeTimer -= dt
        if (entry.nodeTimer > 0) return
        autoResolveNode(entry)
        return
      }

      const battle = entry.battle
      if (battle === null) return
      drainTokens(entry)
      const beforeX = battle.player.x
      const beforeY = battle.player.y
      const events = step(battle, dt)
      entry.moving = Math.hypot(battle.player.x - beforeX, battle.player.y - beforeY) > 0.2
      entry.trailTimer -= dt
      if (entry.moving && entry.trailTimer <= 0) {
        entry.trailTimer += 0.06
        entry.playerTrail.push({ x: battle.player.x, y: battle.player.y, life: 0.32 })
        if (entry.playerTrail.length > 14) entry.playerTrail.shift()
      }
      for (const enemy of battle.enemies) {
        if (!entry.spawnAt.has(enemy.id)) entry.spawnAt.set(enemy.id, entry.time)
      }
      for (const list of entry.arcTrail.values()) {
        for (const point of list) point.life -= dt
      }
      for (const sword of battle.arcSwords) {
        let list = entry.arcTrail.get(sword.id)
        if (list === undefined) {
          list = []
          entry.arcTrail.set(sword.id, list)
        }
        list.push({ x: sword.x, y: sword.y, life: 0.18 })
        if (list.length > 12) list.shift()
      }
      for (const [id, list] of entry.arcTrail) {
        const alive = list.filter((point) => point.life > 0)
        if (alive.length === 0) entry.arcTrail.delete(id)
        else entry.arcTrail.set(id, alive)
      }
      for (const ev of events) juice(entry, ev)
      if (battle.state !== 'fighting') {
        entry.lastResult = {
          kind: battle.state,
          floor: entry.floor,
          kills: battle.kills,
          cells: battle.player.cells,
        }
        entry.phase = 'result'
        entry.resultTimer = battle.state === 'cleared' ? PAUSE_CLEAR : PAUSE_FAIL
        if (battle.state === 'cleared') {
          entry.best = Math.max(entry.best, entry.floor)
          entry.stats.bestFloor = Math.max(entry.stats.bestFloor, entry.floor)
        }
        settleBattle(entry)
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
        while (entry.acc >= STEP_SECONDS && guard < 8) {
          tick(entry, STEP_SECONDS)
          entry.acc -= STEP_SECONDS
          guard += 1
        }
        if (guard >= 8) entry.acc = 0
      }
      entry.raf = window.requestAnimationFrame(loop)
    }

    function acquireEntry(key) {
      let entry = ENTRIES.get(key)
      if (entry === undefined) {
        entry = createEntry(key, undefined, { autostart: false })
        openMenu(entry)
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

    function drawEnemy(c, e, entry) {
      const spawn = entry.spawnAt.get(e.id)
      const age = spawn === undefined ? 1 : entry.time - spawn
      const grow = Math.min(1, age / 0.22)
      const base = Math.round((5 + Math.min(7, e.cells / 4)) * (e.elite ? 1.25 : 1))
      const size = Math.max(1, Math.round(base * (0.45 + grow * 0.55)))
      const half = Math.floor(size / 2)
      const x = Math.round(e.x) - half
      const y = Math.round(e.y) - half
      const type = ENEMY_TYPES[e.type]
      const style = type === undefined ? ENEMY_TYPES.swarm.color : type.color
      const lit = e.flash > 0
      const chilled = (e.statuses?.chill?.stacks ?? 0) > 0
      c.globalAlpha = (0.35 + grow * 0.65)

      c.fillStyle = '#05070a'
      c.fillRect(x, y + size, size, 1)

      if (chilled) {
        c.fillStyle = COLORS.chill
        c.globalAlpha *= 0.55
        c.fillRect(x - 1, y - 1, size + 2, size + 2)
        c.globalAlpha = (0.35 + grow * 0.65)
      }

      c.fillStyle = lit ? '#ffffff' : style.rim
      c.fillRect(x, y, size, size)
      c.fillStyle = lit ? '#ffffff' : style.body
      c.fillRect(x + 1, y + 1, Math.max(1, size - 2), Math.max(1, size - 2))

      if (size >= 6 && !lit) {
        c.fillStyle = '#0a0d12'
        c.fillRect(x + 2, y + 2, 1, 1)
        c.fillRect(x + size - 3, y + 2, 1, 1)
      }
      if (e.elite) {
        c.fillStyle = '#ffd166'
        c.fillRect(x + half - 1, y - 3, 2, 1)
      }
      c.globalAlpha = 1

      const barW = Math.max(3, size)
      c.fillStyle = '#101820'
      c.fillRect(x, y - 4, barW, 1)
      c.fillStyle = style.body
      const filled = Math.max(1, Math.round((e.cells / e.maxCells) * barW))
      c.fillRect(x, y - 4, Math.min(barW, filled), 1)

      const statuses = e.statuses ?? {}
      STATUS_ORDER.forEach((id, index) => {
        const instance = statuses[id]
        if (instance === undefined || instance.stacks <= 0) return
        c.fillStyle = contentById(id)?.color ?? '#ffffff'
        c.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(entry.time * 8 + e.id + index))
        c.fillRect(x + size + 1, y + index * 2, 1, 1)
        if (instance.stacks >= 3) c.fillRect(x + size + 2, y + index * 2, 1, 1)
      })
      c.globalAlpha = 1
    }

    function drawPlayer(c, p, entry) {
      const bob = entry.moving ? Math.round(Math.sin(entry.time * 12) * 0.5) : 0
      const squash = entry.hurtT > 0 ? 1 : 0
      const w = 7 + squash
      const h = 6 - squash
      const x = Math.round(p.x) - Math.floor(w / 2)
      const y = Math.round(p.y) - Math.floor(h / 2) + bob
      c.fillStyle = '#05070a'
      c.fillRect(x - 1, y - 1, w + 2, h + 2)
      c.fillStyle = COLORS.playerDark
      c.fillRect(x - 1, y + h, w + 2, 1)
      c.fillStyle = entry.hurtT > 0 ? '#ffffff' : COLORS.player
      c.fillRect(x, y, w, h)
      c.fillStyle = COLORS.eye
      c.fillRect(x + 1, y + 2, 1, 2)
      c.fillRect(x + w - 2, y + 2, 1, 2)
      if (entry.muzzle > 0) {
        c.fillStyle = '#fff2b0'
        c.fillRect(x + w, y + 2, 2, 1)
      }
    }

    function drawAura(c, entry, plan) {
      const color = plan.element === null ? plan.action.color : plan.element.color
      c.globalAlpha = 0.26 + 0.08 * Math.sin(entry.time * 2.4)
      c.fillStyle = color
      const radius = plan.radius
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2
        c.fillRect(
          Math.round(entry.battle.player.x + Math.cos(a) * radius),
          Math.round(entry.battle.player.y + Math.sin(a) * radius),
          1,
          1,
        )
      }
      c.globalAlpha = 1
    }

    function draw(c, entry) {
      const shake = entry.shake
      const ox = shake > 0 ? Math.sin(entry.time * 130) * shake : 0
      const oy = shake > 0 ? Math.cos(entry.time * 170) * shake : 0
      c.setTransform(2, 0, 0, 2, Math.round(ox * 2), Math.round(oy * 2))
      c.imageSmoothingEnabled = false
      c.fillStyle = COLORS.bg
      c.fillRect(-8, -8, VIEW_W + 16, VIEW_H + 16)

      c.fillStyle = '#22303f'
      for (let i = 0; i < 12; i += 1) {
        const x = (i * 37 + entry.time * (4 + (i % 3))) % VIEW_W
        const y = (i * 53 + Math.sin(entry.time * 0.6 + i) * 6 + VIEW_H) % VIEW_H
        c.fillRect(Math.round(x), Math.round(y), 1, 1)
      }

      c.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(entry.time * 2))
      c.fillStyle = COLORS.grid
      for (let x = 8; x < VIEW_W; x += 8) for (let y = 8; y < VIEW_H; y += 8) c.fillRect(x, y, 1, 1)
      c.globalAlpha = 1

      c.globalAlpha = 0.22
      c.fillStyle = '#2a3a4a'
      for (let i = 0; i < 28; i += 1) {
        const a = (i / 28) * Math.PI * 2
        c.fillRect(
          Math.round(VIEW_W / 2 + Math.cos(a) * 30),
          Math.round(VIEW_H / 2 + Math.sin(a) * 30),
          1,
          1,
        )
      }
      c.globalAlpha = 1
      c.fillStyle = COLORS.frame
      c.fillRect(4, 4, 8, 1)
      c.fillRect(4, 4, 1, 8)
      c.fillRect(VIEW_W - 12, 4, 8, 1)
      c.fillRect(VIEW_W - 5, 4, 1, 8)
      c.fillRect(4, VIEW_H - 5, 8, 1)
      c.fillRect(4, VIEW_H - 12, 1, 8)
      c.fillRect(VIEW_W - 12, VIEW_H - 5, 8, 1)
      c.fillRect(VIEW_W - 5, VIEW_H - 12, 1, 8)
      c.fillRect(0, 0, VIEW_W, 1)
      c.fillRect(0, VIEW_H - 1, VIEW_W, 1)
      c.fillRect(0, 0, 1, VIEW_H)
      c.fillRect(VIEW_W - 1, 0, 1, VIEW_H)

      const battle = entry.battle
      if (battle === null) return

      for (const plan of battle.plans) {
        if (plan.action.handler === 'aura') drawAura(c, entry, plan)
      }

      for (const f of entry.fx) {
        c.globalAlpha = Math.max(0, Math.min(1, f.life * 2.4))
        c.fillStyle = f.color ?? '#ffd166'
        const points = 16
        for (let i = 0; i < points; i += 1) {
          const a = (i / points) * Math.PI * 2
          c.fillRect(Math.round(f.x + Math.cos(a) * f.r), Math.round(f.y + Math.sin(a) * f.r), 1, 1)
        }
      }
      c.globalAlpha = 1

      for (const f of entry.swingFx ?? []) {
        c.globalAlpha = Math.max(0, Math.min(1, f.life / 0.2))
        c.fillStyle = f.color
        const steps = 14
        for (let i = 0; i <= steps; i += 1) {
          const a = f.angle - f.half + (i / steps) * f.half * 2
          const r = f.radius * (0.65 + 0.35 * (i / steps))
          c.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r), 1, 1)
        }
      }
      c.globalAlpha = 1

      for (const trap of battle.traps) {
        const color = trap.plan.element === null ? trap.plan.action.color : trap.plan.element.color
        const pulse = 0.5 + 0.5 * Math.sin(entry.time * 6)
        c.globalAlpha = 0.14 + pulse * 0.12
        c.fillStyle = color
        for (let i = 0; i < 16; i += 1) {
          const a = (i / 16) * Math.PI * 2
          c.fillRect(
            Math.round(trap.x + Math.cos(a) * trap.triggerRadius),
            Math.round(trap.y + Math.sin(a) * trap.triggerRadius),
            1,
            1,
          )
        }
        c.globalAlpha = 0.7
        c.fillRect(Math.round(trap.x) - 1, Math.round(trap.y) - 1, 3, 3)
      }
      c.globalAlpha = 1

      for (const e of battle.enemies) drawEnemy(c, e, entry)
      for (const t of entry.playerTrail) {
        c.globalAlpha = Math.max(0, t.life / 0.32) * 0.65
        c.fillStyle = COLORS.playerDark
        c.fillRect(Math.round(t.x) - 1, Math.round(t.y) - 1, 2, 2)
      }
      c.globalAlpha = 1
      drawPlayer(c, battle.player, entry)

      for (const sword of battle.orbitSwords) {
        const color = sword.plan.element === null ? sword.plan.action.color : sword.plan.element.color
        c.fillStyle = color
        c.fillRect(Math.round(sword.x) - 1, Math.round(sword.y) - 1, 3, 3)
        c.fillStyle = '#ffffff'
        c.fillRect(Math.round(sword.x), Math.round(sword.y), 1, 1)
      }

      for (const sword of battle.arcSwords) {
        const color = sword.plan.element === null ? sword.plan.action.color : sword.plan.element.color
        const dx = sword.dirX ?? 1
        const dy = sword.dirY ?? 0
        // 剑影在 0.12 秒内加亮；尾迹只做表现，不参与判定。
        const reveal = Math.min(1, (sword.elapsed ?? 0) / 0.12)
        c.fillStyle = color
        for (const point of entry.arcTrail?.get(sword.id) ?? []) {
          c.globalAlpha = (point.life / 0.18) * 0.35
          c.fillRect(Math.round(point.x), Math.round(point.y), 1, 1)
        }
        c.globalAlpha = 0.3 + reveal * 0.6
        for (let i = 0; i < 4; i += 1) {
          c.fillRect(Math.round(sword.x - dx * i), Math.round(sword.y - dy * i), 1, 1)
        }
        c.globalAlpha = 0.45 + reveal * 0.35
        c.fillRect(Math.round(sword.x - dy), Math.round(sword.y + dx), 1, 1)
        c.fillRect(Math.round(sword.x + dy), Math.round(sword.y - dx), 1, 1)
        c.globalAlpha = 0.7 + reveal * 0.3
        c.fillStyle = '#ffffff'
        c.fillRect(Math.round(sword.x + dx), Math.round(sword.y + dy), 1, 1)
        c.fillRect(Math.round(sword.x + dx * 2), Math.round(sword.y + dy * 2), 1, 1)
      }
      c.globalAlpha = 1

      for (const sword of battle.piercingSwords) {
        const color = sword.plan.element === null ? sword.plan.action.color : sword.plan.element.color
        c.fillStyle = color
        for (let i = 0; i < 4; i += 1) {
          c.fillRect(
            Math.round(sword.x - sword.dirX * i),
            Math.round(sword.y - sword.dirY * i),
            1,
            1,
          )
        }
        c.fillStyle = '#ffffff'
        c.fillRect(Math.round(sword.x), Math.round(sword.y), 1, 1)
      }

      for (const array of battle.swordArrays) {
        const color = array.plan.element === null ? array.plan.action.color : array.plan.element.color
        c.globalAlpha = 0.2 + 0.1 * Math.sin(entry.time * 5)
        c.fillStyle = color
        for (let i = 0; i < 20; i += 1) {
          const a = (i / 20) * Math.PI * 2 + entry.time * 0.8
          c.fillRect(
            Math.round(array.x + Math.cos(a) * array.radius),
            Math.round(array.y + Math.sin(a) * array.radius),
            1,
            1,
          )
        }
        c.globalAlpha = 0.8
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * Math.PI * 2 + entry.time * 1.6
          c.fillRect(Math.round(array.x + Math.cos(a) * array.radius * 0.45), Math.round(array.y + Math.sin(a) * array.radius * 0.45), 1, 2)
        }
        c.globalAlpha = 1
      }

      const next = new Map()
      for (const b of battle.projectiles) {
        const color = b.plan.element === null ? b.plan.action.color : b.plan.element.color
        const prev = entry.bulletPrev.get(b.id)
        if (prev !== undefined) {
          c.globalAlpha = 0.35
          c.fillStyle = color
          c.fillRect(Math.round((prev.x + b.x) / 2), Math.round((prev.y + b.y) / 2), 1, 1)
          c.globalAlpha = 1
        }
        c.fillStyle = color
        c.globalAlpha = 0.22
        c.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3)
        c.globalAlpha = 1
        c.fillRect(Math.round(b.x), Math.round(b.y), 1, 2)
        next.set(b.id, { x: b.x, y: b.y })
      }
      entry.bulletPrev = next

      c.fillStyle = COLORS.enemyShot
      for (const shot of battle.enemyShots) {
        c.fillRect(Math.round(shot.x), Math.round(shot.y), 2, 1)
      }

      for (const p of entry.particles) {
        c.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife))
        c.fillStyle = p.color
        c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size)
      }
      c.globalAlpha = 1

      for (let i = 0; i < 6; i += 1) {
        c.globalAlpha = 0.055
        c.fillStyle = '#000000'
        c.fillRect(i, i, VIEW_W - i * 2, 1)
        c.fillRect(i, VIEW_H - 1 - i, VIEW_W - i * 2, 1)
        c.fillRect(i, i, 1, VIEW_H - i * 2)
        c.fillRect(VIEW_W - 1 - i, i, 1, VIEW_H - i * 2)
      }
      c.globalAlpha = 1

      const hpRatio = battle.player.maxCells > 0 ? battle.player.cells / battle.player.maxCells : 1
      if (hpRatio < 0.35) {
        const pulse = 0.5 + 0.5 * Math.sin(entry.time * 6)
        c.globalAlpha = 0.06 + pulse * 0.09
        c.fillStyle = '#e35d5d'
        c.fillRect(0, 0, VIEW_W, 4)
        c.fillRect(0, VIEW_H - 4, VIEW_W, 4)
        c.fillRect(0, 0, 4, VIEW_H)
        c.fillRect(VIEW_W - 4, 0, 4, VIEW_H)
        c.globalAlpha = 1
      }

      if (entry.flash > 0) {
        c.globalAlpha = Math.min(0.4, entry.flash)
        c.fillStyle = entry.flashColor
        c.fillRect(0, 0, VIEW_W, VIEW_H)
        c.globalAlpha = 1
      }
    }

    // ---- 报告 ----

    function damageReport(entry) {
      const battle = entry.battle
      if (battle === null) return ''
      const entries = Object.entries(battle.stats.damage)
      if (entries.length === 0) return ''
      entries.sort((a, b) => b[1] - a[1])
      const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1
      const labels = new Map(battle.plans.map((plan) => [plan.id, plan.label]))
      const shares = entries
        .slice(0, 3)
        .map(([id, value]) => {
          const label = labels.get(id) ?? contentById(id)?.label ?? (id.startsWith('reaction:') ? id.slice(9) : id)
          return label + ' ' + Math.round((value / total) * 100) + '%'
        })
        .join(' / ')
      const overflow = battle.stats.overflow ?? 0
      const crits = battle.stats.crits ?? 0
      const extras = []
      if (crits > 0) extras.push('暴击 ' + crits)
      if (overflow > 0) extras.push('溢出 ' + Math.round(overflow))
      return extras.length === 0 ? shares : shares + ' · ' + extras.join(' · ')
    }

    function reactionReport(entry) {
      const battle = entry.battle
      if (battle === null) return ''
      const parts = []
      for (const [id, stat] of Object.entries(battle.stats.reactions)) {
        if (stat.count > 0) {
          const label = contentById(id)?.label ?? id
          parts.push(label + ' ×' + stat.count)
        }
      }
      for (const [id, count] of Object.entries(battle.stats.modifiers ?? {})) {
        if (count > 0) {
          const label = contentById(id)?.label ?? id
          parts.push(label + ' ×' + count)
        }
      }
      return parts.join(' · ')
    }

    function diagnoseRun(entry) {
      const result = entry.lastResult
      if (result === null) return ''
      const run = entry.map
      if (result.kind === 'cleared') {
        if (run === null) return '进入第 ' + Math.min(MAX_FLOOR, entry.floor + 1) + ' 层'
        const next = availableNodes(run)
        if (next.length === 0) return '正在选择下一站'
        return '下一站：' + next.map((node) => NODE_TYPES[node.type].label).join(' / ')
      }
      if (result.kind === 'dead') {
        return run === null
          ? '生命耗尽 · 重试本层，并补一次升级选择'
          : '生命耗尽 · 重试当前节点，并补一次升级选择'
      }
      if (run !== null) {
        const node = currentNode(run)
        const modifier = node === null ? null : nodePlan(node)?.modifier ?? null
        if (modifier !== null && MODIFIERS[modifier] !== undefined) {
          return TIME_LIMIT + ' 秒内没清完：' + MODIFIERS[modifier].desc
        }
        return TIME_LIMIT + ' 秒内没清完：输出不够。'
      }
      const modifier = floorModifier(result.floor)
      if (modifier !== null) return TIME_LIMIT + ' 秒内没清完：' + MODIFIERS[modifier].desc
      return TIME_LIMIT + ' 秒内没清完：输出不够。'
    }

    function formatTokens(n) {
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    // ---- 界面 ----

    function slotChip(kind, id) {
      const def = id === null ? null : contentById(id)
      const label = def === undefined || def === null ? '空' : def.label
      const color = def !== undefined && def !== null && def.color !== undefined ? def.color : '#cfe3ef'
      return h('span', {
        className: 'dsh-pet-slot' + (def === null || def === undefined ? ' empty' : ''),
        style: def === null || def === undefined ? undefined : { borderColor: color, color },
        title: def === undefined || def === null ? '空槽：升级时可以装入' : def.desc,
      }, KIND_LABELS[kind] + ' · ' + label)
    }

    /**
     * 构筑栏：默认折叠成一行（技能数 / 备用数），点标题展开技能详情与备用栏。
     * 风格与移动策略不再占用战场面板，见下方 statusPanel 的说明。
     */
    function toggleBuild(entry) {
      entry.buildOpen = entry.buildOpen !== true
      return entry.buildOpen
    }

    function buildPanel(entry, bump) {
      const battle = entry.battle
      const build = battle === null ? entry.build : battle.build
      const plans = battle === null ? [] : battle.plans
      const open = entry.buildOpen === true
      const planById = new Map(plans.map((plan) => [plan.id, plan]))
      const head = h('button', {
        type: 'button',
        className: 'dsh-pet-fold-head' + (open ? ' open' : ''),
        'aria-expanded': open,
        title: open ? '收起构筑' : '展开构筑：查看技能槽位与备用栏',
        onClick: () => {
          toggleBuild(entry)
          bump()
        },
      },
        h('span', { className: 'dsh-pet-fold-caret' }, open ? '▾' : '▸'),
        h('span', { className: 'dsh-pet-fold-title' }, '构筑'),
        h('span', { className: 'dsh-pet-fold-summary' },
          build.skills.length + '/' + MAX_SKILLS + ' 技能 · 备用 ' + build.reserve.length),
      )
      if (!open) return h('div', { className: 'dsh-pet-fold dsh-pet-build' }, head)

      const skills = build.skills.map((skill, index) => {
        const plan = planById.get(skill.id)
        return h('div', { className: 'dsh-pet-skill', key: skill.id },
          h('div', { className: 'dsh-pet-skill-head' },
            h('span', { className: 'dsh-pet-skill-name' }, plan === undefined ? '技能 ' + (index + 1) + ' · 未运行' : plan.label),
            h('span', { className: 'dsh-pet-muted' }, index === 0 ? '主技能' : '副技能'),
          ),
          h('div', { className: 'dsh-pet-slots' },
            slotChip('action', skill.action),
            slotChip('element', skill.element),
            slotChip('modifier', skill.modifier),
          ),
          plan === undefined ? null : h('div', { className: 'dsh-pet-skill-desc' }, plan.description),
        )
      })
      if (skills.length < MAX_SKILLS) {
        skills.push(h('div', { className: 'dsh-pet-skill muted', key: 'empty-skill' },
          h('div', { className: 'dsh-pet-skill-head' },
            h('span', { className: 'dsh-pet-skill-name muted' }, '空技能槽'),
            h('span', { className: 'dsh-pet-muted' }, '升级时选择动作'),
          ),
        ))
      }
      const reserve = build.reserve.length === 0
        ? [h('span', { className: 'dsh-pet-muted', key: 'empty' }, '空')]
        : build.reserve.map((id) => {
            const def = contentById(id)
            return h('button', {
              key: id,
              type: 'button',
              className: 'dsh-pet-chip',
              title: def === undefined ? id : def.desc + '（点击装回）',
              onClick: () => {
                if (equipFromReserve(entry, id)) bump()
              },
            }, def === undefined ? id : def.label)
          })
      return h('div', { className: 'dsh-pet-fold dsh-pet-build' },
        head,
        h('div', { className: 'dsh-pet-fold-body' },
          ...skills,
          h('div', { className: 'dsh-pet-reserve' },
            h('span', { className: 'dsh-pet-muted' }, '备用：'),
            ...reserve,
          ),
        ),
      )
    }

    /** 折叠状态存在 entry 上：关闭/展开不会因为 200ms 重绘或 bump 丢失。 */
    function toggleAttributes(entry) {
      entry.attributesOpen = entry.attributesOpen !== true
      return entry.attributesOpen
    }

    /** 折叠时的摘要：只留最能说明当前强度的两项，避免又占满一行。 */
    function collapsedAttributeSummary(combat) {
      return '护甲 ' + formatCombatValue('armor', combat.armor) +
        ' · 暴击 ' + formatCombatValue('critChance', combat.critChance)
    }

    /**
     * 属性面板：默认折叠，只占一行；点标题展开四项基础属性、各自点数、
     * 投入 1 点后的实际变化与战斗属性摘要。
     */
    function attributePanel(entry, bump) {
      const battle = entry.battle
      const attributes = normalizeAttributes(battle === null ? entry.attributes : battle.attributes)
      const points = battle === null ? entry.attributePoints : battle.attributePoints
      const combat = battle === null ? createCombatStats(attributes) : battle.combat
      const open = entry.attributesOpen === true
      const head = h('button', {
        type: 'button',
        className: 'dsh-pet-fold-head' + (open ? ' open' : ''),
        'aria-expanded': open,
        title: open ? '收起属性' : '展开属性：查看四项属性并分配点数',
        onClick: () => {
          toggleAttributes(entry)
          bump()
        },
      },
        h('span', { className: 'dsh-pet-fold-caret' }, open ? '▾' : '▸'),
        h('span', { className: 'dsh-pet-fold-title' }, '属性'),
        points > 0
          ? h('span', { className: 'dsh-pet-points ready dsh-pet-attrs-points' }, '可用 ' + points + ' 点')
          : h('span', { className: 'dsh-pet-attrs-points dsh-pet-muted' }, ''),
        h('span', { className: 'dsh-pet-fold-summary' }, collapsedAttributeSummary(combat)),
      )

      if (!open) return h('div', { className: 'dsh-pet-fold dsh-pet-attrs' }, head)

      const rows = ATTRIBUTE_IDS.map((id) => {
        const preview = previewAttribute(attributes, id)
        const canSpend = battle !== null && points > 0
        return h('div', { className: 'dsh-pet-attr-row', key: id },
          h('span', { className: 'dsh-pet-attr-name' }, ATTRIBUTES[id].label),
          h('span', { className: 'dsh-pet-attr-points' }, String(attributes[id])),
          h('button', {
            type: 'button',
            className: 'dsh-pet-attr-btn',
            disabled: !canSpend,
            title: canSpend
              ? '投入 1 点 · ' + preview.text
              : points > 0 ? '战斗开始后可分配' : '升级后再来',
            onClick: () => {
              if (spendAttributePoint(entry, id)) bump()
            },
          }, '+1'),
          h('span', { className: 'dsh-pet-attr-effect' }, preview.text),
        )
      })
      return h('div', { className: 'dsh-pet-fold dsh-pet-attrs' },
        head,
        h('div', { className: 'dsh-pet-fold-body' },
          points > 0
            ? h('div', { className: 'dsh-pet-attrs-hint' }, '可用 ' + points + ' 点 · 点击 +1 投入，每级 +1')
            : h('div', { className: 'dsh-pet-attrs-hint' }, '没有可用属性点 · 升级后每级 +1'),
          ...rows,
          h('div', { className: 'dsh-pet-combat' }, describeCombatStats(combat)),
        ),
      )
    }

    function offerPanel(entry, choosing, setChoosing, bump) {
      const battle = entry.battle
      if (battle === null || battle.offer === null || entry.phase === 'result') return null
      const build = battle.build
      const rows = battle.offer.map((id) => {
        const info = choiceInfo(build, id)
        if (info === null) return null
        const active = choosing !== null && choosing.id === id
        const card = h('button', {
          key: id,
          type: 'button',
          className: 'dsh-pet-card',
          onClick: () => {
            const slots = upgradeSlots(build, id)
            if (slots.length === 0) return
            if (slots.length === 1) {
              if (pickUpgrade(entry, id, slots[0])) {
                setChoosing(null)
                bump()
              }
              return
            }
            setChoosing({ id, slots })
          },
        },
          h('span', { className: 'dsh-pet-card-head' },
            h('span', { className: 'dsh-pet-card-name' }, info.baseLabel),
            h('span', {
              className: 'dsh-pet-kind',
              style: { background: info.color },
            }, KIND_LABELS[info.kind] ?? info.kind),
          ),
          h('span', { className: 'dsh-pet-card-desc' }, info.description),
          info.note !== '' ? h('span', { className: 'dsh-pet-card-desc' }, info.note) : null,
        )
        if (!active) return card
        return h('div', { key: id }, card,
          h('div', { className: 'dsh-pet-slotpick' },
            choosing.slots.map((slot) => h('button', {
              key: slot.skillIndex + ':' + slot.kind,
              type: 'button',
              onClick: () => {
                if (pickUpgrade(entry, id, slot)) {
                  setChoosing(null)
                  bump()
                }
              },
            }, placementLabel(build, slot) + (slot.replacing ? '（替换）' : ''))),
            h('button', {
              key: 'cancel',
              type: 'button',
              onClick: () => setChoosing(null),
            }, '取消'),
          ),
        )
      })
      return h('div', { className: 'dsh-pet-offer' },
        h('div', { className: 'dsh-pet-offer-title' },
          h('span', null, (battle.lastStage ?? stageLabel(build, battle.draftCount)) + ' · 三选一'),
          h('span', { className: 'dsh-pet-muted' }, '剩余 ' + battle.pending),
          choosing !== null ? h('span', { className: 'dsh-pet-muted' }, '选择装入位置') : null,
        ),
        ...rows,
      )
    }

    // ---- 地图界面 ----

    /** 折叠时的摘要：当前节点与下一站类型，不需要展开就能看懂。 */
    function mapSummaryLine(entry) {
      const run = entry.map
      if (run === null) return '没有地图'
      const summary = mapRunSummary(run)
      if (summary.finished === true) return '本局已结束'
      const mode = AUTO_MODES[summary.autoMode]?.label ?? ''
      const next = availableNodes(run)
      if (next.length === 0) {
        return (mode === '' ? '' : mode + ' · ') + '当前：' + summary.currentLabel +
          ' · ' + summary.currentSummary
      }
      const labels = next.map((node) => NODE_TYPES[node.type].icon + NODE_TYPES[node.type].label)
      return (mode === '' ? '' : mode + ' · ') + '下一站：' + labels.join(' / ')
    }

    function autoModeRow(entry, bump) {
      const run = entry.map
      return h('div', { className: 'dsh-pet-mode' },
        h('span', null, '自动'),
        ...AUTO_MODE_IDS.map((id) => h('button', {
          key: id,
          type: 'button',
          className: run !== null && run.autoMode === id ? 'on' : '',
          title: AUTO_MODES[id].desc,
          onClick: () => {
            if (setMapAutoMode(entry, id)) bump()
          },
        }, AUTO_MODES[id].label)),
      )
    }

    /** 节点小方块：图标 + 类型文字，完全靠颜色之外的信息区分。 */
    function nodeChip(entry, node, bump, { selectable = false, compact = false } = {}) {
      const run = entry.map
      const def = NODE_TYPES[node.type]
      const status = run === null ? 'unvisited' : nodeStatus(run, node.id)
      const current = run !== null && run.currentNodeId === node.id
      const classes = ['dsh-pet-node']
      if (current) classes.push('cur')
      else if (status === 'done' || status === 'active') classes.push('visited')
      else if (selectable) classes.push('pick')
      else classes.push('dim')
      if (entry.mapInspect === node.id) classes.push('inspected')
      const label = compact ? def.icon : def.icon + ' ' + def.label
      return h('button', {
        key: node.id,
        type: 'button',
        className: classes.join(' '),
        title: def.label + ' · 第 ' + node.floor + ' 层 · ' + nodeSummary(node),
        onClick: () => {
          if (selectable) {
            if (chooseMapNode(entry, node.id)) bump()
            return
          }
          entry.mapInspect = entry.mapInspect === node.id ? null : node.id
          bump()
        },
      }, label)
    }

    /**
     * 地图栏：默认折叠成一行（当前进度 + 下一站），展开后是按层排列的节点。
     * 已走路线保留高亮，未选择路线淡化，可选节点用绿色实心按钮描出来。
     */
    function mapPanel(entry, bump) {
      const run = entry.map
      if (run === null) return null
      const summary = mapRunSummary(run)
      const open = entry.mapOpen === true
      const selectable = new Set(availableNodeIds(run))
      const head = h('button', {
        type: 'button',
        className: 'dsh-pet-fold-head' + (open ? ' open' : ''),
        'aria-expanded': open,
        title: open ? '收起地图' : '展开地图：查看完整路线并选择下一站',
        onClick: () => {
          entry.mapOpen = open !== true
          if (open === true) entry.mapShowAll = false
          bump()
        },
      },
        h('span', { className: 'dsh-pet-fold-caret' }, open ? '▾' : '▸'),
        h('span', { className: 'dsh-pet-fold-title' }, '地图'),
        h('span', { className: 'dsh-pet-muted' }, summary.floor + '/' + summary.depth),
        h('span', { className: 'dsh-pet-fold-summary' }, summary.currentLabel),
      )

      if (!open) {
        return h('div', { className: 'dsh-pet-fold dsh-pet-map' },
          head,
          h('div', { className: 'dsh-pet-map-notice' }, mapSummaryLine(entry)),
        )
      }

      const byFloor = new Map()
      for (const node of run.nodes) {
        if (!byFloor.has(node.floor)) byFloor.set(node.floor, [])
        byFloor.get(node.floor).push(node)
      }
      const rows = []
      const from = entry.mapShowAll === true ? 1 : Math.max(1, summary.floor - 3)
      const to = entry.mapShowAll === true ? run.depth : Math.min(run.depth, summary.floor + 4)
      for (let floor = from; floor <= to; floor += 1) {
        const row = (byFloor.get(floor) ?? []).slice().sort((a, b) => a.column - b.column)
        rows.push(h('div', {
          key: 'floor-' + floor,
          className: 'dsh-pet-map-floor' + (floor === summary.floor ? ' cur' : ''),
        },
          h('span', { className: 'dsh-pet-map-floor-n' }, String(floor)),
          ...row.map((node) => nodeChip(entry, node, bump, { selectable: selectable.has(node.id) })),
        ))
      }
      const inspected = entry.mapInspect === null
        ? null
        : run.nodes.find((node) => node.id === entry.mapInspect) ?? null

      return h('div', { className: 'dsh-pet-fold dsh-pet-map' },
        head,
        autoModeRow(entry, bump),
        h('div', { className: 'dsh-pet-map-body' }, ...rows),
        h('div', { className: 'dsh-pet-map-detail' },
          '种子 ' + summary.seed + ' · 金币 ' + summary.gold +
          ' · 生命 ' + summary.life + '/' + summary.lifeMax +
          ' · ' + (summary.generation.fallback === true ? '保底模板' : '第 ' + summary.generation.attempts + ' 次通过'),
        ),
        inspected === null ? null : h('div', { className: 'dsh-pet-map-detail' },
          h('div', null, NODE_TYPES[inspected.type].icon + ' ' + NODE_TYPES[inspected.type].label +
            ' · 第 ' + inspected.floor + ' 层'),
          h('div', null, NODE_TYPES[inspected.type].desc),
          h('div', null, nodeSummary(inspected)),
        ),
        h('div', { className: 'dsh-pet-mode' },
          h('button', {
            type: 'button',
            onClick: () => {
              entry.mapShowAll = entry.mapShowAll !== true
              bump()
            },
          }, entry.mapShowAll === true ? '只看附近' : '查看完整地图'),
        ),
        entry.mapNotice !== '' ? h('div', { className: 'dsh-pet-map-notice' }, entry.mapNotice) : null,
      )
    }

    /** 分叉时的下一站按钮；自动模式暂停时也靠它接管。 */
    function mapChoicesRow(entry, bump) {
      const run = entry.map
      if (run === null || entry.phase !== 'map') return null
      // 连续失败后的暂停：给一个显式重试入口，而不是默默反复开打。
      if (entry.retryHold === true) {
        return h('div', { className: 'dsh-pet-choices' },
          h('span', null, entry.mapNotice !== '' ? entry.mapNotice : '已暂停自动重试'),
          h('span', { className: 'dsh-pet-spacer' }),
          h('button', {
            type: 'button',
            className: 'dsh-pet-choice',
            title: '带着当前构筑重新挑战当前节点；不会重复发放奖励',
            onClick: () => {
              if (retryCurrentBattle(entry)) bump()
            },
          }, '重试当前节点'),
        )
      }
      const nodes = availableNodes(run)
      return h('div', { className: 'dsh-pet-choices' },
        h('span', null, nodes.length === 0
          ? '没有可选路线'
          : '下一站（第 ' + nodes[0].floor + ' 层）'),
        ...nodes.map((node) => h('button', {
          key: node.id,
          type: 'button',
          className: 'dsh-pet-choice',
          title: NODE_TYPES[node.type].desc + ' · ' + nodeSummary(node),
          onClick: () => {
            if (chooseMapNode(entry, node.id)) bump()
          },
        }, NODE_TYPES[node.type].icon + ' ' + NODE_TYPES[node.type].label)),
        h('span', { className: 'dsh-pet-spacer' }),
        entry.mapNotice !== '' ? h('span', { className: 'dsh-pet-muted' }, entry.mapNotice) : null,
      )
    }

    /** 休息 / 事件 / 商店：选项直接写出代价与结果，付不起的置灰。 */
    function nodePanel(entry, bump) {
      const run = entry.map
      if (run === null || entry.phase !== 'node') return null
      const node = currentNode(run)
      if (node === null) return null
      const def = NODE_TYPES[node.type]
      const head = h('div', { className: 'dsh-pet-node-head' },
        h('span', null, def.icon + ' ' + def.label),
        h('span', { className: 'dsh-pet-muted' }, '第 ' + node.floor + ' 层'),
        h('span', { className: 'dsh-pet-spacer' }),
        h('span', { className: 'dsh-pet-muted' },
          '生命 ' + Math.round(run.life) + '/' + run.lifeMax + ' · 金币 ' + run.gold),
      )

      if (node.type === 'rest') {
        const options = restOptions(run, node.id)
        return h('div', { className: 'dsh-pet-node-panel' },
          head,
          ...options.map((option) => h('button', {
            key: option.id,
            type: 'button',
            className: 'dsh-pet-node-option',
            disabled: option.available !== true,
            onClick: () => {
              if (restChoice(entry, option.id)) bump()
            },
          },
            h('b', null, option.label),
            h('span', null, option.available === true ? option.desc : (option.reason || option.desc)),
          )),
        )
      }

      if (node.type === 'event') {
        const view = eventView(run, node.id)
        return h('div', { className: 'dsh-pet-node-panel' },
          head,
          h('div', { className: 'dsh-pet-node-desc' }, view === null ? '' : view.desc),
          ...(view === null ? [] : view.options.map((option) => h('button', {
            key: option.id,
            type: 'button',
            className: 'dsh-pet-node-option',
            disabled: option.available !== true,
            onClick: () => {
              if (eventChoice(entry, option.id)) bump()
            },
          },
            h('b', null, option.label),
            h('span', null, (option.available === true ? '代价：' : '无法支付：') +
              option.costText + ' · 结果：' + option.resultText),
          ))),
        )
      }

      if (node.type === 'shop') {
        const view = shopView(run, node.id)
        const items = view === null ? [] : view.items
        return h('div', { className: 'dsh-pet-node-panel' },
          head,
          ...items.map((item) => h('button', {
            key: 'item-' + item.index,
            type: 'button',
            className: 'dsh-pet-node-option',
            disabled: item.available !== true,
            onClick: () => {
              if (shopBuy(entry, item.index)) bump()
            },
          },
            h('b', null, item.label + ' · ' + item.price + ' 金币'),
            h('span', null, item.sold === true ? '已售出' : item.desc),
          )),
          h('button', {
            type: 'button',
            className: 'dsh-pet-node-option',
            onClick: () => {
              if (shopLeave(entry)) bump()
            },
          },
            h('b', null, '离开商店'),
            h('span', null, '可以只看不买'),
          ),
        )
      }

      return h('div', { className: 'dsh-pet-node-panel' }, head)
    }

    // ---- 存档大厅 ----

    function formatSaveTime(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '旧存档'
      const date = new Date(ms)
      const pad = (n) => (n < 10 ? '0' + n : String(n))
      return (date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function saveSummary(info) {
      if (info.empty) return '空存档'
      const depth = Number.isFinite(info.depth) ? info.depth : MAP_DEPTH
      if (info.legacy) return '旧版 ' + info.legacyLabel + ' 存档 · 第 ' + info.floor + ' 层'
      return info.styleLabel + ' · 第 ' + info.floor + '/' + depth + ' 层 · Lv.' + info.level + ' · 最佳 ' + info.best
    }

    function saveDetail(info) {
      if (info.empty) return '还没有进度，可在这里新建'
      const points = info.attributePoints > 0 ? ' · 属性点 ' + info.attributePoints : ''
      const gold = Number.isFinite(info.gold) && info.gold > 0 ? ' · 金币 ' + info.gold : ''
      return '击杀 ' + info.kills + ' · 抽卡 ' + info.drafts + ' · 技能 ' + info.skills + points + gold
    }

    function menuButton(label, onClick, options = {}) {
      const classes = ['dsh-pet-menu-btn']
      if (options.primary === true) classes.push('primary')
      if (options.danger === true) classes.push('danger')
      return h('button', {
        type: 'button',
        className: classes.join(' '),
        disabled: options.disabled === true,
        title: options.title,
        onClick,
      }, label)
    }

    function statsForNewGame(entry, info) {
      return {
        ...entry.stats,
        bestFloor: Math.max(1, entry.stats.bestFloor, entry.best, info.empty ? 1 : info.best),
      }
    }

    function debugToggle(bump) {
      const on = debugEnabled()
      return h('div', { className: 'dsh-pet-menu-debug' },
        h('div', { className: 'dsh-pet-menu-debug-row' },
          h('span', { className: 'dsh-pet-menu-label' }, '开发者调试'),
          h('button', {
            type: 'button',
            className: 'dsh-pet-menu-btn' + (on ? ' on' : ''),
            title: '仅影响本机 UI，不写入存档',
            onClick: () => {
              setDebugEnabled(!debugEnabled())
              bump()
            },
          }, on ? '开发者模式：开' : '开发者模式：关'),
        ),
        h('div', { className: 'dsh-pet-menu-hint' },
          on
            ? '已解锁全部风格（本机全局，不写入存档）'
            : '开启后可选择剑修 / 陷阱师等未解锁风格'),
      )
    }

    function slotCard(entry, info, menu, bump) {
      const current = entry.battle !== null && normalizeSlot(entry.slot) === info.slot
      const confirming = menu.confirmDelete === info.slot
      const actions = confirming
        ? h('div', { className: 'dsh-pet-menu-slot-actions' },
            h('span', { className: 'dsh-pet-menu-warn' },
              current ? '删除当前存档会放弃本轮进度。' : '删除后不可恢复。'),
            menuButton('确认删除', () => {
              deleteSave(entry, info.slot)
              bump()
            }, { danger: true }),
            menuButton('取消', () => {
              menu.confirmDelete = -1
              bump()
            }),
          )
        : h('div', { className: 'dsh-pet-menu-slot-actions' },
            info.empty ? null : menuButton('读取', () => {
              if (loadSlot(entry, info.slot)) bump()
            }, { title: '从该存档所在层重新开始' }),
            menuButton(info.empty ? '在此新建' : '覆盖新建', () => {
              openNewGameMenu(entry, info.slot)
              bump()
            }),
            info.empty ? null : menuButton('删除', () => {
              menu.confirmDelete = info.slot
              bump()
            }, { danger: true }),
          )
      return h('div', {
        key: info.slot,
        className: 'dsh-pet-menu-slot' + (current ? ' on' : '') + (info.empty ? ' empty' : ''),
      },
        h('div', { className: 'dsh-pet-menu-slot-head' },
          h('span', { className: 'dsh-pet-menu-slot-name' }, '存档 ' + (info.slot + 1)),
          current ? h('span', { className: 'dsh-pet-menu-tag' }, '当前') : null,
          h('span', { className: 'dsh-pet-menu-slot-time' },
            info.empty ? '空' : formatSaveTime(info.savedAt)),
        ),
        h('div', { className: 'dsh-pet-menu-slot-desc' }, saveSummary(info)),
        info.empty ? null : h('div', { className: 'dsh-pet-menu-slot-desc' }, saveDetail(info)),
        actions,
      )
    }

    function menuHome(entry, bump) {
      const menu = entry.menu
      const slots = listSaveSlots(entry.key)
      const preferred = preferredSlot(entry.key)
      const latestInfo = preferred >= 0 ? slots[preferred] : null
      const running = entry.battle !== null
      const canContinue = running || latestInfo !== null
      const style = styleById(entry.style) ?? defaultStyle()
      const runLevel = entry.battle !== null ? entry.battle.level : entry.level
      const summary = running
        ? '本轮：' + style.label + ' · 第 ' + entry.floor + ' 层 · Lv.' + runLevel
        : latestInfo === null
          ? '还没有存档，开始一局新游戏吧。'
          : '存档：' + saveSummary(latestInfo)
      return h('div', { className: 'dsh-pet-menu' },
        h('div', { className: 'dsh-pet-menu-title' }, 'DSH PET'),
        h('div', { className: 'dsh-pet-menu-sub' }, running ? '暂停中 · 战斗已冻结' : '你干活，它打怪'),
        h('div', { className: 'dsh-pet-menu-slot-desc' }, summary),
        canContinue
          ? menuButton('继续游戏', () => {
              if (continueGame(entry)) bump()
            }, { primary: true })
          : null,
        h('div', { className: 'dsh-pet-menu-actions' },
          running
            ? menuButton('保存进度', () => {
                saveProgress(entry)
                menu.message = '已保存到存档 ' + (normalizeSlot(entry.slot) + 1)
                bump()
              }, { title: '立即写入当前槽位' })
            : null,
          canContinue
            ? menuButton('新游戏', () => {
                openNewGameMenu(entry)
                bump()
              })
            : menuButton('开始游戏', () => {
                openNewGameMenu(entry)
                bump()
              }, { primary: true }),
        ),
        menu.message !== '' ? h('div', { className: 'dsh-pet-menu-msg' }, menu.message) : null,
        h('div', { className: 'dsh-pet-menu-head' }, '存档槽位'),
        ...slots.map((info) => slotCard(entry, info, menu, bump)),
        debugToggle(bump),
        h('div', { className: 'dsh-pet-menu-foot' },
          '进入新层、升级或结算时自动保存到当前槽位；读取其他槽位会从该存档所在层开始。'),
      )
    }

    function menuNewGame(entry, bump) {
      const menu = entry.menu
      const slots = listSaveSlots(entry.key)
      const target = normalizeSlot(menu.newSlot === null ? entry.slot : menu.newSlot)
      const info = slots[target]
      const stats = statsForNewGame(entry, info)
      const debug = debugEnabled()
      const wanted = styleById(menu.newStyle) ?? styleById(entry.style) ?? defaultStyle()
      const selected = styleAvailable(wanted, stats) ? wanted : defaultStyle()
      const styleButtons = listStyles().map((style) => {
        const naturallyUnlocked = isStyleUnlocked(style, stats)
        const unlocked = debug || naturallyUnlocked
        return h('button', {
          key: style.id,
          type: 'button',
          className: 'dsh-pet-style' + (selected.id === style.id ? ' on' : ''),
          disabled: !unlocked,
          title: unlocked
            ? style.desc + (debug && !naturallyUnlocked ? '（开发者模式已解锁）' : '')
            : '未解锁：最高层达到 ' + style.unlockedBy.bestFloor,
          onClick: () => {
            menu.newStyle = style.id
            bump()
          },
        }, style.label)
      })
      const slotButtons = slots.map((slotInfo) => h('button', {
        key: slotInfo.slot,
        type: 'button',
        className: 'dsh-pet-menu-slotpick' + (slotInfo.slot === target ? ' on' : ''),
        onClick: () => {
          menu.newSlot = slotInfo.slot
          const nextStats = statsForNewGame(entry, slotInfo)
          const current = styleById(menu.newStyle)
          if (current === undefined || !styleAvailable(current, nextStats)) {
            menu.newStyle = defaultStyle().id
          }
          bump()
        },
      }, '存档 ' + (slotInfo.slot + 1) + ' · ' +
        (slotInfo.empty ? '空档' : '覆盖 · 第 ' + slotInfo.floor + ' 层')))
      const lockedStyles = debug
        ? []
        : listStyles().filter((style) => !isStyleUnlocked(style, stats))
      return h('div', { className: 'dsh-pet-menu' },
        h('div', { className: 'dsh-pet-menu-title' }, '新游戏'),
        h('div', { className: 'dsh-pet-menu-sub' }, '选择存档位置与起始风格；累计战绩与解锁保留'),
        h('div', { className: 'dsh-pet-menu-label' }, '存档位置'),
        h('div', { className: 'dsh-pet-menu-actions' }, ...slotButtons),
        info.empty
          ? null
          : h('div', { className: 'dsh-pet-menu-warn' },
              '将覆盖存档 ' + (target + 1) + '，重开第 1 层；该档的累计战绩会合并保留。'),
        h('div', { className: 'dsh-pet-menu-label' }, '战斗风格'),
        h('div', { className: 'dsh-pet-style-row' }, ...styleButtons),
        lockedStyles.length > 0
          ? h('div', { className: 'dsh-pet-menu-hint' },
              '未解锁：' + lockedStyles.map((style) =>
                style.label + '（最佳 ' + style.unlockedBy.bestFloor + ' 层）').join(' · ') +
              '；当前最佳 ' + stats.bestFloor + ' 层')
          : null,
        debugToggle(bump),
        h('div', { className: 'dsh-pet-menu-actions' },
          menuButton('开始游戏', () => {
            startNewGame(entry, target, selected.id)
            bump()
          }, { primary: true }),
          menuButton('返回', () => {
            menu.screen = 'home'
            bump()
          }),
        ),
        h('div', { className: 'dsh-pet-menu-foot' },
          '新游戏只重置本轮进度；已解锁风格、最佳层与累计击杀会保留。'),
      )
    }

    function menuPanel(entry, bump) {
      const menu = entry.menu
      if (menu === null) return null
      return menu.screen === 'new' ? menuNewGame(entry, bump) : menuHome(entry, bump)
    }

    /**
     * 战场下方的面板：生命条、折叠属性栏、折叠构筑栏与底部数字。
     * 风格栏与移动栏不在这里显示：风格在「新游戏」界面选择，移动策略跟随
     * 风格默认值，不再占用战场高度。
     */
    function statusPanel(entry, bump) {
      const battle = entry.battle
      const run = entry.map
      // 非战斗节点没有战斗世界，生命条改读地图上跨节点保留的生命。
      const cells = battle === null ? (run === null ? 0 : run.life) : battle.player.cells
      const maxCells = battle === null ? (run === null ? 1 : run.lifeMax) : battle.player.maxCells
      const pct = Math.max(0, Math.min(100, (cells / maxCells) * 100))
      const hpColor = pct > 50 ? '#6ee7a8' : pct > 25 ? '#ffd166' : '#e35d5d'
      return h('div', { className: 'dsh-pet-body-rest' },
        h('div', { className: 'dsh-pet-cells' }, h('i', { style: { width: pct + '%', background: hpColor } })),
        attributePanel(entry, bump),
        buildPanel(entry, bump),
        h('div', { className: 'dsh-pet-bottom' },
          h('span', null, '生命 ' + Math.max(0, Math.ceil(cells)) + '/' + maxCells),
          h('span', null, '击杀 ' + (battle === null ? 0 : battle.kills)),
          h('span', null, '敌 ' + (battle === null ? 0 : battle.enemies.length)),
          h('span', null, '压力 +' + (battle === null ? 0 : battle.extra)),
          battle !== null && battle.surge ? h('span', { className: 'dsh-pet-hot' }, '过载') : null,
          h('span', { className: 'dsh-pet-spacer' }),
          h('span', null, formatTokens(entry.consumed) + ' token'),
        ),
      )
    }

    function PetBody(props) {
      const sessionId = props !== null && props !== undefined && props.sessionId !== undefined
        ? String(props.sessionId)
        : ''
      const canvasRef = React.useRef(null)
      const entryRef = React.useRef(null)
      const [key, setKey] = React.useState(null)
      const [choosing, setChoosing] = React.useState(null)
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
        const id = window.setInterval(poll, POLL_INTERVAL)
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

      if (entry.menu !== null) {
        return h('div', { className: 'dsh-pet' },
          h('style', { key: 'style' }, CSS),
          menuPanel(entry, bump),
        )
      }

      const battle = entry.battle
      const result = entry.phase === 'result' ? entry.lastResult : null
      const run = entry.map
      const mapNodeNow = run === null ? null : currentNode(run)
      const modifier = battle !== null
        ? battle.modifier
        : mapNodeNow === null ? floorModifier(entry.floor) : nodePlan(mapNodeNow)?.modifier ?? null
      const depth = run === null ? MAX_FLOOR : run.depth
      const gold = run === null ? 0 : run.gold
      const reactions = reactionReport(entry)
      const notice = entry.notice
      const offerIds = battle !== null && Array.isArray(battle.offer) ? battle.offer : []
      const activeChoosing =
        choosing !== null && offerIds.includes(choosing.id) ? choosing : null

      return h('div', { className: 'dsh-pet' },
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'dsh-pet-top' },
          h('span', { className: 'dsh-pet-floor' }, '第 ' + entry.floor + '/' + depth + ' 层'),
          h('span', { className: 'dsh-pet-muted' }, 'Lv.' + (battle === null ? entry.level : battle.level)),
          h('span', { className: 'dsh-pet-muted' }, '最佳 ' + entry.best),
          h('span', { className: 'dsh-pet-muted' }, '金币 ' + gold),
          modifier !== null && MODIFIERS[modifier] !== undefined
            ? h('span', { className: 'dsh-pet-hot' }, MODIFIERS[modifier].name)
            : null,
          h('span', { className: 'dsh-pet-spacer' }),
          h('span', { className: 'dsh-pet-muted' }, '技能 ' + (battle === null ? entry.build.skills.length : battle.build.skills.length) + '/' + MAX_SKILLS),
          entry.menu === null ? h('button', {
            type: 'button',
            className: 'dsh-pet-btn',
            title: '存档与菜单',
            onClick: () => {
              openMenu(entry)
              bump()
            },
          }, '存档') : null,
          entry.menu === null ? h('span', { className: 'dsh-pet-dot' + (entry.online ? ' on' : '') }) : null,
        ),
        notice !== '' && entry.menu === null ? h('div', {
          className: 'dsh-pet-notice',
          title: '点击关闭',
          onClick: () => {
            entry.notice = ''
            bump()
          },
        }, notice) : null,
        mapPanel(entry, bump),
        mapChoicesRow(entry, bump),
        h('div', { className: 'dsh-pet-stage' },
          h('canvas', { ref: canvasRef, width: VIEW_W * 2, height: VIEW_H * 2, className: 'dsh-pet-canvas' }),
          entry.banner !== null
            ? h('div', { className: 'dsh-pet-banner' },
                h('div', { className: 'dsh-pet-banner-text' }, entry.banner.text),
                entry.banner.sub !== ''
                  ? h('div', { className: 'dsh-pet-banner-sub' }, entry.banner.sub)
                  : null,
              )
            : null,
          result !== null
            ? h('div', { className: 'dsh-pet-overlay' },
                h('div', {
                  className: 'dsh-pet-overlay-title ' + (result.kind === 'cleared' ? 'good' : 'bad'),
                }, result.kind === 'cleared' ? '清层' : result.kind === 'dead' ? '阵亡' : '超时'),
                h('div', { className: 'dsh-pet-overlay-sub' }, diagnoseRun(entry)),
                h('div', { className: 'dsh-pet-overlay-sub' }, damageReport(entry)),
                reactions !== '' ? h('div', { className: 'dsh-pet-reactions' }, reactions) : null,
              )
            : entry.phase === 'node'
              ? nodePanel(entry, bump)
              : entry.phase === 'map'
                ? h('div', { className: 'dsh-pet-overlay' },
                    h('div', { className: 'dsh-pet-overlay-title' }, '分叉'),
                    h('div', { className: 'dsh-pet-overlay-sub' },
                      run !== null && run.autoMode === 'manual' ? '选择下一站' : '自动路线已暂停'),
                    entry.mapNotice !== ''
                      ? h('div', { className: 'dsh-pet-map-notice' }, entry.mapNotice)
                      : null,
                  )
                : offerPanel(entry, activeChoosing, setChoosing, bump),
        ),
        entry.menu === null ? statusPanel(entry, bump) : null,
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
            guide: [{ id: 'pet', title: '宠物', description: '按层推进的技能自动战斗' }],
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
        pickUpgrade,
        equipFromReserve,
        spendAttributePoint,
        attributePanel,
        toggleAttributes,
        buildPanel,
        toggleBuild,
        statusPanel,
        allocateAttribute,
        attributeSummary,
        advance,
        awardXp,
        pushTokens,
        damageReport,
        reactionReport,
        loadAccount,
        setStyle,
        setMovement,
        listStyles,
        isStyleUnlocked,
        listSaveSlots,
        latestSlot,
        activeSlot,
        preferredSlot,
        loadSlot,
        continueGame,
        startNewGame,
        deleteSave,
        openMenu,
        openNewGameMenu,
        saveAccount,
        saveProgress,
        formatSaveTime,
        saveSummary,
        menuPanel,
        css: CSS,
        debugEnabled,
        setDebugEnabled,
        styleAvailable,
        // 地图系统：进度、界面与存档
        startMapNode,
        startNodeBattle,
        chooseMapNode,
        advanceMap,
        retryCurrentBattle,
        mapPanel,
        mapChoicesRow,
        nodePanel,
        mapSummaryLine,
        restChoice,
        eventChoice,
        shopBuy,
        shopLeave,
        autoResolveNode,
        setMapAutoMode,
        applyMapEffects,
        mapRunSummary,
        serializeMapRun,
        restoreMapRun,
        createMapRun,
        availableNodes,
        availableNodeIds,
        beginNode,
        completeNode,
        retryNode,
        leaveNode,
        pickNextNode,
        autoReasonText,
        currentNode,
        nodeStatus,
        nodePlan,
        nodeBattlePlan,
        isBattleNode,
        migrateMapRun,
        AUTO_MODES,
        AUTO_MODE_IDS,
        NODE_TYPES,
      },
    }
  },
})
