import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attackCells,
  cooldown,
  damageTaken,
  normalizeAttrs,
  regenPerSecond,
  visionScale,
} from '../src/game/rules.js';
import { createBattle, spendPoint } from '../src/game/arena.js';

test('normalizeAttrs：补零、取整、夹到 0–10', () => {
  const attrs = normalizeAttrs({ edge: 99, body: -3, swift: 4.7 });
  assert.equal(attrs.edge, 10);
  assert.equal(attrs.body, 0);
  assert.equal(attrs.swift, 4);
  assert.equal(attrs.tough, 0);
  assert.equal(attrs.recover, 0);
  assert.equal(attrs.vision, 0);
});

test('六项属性的换算', () => {
  assert.equal(damageTaken(1, { tough: 10 }), 0.7);
  assert.equal(cooldown(1, { swift: 10 }), 0.6);
  assert.equal(regenPerSecond({ recover: 10 }), 2);
  assert.equal(visionScale({ vision: 10 }), 1.6);
  assert.equal(visionScale({}), 1);
});

test('体魄：当场提高上限并补回等量生命', () => {
  const battle = createBattle({
    floor: 1,
    build: ['orb_phys'],
    attrs: {},
    points: 3,
  });
  assert.equal(battle.player.maxCells, 12);
  assert.equal(spendPoint(battle, 'body'), true);
  assert.equal(battle.attrs.body, 1);
  assert.equal(battle.points, 2);
  assert.equal(battle.player.maxCells, 14);
  assert.equal(battle.player.cells, 14);
});

test('属性点花不出去的情况：没点、已满、不存在的属性', () => {
  const battle = createBattle({ floor: 1, build: ['orb_phys'], attrs: { edge: 10 }, points: 0 });
  assert.equal(spendPoint(battle, 'edge'), false);
  battle.points = 5;
  assert.equal(spendPoint(battle, 'edge'), false);
  assert.equal(spendPoint(battle, 'nope'), false);
});

test('锋锐直接抬高每击格数', () => {
  const battle = createBattle({ floor: 1, build: ['orb_phys'], attrs: { edge: 10 } });
  assert.equal(attackCells(battle.cards[0], battle.attrs), 6);
});
