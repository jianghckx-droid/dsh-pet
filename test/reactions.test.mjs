import test from 'node:test';
import assert from 'node:assert/strict';

import { applyStatus, stacksOf } from '../src/game/skills/status.js';
import { compileBuild } from '../src/game/skills/compile.js';
import { fireHit, makeBattle, makeEnemy, settleDeaths } from './helpers.mjs';

function buildWith(element, modifier, action = 'projectile') {
  return {
    version: 2,
    skills: [{ id: 'skill-1', action, element, modifier }],
    reserve: [],
  };
}

test('传火：带灼烧的敌人死亡时把灼烧传给附近有限目标', () => {
  const battle = makeBattle(buildWith('fire', null));
  const dead = makeEnemy(1, 80, 72, { cells: 1 });
  const near = makeEnemy(2, 92, 72, { cells: 20 });
  const far = makeEnemy(3, 150, 72, { cells: 20 });
  battle.enemies = [dead, near, far];
  applyStatus(dead, 'burn', 4, { skillInstanceId: 'skill-1', element: 'fire', canSpread: true });

  fireHit(battle, 1, { damage: 2, element: 'fire' }, ['projectile', 'fire']);
  settleDeaths(battle);

  assert.equal(battle.enemies.includes(dead), false);
  assert.equal(stacksOf(near, 'burn'), 2, 'transferRatio 0.5，向下取整到最低 1 层');
  assert.equal(stacksOf(far, 'burn'), 0, '范围外的敌人不应被传火');
  assert.equal(battle.stats.reactions.spreadFire.count, 1);
});

test('传火：火焰致死命中仍先完成状态施加，因此可以触发传火', () => {
  const battle = makeBattle(buildWith('fire', null));
  const killed = makeEnemy(1, 80, 72, { cells: 1 });
  const neighbor = makeEnemy(2, 90, 72, { cells: 20 });
  battle.enemies = [killed, neighbor];

  fireHit(battle, 1, { damage: 2, element: 'fire' }, ['projectile', 'fire']);
  settleDeaths(battle);

  assert.equal(stacksOf(neighbor, 'burn'), 1);
  assert.equal(battle.stats.reactions.spreadFire.count, 1);
});

test('传火：可以跨多次死亡连续传播，受深度与目标数约束', () => {
  const battle = makeBattle(buildWith('fire', null));
  const first = makeEnemy(1, 80, 72, { cells: 1 });
  const second = makeEnemy(2, 92, 72, { cells: 20 });
  const third = makeEnemy(3, 104, 72, { cells: 20 });
  const fourth = makeEnemy(4, 116, 72, { cells: 20 });
  battle.enemies = [first, second, third, fourth];
  applyStatus(first, 'burn', 4, { skillInstanceId: 'skill-1', element: 'fire' });

  fireHit(battle, 1, { damage: 2, element: 'fire' }, ['projectile', 'fire']);
  settleDeaths(battle);
  assert.equal(stacksOf(second, 'burn'), 2);
  assert.equal(stacksOf(third, 'burn'), 2);

  second.cells = 0;
  settleDeaths(battle);
  assert.equal(battle.stats.reactions.spreadFire.count, 2, '第二个目标死亡后仍可传火');
  assert.ok(stacksOf(third, 'burn') > 2);

  third.cells = 0;
  settleDeaths(battle);
  assert.equal(battle.stats.reactions.spreadFire.count, 3, '第三个目标死亡后仍可传火');
  assert.ok(stacksOf(fourth, 'burn') > 0);
});

test('传火：达到传播深度上限后停止，命令预算仍是最后护栏', () => {
  const battle = makeBattle(buildWith('fire', null));
  const dead = makeEnemy(1, 80, 72, { cells: 1 });
  const neighbor = makeEnemy(2, 90, 72, { cells: 20 });
  battle.enemies = [dead, neighbor];
  applyStatus(dead, 'burn', 4, { skillInstanceId: 'skill-1', spreadDepth: 4 });

  fireHit(battle, 1, { damage: 2, element: null }, []);
  settleDeaths(battle);
  assert.equal(stacksOf(neighbor, 'burn'), 0, '达到传播深度上限后不应再传');
  assert.equal(battle.stats.reactions.spreadFire?.count ?? 0, 0);
});

test('导电：带充能目标被雷电击杀时仍触发导电', () => {
  const battle = makeBattle(buildWith('thunder', null));
  const target = makeEnemy(1, 80, 72, { cells: 1 });
  const neighbor = makeEnemy(2, 90, 72, { cells: 20 });
  battle.enemies = [target, neighbor];
  applyStatus(target, 'charge', 1);

  fireHit(battle, 1, { damage: 3, element: 'thunder' }, ['projectile', 'thunder']);
  assert.equal(battle.stats.reactions.conductive.count, 1);
  assert.equal(neighbor.cells, 17);
  settleDeaths(battle);
  assert.equal(battle.stats.kills, 1);
  assert.equal(battle.enemies.includes(target), false);
});

test('碎裂：带寒冷目标被强力命中击杀时仍触发碎裂', () => {
  const battle = makeBattle(buildWith('frost', null, 'aura'));
  const target = makeEnemy(1, 80, 72, { cells: 1 });
  const neighbor = makeEnemy(2, 90, 72, { cells: 20 });
  battle.enemies = [target, neighbor];
  applyStatus(target, 'chill', 2);

  fireHit(battle, 1, { damage: 5, element: 'frost', action: 'aura' }, ['aura', 'frost', 'heavy']);
  assert.equal(battle.stats.reactions.shatter.count, 1);
  assert.equal(neighbor.cells, 17);
  settleDeaths(battle);
  assert.equal(battle.stats.kills, 1);
});

test('导电：带充能目标再次受雷电命中，消耗充能并雷击附近目标', () => {
  const battle = makeBattle(buildWith('thunder', null));
  const target = makeEnemy(1, 80, 72, { cells: 30 });
  const a = makeEnemy(2, 88, 72, { cells: 10 });
  const b = makeEnemy(3, 94, 72, { cells: 10 });
  battle.enemies = [target, a, b];
  applyStatus(target, 'charge', 1);

  fireHit(battle, 1, { damage: 3, element: 'thunder' }, ['projectile', 'thunder']);

  assert.equal(stacksOf(target, 'charge'), 0, '导电消耗充能');
  assert.equal(a.cells, 7);
  assert.equal(b.cells, 7);
  assert.equal(battle.stats.reactions.conductive.count, 1);
  assert.equal(battle.stats.reactions.conductive.damage, 6);
  assert.equal(stacksOf(a, 'charge'), 0, '雷击不施加充能');
});

test('导电：第一次雷电命中只施加充能，不触发', () => {
  const battle = makeBattle(buildWith('thunder', null));
  const target = makeEnemy(1, 80, 72, { cells: 30 });
  battle.enemies = [target];

  fireHit(battle, 1, { damage: 3, element: 'thunder' }, ['projectile', 'thunder']);
  assert.equal(stacksOf(target, 'charge'), 1);
  assert.equal(battle.stats.reactions.conductive, undefined);
});

test('导电：雷击带有终止标签，不能再次触发导电', () => {
  const battle = makeBattle(buildWith('thunder', null));
  const target = makeEnemy(1, 80, 72, { cells: 30 });
  const near = makeEnemy(2, 90, 72, { cells: 30 });
  battle.enemies = [target, near];
  applyStatus(target, 'charge', 1);
  applyStatus(near, 'charge', 1);

  fireHit(battle, 1, { damage: 3, element: 'thunder' }, ['projectile', 'thunder']);

  assert.equal(battle.stats.reactions.conductive.count, 1, '同一次命中只触发一次');
  assert.equal(stacksOf(near, 'charge'), 1, '雷击不消耗充能，也不再触发导电');
  assert.equal(near.cells, 27);
});

test('碎裂：寒冷达到阈值并被强力命中时消耗寒冷、造成范围伤害', () => {
  const battle = makeBattle(buildWith('frost', null, 'impact'));
  const target = makeEnemy(1, 80, 72, { cells: 40 });
  const near = makeEnemy(2, 96, 72, { cells: 40 });
  const far = makeEnemy(3, 140, 72, { cells: 40 });
  battle.enemies = [target, near, far];
  applyStatus(target, 'chill', 2);

  fireHit(battle, 1, { damage: 5, element: 'frost', action: 'impact' }, ['impact', 'frost', 'heavy']);

  assert.equal(stacksOf(target, 'chill'), 0, '碎裂消耗全部寒冷');
  assert.equal(target.cells, 32, '5 点冲击 + 3 点碎裂');
  assert.equal(near.cells, 37);
  assert.equal(far.cells, 40, '范围外的敌人不受影响');
  assert.equal(battle.stats.reactions.shatter.count, 1);
  assert.equal(battle.stats.reactions.shatter.damage, 6);
});

test('碎裂：没有 heavy 标签的命中不触发', () => {
  const battle = makeBattle(buildWith('frost', null));
  const target = makeEnemy(1, 80, 72, { cells: 40 });
  battle.enemies = [target];
  applyStatus(target, 'chill', 4);

  fireHit(battle, 1, { damage: 2, element: 'frost' }, ['projectile', 'frost']);
  assert.equal(battle.stats.reactions.shatter, undefined);
  assert.equal(stacksOf(target, 'chill'), 5, '只是继续加寒冷');
});

test('碎裂伤害不再触发碎裂', () => {
  const battle = makeBattle(buildWith('frost', null, 'impact'));
  const target = makeEnemy(1, 80, 72, { cells: 40 });
  const near = makeEnemy(2, 92, 72, { cells: 40 });
  battle.enemies = [target, near];
  applyStatus(target, 'chill', 3);
  applyStatus(near, 'chill', 3);

  fireHit(battle, 1, { damage: 5, element: 'frost', action: 'impact' }, ['impact', 'frost', 'heavy']);
  assert.equal(battle.stats.reactions.shatter.count, 1);
  assert.equal(near.cells, 37);
  assert.equal(stacksOf(near, 'chill'), 3, '碎裂伤害没有 heavy 标签，不消耗也不重触发');
});

test('无效目标的反应命令会被安全跳过', () => {
  const battle = makeBattle(buildWith('thunder', null));
  const target = makeEnemy(1, 80, 72, { cells: 30 });
  battle.enemies = [target];
  applyStatus(target, 'charge', 1);
  fireHit(battle, 1, { damage: 3, element: 'thunder' }, ['projectile', 'thunder']);
  assert.equal(battle.diagnostics.length, 0);
});

test('反应定义可被编译期内容校验读取', () => {
  const compiled = compileBuild(buildWith('thunder', 'echo'));
  assert.equal(compiled.ok, true);
});
