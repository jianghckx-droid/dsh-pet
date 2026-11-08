// 技能冷却与动作调度：只负责"到期 → 检查 → 施放 → 启动冷却"。
//
// 具体行为在 actions/*.js；动作通过 action context 查询目标、创建实体和提交
// 命中。没有目标或实体上限时 canCast 返回 false，技能保持就绪，下一固定步重试。

import { ARENA } from './constants.js';
import { ensureResolutionState, diagnose } from './resolve.js';
import { actionImplementation } from './actions/index.js';
import { createActionContext } from './world.js';

export { ARENA };

export function castDueSkills(world, dt) {
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
    skill.timer = plan.cooldown;
    world.stats.casts[plan.id] = (world.stats.casts[plan.id] ?? 0) + 1;
  }
}

/** 新建技能实例：开局给一小段预热，避免同时开火。 */
export function createSkillInstances(plans) {
  return plans.map((plan) => ({
    id: plan.id,
    plan,
    timer: plan.cooldown * 0.35,
    castCount: 0,
  }));
}

/**
 * 编辑构筑后的重编译接入点。
 * 已存在的实体保留自己的 plan 快照；冷却按技能实例 ID 继承。
 */
export function replaceSkillInstances(world, plans) {
  const previous = new Map(world.skills.map((skill) => [skill.plan.id, skill]));
  world.skills = plans.map((plan) => {
    const old = previous.get(plan.id);
    return {
      id: plan.id,
      plan,
      timer: old === undefined ? plan.cooldown * 0.35 : Math.min(old.timer, plan.cooldown),
      castCount: old === undefined ? 0 : old.castCount,
    };
  });
}

export function resetSkillCooldowns(world) {
  for (const skill of world.skills) skill.timer = 0;
}

export function skillColor(plan) {
  if (plan === null || plan === undefined) return '#7f93a3';
  return plan.element === null ? plan.action.color : plan.element.color;
}
