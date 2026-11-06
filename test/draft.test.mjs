import test from 'node:test';
import assert from 'node:assert/strict';

import { awardXp, chooseCard, createBattle, MAX_SLOTS } from '../src/game/arena.js';
import { FIRE_PACK } from '../src/game/cards.js';

const ATTRS = { edge: 0, body: 10 };

function fresh({ build = ['orb_phys'], pool = [...FIRE_PACK] } = {}) {
  return createBattle({ floor: 1, build, attrs: ATTRS, seed: 3, pool });
}

test('升到 2 级时给出三选一', () => {
  const battle = fresh();
  assert.equal(battle.offer, null);
  awardXp(battle, 8); // 1→2 级
  assert.ok(Array.isArray(battle.offer), 'expected an offer');
  assert.equal(battle.offer.length, 3);
  assert.equal(battle.pending, 1);
  for (const id of battle.offer) assert.ok(FIRE_PACK.includes(id));
});

test('选卡进槽、加进 build、清空 offer', () => {
  const battle = fresh();
  awardXp(battle, 8);
  const id = battle.offer[0];
  assert.equal(chooseCard(battle, id), true);
  assert.equal(battle.slots.length, 1);
  assert.ok(battle.cards.some((card) => card.id === id));
  assert.equal(battle.offer, null);
});

test('offer 不会重复给已拥有的卡', () => {
  const battle = fresh({ build: ['orb_phys', 'orb_fire'] });
  awardXp(battle, 8);
  assert.ok(!battle.offer.includes('orb_fire'));
});

test('槽位满 3 个之后不再出 offer', () => {
  const battle = fresh();
  for (let i = 0; i < 6 && battle.slots.length < MAX_SLOTS; i += 1) {
    awardXp(battle, 40);
    if (battle.offer !== null) assert.equal(chooseCard(battle, battle.offer[0]), true);
  }
  assert.equal(battle.slots.length, MAX_SLOTS);
  awardXp(battle, 100);
  assert.equal(battle.offer, null);
});

test('选不在 offer 里的卡会被拒绝', () => {
  const battle = fresh();
  awardXp(battle, 8);
  assert.equal(chooseCard(battle, 'not_a_card'), false);
  assert.equal(battle.slots.length, 0);
});

test('池子为空的 build 永远不会出 offer', () => {
  const battle = fresh({ pool: [] });
  awardXp(battle, 100);
  assert.equal(battle.offer, null);
  assert.equal(battle.pending > 0, true);
});
