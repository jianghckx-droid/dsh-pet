import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattle, step } from '../src/game/arena.js';
import { applyBurn, createStatus } from '../src/game/rules.js';

function makeBattle(build) {
  const battle = createBattle({ floor: 1, build, attrs: {}, seed: 3, pool: [] });
  battle.spawned = 999;
  battle.player.speed = 0;
  battle.player.x = 80;
  battle.player.y = 72;
  return battle;
}

function addEnemy(battle, x, y, opts = {}) {
  const enemy = {
    id: 900 + battle.enemies.length,
    x,
    y,
    cells: opts.cells ?? 10,
    maxCells: opts.cells ?? 10,
    locks: opts.locks ?? [],
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
    mark: opts.mark ?? 0,
    markLeft: opts.mark ? 6 : 0,
    cleanseCd: 3,
    flash: 0,
  };
  battle.enemies.push(enemy);
  return enemy;
}

function run(battle, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i += 1) step(battle, 1 / 20);
}

test('标记弹 + 猎标：命中叠标记', () => {
  const battle = makeBattle(['mark_bolt', 'mark_hunter']);
  const enemy = addEnemy(battle, 92, 72);
  run(battle, 1.1);
  assert.ok(enemy.mark >= 2, `expected marks, got ${enemy.mark}`);
});

test('处决：3 层标记且 ≤4 格直接移除', () => {
  const battle = makeBattle(['orb_phys', 'execute_mark']);
  const enemy = addEnemy(battle, 90, 72, { cells: 4, mark: 3 });
  run(battle, 1.0);
  assert.ok(enemy.cells <= 0, `expected execute, got ${enemy.cells}`);
});

test('净化：3 秒后清掉灼烧与标记', () => {
  const battle = makeBattle(['orb_phys']);
  const enemy = addEnemy(battle, 90, 72, { locks: ['cleanse'], mark: 3, cells: 60 });
  applyBurn(enemy.status, 5);
  run(battle, 3.3);
  assert.equal(enemy.mark, 0);
  assert.equal(enemy.status.burn, 0);
});

test('引信：带标记的敌人死亡时爆炸', () => {
  const battle = makeBattle(['orb_phys', 'fuse']);
  addEnemy(battle, 90, 72, { cells: 1, mark: 3 });
  const neighbor = addEnemy(battle, 102, 72);
  run(battle, 1.2);
  assert.ok(neighbor.cells <= 7, `expected fuse damage, got ${neighbor.cells}`);
});

test('传导：标记传给最近的敌人', () => {
  const battle = makeBattle(['orb_phys', 'spread']);
  addEnemy(battle, 90, 72, { cells: 1, mark: 3 });
  const neighbor = addEnemy(battle, 104, 72);
  run(battle, 1.2);
  assert.ok(neighbor.mark > 0, 'expected mark to spread');
});
