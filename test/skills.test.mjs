import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTENT,
  buildContent,
  contentById,
  contentList,
  validateContent,
} from '../src/game/skills/registry.js';
import { BUILD_LIMITS } from '../src/game/skills/schema.js';
import {
  BUILD_VERSION,
  compileBuild,
  emptyBuild,
  normalizeBuild,
  pruneBuild,
} from '../src/game/skills/compile.js';
import {
  choiceInfo,
  equipReserveComponent,
  installChoice,
  offerUpgrades,
  placementsFor,
  replacementsFor,
  stageLabel,
  upgradeSlots,
} from '../src/game/skills/draft.js';

const LISTS = {
  action: contentList('action'),
  element: contentList('element'),
  modifier: contentList('modifier'),
  status: contentList('status'),
  reaction: contentList('reaction'),
  style: contentList('style'),
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('内容注册：动作、属性、修饰、状态、反应与风格都通过校验', () => {
  assert.deepEqual(validateContent(LISTS), []);
  assert.equal(contentList('action').length, 9);
  assert.equal(contentList('element').length, 3);
  assert.equal(contentList('modifier').length, 5);
  assert.equal(contentList('reaction').length, 3);
  assert.equal(contentList('style').length, 4);
  assert.equal(CONTENT.order.reaction.includes('spreadFire'), true);
  assert.equal(contentById('fire').kind, 'element');
});

test('内容注册拒绝重复 ID', () => {
  const actions = [...LISTS.action, clone(LISTS.action[0])];
  const errors = validateContent({ ...LISTS, action: actions });
  assert.ok(errors.some((message) => message.includes('重复 ID')), errors.join('\n'));
});

test('内容注册拒绝未知处理器、缺失状态引用与非法参数', () => {
  const actions = clone(LISTS.action);
  actions[0].handler = 'laser';
  assert.ok(
    validateContent({ ...LISTS, action: actions }).some((message) => message.includes('未知动作处理器')),
  );

  const elements = clone(LISTS.element);
  elements[0].onHit[0].status = 'poison';
  assert.ok(
    validateContent({ ...LISTS, element: elements }).some((message) => message.includes('未知状态')),
  );

  const slow = clone(LISTS.action);
  slow[0].params.cooldown = 0;
  assert.ok(
    validateContent({ ...LISTS, action: slow }).some((message) => message.includes('cooldown 必须大于 0')),
  );
});

test('内容注册拒绝未知反应事件与处理器', () => {
  const reactions = clone(LISTS.reaction);
  reactions[0].event = 'somethingHappened';
  reactions[1].handler = 'explode';
  const errors = validateContent({ ...LISTS, reaction: reactions });
  assert.ok(errors.some((message) => message.includes('未知语义事件')));
  assert.ok(errors.some((message) => message.includes('未知反应处理器')));
});

test('buildContent 在内容有错时直接抛错', () => {
  const broken = clone(LISTS.action);
  broken[0].handler = 'laser';
  assert.throws(() => buildContent({ ...LISTS, action: broken }), /技能内容注册失败/);
});

test('基础构筑：动作单独存在即可编译，描述覆盖真实冷却与伤害', () => {
  const compiled = compileBuild(emptyBuild());
  assert.equal(compiled.ok, true);
  assert.equal(compiled.plans.length, 1);
  const plan = compiled.plans[0];
  assert.equal(plan.action.id, 'projectile');
  assert.equal(plan.element, null);
  assert.equal(plan.modifier, null);
  assert.equal(plan.damage, 2);
  assert.equal(plan.cooldown, 0.9);
  assert.ok(plan.description.includes('0.9'));
  assert.ok(plan.description.includes('2'));
  assert.ok(plan.description.includes('飞弹'));
});

test('属性与修饰进入计划：火焰飞弹 + 分裂的数值来自同一份编译结果', () => {
  const build = {
    version: BUILD_VERSION,
    skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' }],
    reserve: [],
  };
  const compiled = compileBuild(build);
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0];
  assert.equal(plan.element.id, 'fire');
  assert.equal(plan.modifier.id, 'split');
  assert.equal(plan.effects[0].status, 'burn');
  assert.ok(plan.description.includes('灼烧'));
  assert.ok(plan.description.includes('分裂'));
  assert.ok(plan.description.includes('50%'));
  assert.ok(plan.description.includes('2 个目标'));
});

test('雷电的被动伤害与充能效果进入计划', () => {
  const compiled = compileBuild({
    skills: [{ id: 'skill-1', action: 'projectile', element: 'thunder' }],
    reserve: [],
  });
  assert.equal(compiled.plans[0].damage, 3);
  assert.equal(compiled.plans[0].effects[0].status, 'charge');
});

test('能力要求不匹配时返回结构化错误，并忽略该槽位', () => {
  const compiled = compileBuild({
    skills: [{ id: 'skill-1', action: 'aura', element: null, modifier: 'split' }],
    reserve: [],
  });
  assert.equal(compiled.ok, false);
  assert.equal(compiled.errors[0].code, 'capability-mismatch');
  assert.equal(compiled.errors[0].path, 'skills[0].modifier');
  assert.equal(compiled.plans[0].modifier, null);
});

test('投射物不能装扩大或牵引；冲击可以装全部范围类修饰', () => {
  for (const modifier of ['expand', 'pull']) {
    const compiled = compileBuild({
      skills: [{ id: 'skill-1', action: 'projectile', modifier }],
      reserve: [],
    });
    assert.equal(compiled.ok, false, modifier);
    assert.equal(compiled.errors[0].code, 'capability-mismatch');
  }
  for (const modifier of ['expand', 'pull', 'echo']) {
    const compiled = compileBuild({
      skills: [{ id: 'skill-1', action: 'impact', modifier }],
      reserve: [],
    });
    assert.equal(compiled.ok, true, modifier);
  }
});

test('未知组件产生可显示错误，不影响其他合法技能', () => {
  const compiled = compileBuild({
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire' },
      { id: 'skill-2', action: 'impact', element: 'poison' },
    ],
    reserve: ['no-such-thing'],
  });
  assert.equal(compiled.ok, false);
  assert.equal(compiled.plans.length, 2);
  assert.ok(compiled.errors.some((error) => error.code === 'unknown-element'));
  assert.ok(compiled.warnings.some((warning) => warning.code === 'unknown-reserve'));
});

test('技能数量上限由编译期校验，而不是静默截断', () => {
  const compiled = compileBuild({
    skills: [
      { id: 'skill-1', action: 'projectile' },
      { id: 'skill-2', action: 'aura' },
      { id: 'skill-3', action: 'impact' },
    ],
    reserve: [],
  });
  assert.equal(compiled.ok, false);
  assert.ok(compiled.errors.some((error) => error.code === 'too-many-skills'));
  assert.equal(compiled.plans.length, BUILD_LIMITS.maxSkills);
});

test('normalizeBuild 补齐空槽、去重备用栏、保留稳定技能 ID', () => {
  const build = normalizeBuild({
    skills: [{ action: 'aura' }, { id: 'custom', action: 'impact', element: null, modifier: null }],
    reserve: ['fire', 'fire', 'split', 'echo', 'pull'],
  });
  assert.equal(build.version, BUILD_VERSION);
  assert.equal(build.skills[0].id, 'skill-1');
  assert.equal(build.skills[0].element, null);
  assert.equal(build.skills[1].id, 'custom');
  assert.deepEqual(build.reserve, ['fire', 'split', 'echo']);
});

test('pruneBuild 清空已移除组件并报告，保留可用部分', () => {
  const pruned = pruneBuild({
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'nope' },
      { id: 'skill-2', action: 'removed-action', element: 'fire' },
    ],
    reserve: ['frost', 'gone'],
  });
  assert.equal(pruned.build.skills.length, 1);
  assert.equal(pruned.build.skills[0].element, 'fire');
  assert.equal(pruned.build.skills[0].modifier, null);
  assert.deepEqual(pruned.build.reserve, ['frost']);
  assert.ok(pruned.removed.includes('nope'));
  assert.ok(pruned.removed.includes('removed-action'));
  assert.ok(pruned.removed.includes('gone'));
});

test('pruneBuild 修复重复技能实例 ID，避免两个实例共用一个冷却', () => {
  const pruned = pruneBuild({
    skills: [
      { id: 'same', action: 'projectile' },
      { id: 'same', action: 'aura' },
    ],
    reserve: [],
  });
  assert.equal(pruned.build.skills.length, 2);
  assert.notEqual(pruned.build.skills[0].id, pruned.build.skills[1].id);
  assert.ok(pruned.removed.includes('same'));
});

test('放置规则：分裂只进 targeted，扩大只进 area，动作只能开新技能', () => {
  const build = emptyBuild();
  assert.equal(placementsFor(build, 'fire').length, 1);
  assert.equal(placementsFor(build, 'split').length, 1);
  assert.equal(placementsFor(build, 'expand').length, 0);
  assert.equal(placementsFor(build, 'pull').length, 0);
  assert.equal(placementsFor(build, 'aura').length, 1);
  assert.equal(placementsFor(build, 'projectile').length, 0, 'already owned');

  const auraBuild = {
    skills: [{ id: 'skill-1', action: 'aura', element: null, modifier: null }],
    reserve: [],
  };
  assert.equal(placementsFor(auraBuild, 'split').length, 0);
  assert.equal(placementsFor(auraBuild, 'expand').length, 1);
  assert.equal(placementsFor(auraBuild, 'pull').length, 1);
});

test('替换槽位：空槽优先，装满后才给出替换选项', () => {
  const build = {
    skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: null }],
    reserve: [],
  };
  assert.equal(placementsFor(build, 'frost').length, 0);
  const replacements = replacementsFor(build, 'frost');
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].replacing, true);
});

test('装入与替换：旧组件进入备用栏，备用栏上限为三', () => {
  const build = {
    skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' }],
    reserve: ['echo', 'pull'],
  };
  const installed = installChoice(build, 'frost', { kind: 'element', skillIndex: 0, replacing: true });
  assert.equal(installed.ok, true);
  assert.equal(installed.build.skills[0].element, 'frost');
  assert.ok(installed.build.reserve.includes('fire'));
  assert.equal(installed.build.reserve.length, BUILD_LIMITS.maxReserve);

  const full = installChoice(installed.build, 'thunder', { kind: 'element', skillIndex: 0, replacing: true });
  assert.equal(full.ok, true);
  assert.equal(full.build.reserve.length, BUILD_LIMITS.maxReserve);
  assert.equal(full.warnings[0].code, 'reserve-full');
});

test('原子替换：取出项位于备用栏首、中、末都不丢失组件', () => {
  for (const reserve of [
    ['thunder', 'frost', 'echo'],
    ['frost', 'thunder', 'echo'],
    ['frost', 'echo', 'thunder'],
  ]) {
    const build = {
      skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: null }],
      reserve: [...reserve],
    };
    const installed = installChoice(build, 'thunder', {
      kind: 'element',
      skillIndex: 0,
      replacing: true,
    });
    assert.equal(installed.ok, true);
    assert.deepEqual(installed.build.reserve, ['frost', 'echo', 'fire']);
    assert.equal(installed.warnings.length, 0);
  }
});

test('原子替换：取出后仍满员才丢弃最旧组件并提示', () => {
  const build = {
    skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: null }],
    reserve: ['frost', 'echo', 'pull'],
  };
  const installed = installChoice(build, 'thunder', {
    kind: 'element',
    skillIndex: 0,
    replacing: true,
  });
  assert.equal(installed.ok, true);
  assert.deepEqual(installed.build.reserve, ['echo', 'pull', 'fire']);
  assert.equal(installed.warnings[0].code, 'reserve-full');
  assert.ok(installed.warnings[0].message.includes('frost'));
});

test('弧光飞剑：描述展示射程、冷却、单目标与拦截；分裂与范围修饰不开放', () => {
  const compiled = compileBuild({
    skills: [{ id: 'skill-1', action: 'arcSword', element: null, modifier: null }],
    reserve: [],
  });
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0];
  assert.equal(plan.movement.preferredRange, 78);
  assert.equal(plan.capabilities.includes('homing'), true);
  assert.equal(plan.capabilities.includes('ranged'), false, '首版不向分裂开放');
  assert.ok(plan.description.includes('104'), plan.description);
  assert.ok(plan.description.includes('1.2'), plan.description);
  assert.ok(plan.description.includes('2'), plan.description);
  assert.ok(plan.description.includes('首个目标'), plan.description);
  assert.ok(plan.description.includes('拦截'), plan.description);

  for (const modifier of ['split', 'expand', 'pull']) {
    const blocked = compileBuild({
      skills: [{ id: 'skill-1', action: 'arcSword', modifier }],
      reserve: [],
    });
    assert.equal(blocked.ok, false, modifier);
    assert.equal(blocked.errors[0].code, 'capability-mismatch');
  }
  for (const modifier of ['echo', 'detonate']) {
    const allowed = compileBuild({
      skills: [{ id: 'skill-1', action: 'arcSword', modifier }],
      reserve: [],
    });
    assert.equal(allowed.ok, true, modifier);
  }
});

test('修饰能力契约：分裂只接受远程动作，近战与御剑不能分裂', () => {
  for (const action of ['projectile', 'impact']) {
    const compiled = compileBuild({
      skills: [{ id: 'skill-1', action, modifier: 'split' }],
      reserve: [],
    });
    assert.equal(compiled.ok, true, action);
  }
  for (const action of ['swing', 'orbitSword', 'trap']) {
    const compiled = compileBuild({
      skills: [{ id: 'skill-1', action, modifier: 'split' }],
      reserve: [],
    });
    assert.equal(compiled.ok, false, action);
    assert.equal(compiled.errors[0].code, 'capability-mismatch');
  }
});

test('描述数据来自最终计划，而不是事后检查数字子串', () => {
  const compiled = compileBuild({
    skills: [{ id: 'skill-1', action: 'impact', element: 'thunder', modifier: 'expand' }],
    reserve: [],
  });
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0];
  assert.equal(plan.descriptionData.numbers.cooldown, plan.cooldown);
  assert.equal(plan.descriptionData.numbers.radius, plan.radius);
  assert.equal(plan.descriptionData.numbers.damage, plan.damage);
  assert.equal(plan.descriptionData.element.damage, 6);
  assert.equal(plan.descriptionData.modifier.id, 'expand');
  assert.ok(plan.descriptionData.action.includes('冲击'));
});

test('动作替换：满槽后新动作替换旧动作，保留兼容组件并把旧组件移入备用栏', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: 'frost', modifier: 'pull' },
    ],
    reserve: [],
  };
  const slots = upgradeSlots(build, 'swing');
  assert.equal(slots.length, 2);
  assert.equal(slots[0].replacing, true);

  const installed = installChoice(build, 'swing', slots[0]);
  assert.equal(installed.ok, true);
  assert.equal(installed.build.skills[0].id, 'skill-1', '技能实例 ID 保持稳定');
  assert.equal(installed.build.skills[0].action, 'swing');
  assert.equal(installed.build.skills[0].element, 'fire', '火焰仍兼容挥斩');
  assert.equal(installed.build.skills[0].modifier, null, '分裂不再兼容');
  assert.ok(installed.build.reserve.includes('projectile'));
  assert.ok(installed.build.reserve.includes('split'));
  assert.deepEqual(installed.retained, ['fire']);
  assert.equal(compileBuild(installed.build).ok, true);
});

test('动作替换：两个组件都兼容时只移走旧动作', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: null, modifier: null },
    ],
    reserve: [],
  };
  const installed = installChoice(build, 'impact', {
    kind: 'action',
    skillIndex: 0,
    replacing: true,
  });
  assert.equal(installed.ok, true);
  assert.equal(installed.build.skills[0].action, 'impact');
  assert.equal(installed.build.skills[0].element, 'fire');
  assert.equal(installed.build.skills[0].modifier, 'split');
  assert.deepEqual(installed.build.reserve, ['projectile']);
});

test('动作替换：备用栏不足时拒绝而不是静默丢弃', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: null, modifier: null },
    ],
    reserve: ['echo', 'pull', 'expand'],
  };
  const snapshot = JSON.parse(JSON.stringify(build));
  const installed = installChoice(build, 'swing', {
    kind: 'action',
    skillIndex: 0,
    replacing: true,
  });
  assert.equal(installed.ok, false);
  assert.equal(installed.reason, 'reserve-full');
  assert.ok(installed.required >= 1);
  assert.deepEqual(build, snapshot, '失败不得修改构筑');
});

test('动作替换候选在满槽时仍会进入三选一', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: null },
      { id: 'skill-2', action: 'aura', element: 'frost', modifier: null },
    ],
    reserve: [],
  };
  const offer = offerUpgrades(build, seeded(5), { draftCount: 4 });
  assert.ok(offer.some((id) => contentById(id).kind === 'action'), offer.join(','));
});

test('动作替换候选会预览保留与移入备用栏的组件', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: null, modifier: null },
    ],
    reserve: [],
  };
  const info = choiceInfo(build, 'swing', { kind: 'action', skillIndex: 0, replacing: true });
  assert.equal(info.blocked, false);
  assert.ok(info.description.includes('挥斩'));
  assert.ok(info.note.includes('备用栏'));
  assert.ok(info.note.includes('飞弹'));
  assert.ok(info.note.includes('分裂'));
  assert.deepEqual(info.retained, ['fire']);
});

test('动作替换候选在空间不足时显示阻塞原因', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: null, modifier: null },
    ],
    reserve: ['echo', 'pull', 'expand'],
  };
  const info = choiceInfo(build, 'swing', { kind: 'action', skillIndex: 0, replacing: true });
  assert.equal(info.blocked, true);
  assert.ok(info.note.includes('备用栏空间不足'));
});

test('动作替换：备用栏满时不把阻塞候选放进三选一', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: 'frost', modifier: 'pull' },
    ],
    reserve: ['echo', 'expand', 'detonate'],
  };
  const offer = offerUpgrades(build, seeded(5), { draftCount: 4 });
  assert.ok(offer.length > 0);
  assert.ok(offer.every((id) => contentById(id).kind !== 'action'), offer.join(','));
});

test('扩大描述使用编译后的最终冷却与范围', () => {
  const compiled = compileBuild({
    skills: [{ id: 'skill-1', action: 'aura', element: 'fire', modifier: 'expand' }],
    reserve: [],
  });
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0];
  assert.ok(plan.description.includes('1.38'), plan.description);
  assert.ok(plan.description.includes('43.5'), plan.description);
  assert.ok(!plan.description.includes('每 1.1 秒'), plan.description);
});
test('备用栏组件可以装回空槽', () => {
  const build = {
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: null },
      { id: 'skill-2', action: 'aura', element: null, modifier: null },
    ],
    reserve: ['frost'],
  };
  const equipped = equipReserveComponent(build, 'frost');
  assert.equal(equipped.ok, true);
  assert.equal(equipped.build.skills[1].element, 'frost');
  assert.equal(equipped.build.reserve.includes('frost'), false);
});

test('升级阶段：第一次只给属性，之后开放修饰，再开放第二个动作', () => {
  const build = emptyBuild();
  const first = offerUpgrades(build, seeded(3), { draftCount: 0 });
  assert.equal(first.length, 3);
  assert.ok(first.every((id) => contentById(id).kind === 'element'));
  assert.equal(stageLabel(build, 0), '选择属性');

  const second = offerUpgrades(build, seeded(3), { draftCount: 1 });
  assert.ok(second.some((id) => contentById(id).kind === 'modifier'));

  const withElement = installChoice(build, 'fire', { kind: 'element', skillIndex: 0 }).build;
  const later = offerUpgrades(withElement, seeded(3), { draftCount: 3 });
  assert.ok(later.some((id) => contentById(id).kind === 'action'));
  assert.equal(stageLabel(withElement, 3), '选择动作');
});

test('三选一稳定：同一 seed 与同一 build 给同一组候选', () => {
  const build = emptyBuild();
  const a = offerUpgrades(build, seeded(11), { draftCount: 2 });
  const b = offerUpgrades(build, seeded(11), { draftCount: 2 });
  assert.deepEqual(a, b);
});

test('候选描述是装入后的完整描述', () => {
  const build = emptyBuild();
  const info = choiceInfo(build, 'fire');
  assert.equal(info.kind, 'element');
  assert.ok(info.description.includes('灼烧'));
  assert.ok(info.description.includes('飞弹'));

  const split = choiceInfo(build, 'split');
  assert.ok(split.description.includes('分裂'));
  assert.ok(split.description.includes('50%'));
});

test('upgradeSlots 在装满后回退到替换槽，不会静默丢弃选择', () => {
  const build = {
    skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' }],
    reserve: [],
  };
  const slots = upgradeSlots(build, 'echo');
  assert.equal(slots.length, 1);
  assert.equal(slots[0].replacing, true);
});
