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
    phaseCd: 4,
    invuln: 0,
    flash: 0,
  };
  battle.enemies.push(enemy);
  return enemy;
}

function run(battle, seconds) {
  let shots = 0;
  for (let i = 0; i < Math.round(seconds * 20); i += 1) {
    const events = step(battle, 1 / 20);
    for (const event of events) if (event.type === 'shot') shots += 1;
  }
  return shots;
}

test('透支：开局扣 3 格生命', () => {
  const battle = makeBattle(['orb_phys', 'overdraft']);
  assert.equal(battle.player.maxCells, 12);
  assert.equal(battle.player.cells, 9);
});

test('血偿：受伤后下一次攻击加成', () => {
  const battle = makeBattle(['orb_phys', 'blood_debt']);
  addEnemy(battle, 82, 72, { cells: 50, damage: 1, attackTimer: 0 });
  run(battle, 0.2);
  assert.ok(battle.bloodStacks > 0, 'expected blood debt stack');
  const before = battle.enemies[0].cells;
  run(battle, 0.8);
  assert.ok(battle.enemies[0].cells < before, 'expected a boosted hit');
});

test('护盾爆：护盾破碎时炸周围', () => {
  const battle = makeBattle(['orb_phys', 'shield_burst']);
  const enemy = addEnemy(battle, 100, 72, { cells: 30 });
  run(battle, 6.3);
  assert.ok(battle.player.shield > 0, 'expected a shield');

  const attacker = addEnemy(battle, 82, 72, { cells: 30, damage: 3, attackTimer: 0 });
  run(battle, 0.2);
  assert.equal(battle.player.shield, 0);
  assert.ok(attacker.cells <= 27, `expected burst damage, got ${attacker.cells}`);
});

test('破釜：残血时射得更快', () => {
  const low = makeBattle(['orb_phys', 'desperate']);
  low.player.cells = 2;
  addEnemy(low, 100, 72, { cells: 500 });

  const normal = makeBattle(['orb_phys']);
  addEnemy(normal, 100, 72, { cells: 500 });

  const lowShots = run(low, 3);
  const normalShots = run(normal, 3);
  assert.ok(lowShots > normalShots, `expected faster fire, ${lowShots} vs ${normalShots}`);
});
