import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattle, step } from '../src/game/arena.js';
import { compileBuild } from '../src/game/skills/compile.js';
import { ACTION_CONTRACTS } from '../src/game/skills/actions/contracts.js';
import { ACTION_IMPLEMENTATIONS, actionImplementation } from '../src/game/skills/actions/index.js';
import { createActionContext } from '../src/game/skills/world.js';
import { processCommands } from '../src/game/skills/resolve.js';
import { updateEntities } from '../src/game/skills/entities/index.js';
import { replaceSkillInstances } from '../src/game/skills/runtime.js';
import { RUNTIME_LIMITS } from '../src/game/skills/schema.js';
import { makeEnemy } from './helpers.mjs';

function buildFor(action, { element = null, modifier = null, movementStrategy = 'auto' } = {}) {
  const build = {
    version: 3,
    skills: [{ id: 'skill-1', action, element, modifier }],
    reserve: [],
  };
  const battle = createBattle({ floor: 1, build, seed: 7, movementStrategy });
  battle.spawned = 999;
  battle.total = 999;
  battle.player.speed = 0;
  battle.player.x = 80;
  battle.player.y = 72;
  battle.enemies = [];
  return battle;
}

function cast(battle, index = 0) {
  const skill = battle.skills[index];
  const plan = battle.plans[index];
  const context = createActionContext(battle, skill, plan, `${plan.id}:${skill.castCount}`);
  const impl = actionImplementation(plan.action.handler);
  assert.ok(impl, `missing implementation for ${plan.action.handler}`);
  if (!impl.handler.canCast(context)) return { accepted: false, context, impl };
  const accepted = impl.handler.cast(context);
  if (accepted) skill.castCount += 1;
  return { accepted, context, impl };
}

test('动作契约与运行时处理器一一对应', () => {
  const contractIds = Object.keys(ACTION_CONTRACTS).sort();
  const implIds = Object.keys(ACTION_IMPLEMENTATIONS).sort();
  assert.deepEqual(implIds, contractIds);
  for (const id of contractIds) {
    const impl = ACTION_IMPLEMENTATIONS[id];
    assert.equal(typeof impl.contract.validate, 'function');
    assert.equal(typeof impl.contract.describe, 'function');
    assert.equal(typeof impl.handler.canCast, 'function');
    assert.equal(typeof impl.handler.cast, 'function');
  }
});

test('编译出的计划包含动作契约、移动提示与结构化描述', () => {
  const compiled = compileBuild({
    skills: [{ id: 'skill-1', action: 'swing', element: 'frost', modifier: null }],
    reserve: [],
  });
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0];
  assert.equal(plan.action.handler, 'swing');
  assert.equal(plan.movement.preferredRange, 14);
  assert.equal(plan.descriptionData.numbers.damage, 3);
  assert.ok(plan.descriptionData.action.includes('110°'));
  assert.ok(plan.descriptionData.element.effects[0].status === 'chill');
});

test('canCast 无副作用；没有目标时技能保持就绪，目标出现后才施放', () => {
  const battle = buildFor('swing', { movementStrategy: 'approach' });
  battle.enemies.push(makeEnemy(9, 10, 10, { cells: 999 }));
  battle.skills[0].timer = 0;
  for (let i = 0; i < 30; i += 1) step(battle, 1 / 60);
  assert.equal(battle.stats.casts['skill-1'] ?? 0, 0);
  assert.equal(battle.player.cells, battle.player.maxCells);

  battle.enemies.push(makeEnemy(1, 92, 72, { cells: 20 }));
  step(battle, 1 / 60);
  assert.equal(battle.stats.casts['skill-1'], 1);
});

test('挥斩只命中面前扇形内的有限目标', () => {
  const battle = buildFor('swing');
  const ahead = makeEnemy(1, 95, 72, { cells: 20 });
  const side = makeEnemy(2, 88, 78, { cells: 20 });
  const behind = makeEnemy(3, 50, 72, { cells: 20 });
  battle.enemies = [behind, side, ahead];
  const result = cast(battle);
  assert.equal(result.accepted, true);
  processCommands(battle);
  assert.ok(ahead.cells < 20);
  assert.ok(side.cells < 20);
  assert.equal(behind.cells, 20, '背后的目标不在扇形内');
});

test('飞弹实体：创建后同帧推进，命中提交统一伤害', () => {
  const battle = buildFor('projectile');
  const target = makeEnemy(1, 120, 72, { cells: 30 });
  battle.enemies = [target];
  const result = cast(battle);
  assert.equal(result.accepted, true);
  assert.equal(battle.entities.length, 1);
  const projectile = battle.entities[0];
  assert.equal(projectile.kind, 'projectile');
  const startX = projectile.x;
  updateEntities(battle, 1 / 60);
  assert.ok(projectile.x > startX, '创建帧首次推进后应已经移动');

  battle.skills = [];
  for (let i = 0; i < 120 && target.cells === 30; i += 1) step(battle, 1 / 60);
  assert.ok(target.cells < 30, 'expected projectile hit');
  assert.equal(battle.entities.length, 0);
});

test('弧光飞剑：背侧弧线起点、左右交替与计划快照', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];

  assert.equal(cast(battle).accepted, true);
  const first = battle.entities[0];
  assert.equal(first.kind, 'arcSword');
  assert.equal(first.targetId, 1);
  assert.equal(first.side, 1);
  assert.ok(Math.abs(first.startX - 72) < 1e-6, `startX=${first.startX}`);
  assert.ok(Math.abs(first.startY - 77) < 1e-6, `startY=${first.startY}`);
  assert.equal(first.flightTime, 0.55);
  assert.equal(first.maxHits, 1);
  assert.equal(first.maxCorrection, 18);
  assert.equal(first.plan.element, null);

  battle.entities = [];
  assert.equal(cast(battle).accepted, true);
  const second = battle.entities[0];
  assert.equal(second.side, -1);
  assert.ok(Math.abs(second.startX - 72) < 1e-6, `startX=${second.startX}`);
  assert.ok(Math.abs(second.startY - 67) < 1e-6, `startY=${second.startY}`);
});

test('弧光飞剑：有限追踪命中一次并提交共享伤害，到达后清理', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  battle.skills = [];

  let hits = 0;
  for (let i = 0; i < 60 && battle.entities.length > 0; i += 1) {
    step(battle, 1 / 60);
    hits += battle.events.filter((event) => event.type === 'hit').length;
  }
  assert.equal(hits, 1, '一次施放只应命中一次');
  assert.equal(target.cells, 997, '基础伤害 2 只结算一次');
  assert.equal(battle.entities.length, 0);
});

test('弧光飞剑：末段追踪累计修正不超过 18，目标远离后落空', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 120, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const sword = battle.entities[0];
  battle.skills = [];

  target.x = 160;
  for (let i = 0; i < 60 && !sword.dead; i += 1) {
    battle.time += 1 / 60;
    updateEntities(battle, 1 / 60);
    processCommands(battle);
  }
  assert.ok(Math.abs(sword.endX - (sword.baseEndX + 18)) < 1e-6, `endX=${sword.endX}`);
  assert.ok(Math.abs(sword.endY - sword.baseEndY) < 1e-6);
  assert.ok(Math.abs(sword.control2X - (sword.baseControl2X + 18)) < 1e-6);
  assert.equal(sword.dead, true);
  assert.equal(target.cells, 999, '超出追踪上限后不应命中');
});

test('弧光飞剑：其他敌人可以拦截，大步长也不漏判', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  // 施放后另一只敌人移动到飞行路径上，验证路径拦截而不是换目标。
  const interceptor = makeEnemy(2, 104.5, 84.6, { cells: 30 });
  battle.enemies.push(interceptor);
  battle.skills = [];

  updateEntities(battle, 0.3);
  processCommands(battle);
  assert.ok(interceptor.cells < 30, '路径上的其他敌人应拦截飞剑');
  assert.equal(target.cells, 999, '被拦截后不得继续命中锁定目标');
  assert.equal(battle.entities.length, 0);
});

test('弧光飞剑：目标死亡后保留最后终点，不产生幽灵命中', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const sword = battle.entities[0];
  battle.skills = [];

  target.cells = 0;
  target.dead = true;
  battle.enemies = [];
  for (let i = 0; i < 60 && !sword.dead; i += 1) {
    battle.time += 1 / 60;
    updateEntities(battle, 1 / 60);
    processCommands(battle);
  }
  assert.equal(sword.dead, true);
  assert.equal(battle.entities.includes(sword), false);
  assert.equal(battle.stats.damage['skill-1'] ?? 0, 0);
});

test('弧光飞剑：最大寿命到期后安全清理', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const sword = battle.entities[0];
  battle.skills = [];
  sword.life = 0.05;
  updateEntities(battle, 0.1);
  assert.equal(sword.dead, true);
  assert.equal(battle.entities.includes(sword), false);
  assert.equal(target.cells, 999);
});

test('弧光飞剑：同距离按敌人 ID 升序选择目标，超出索敌半径不施放', () => {
  const battle = buildFor('arcSword');
  const first = makeEnemy(5, 100, 72, { cells: 999 });
  const second = makeEnemy(2, 60, 72, { cells: 999 });
  battle.enemies = [first, second];
  assert.equal(cast(battle).accepted, true);
  assert.equal(battle.entities[0].targetId, 2);

  battle.entities = [];
  battle.enemies = [makeEnemy(1, 190, 72, { cells: 999 })];
  assert.equal(cast(battle).accepted, false);
  assert.equal(battle.entities.length, 0);
});

test('弧光飞剑：角色与目标重合时沿用上次有效朝向，否则固定向右', () => {
  const battle = buildFor('arcSword');
  battle.enemies = [makeEnemy(1, 80, 72, { cells: 999 })];
  assert.equal(cast(battle).accepted, true);
  let sword = battle.entities[0];
  assert.ok(Math.abs(sword.startX - 72) < 1e-6, `fallback startX=${sword.startX}`);
  assert.ok(Math.abs(sword.startY - 77) < 1e-6, `fallback startY=${sword.startY}`);

  battle.entities = [];
  battle.skills[0].lastAimX = 0;
  battle.skills[0].lastAimY = 1;
  assert.equal(cast(battle).accepted, true);
  sword = battle.entities[0];
  assert.ok(Math.abs(sword.startX - 85) < 1e-6, `last-aim startX=${sword.startX}`);
  assert.ok(Math.abs(sword.startY - 64) < 1e-6, `last-aim startY=${sword.startY}`);
});

test('弧光飞剑：同时存在上限达到后不施放、不消耗冷却', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  for (let i = 0; i < RUNTIME_LIMITS.maxArcSwords; i += 1) {
    assert.equal(cast(battle).accepted, true, `cast ${i + 1}`);
  }
  assert.equal(battle.entities.length, RUNTIME_LIMITS.maxArcSwords);
  assert.equal(cast(battle).accepted, false);
  assert.ok(battle.diagnostics.some((entry) => entry.code === 'arc-sword-limit'));

  battle.skills[0].timer = 0;
  step(battle, 1 / 60);
  assert.equal(battle.stats.casts['skill-1'] ?? 0, 0);
  assert.equal(battle.skills[0].timer, 0, '没有创建飞剑时冷却必须保持就绪');
});

test('弧光飞剑：起点可以短暂在场地外，不夹取弧线', () => {
  const battle = buildFor('arcSword');
  battle.player.x = 6;
  const target = makeEnemy(1, 80, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  assert.ok(battle.entities[0].startX < 0, `startX=${battle.entities[0].startX}`);
});

test('弧光飞剑 + 回响：延迟 0.7 秒对同一目标追加 50% 伤害，不复制飞剑实体', () => {
  const battle = buildFor('arcSword', { modifier: 'echo' });
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  battle.skills = [];
  for (let i = 0; i < 120; i += 1) step(battle, 1 / 60);
  assert.equal(target.cells, 996, '2 点基础伤害 + 1 点回响伤害');
  assert.equal(battle.entities.length, 0);
});

test('飞弹 + 回响：延迟 0.7 秒命中同一目标（回归）', () => {
  const battle = buildFor('projectile', { modifier: 'echo' });
  const target = makeEnemy(1, 120, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  battle.skills = [];
  for (let i = 0; i < 120; i += 1) step(battle, 1 / 60);
  assert.equal(target.cells, 996, '2 点基础伤害 + 1 点回响伤害');
});

test('弧光飞剑：改装后旧剑保留计划快照，新施放使用新计划', () => {
  const battle = buildFor('arcSword');
  const target = makeEnemy(1, 158, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const oldSword = battle.entities[0];
  assert.equal(oldSword.plan.element, null);

  const next = compileBuild({
    skills: [{ id: 'skill-1', action: 'arcSword', element: 'fire', modifier: null }],
    reserve: [],
  });
  assert.equal(next.ok, true);
  battle.plans = next.plans;
  replaceSkillInstances(battle, next.plans);
  assert.equal(cast(battle).accepted, true);
  const newSword = battle.entities.find((entity) => entity !== oldSword);
  assert.equal(newSword.plan.element.id, 'fire');
  assert.equal(oldSword.plan.element, null);
});

test('御剑：飞剑环绕、同目标命中间隔与计划快照', () => {
  const battle = buildFor('orbitSword');
  const target = makeEnemy(1, 92, 72, { cells: 999 });
  battle.enemies = [target];
  const result = cast(battle);
  assert.equal(result.accepted, true);
  const sword = battle.entities[0];
  const originalPlan = sword.plan;
  assert.equal(sword.kind, 'orbitSword');
  assert.equal(sword.plan.element, null);

  battle.skills = [];
  const hitTimes = [];
  let lastHitCount = 0;
  for (let i = 0; i < 60 * 2 && fight(battle); i += 1) {
    const before = battle.events.length;
    step(battle, 1 / 60);
    const hits = battle.events.filter((event) => event.type === 'hit').length;
    if (hits > 0) hitTimes.push(battle.time);
    lastHitCount += hits;
    assert.ok(before >= 0);
  }
  assert.ok(lastHitCount > 0, 'expected sword hits');
  for (let i = 1; i < hitTimes.length; i += 1) {
    assert.ok(hitTimes[i] - hitTimes[i - 1] >= 0.5, `hit interval too short: ${hitTimes[i] - hitTimes[i - 1]}`);
  }
  assert.equal(sword.plan, originalPlan, '旧飞剑保留创建时的计划快照');
});

test('改装后旧飞剑保留计划快照，新施放使用新计划', () => {
  const battle = buildFor('orbitSword');
  assert.equal(cast(battle).accepted, true);
  const oldSword = battle.entities[0];
  assert.equal(oldSword.plan.element, null);

  const next = compileBuild({
    skills: [{ id: 'skill-1', action: 'orbitSword', element: 'fire', modifier: null }],
    reserve: [],
  });
  assert.equal(next.ok, true);
  battle.plans = next.plans;
  replaceSkillInstances(battle, next.plans);

  assert.equal(cast(battle).accepted, true);
  const newSword = battle.entities.find((entity) => entity !== oldSword);
  assert.equal(newSword.plan.element.id, 'fire');
  assert.equal(oldSword.plan.element, null, '旧实体不能被改装追溯改写');
});

test('御剑到期清理，目标失效时命中记录被移除', () => {
  const battle = buildFor('orbitSword');
  const target = makeEnemy(1, 104, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const sword = battle.entities[0];
  battle.skills = [];
  target.dead = true;
  target.deathHandled = true;
  battle.enemies = [];
  for (let i = 0; i < 60 * 8; i += 1) {
    battle.time += 1 / 60;
    updateEntities(battle, 1 / 60);
    processCommands(battle);
  }
  assert.equal(battle.entities.includes(sword), false);
  assert.equal(sword.nextHit.size, 0);
});

test('御剑到期时清理逐目标命中记录', () => {
  const battle = buildFor('orbitSword');
  const target = makeEnemy(1, 104, 72, { cells: 999 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const sword = battle.entities[0];
  battle.skills = [];
  for (let i = 0; i < 60 * 8; i += 1) {
    battle.time += 1 / 60;
    updateEntities(battle, 1 / 60);
    processCommands(battle);
  }
  assert.equal(battle.entities.includes(sword), false);
  assert.equal(sword.nextHit.size, 0, '实体结束必须清理全部命中记录');
});

test('飞剑穿敌：沿直线穿透多个目标，每个目标只命中一次', () => {
  const battle = buildFor('swordPierce');
  const first = makeEnemy(1, 100, 72, { cells: 30 });
  const second = makeEnemy(2, 112, 72, { cells: 30 });
  const third = makeEnemy(3, 124, 72, { cells: 30 });
  const offLine = makeEnemy(4, 108, 92, { cells: 30 });
  battle.enemies = [first, second, third, offLine];
  assert.equal(cast(battle).accepted, true);
  const entity = battle.entities[0];
  assert.equal(entity.kind, 'piercingSword');
  battle.skills = [];
  for (let i = 0; i < 60 && battle.entities.length > 0; i += 1) step(battle, 1 / 60);
  assert.ok(first.cells < 30);
  assert.ok(second.cells < 30);
  assert.ok(third.cells < 30);
  assert.equal(offLine.cells, 30, '不在路径上的目标不应被命中');
  assert.ok(entity.hitIds.length <= 3);
});

test('剑阵：固定区域周期性命中，持续结束后清理', () => {
  const battle = buildFor('swordArray');
  const target = makeEnemy(1, 100, 72, { cells: 200 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  const array = battle.entities[0];
  assert.equal(array.kind, 'swordArray');
  battle.skills = [];
  for (let i = 0; i < 60 * 3; i += 1) step(battle, 1 / 60);
  assert.ok(target.cells < 200, '剑阵应周期性造成伤害');
  for (let i = 0; i < 60 * 3; i += 1) step(battle, 1 / 60);
  assert.equal(battle.entities.includes(array), false, '剑阵到期应清理');
});

test('剑阵：范围内有限目标与元素状态复用公共结算', () => {
  const battle = buildFor('swordArray', { element: 'fire' });
  const a = makeEnemy(1, 100, 72, { cells: 100 });
  const b = makeEnemy(2, 106, 76, { cells: 100 });
  battle.enemies = [a, b];
  assert.equal(cast(battle).accepted, true);
  battle.skills = [];
  for (let i = 0; i < 60; i += 1) step(battle, 1 / 60);
  assert.ok((a.statuses?.burn?.stacks ?? 0) > 0);
  assert.ok((b.statuses?.burn?.stacks ?? 0) > 0);
});

test('陷阱：布下后等待触发，触发范围命中并清理', () => {
  const battle = buildFor('trap');
  const target = makeEnemy(1, 80, 72, { cells: 30 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  assert.equal(battle.entities[0].kind, 'trap');
  battle.skills = [];
  step(battle, 1 / 60);
  assert.ok(target.cells >= 28, 'armTime 前不应触发');
  for (let i = 0; i < 60; i += 1) step(battle, 1 / 60);
  assert.ok(target.cells < 30, 'expected trap damage');
  assert.equal(battle.entities.length, 0);
});

test('陷阱触发仍通过统一命中应用属性状态', () => {
  const battle = buildFor('trap', { element: 'fire' });
  const target = makeEnemy(1, 80, 72, { cells: 30 });
  battle.enemies = [target];
  assert.equal(cast(battle).accepted, true);
  battle.skills = [];
  for (let i = 0; i < 60; i += 1) step(battle, 1 / 60);
  assert.ok(target.cells < 30);
  assert.ok((target.statuses?.burn?.stacks ?? 0) > 0);
});

test('陷阱：没有敌人时到期清理', () => {
  const battle = buildFor('trap');
  const trap = cast(battle);
  assert.equal(trap.accepted, true);
  battle.skills = [];
  for (let i = 0; i < 60 * 10; i += 1) {
    battle.time += 1 / 60;
    updateEntities(battle, 1 / 60);
    processCommands(battle);
  }
  assert.equal(battle.entities.length, 0);
});

test('实体上限返回失败并写入诊断，不静默忽略', () => {
  const battle = buildFor('projectile');
  const target = makeEnemy(1, 120, 72, { cells: 999 });
  battle.enemies = [target];
  const context = createActionContext(battle, battle.skills[0], battle.plans[0], 'limit');
  for (let i = 0; i < RUNTIME_LIMITS.maxEntities; i += 1) {
    const entity = context.spawnEntity({
      kind: 'projectile',
      x: 0,
      y: 0,
      targetId: target.id,
      plan: battle.plans[0],
      skillInstanceId: 'skill-1',
      castId: 'limit',
      speed: 1,
      hitRadius: 1,
      life: 10,
    });
    if (entity === null) break;
  }
  assert.ok(battle.diagnostics.some((entry) => entry.code === 'entity-limit'));
});

function fight(battle) {
  return battle.state === 'fighting';
}
