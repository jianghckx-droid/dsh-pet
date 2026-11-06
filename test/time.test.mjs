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
    maxCells: opts.cells ?? 10,
    locks: opts.locks ?? [],
    primary: true,
    canSplit: false,
    r: 3,
    speed: 0,
    damage: opts.damage ?? 1,
    attackTimer: opts.attackTimer ?? 99,
    status: createStatus(),
    freeze: 0,
    root: 0,
    vortex: 0,
    wallCd: 0,
    mark: 0,
    markLeft: 0,
    cleanseCd: 3,
    devourCd: 6,
    phaseCd: opts.phaseCd ?? 4,
    invuln: 0,
    flash: 0,
  };
  battle.enemies.push(enemy);
  return enemy;
}

function run(battle, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i += 1) step(battle, 1 / 20);
}

test('时停：12 秒时冻结全场', () => {
  const battle = makeBattle(['orb_phys', 'time_stop']);
  const enemy = addEnemy(battle, 90, 72, { cells: 1000 });
  run(battle, 12.2);
  assert.ok(enemy.freeze > 0, 'expected freeze');
});

test('延迟：伤害 2 秒后才结算', () => {
  const battle = makeBattle(['orb_phys', 'delay']);
  addEnemy(battle, 82, 72, { cells: 500, attackTimer: 0 });
  run(battle, 0.2);
  assert.ok(battle.delayQueue.length > 0, 'expected a queued hit');
  assert.equal(battle.player.cells, 12);
  run(battle, 2.2);
  assert.ok(battle.player.cells < 12, 'expected delayed damage to land');
});

test('延迟：击杀来源可以取消伤害', () => {
  const battle = makeBattle(['orb_phys', 'delay']);
  addEnemy(battle, 90, 72, { cells: 1, attackTimer: 0 });
  run(battle, 3.0);
  assert.equal(battle.player.cells, 12);
});

test('连锁：击杀后下一发攻击追加子弹', () => {
  const battle = makeBattle(['orb_phys', 'chain']);
  addEnemy(battle, 90, 72, { cells: 1 });
  addEnemy(battle, 105, 72, { cells: 50 });
  run(battle, 0.6);
  assert.equal(battle.chainStacks, 1);
  run(battle, 0.7);
  assert.equal(battle.chainStacks, 0);
});

test('回溯：残血时回到 3 秒前', () => {
  const battle = makeBattle(['orb_phys', 'rewind']);
  addEnemy(battle, 82, 72, { cells: 500, attackTimer: 0, damage: 3 });
  run(battle, 3.4);
  assert.equal(battle.rewindUsed, true);
  assert.ok(battle.player.cells > 3, `expected rewind heal, got ${battle.player.cells}`);
});

test('相位：无敌窗口内免伤', () => {
  const battle = makeBattle(['orb_phys']);
  const enemy = addEnemy(battle, 90, 72, { cells: 10, locks: ['phase'], phaseCd: 0.01 });
  run(battle, 0.6);
  assert.equal(enemy.cells, 10, 'phase should block the first hit');
});
