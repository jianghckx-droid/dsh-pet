// 地图配置：层数、宽度、类型权重、保底间隔与奖励基数。
//
// 数值来自 docs/map-system-design.md 与 docs/map-generation-design.md，
// 属于待试玩验证的原型参数。改动权重或间隔会改变同种子生成的地图，
// 必须同步提升 MAP_VERSION，并在分享种子时标明版本。
//
// 由 45% 普通 / 20% 事件 / 12% 休息 / 10% 商店 / 13% 精英的参考权重估算，
// 一局约经历 44 场普通战斗与 13 场精英战斗。

export const MAP_VERSION = 1;

/** 地点类型：全部对 UI 暴露图标、颜色与说明，不只靠颜色区分。 */
export const NODE_TYPES = Object.freeze({
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

export const NODE_TYPE_IDS = Object.freeze(['normal', 'elite', 'rest', 'event', 'shop', 'boss']);

/** 自动路线偏好。手动接管随时可用。 */
export const AUTO_MODES = Object.freeze({
  manual: Object.freeze({ id: 'manual', label: '手动', desc: '每到分叉都停下，由玩家自己选择' }),
  steady: Object.freeze({ id: 'steady', label: '稳健', desc: '低生命优先休息，尽量避开精英' }),
  balanced: Object.freeze({ id: 'balanced', label: '均衡', desc: '兼顾恢复、商店与成长，状态好时才考虑精英' }),
  risky: Object.freeze({ id: 'risky', label: '冒险', desc: '优先精英和高风险事件' }),
});

export const AUTO_MODE_IDS = Object.freeze(['manual', 'steady', 'balanced', 'risky']);

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
export function mapConfig(overrides = {}) {
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
export function prototypeConfig(overrides = {}) {
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
export const MAP_CONFIG = mapConfig();

/** 存档里保存的配置快照：只保留影响生成的字段。 */
export function snapshotMapConfig(config) {
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
export function fixedNodeType(floor, config) {
  if (floor <= 1) return 'normal';
  if (floor === config.depth) return 'boss';
  if (floor === config.depth - 1) return 'rest';
  return null;
}
