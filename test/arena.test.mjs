import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_EXTRA,
  TIME_LIMIT,
  addPressure,
  awardXp,
  chooseUpgrade,
  createBattle,
  step,
  triggerSurge,
} from '../src/game/arena.js';
import { emptyBuild } from '../src/game/skills/compile.js';
import { contentById } from '../src/game/skills/registry.js';
import { enqueue } from '../src/game/skills/resolve.js';
import { applyStatus } from '../src/game/skills/status.js';
import { makeEnemy, fireHit } from './helpers.mjs';

const FIRE_BUILD = {
  version: 2,
  skills: [
    { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
    { id: 'skill-2', action: 'aura', element: 'fire', modifier: 'expand' },
  ],
  reserve: [],
};

const ICE_BUILD = {
  version: 2,
  skills: [
    { id: 'skill-1', action: 'aura', element: 'frost', modifier: 'pull' },
    { id: 'skill-2', action: 'impact', element: 'frost', modifier: 'echo' },
  ],
  reserve: [],
};

function play(floor, build, seed = 7) {
  const battle = createBattle({ floor, build, seed });
  let guard = 0;
  while (battle.state === 'fighting' && battle.time < TIME_LIMIT + 5 && guard < 60 * 60) {
    step(battle, 1 / 60);
    guard += 1;
  }
  return battle;
}

function collectEvents(battle) {
  const events = [];
  let guard = 0;
  while (battle.state === 'fighting' && battle.time < 50 && guard < 60 * 60) {
    for (const event of step(battle, 1 / 60)) events.push(event);
    guard += 1;
  }
  return events;
}

test('同一 seed、同一 build 与固定步长产生同一结果', () => {
  const a = play(6, FIRE_BUILD, 11);
  const b = play(6, FIRE_BUILD, 11);
  assert.equal(a.state, b.state);
  assert.equal(a.time, b.time);
  assert.equal(a.kills, b.kills);
  assert.equal(a.player.cells, b.player.cells);
  assert.equal(a.nextEventId, b.nextEventId);
});

test('事件序列可重放：事件类型、位置与伤害一致', () => {
  const a = createBattle({ floor: 3, build: FIRE_BUILD, seed: 5 });
  const b = createBattle({ floor: 3, build: FIRE_BUILD, seed: 5 });
  const ea = collectEvents(a);
  const eb = collectEvents(b);
  assert.deepEqual(ea.map((event) => event.type), eb.map((event) => event.type));
  assert.equal(ea.length, eb.length);
  for (let i = 0; i < ea.length; i += 1) {
    assert.equal(ea[i].x, eb[i].x);
    assert.equal(ea[i].y, eb[i].y);
    assert.equal(ea[i].cells, eb[i].cells);
  }
});

test('基础飞弹能清第 1 层，纯数值构筑撞不过第 6 层', () => {
  const first = play(1, emptyBuild());
  assert.equal(first.state, 'cleared');
  const later = play(6, emptyBuild());
  assert.notEqual(later.state, 'cleared');
});

test('完整技能构筑能处理更深的层', () => {
  assert.equal(play(5, FIRE_BUILD).state, 'cleared');
  assert.equal(play(5, ICE_BUILD).state, 'cleared');
});

test('玩家始终留在场地内，数值不出现 NaN', () => {
  const battle = createBattle({ floor: 6, build: FIRE_BUILD, seed: 3 });
  for (let i = 0; i < 60 * 40 && battle.state === 'fighting'; i += 1) {
    step(battle, 1 / 60);
    const { x, y, cells } = battle.player;
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(cells));
    assert.ok(x >= 6 && x <= 160 - 6);
    assert.ok(y >= 6 && y <= 144 - 6);
  }
});

test('token 压力：额外敌人被刷出，且受上限约束', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 5 });
  assert.equal(addPressure(battle, 5), 5);
  assert.equal(battle.extra, 5);
  while (battle.state === 'fighting' && battle.time < 60) step(battle, 1 / 60);
  assert.equal(battle.spawned, 13, '8 基础 + 5 压力');

  const capped = createBattle({ floor: 1, build: emptyBuild(), seed: 5 });
  assert.equal(addPressure(capped, 999), MAX_EXTRA);
  assert.equal(addPressure(capped, 1), 0);
});

test('战斗结束后不再接受压力', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 5 });
  battle.state = 'cleared';
  assert.equal(addPressure(battle, 3), 0);
});

test('过载潮：触发额外敌人，清层后额外给一次选择', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 5 });
  assert.equal(triggerSurge(battle, 6), true);
  assert.equal(battle.extra, 6);
  assert.equal(battle.surge, true);
  while (battle.state === 'fighting' && battle.time < 60) step(battle, 1 / 60);
  assert.equal(battle.state, 'cleared');
  assert.ok(battle.pending >= 1);
});

test('升级：第一次三选一只给属性，选中后进入技能计划', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  assert.equal(battle.offer, null);
  awardXp(battle, 8);
  assert.ok(Array.isArray(battle.offer));
  assert.equal(battle.pending, 1);
  assert.ok(battle.offer.every((id) => id === 'fire' || id === 'frost' || id === 'thunder'));

  const picked = battle.offer[0];
  assert.equal(chooseUpgrade(battle, picked), true);
  assert.equal(battle.build.skills[0].element, picked);
  assert.equal(battle.plans[0].element.id, picked);
  assert.equal(battle.offer, null);
  assert.equal(battle.pending, 0);
});

test('升级：候选之外的 ID 与不合法槽位会被拒绝', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  awardXp(battle, 8);
  assert.equal(chooseUpgrade(battle, 'split'), false);
  const picked = battle.offer[0];
  assert.equal(chooseUpgrade(battle, picked, { kind: 'modifier', skillIndex: 0 }), false);
  assert.equal(battle.build.skills[0].element, null);
});

test('升级后重编译：技能计划与描述一起更新', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  awardXp(battle, 8);
  const picked = battle.offer[0];
  chooseUpgrade(battle, picked);
  const plan = battle.plans[0];
  assert.ok(plan.description.includes('灼烧') || plan.description.includes('寒冷') || plan.description.includes('充能'));
  assert.equal(battle.skills[0].plan.id, plan.id);
});

test('升级选择跨层保留：pending 与新层一起带回', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3, pending: 1 });
  assert.equal(battle.offer.length, 3);
});

test('无效构筑会被安全修复：无动作时临时使用基础飞弹并留下提示', () => {
  const battle = createBattle({
    floor: 1,
    build: { version: 2, skills: [{ id: 'skill-1', action: 'removed', element: 'fire' }], reserve: [] },
    seed: 3,
  });
  assert.equal(battle.plans.length, 1);
  assert.equal(battle.plans[0].action.id, 'projectile');
  assert.ok(battle.compileWarnings.length > 0);
});

test('寒冷降低敌人移动速度', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  battle.spawned = 999;
  const fast = makeEnemy(1, 130, 72, { cells: 100 });
  fast.speed = 34;
  battle.enemies = [fast];
  step(battle, 1);
  const fastX = fast.x;

  const slowBattle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  slowBattle.spawned = 999;
  const slow = makeEnemy(1, 130, 72, { cells: 100 });
  slow.speed = 34;
  slowBattle.enemies = [slow];
  applyStatus(slow, 'chill', 5);
  step(slowBattle, 1);
  assert.ok(slow.x > fastX, `chilled enemy should move less: ${slow.x} vs ${fastX}`);
});

test('游击者保持距离并发射敌方弹体', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  battle.spawned = 999;
  const kite = makeEnemy(1, 60, 72, { cells: 100, type: 'skirmisher' });
  kite.behavior = 'kite';
  kite.preferredRange = 52;
  kite.shot = { speed: 120, damage: 1, radius: 2.5, life: 1.6 };
  kite.attackTimer = 0;
  battle.enemies = [kite];
  step(battle, 1 / 60);
  assert.ok(battle.enemyShots.length > 0, 'expected a ranged attack');
});

test('命令深度与每根事件命令数有硬上限并留下诊断', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  assert.equal(enqueue(battle, { type: 'hit', depth: 99, targetId: 1 }), false);
  assert.ok(battle.diagnostics.some((entry) => entry.code === 'command-depth'));

  const root = 12345;
  for (let i = 0; i < 120; i += 1) {
    enqueue(battle, {
      type: 'move',
      targetId: 1,
      rootEventId: root,
      payload: { centerX: 80, centerY: 72, strength: 1 },
    });
  }
  assert.equal(battle.commands.length, 96);
  assert.ok(battle.diagnostics.some((entry) => entry.code === 'command-budget'));
});

test('伤害统计：只记录有效伤害，溢出伤害单独计量', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  battle.spawned = 999;
  const target = makeEnemy(1, 80, 72, { cells: 1 });
  battle.enemies = [target];
  fireHit(battle, 1, { damage: 10 });
  assert.equal(battle.stats.damage['skill-1'], 1);
  assert.equal(battle.stats.overflow, 9);
  assert.equal(target.cells, -9);
});

test('动作替换：满槽时仍可获得动作，冷却按技能实例 ID 继承', () => {
  const build = {
    version: 3,
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: 'frost', modifier: 'pull' },
    ],
    reserve: [],
  };
  const battle = createBattle({ floor: 1, build, seed: 9, pending: 1, draftCount: 4 });
  const actionId = battle.offer.find((id) => contentById(id)?.kind === 'action');
  assert.ok(actionId, 'full build should still offer an action');
  battle.skills[0].timer = 0.5;
  const oldPlan = battle.plans[0];
  const oldEntity = {
    id: 999,
    kind: 'projectile',
    plan: oldPlan,
    skillInstanceId: 'skill-1',
    castId: 'old',
    x: 0,
    y: 0,
  };
  battle.entities.push(oldEntity);
  const placement = { kind: 'action', skillIndex: 0, replacing: true };
  assert.equal(chooseUpgrade(battle, actionId, placement), true);
  assert.equal(battle.build.skills[0].id, 'skill-1');
  assert.equal(battle.build.skills[0].action, actionId);
  assert.ok(battle.skills[0].timer <= 0.5);
  assert.equal(oldEntity.plan, oldPlan, '旧实体保留创建时的计划快照');
  assert.ok(battle.build.reserve.includes('projectile'));
});

test('死亡目标不会再被命中', () => {
  const battle = createBattle({ floor: 1, build: emptyBuild(), seed: 3 });
  battle.spawned = 999;
  const dead = makeEnemy(1, 80, 72, { cells: 10 });
  dead.dead = true;
  battle.enemies = [dead];
  const events = step(battle, 1 / 60);
  assert.equal(dead.cells, 10);
  assert.equal(events.some((event) => event.type === 'hit'), false);
});
