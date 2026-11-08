// 内容注册表：按类别保存定义并拒绝重复 ID、未知处理器、缺失引用、非法参数。
//
// 定义是数据，不是函数；运行时只通过稳定 ID 查找，不允许 UI 或战斗层按
// 中文名称匹配。注册表冻结后不再变化，冷却、层数等实例状态只存在于战斗状态。
//
// 动作契约来自 actions/contracts.js，修饰契约来自 modifiers/index.js；
// 注册表不再维护第二份处理器白名单。

import {
  BUILD_LIMITS,
  CAPABILITIES,
  EFFECT_TYPES,
  MOVEMENT_STRATEGIES,
  REACTION_EVENTS,
  REACTION_HANDLERS,
} from './schema.js';
import { ACTION_CONTRACTS } from './actions/contracts.js';
import { validateModifier } from './modifiers/index.js';
import { ACTION_DEFS } from './content/actions.js';
import { ELEMENT_DEFS } from './content/elements.js';
import { MODIFIER_DEFS } from './content/modifiers.js';
import { REACTION_DEFS } from './content/reactions.js';
import { STATUS_DEFS } from './content/statuses.js';
import { STYLE_DEFS } from './content/styles.js';

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
export function validateContent(lists = KINDS) {
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
export function buildContent(lists = KINDS) {
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

export const CONTENT = buildContent();

export function contentById(id) {
  if (typeof id !== 'string') return undefined;
  return CONTENT.defs.get(id);
}

export function contentByKind(kind) {
  return CONTENT.byKind[kind] ?? new Map();
}

export function contentList(kind) {
  return (CONTENT.order[kind] ?? []).map((id) => CONTENT.byKind[kind].get(id));
}

export function isKind(id, kind) {
  const def = contentById(id);
  return def !== undefined && def.kind === kind;
}
