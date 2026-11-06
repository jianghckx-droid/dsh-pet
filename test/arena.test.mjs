import test from 'node:test';
import assert from 'node:assert/strict';

import { ARENA, createBattle, runToEnd, step, TIME_LIMIT } from '../src/game/arena.js';
import { FIRE_BUILD } from '../src/game/cards.js';

const PURE = { build: ['orb_phys'], attrs: { edge: 10, body: 0 } };
const FIRE = { build: [...FIRE_BUILD], attrs: { edge: 0, body: 10 } };

function play(floor, preset, seed = 7) {
  const battle = createBattle({ floor, seed, ...preset });
  return runToEnd(battle, { maxSeconds: TIME_LIMIT + 10 });
}

test('同一 seed 完全可复现', () => {
  const a = play(6, FIRE, 11);
  const b = play(6, FIRE, 11);
  assert.equal(a.state, b.state);
  assert.equal(a.time, b.time);
  assert.equal(a.kills, b.kills);
  assert.equal(a.player.cells, b.player.cells);
});

test('第 1 层：两种 build 都能过', () => {
  assert.equal(play(1, PURE).state, 'cleared');
  assert.equal(play(1, FIRE).state, 'cleared');
});

test('第 5 层（无锁）：两种 build 都能过', () => {
  assert.equal(play(5, PURE).state, 'cleared');
  assert.equal(play(5, FIRE).state, 'cleared');
});

test('第 6 层墙：纯数值过不去，灼烧能过', () => {
  const pure = play(6, PURE);
  const fire = play(6, FIRE);
  assert.notEqual(pure.state, 'cleared', `pure should fail, got ${pure.state}`);
  assert.equal(fire.state, 'cleared');
});

test('第 6 层灼烧是"勉强过"：会掉血，但不死', () => {
  const fire = play(6, FIRE);
  assert.ok(fire.player.cells < fire.player.maxCells, 'expected some damage taken');
  assert.ok(fire.player.cells > 0);
});

test('玩家始终在场地内，数值不为 NaN', () => {
  const battle = createBattle({ floor: 6, seed: 3, ...FIRE });
  for (let i = 0; i < 60 * 40 && battle.state === 'fighting'; i += 1) {
    step(battle, 1 / 60);
    const { x, y, cells } = battle.player;
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(cells));
    assert.ok(x >= 6 && x <= ARENA.w - 6);
    assert.ok(y >= 6 && y <= ARENA.h - 6);
  }
});

test('灼烧能在甲壳上生效：火 build 击杀数大于 0', () => {
  const fire = play(6, FIRE);
  assert.ok(fire.kills > 0, 'fire should kill something');
});
