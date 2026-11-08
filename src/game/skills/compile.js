// 构筑编译：build → 校验 → 不可变 SkillPlan。
//
// 运行时不再反复扫描构筑；冷却、伤害、范围、命中效果和描述都来自同一份
// 编译结果。动作描述由 actions/contracts.js 提供，修饰描述由 modifiers/index.js
// 提供；未知处理器直接失败，不再静默回退成另一种动作的文案。
//
// 失败返回结构化错误（code / path / message），调用方可以逐条显示。

import { BUILD_LIMITS } from './schema.js';
import { CONTENT, contentById } from './registry.js';
import { ACTION_CONTRACTS } from './actions/contracts.js';
import { compileModifier, describeModifier } from './modifiers/index.js';
import { fmtNumber } from './format.js';

export const BUILD_VERSION = 3;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function freezePlan(plan) {
  Object.freeze(plan.effects);
  Object.freeze(plan.tags);
  Object.freeze(plan.capabilities);
  Object.freeze(plan.descriptionData);
  return Object.freeze(plan);
}

export function emptyBuild() {
  return {
    version: BUILD_VERSION,
    skills: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
    reserve: [],
  };
}

/** 把任意存档/UI 输入收敛成合法形状；不在这里判断内容是否存在。 */
export function normalizeBuild(input) {
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
export function compileBuild(input) {
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
export function firstPlan(plans) {
  return Array.isArray(plans) && plans.length > 0 ? plans[0] : null;
}

/**
 * 存档修复：移除已删除的组件，清空不兼容的槽位，丢弃非法备用栏条目。
 * 返回被移除的 ID，供 UI 显示"存档已修复"提示。
 */
export function pruneBuild(input) {
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
export function contentCatalog() {
  return CONTENT.order;
}
