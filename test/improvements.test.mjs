import test from 'node:test';
import assert from 'node:assert/strict';

import { awardXp, createBattle, runToEnd, triggerSurge } from '../src/game/arena.js';
import { FIRE_PACK, LAB_PACK, MARK_PACK } from '../src/game/cards.js';
import { floorModifier } from '../src/game/floors.js';

const ATTRS = { edge: 10, body: 10 };

test('按家族抽卡：三张来自同一个主题', () => {
  const battle = createBattle({
    floor: 1,
    build: ['orb_phys'],
    attrs: ATTRS,
    seed: 3,
    pool: [...LAB_PACK],
    families: [[...FIRE_PACK], [...MARK_PACK]],
  });
  awardXp(battle, 8);
  assert.equal(battle.offer.length, 3);
  const inFire = battle.offer.every((id) => FIRE_PACK.includes(id));
  const inMark = battle.offer.every((id) => MARK_PACK.includes(id));
  assert.ok(inFire || inMark, `expected one family, got ${battle.offer.join(',')}`);
});

test('定向保底：死因锁会出现在下一次三选一里', () => {
  const battle = createBattle({
    floor: 6,
    build: ['orb_phys'],
    attrs: ATTRS,
    seed: 3,
    pool: [...LAB_PACK],
    pity: 'carapace',
  });
  awardXp(battle, 8);
  const solvers = ['orb_fire', 'field_fire', 'summon_fire', 'self_fire'];
  assert.ok(
    battle.offer.some((id) => solvers.includes(id)),
    `expected a carapace counter, got ${battle.offer.join(',')}`,
  );
});

test('层修饰符：拥挤层的敌人数变多', () => {
  assert.equal(floorModifier(4), 'crowded');
  const battle = createBattle({
    floor: 4,
    build: ['orb_phys'],
    attrs: ATTRS,
    seed: 5,
  });
  assert.equal(battle.modifier, 'crowded');
  runToEnd(battle, { maxSeconds: 60 });
  assert.equal(battle.spawned, 18); // 12 × 1.5
});

test('过载潮：加怪并在清层后给一次三选一', () => {
  const battle = createBattle({
    floor: 1,
    build: ['orb_phys'],
    attrs: ATTRS,
    seed: 5,
  });
  assert.equal(triggerSurge(battle, 6), true);
  assert.equal(battle.extra, 6);
  assert.equal(battle.surge, true);
  runToEnd(battle, { maxSeconds: 60 });
  assert.equal(battle.state, 'cleared');
  assert.ok(battle.pending >= 1, 'expected a draft reward');
});

test('伤害统计：记录来源', () => {
  const battle = createBattle({ floor: 1, build: ['orb_phys'], attrs: ATTRS, seed: 5 });
  runToEnd(battle, { maxSeconds: 60 });
  const total = Object.values(battle.stats.damage).reduce((sum, value) => sum + value, 0);
  assert.ok(total > 0, 'expected damage stats');
  assert.ok(battle.stats.kills > 0, 'expected kill stats');
});
