import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_EXTRA, addPressure, createBattle, runToEnd } from '../src/game/arena.js';

test('token 压力：额外敌人会被刷出来，且不延长层时长', () => {
  const battle = createBattle({
    floor: 1,
    build: ['orb_phys'],
    attrs: { edge: 10 },
    seed: 5,
  });
  assert.equal(addPressure(battle, 5), 5);
  assert.equal(battle.extra, 5);
  runToEnd(battle);
  assert.equal(battle.spawned, 13, '8 base + 5 pressure');
});

test('压力有上限，超出部分丢弃', () => {
  const battle = createBattle({ floor: 1, build: ['orb_phys'], attrs: { edge: 10 }, seed: 5 });
  assert.equal(addPressure(battle, 999), MAX_EXTRA);
  assert.equal(battle.extra, MAX_EXTRA);
  assert.equal(addPressure(battle, 1), 0);
});

test('战斗结束后不再接受压力', () => {
  const battle = createBattle({ floor: 1, build: ['orb_phys'], attrs: { edge: 10 }, seed: 5 });
  battle.state = 'cleared';
  assert.equal(addPressure(battle, 3), 0);
  assert.equal(battle.extra, 0);
});
