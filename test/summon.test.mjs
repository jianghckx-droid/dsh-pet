import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattle, step } from '../src/game/arena.js';
import { createStatus } from '../src/game/rules.js';

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
    maxCells: opts.maxCells ?? opts.cells ?? 10,
    locks: opts.locks ?? [],
    primary: true,
    canSplit: false,
    r: opts.r ?? 3,
    speed: 0,
    damage: 1,
    attackTimer: opts.attackTimer ?? 99,
    status: createStatus(),
    freeze: 0,
    root: 0,
    vortex: 0,
    wallCd: 0,
    mark: 0,
    markLeft: 0,
    cleanseCd: 3,
    devourCd: opts.devourCd ?? 6,
    flash: 0,
  };
  battle.enemies.push(enemy);
  return enemy;
}

function run(battle, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i += 1) step(battle, 1 / 20);
}

test('自爆傀儡：接近后爆炸并消失', () => {
  const battle = makeBattle(['bomber']);
  const enemy = addEnemy(battle, 120, 72, { cells: 20 });
  run(battle, 2.2);
  assert.equal(battle.summons.length, 0);
  assert.ok(enemy.cells <= 17, `expected blast damage, got ${enemy.cells}`);
});

test('连结：玩家伤害转移一半给召唤物', () => {
  const battle = makeBattle(['summon_fire', 'link']);
  const summon = battle.summons[0];
  addEnemy(battle, 82, 72, { cells: 50, attackTimer: 0 });
  run(battle, 0.4);
  assert.ok(summon.cells < summon.maxCells, 'summon should absorb damage');
});

test('吞噬：吃掉召唤物并回血', () => {
  const battle = makeBattle(['summon_fire']);
  const enemy = addEnemy(battle, 72, 72, {
    cells: 5,
    maxCells: 10,
    locks: ['devour'],
    devourCd: 0.05,
  });
  run(battle, 0.3);
  assert.equal(battle.summons.length, 0);
  assert.ok(enemy.cells > 5, `expected heal, got ${enemy.cells}`);
});

test('合体：两个召唤物合并成一个', () => {
  const battle = makeBattle(['summon_fire', 'summon_fire', 'merge']);
  assert.equal(battle.summons.length, 2);
  run(battle, 0.2);
  assert.equal(battle.summons.length, 1);
  assert.equal(battle.summons[0].cells, 8);
});

test('召唤物死亡后 8 秒重召', () => {
  const battle = makeBattle(['summon_fire']);
  addEnemy(battle, 72, 72, { cells: 5, locks: ['devour'], devourCd: 0.05 });
  run(battle, 0.3);
  assert.equal(battle.summons.length, 0);
  run(battle, 8.2);
  assert.equal(battle.summons.length, 1);
});
