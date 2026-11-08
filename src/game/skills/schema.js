// 技能系统的静态契约：能力、效果类型、边界。
//
// 处理器名单由 actions/contracts.js 与 modifiers/index.js 提供，注册表直接读取
// 这些实现契约，避免"白名单里有名字、运行时却没有实现"的两份真相。

/** 能力表示技能可承诺的行为，不是标签。 */
export const CAPABILITIES = Object.freeze([
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

export const EFFECT_TYPES = Object.freeze(['applyStatus']);

export const REACTION_EVENTS = Object.freeze(['statusApplied', 'hitResolved', 'entityDied']);

export const REACTION_HANDLERS = Object.freeze(['spreadFire', 'conductive', 'shatter']);

/** 战斗风格可选的移动策略；风格只提供默认值。 */
export const MOVEMENT_STRATEGIES = Object.freeze(['approach', 'keepDistance', 'auto']);

/** 一局内的构筑上限；第一版原型按设计稿只开放两个技能。 */
export const BUILD_LIMITS = Object.freeze({
  maxSkills: 2,
  maxReserve: 3,
});

/** 运行时的安全护栏。超限必须可诊断，不能静默随机丢弃。 */
export const RUNTIME_LIMITS = Object.freeze({
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
