import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStatus,
  consumeStatus,
  getStatusInstance,
  slowFactor,
  stacksOf,
  statusSnapshot,
  tickStatuses,
} from '../src/game/skills/status.js';
import { makeEnemy } from './helpers.mjs';

function statusWorld(enemy) {
  return { enemies: [enemy] };
}

test('灼烧：加层、上限 5、整体刷新持续时间', () => {
  const enemy = makeEnemy(1, 80, 72);
  applyStatus(enemy, 'burn', 3, { skillInstanceId: 'skill-1' });
  assert.equal(stacksOf(enemy, 'burn'), 3);
  const instance = getStatusInstance(enemy, 'burn');
  assert.equal(instance.remaining, 6);

  tickStatuses(statusWorld(enemy), 4);
  assert.ok(instance.remaining < 3);
  applyStatus(enemy, 'burn', 1);
  assert.equal(instance.remaining, 6, '再次施加必须刷新整体持续时间');

  applyStatus(enemy, 'burn', 9);
  assert.equal(stacksOf(enemy, 'burn'), 5, '层数上限由定义决定');
});

test('灼烧：每 1.5 秒按层数跳出伤害，到期后移除', () => {
  const enemy = makeEnemy(1, 80, 72);
  applyStatus(enemy, 'burn', 3);
  const ticks = tickStatuses(statusWorld(enemy), 1.5);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].damage, 3);
  assert.equal(ticks[0].statusId, 'burn');

  const late = tickStatuses(statusWorld(enemy), 6);
  assert.equal(late.length, 0, '持续时间耗尽后不应继续跳');
  assert.equal(stacksOf(enemy, 'burn'), 0);
});

test('周期伤害继承施加时的技能与根事件归因', () => {
  const enemy = makeEnemy(1, 80, 72);
  applyStatus(enemy, 'burn', 2, { skillInstanceId: 'skill-9', element: 'fire', rootEventId: 42 });
  const ticks = tickStatuses(statusWorld(enemy), 1.5);
  assert.equal(ticks[0].skillInstanceId, 'skill-9');
  assert.equal(ticks[0].element, 'fire');
  assert.equal(ticks[0].rootEventId, 42);
});

test('寒冷：降低移动速度，最多 40%', () => {
  const enemy = makeEnemy(1, 80, 72);
  assert.equal(slowFactor(enemy), 1);
  applyStatus(enemy, 'chill', 2);
  assert.ok(Math.abs(slowFactor(enemy) - 0.84) < 1e-9);
  applyStatus(enemy, 'chill', 5);
  assert.equal(stacksOf(enemy, 'chill'), 5);
  assert.ok(Math.abs(slowFactor(enemy) - 0.6) < 1e-9);
});

test('充能：有限层数且会过期', () => {
  const enemy = makeEnemy(1, 80, 72);
  applyStatus(enemy, 'charge', 1);
  assert.equal(stacksOf(enemy, 'charge'), 1);
  tickStatuses(statusWorld(enemy), 7.9);
  assert.equal(stacksOf(enemy, 'charge'), 1);
  tickStatuses(statusWorld(enemy), 0.2);
  assert.equal(stacksOf(enemy, 'charge'), 0);
});

test('消耗层数返回实际消耗量，归零时移除实例', () => {
  const enemy = makeEnemy(1, 80, 72);
  applyStatus(enemy, 'charge', 3);
  assert.equal(consumeStatus(enemy, 'charge', 2), 2);
  assert.equal(stacksOf(enemy, 'charge'), 1);
  assert.equal(consumeStatus(enemy, 'charge', 5), 1);
  assert.equal(getStatusInstance(enemy, 'charge'), null);
  assert.equal(consumeStatus(enemy, 'charge', 1), 0);
});

test('状态快照读取三种共享状态', () => {
  const enemy = makeEnemy(1, 80, 72);
  applyStatus(enemy, 'burn', 2);
  applyStatus(enemy, 'chill', 1);
  assert.deepEqual(statusSnapshot(enemy), { burn: 2, chill: 1, charge: 0 });
});
