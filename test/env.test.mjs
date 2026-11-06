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
    damage: 1,
    attackTimer: 99,
    status: createStatus(),
    freeze: 0,
    root: 0,
    vortex: 0,
    wallCd: 0,
    mark: 0,
    markLeft: 0,
    cleanseCd: 3,
    devourCd: 6,
    phaseCd: 4,
    invuln: 0,
    shield: 0,
    genCd: 3,
    flash: 0,
  };
  battle.enemies.push(enemy);
  return enemy;
}

function run(battle, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i += 1) step(battle, 1 / 20);
}

test('火焰陷阱：敌人踩到后受伤并叠灼烧', () => {
  const battle = makeBattle(['flame_trap']);
  const enemy = addEnemy(battle, 80, 72);
  run(battle, 2.8);
  assert.ok(enemy.cells < 10, `expected trap damage, got ${enemy.cells}`);
  assert.ok(enemy.status.burn > 0, 'expected burn');
});

test('冰霜陷阱：触发后冻结', () => {
  const battle = makeBattle(['frost_trap']);
  const enemy = addEnemy(battle, 80, 72);
  run(battle, 3.8);
  assert.ok(enemy.freeze > 0, 'expected freeze');
});

test('火痕：轨迹持续造成伤害', () => {
  const battle = makeBattle(['fire_trail']);
  const enemy = addEnemy(battle, 80, 72, { cells: 50 });
  run(battle, 1.2);
  assert.ok(enemy.cells < 50, `expected trail damage, got ${enemy.cells}`);
});

test('发生器：给附近敌人加护盾', () => {
  const battle = makeBattle(['orb_phys']);
  addEnemy(battle, 90, 72, { cells: 50, locks: ['generator'] });
  const ally = addEnemy(battle, 96, 72, { cells: 50 });
  run(battle, 3.2);
  assert.ok(ally.shield >= 2, `expected shield, got ${ally.shield}`);
});

test('敌方护盾先于生命被消耗', () => {
  const battle = makeBattle(['orb_phys']);
  const enemy = addEnemy(battle, 90, 72, { cells: 10 });
  enemy.shield = 3;
  run(battle, 1.0);
  assert.equal(enemy.shield, 2);
  assert.equal(enemy.cells, 10);
});
