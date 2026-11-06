import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattle, step } from '../src/game/arena.js';
import { createStatus } from '../src/game/rules.js';

function makeBattle(build, playerX = 80) {
  const battle = createBattle({ floor: 1, build, attrs: {}, seed: 3, pool: [] });
  battle.spawned = 999; // 关掉自动刷怪，测试只关心手动放进去的敌人
  battle.player.speed = 0;
  battle.player.x = playerX;
  battle.player.y = 72;
  return battle;
}

function addEnemy(battle, x, y, locks = []) {
  const enemy = {
    id: 900 + battle.enemies.length,
    x,
    y,
    cells: 10,
    maxCells: 10,
    locks,
    primary: true,
    canSplit: false,
    r: 3,
    speed: 0,
    damage: 1,
    attackTimer: 99,
    status: createStatus(),
    freeze: 0,
    root: 0,
    vortex: 0,
    wallCd: 0,
    flash: 0,
  };
  battle.enemies.push(enemy);
  return enemy;
}

function run(battle, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i += 1) step(battle, 1 / 20);
}

test('引力井：把范围内的敌人拉近', () => {
  const battle = makeBattle(['orb_phys', 'gravity_well']);
  const enemy = addEnemy(battle, 110, 72);
  run(battle, 1.2);
  assert.ok(Math.abs(enemy.x - 80) < 30, `expected pull, got x=${enemy.x}`);
});

test('锚定：免疫拉拽', () => {
  const battle = makeBattle(['orb_phys', 'gravity_well']);
  const enemy = addEnemy(battle, 110, 72, ['anchor']);
  run(battle, 1.2);
  assert.equal(enemy.x, 110);
});

test('冲击波：推开并造成 1 格', () => {
  const battle = makeBattle(['shockwave']);
  const enemy = addEnemy(battle, 100, 72);
  run(battle, 2.2);
  assert.ok(enemy.x > 100, `expected push, got x=${enemy.x}`);
  assert.ok(enemy.cells <= 9, `expected 1 damage, got ${enemy.cells}`);
});

test('撞墙：被推入墙角的敌人额外吃 2 格', () => {
  const battle = makeBattle(['shockwave', 'rule_wall_slam'], 140);
  const enemy = addEnemy(battle, 155, 72);
  run(battle, 2.2);
  assert.equal(enemy.x, 157, 'clamped to the wall');
  assert.ok(enemy.cells <= 7, `expected wall slam, got ${enemy.cells}`);
});

test('钉住：命中后定身', () => {
  const battle = makeBattle(['orb_phys', 'rule_pin']);
  const enemy = addEnemy(battle, 90, 72);
  run(battle, 0.6);
  assert.ok(enemy.root > 0, 'expected root');
});

test('涡流：敌人进入旋转状态', () => {
  const battle = makeBattle(['vortex']);
  const enemy = addEnemy(battle, 95, 72);
  run(battle, 3.2);
  assert.ok(enemy.vortex > 0 || enemy.y !== 72, 'expected vortex motion');
});
