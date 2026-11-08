import test from 'node:test';
import assert from 'node:assert/strict';

import { compileBuild } from '../src/game/skills/compile.js';
import { contentById } from '../src/game/skills/registry.js';
import { MODIFIER_PHASES, MODIFIER_HANDLERS } from '../src/game/skills/modifiers/index.js';
import { applyStatus, stacksOf } from '../src/game/skills/status.js';
import { fireHit, makeBattle, makeEnemy } from './helpers.mjs';

function buildWith(action, element, modifier) {
  return {
    version: 3,
    skills: [{ id: 'skill-1', action, element, modifier }],
    reserve: [],
  };
}

test('引爆：编译后的描述与冷却来自最终参数', () => {
  const compiled = compileBuild(buildWith('projectile', 'fire', 'detonate'));
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0];
  assert.equal(plan.modifier.id, 'detonate');
  assert.ok(Math.abs(plan.cooldown - 1.08) < 1e-9);
  assert.equal(plan.descriptionData.modifier.id, 'detonate');
  assert.ok(plan.descriptionData.modifier.text.includes('每层 2 伤害'));
  assert.ok(plan.description.includes('引爆'));
  assert.ok(plan.description.includes('1.08'));
});

test('引爆：消耗目标全部状态，对附近目标造成按层数缩放的范围伤害', () => {
  const battle = makeBattle(buildWith('projectile', 'fire', 'detonate'));
  const target = makeEnemy(1, 80, 72, { cells: 40 });
  const near = makeEnemy(2, 92, 72, { cells: 40 });
  const far = makeEnemy(3, 130, 72, { cells: 40 });
  battle.enemies = [target, near, far];
  applyStatus(target, 'burn', 3);
  applyStatus(target, 'chill', 1);

  fireHit(
    battle,
    1,
    {
      damage: 2,
      element: 'fire',
      modifier: contentById('detonate'),
    },
    ['projectile', 'fire'],
  );

  assert.equal(stacksOf(target, 'burn'), 0, '引爆消耗全部状态');
  assert.equal(stacksOf(target, 'chill'), 0);
  assert.equal(near.cells, 30, '附近目标受到 5 层 × 2 伤害');
  assert.equal(far.cells, 40, '范围外目标不受影响');
  assert.equal(battle.stats.modifiers.detonate, 1);
  assert.equal(battle.stats.reactions.detonate, undefined, '引爆是修饰阶段，不计入共享反应');
});

test('引爆：同一施放只触发一次，后续命中不再引爆', () => {
  const battle = makeBattle(buildWith('aura', 'fire', 'detonate'));
  const first = makeEnemy(1, 80, 72, { cells: 60 });
  const second = makeEnemy(2, 86, 72, { cells: 60 });
  battle.enemies = [first, second];
  applyStatus(first, 'burn', 2);
  applyStatus(second, 'burn', 2);

  fireHit(
    battle,
    1,
    {
      damage: 1,
      element: 'fire',
      modifier: contentById('detonate'),
      castId: 'same-cast',
      action: 'aura',
    },
    ['aura', 'fire'],
  );

  assert.equal(stacksOf(first, 'burn'), 0);
  assert.ok(stacksOf(second, 'burn') > 0, '一次施放只引爆首个命中目标');
});

test('修饰阶段表包含全部处理器，且阶段顺序固定', () => {
  assert.deepEqual(Object.keys(MODIFIER_HANDLERS).sort(), ['detonate', 'echo', 'expand', 'pull', 'split']);
  assert.ok(MODIFIER_PHASES.compile < MODIFIER_PHASES.cast);
  assert.ok(MODIFIER_PHASES.cast < MODIFIER_PHASES.onHit);
  assert.ok(MODIFIER_PHASES.onHit < MODIFIER_PHASES.onEnd);
});
