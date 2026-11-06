import test from 'node:test';
import assert from 'node:assert/strict';

import { createBattle } from '../src/game/arena.js';
import { BURN } from '../src/game/rules.js';
import { CORES, unlockedCores } from '../src/game/cards.js';

test('核心卡进战斗，但不占抽卡槽', () => {
  const battle = createBattle({
    floor: 1,
    build: ['orb_phys'],
    cores: ['core_ember'],
    seed: 1,
  });
  assert.ok(battle.cards.some((card) => card.id === 'core_ember'));
  assert.equal(battle.slots.length, 0);
});

test('余烬之种：灼烧上限从 5 提到 7', () => {
  const withCore = createBattle({ floor: 1, build: ['orb_phys'], cores: ['core_ember'], seed: 1 });
  const without = createBattle({ floor: 1, build: ['orb_phys'], seed: 1 });
  assert.equal(withCore.burnCap, BURN.cap + 2);
  assert.equal(without.burnCap, BURN.cap);
});

test('解锁条件按累计 stats 计算', () => {
  assert.deepEqual(unlockedCores({ bestFloor: 1, kills: 0, maxFloorKills: 0, drafts: 0 }), []);
  const all = unlockedCores({ bestFloor: 6, kills: 60, maxFloorKills: 20, drafts: 3 });
  assert.equal(all.length, CORES.length);
});
