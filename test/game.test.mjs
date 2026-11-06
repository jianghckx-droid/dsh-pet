import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BURN,
  advanceStatus,
  applyBurn,
  attackCells,
  createStatus,
  edgeCells,
  playerCells,
  resolveHit,
  steadyDps,
} from '../src/game/rules.js';
import { CARDS, FIRE_BUILD } from '../src/game/cards.js';
import { enemyCells, floorDef, spawnSeconds } from '../src/game/floors.js';

const carapace = { locks: ['carapace'] };
const shield = { locks: ['shield'] };
const plain = { locks: [] };

test('无锁时伤害原样通过', () => {
  assert.equal(resolveHit(plain, 6), 6);
  assert.equal(resolveHit(plain, 1), 1);
});

test('甲壳把单次伤害压到 1 格', () => {
  assert.equal(resolveHit(carapace, 6), 1);
  assert.equal(resolveHit(carapace, 200), 1);
  assert.equal(resolveHit(carapace, 0.5), 0.5);
});

test('护盾只减主攻击，减到 0 为止', () => {
  assert.equal(resolveHit(shield, 3, { main: true }), 2);
  assert.equal(resolveHit(shield, 1, { main: true }), 0);
});

test('护盾不减免衍生伤害（灼烧跳）', () => {
  assert.equal(resolveHit(shield, 5, { main: false }), 5);
});

test('锋锐每 2 点 +1 格，只作用于主攻击', () => {
  assert.equal(edgeCells({ edge: 0 }), 0);
  assert.equal(edgeCells({ edge: 1 }), 0);
  assert.equal(edgeCells({ edge: 10 }), 5);
  assert.equal(attackCells(CARDS.orb_phys, { edge: 10 }), 6);
});

test('灼烧：叠层、跳伤、上限、熄灭', () => {
  const status = createStatus();
  applyBurn(status, 3);
  assert.equal(advanceStatus(status, 1.5), 3);
  applyBurn(status, 4);
  assert.equal(status.burn, BURN.cap);

  const shortLived = createStatus();
  applyBurn(shortLived, 1);
  assert.equal(advanceStatus(shortLived, BURN.durationSeconds), 0);
  assert.equal(shortLived.burn, 0);
});

test('甲壳让锋锐完全失效：火 build 的 DPS 不随锋锐变化', () => {
  const fireNoEdge = steadyDps(FIRE_BUILD.map((id) => CARDS[id]), { edge: 0 }, carapace);
  const fireMaxEdge = steadyDps(FIRE_BUILD.map((id) => CARDS[id]), { edge: 10 }, carapace);
  assert.equal(fireNoEdge, fireMaxEdge);
});

test('第 6 层：纯数值与灼烧的 DPS 差 4 倍以上', () => {
  const iron = steadyDps([CARDS.orb_phys], { edge: 10 }, carapace);
  const fire = steadyDps(FIRE_BUILD.map((id) => CARDS[id]), { edge: 0 }, carapace);
  assert.ok(fire / iron > 4, `expected >4x, got ${(fire / iron).toFixed(2)}x`);
});

test('无锁层里纯数值反而更快', () => {
  const iron = steadyDps([CARDS.orb_phys], { edge: 10 }, plain);
  const fire = steadyDps(FIRE_BUILD.map((id) => CARDS[id]), { edge: 0 }, plain);
  assert.ok(iron > fire * 1.1, `expected iron faster, got ${iron} vs ${fire}`);
});

test('属性换算', () => {
  assert.equal(playerCells({ body: 0 }), 12);
  assert.equal(playerCells({ body: 10 }), 32);
});

test('第 6 层标定值', () => {
  const def = floorDef(6);
  assert.equal(def.enemies, 10);
  assert.deepEqual(def.locks, ['carapace']);
  assert.equal(enemyCells(6, def.locks), 20);
  assert.equal(spawnSeconds(def), 3);
});

test('第 1 层是无锁的 4 格杂兵', () => {
  assert.equal(enemyCells(1, []), 4);
});
