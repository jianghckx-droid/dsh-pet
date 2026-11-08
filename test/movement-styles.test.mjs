import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattle, runToEnd } from '../src/game/arena.js';
import { compileBuild } from '../src/game/skills/compile.js';
import {
  availableStyles,
  buildFromStyle,
  defaultStyle,
  isStyleUnlocked,
  listStyles,
  resolveStyle,
  styleById,
} from '../src/game/skills/styles.js';
import {
  createMovementState,
  desiredRange,
  movePlayer,
  requestDisplacement,
  resolveDisplacements,
} from '../src/game/movement.js';
import { makeEnemy } from './helpers.mjs';

function plansFor(actions) {
  const compiled = compileBuild({
    skills: actions.map((action, index) => ({ id: `skill-${index + 1}`, action, element: null, modifier: null })),
    reserve: [],
  });
  assert.equal(compiled.ok, true);
  return compiled.plans;
}

function battleWith(actions, strategy) {
  const battle = createBattle({
    floor: 1,
    build: {
      skills: actions.map((action, index) => ({ id: `skill-${index + 1}`, action, element: null, modifier: null })),
      reserve: [],
    },
    seed: 7,
    movementStrategy: strategy,
  });
  battle.spawned = 999;
  battle.total = 999;
  battle.player.x = 80;
  battle.player.y = 72;
  battle.enemies = [makeEnemy(1, 130, 72, { cells: 999 })];
  return battle;
}

test('移动策略：接近、保持距离、自动使用不同目标距离', () => {
  const projectile = plansFor(['projectile'])[0];
  const swing = plansFor(['swing'])[0];
  assert.equal(desiredRange([projectile], 'keepDistance'), 90);
  assert.equal(desiredRange([swing], 'approach'), 14);
  assert.equal(desiredRange([projectile, swing], 'approach'), 14);
  assert.equal(desiredRange([projectile, swing], 'keepDistance'), 90);
  assert.equal(desiredRange([projectile, swing], 'auto'), 52);
  assert.equal(createMovementState([projectile], 'nope').strategy, 'auto');
});

test('接近策略向敌人靠近，保持距离策略拉开距离', () => {
  const approach = battleWith(['swing', 'projectile'], 'approach');
  approach.player.speed = 52;
  const x0 = approach.player.x;
  movePlayer(approach, 1);
  assert.ok(approach.player.x > x0, 'approach should move toward the enemy');

  const keep = battleWith(['swing', 'projectile'], 'keepDistance');
  keep.player.speed = 52;
  const x1 = keep.player.x;
  movePlayer(keep, 1);
  assert.ok(keep.player.x < x1, 'keepDistance should move away from the enemy');
});

test('没有敌人时移动到中心区域，且不会越界', () => {
  const battle = battleWith(['projectile'], 'auto');
  battle.player.x = 10;
  battle.player.y = 10;
  battle.enemies = [];
  for (let i = 0; i < 120; i += 1) movePlayer(battle, 1 / 60);
  assert.ok(battle.player.x > 10 && battle.player.x < 160);
  assert.ok(battle.player.y > 10 && battle.player.y < 144);
});

test('位移请求按优先级、来源 ID、入队顺序裁决并限制落点', () => {
  const battle = battleWith(['projectile'], 'keepDistance');
  battle.player.x = 80;
  battle.player.y = 72;
  requestDisplacement(battle, { sourceId: 2, priority: 1, x: 120, y: 72, distance: 5 });
  requestDisplacement(battle, { sourceId: 1, priority: 10, x: 100, y: 72, distance: 5 });
  const applied = resolveDisplacements(battle);
  assert.equal(applied.length, 2);
  assert.equal(applied[0].priority, 10, 'higher priority resolves first');

  battle.player.x = 150;
  battle.player.y = 72;
  requestDisplacement(battle, { sourceId: 3, priority: 5, x: 999, y: 999, distance: 100 });
  resolveDisplacements(battle);
  assert.ok(battle.player.x <= 160 - 6);
  assert.ok(battle.player.y <= 144 - 6);
});

test('无效位移请求被丢弃，不产生位置变化', () => {
  const battle = battleWith(['projectile'], 'auto');
  const beforeX = battle.player.x;
  requestDisplacement(battle, { sourceId: 1, priority: 1, x: NaN, y: 72, distance: 5 });
  requestDisplacement(battle, { sourceId: 2, priority: 1, x: 90, y: 72, distance: 0 });
  assert.equal(resolveDisplacements(battle).length, 0);
  assert.equal(battle.player.x, beforeX);
});

test('风格目录：默认风格与解锁条件可读', () => {
  const styles = listStyles();
  assert.equal(styles.length, 4);
  assert.equal(defaultStyle().id, 'ranged');
  assert.equal(styleById('sword').movementPreference, 'approach');
  assert.equal(isStyleUnlocked(styleById('sword'), { bestFloor: 1 }), false);
  assert.equal(isStyleUnlocked(styleById('sword'), { bestFloor: 3 }), true);
  assert.deepEqual(
    availableStyles({ bestFloor: 1 }).map((style) => style.id),
    ['ranged', 'melee'],
  );
  assert.deepEqual(
    availableStyles({ bestFloor: 5 }).map((style) => style.id),
    ['ranged', 'melee', 'sword', 'trapper'],
  );
});

test('未知或未解锁风格安全回退到默认风格', () => {
  assert.equal(resolveStyle('unknown', { bestFloor: 10 }).id, 'ranged');
  assert.equal(resolveStyle('sword', { bestFloor: 1 }).id, 'ranged');
  assert.equal(resolveStyle('sword', { bestFloor: 3 }).id, 'sword');
});

test('每种风格的起始构筑都能编译，且不共享战斗结算分支', () => {
  for (const style of listStyles()) {
    const compiled = compileBuild(buildFromStyle(style));
    assert.equal(compiled.ok, true, style.id + ': ' + JSON.stringify(compiled.errors));
    assert.equal(compiled.plans.length, 1);
  }
});

test('所有起始风格在无属性、无修饰时能完成教学战斗', () => {
  for (const style of listStyles()) {
    const battle = createBattle({
      floor: 1,
      build: buildFromStyle(style),
      seed: 7,
      movementStrategy: style.movementPreference,
    });
    runToEnd(battle, { maxSeconds: 60 });
    assert.equal(battle.state, 'cleared', style.id + ' 起始构筑应能清第 1 层');
  }
});
