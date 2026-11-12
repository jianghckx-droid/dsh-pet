// 修饰阶段处理器：编译参数、命中后命令、描述。
//
// 结算器只把统一的上下文交给当前修饰，不按修饰类型写分支。未来开放多修饰时
// 按 MODIFIER_PHASES 的优先级排序；本次每个技能仍只有一个修饰槽。

import { fmtNumber, percentText } from '../format.js';

export const MODIFIER_PHASES = Object.freeze({
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

export const MODIFIER_HANDLERS = Object.freeze({
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

export const MODIFIER_HANDLER_IDS = Object.freeze(Object.keys(MODIFIER_HANDLERS));

export function modifierHandler(type) {
  return MODIFIER_HANDLERS[type];
}

/** 注册表调用：校验 transform 结构与参数。 */
export function validateModifier(def) {
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
export function compileModifier(modifier, numbers) {
  if (modifier === null || modifier === undefined) return numbers;
  const handler = MODIFIER_HANDLERS[modifier.transform.type];
  if (handler === undefined || typeof handler.compile !== 'function') return numbers;
  return handler.compile(numbers, modifier.transform);
}

/** 描述期：由处理器提供最终数值描述，未知处理器返回空串（注册表已拒绝）。 */
export function describeModifier(modifier, plan) {
  if (modifier === null || modifier === undefined) return '';
  const handler = MODIFIER_HANDLERS[modifier.transform.type];
  if (handler === undefined || typeof handler.describe !== 'function') return '';
  return handler.describe(plan, modifier.transform);
}

/** 命中后阶段：结算器只负责准备上下文。 */
export function applyModifierOnHit(modifier, context) {
  if (modifier === null || modifier === undefined) return;
  const handler = MODIFIER_HANDLERS[modifier.transform.type];
  if (handler === undefined || typeof handler.onHit !== 'function') return;
  handler.onHit(context);
}
