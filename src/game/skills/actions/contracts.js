// 动作契约：验证参数、生成描述、声明移动提示。
//
// 这里只依赖格式化工具，不导入运行时或世界。注册表用它校验内容，编译器和
// 升级界面用它生成最终描述；具体行为在 actions/*.js 中实现。

import { fmtNumber } from '../format.js';

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

export const ACTION_CONTRACTS = Object.freeze({
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

export const ACTION_HANDLER_IDS = Object.freeze(Object.keys(ACTION_CONTRACTS));

export function actionContract(id) {
  return ACTION_CONTRACTS[id];
}
