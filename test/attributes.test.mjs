import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTRIBUTE_IDS,
  COMBAT_CAPS,
  conditionalBonus,
  createCombatStats,
  describeCombatStats,
  effectiveCooldown,
  emptyAttributes,
  mitigateDamage,
  normalizeAttributes,
  previewAttribute,
  resolveDamage,
  spentPoints,
  unspentPointsFor,
} from '../src/game/attributes.js';
import {
  allocateAttribute,
  attributeSummary,
  awardXp,
  createBattle,
  step,
} from '../src/game/arena.js';
import { emptyBuild } from '../src/game/skills/compile.js';
import { contentById } from '../src/game/skills/registry.js';
import { applyStatus } from '../src/game/skills/status.js';
import { fireHit, makeEnemy } from './helpers.mjs';

const approx = (actual, expected, eps = 1e-9, label = '') => {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= eps,
    `${label} expected ${expected}, got ${actual}`,
  );
};

/** 固定场景：没有刷怪、不走位、没有敌人的空场，方便逐条验证公式。 */
function battleFor(attributes = {}, { build = emptyBuild(), seed = 7 } = {}) {
  const battle = createBattle({ floor: 1, build, seed, attributes });
  battle.spawned = 999;
  battle.total = 999;
  battle.player.speed = 0;
  battle.player.x = 80;
  battle.player.y = 72;
  battle.enemies = [];
  return battle;
}

test('基础属性换算：四项属性各按固定比例进入战斗属性', () => {
  const stats = createCombatStats({ strength: 3, agility: 4, intellect: 5, vitality: 6 });
  assert.equal(stats.armor, 6);
  approx(stats.attackSpeed, 0.04);
  approx(stats.critChance, 0.05 + 0.02);
  approx(stats.damageBonus, 0.10);
  assert.equal(stats.maxLife, 30);
  assert.equal(stats.spent, 18);
});

test('上限：攻击速度 100%、暴击率 100%、护甲减伤 60%', () => {
  const stats = createCombatStats({ strength: 500, agility: 500 });
  assert.equal(stats.attackSpeed, COMBAT_CAPS.attackSpeed);
  assert.equal(stats.critChance, 1);
  approx(stats.armorReduction, 0.6);
  approx(mitigateDamage(10, stats), 4);
  assert.equal(mitigateDamage(10, createCombatStats({ strength: 50 })), 5);
  assert.equal(mitigateDamage(10, createCombatStats()), 10);
});

test('攻击速度只作用于施放冷却，且不能低于一半冷却', () => {
  approx(effectiveCooldown(0.9, createCombatStats()), 0.9);
  approx(effectiveCooldown(0.9, createCombatStats({ agility: 25 })), 0.9 / 1.25);
  approx(effectiveCooldown(0.9, createCombatStats({ agility: 1000 })), 0.45);
});

test('文档示例：2 点基础伤害 × (1 + 0.12 + 0.15) × 1.5 = 3.81', () => {
  const combat = createCombatStats(
    { intellect: 6 },
    { conditional: [{ damage: 0.15, element: 'fire' }] },
  );
  const crit = resolveDamage(combat, {
    amount: 2,
    channel: 'direct',
    element: 'fire',
    tags: ['projectile', 'fire'],
    rng: () => 0,
  });
  approx(crit.amount, 3.81, 1e-9, 'crit');
  assert.equal(crit.crit, true);
  approx(crit.scaling, 1.27);

  const normal = resolveDamage(combat, {
    amount: 2,
    channel: 'direct',
    element: 'fire',
    tags: ['projectile', 'fire'],
    rng: () => 0.99,
  });
  approx(normal.amount, 2.54, 1e-9, 'normal');
  assert.equal(normal.crit, false);
});

test('条件伤害按标签匹配，每条词条只算一次', () => {
  const combat = createCombatStats(
    {},
    {
      conditional: [
        { damage: 0.15, element: 'fire' },
        { damage: 0.1, tag: 'projectile' },
        { damage: 0.2, status: 'chill' },
      ],
    },
  );
  const target = makeEnemy(1, 80, 72, { cells: 10 });
  const plain = resolveDamage(combat, {
    amount: 1,
    channel: 'direct',
    element: 'fire',
    tags: ['projectile', 'projectile'],
    target,
    rng: () => 0.99,
  });
  approx(plain.scaling, 1 + 0.15 + 0.1);
  assert.equal(
    conditionalBonus(combat, { element: 'fire', tags: ['projectile', 'projectile'], target }),
    0.25,
  );

  applyStatus(target, 'chill', 1);
  const chilled = resolveDamage(combat, {
    amount: 1,
    channel: 'dot',
    element: 'fire',
    tags: ['projectile'],
    target,
    rng: () => 0,
  });
  approx(chilled.scaling, 1 + 0.15 + 0.1 + 0.2);
  assert.equal(chilled.crit, false, '持续伤害不暴击');

  const unrelated = resolveDamage(combat, {
    amount: 1,
    channel: 'direct',
    element: 'frost',
    tags: ['aura'],
    target: makeEnemy(2, 80, 72),
    rng: () => 0.99,
  });
  approx(unrelated.scaling, 1, 1e-9, '没有匹配标签时只保留通用加成');
});

test('伤害通道：直接与派生命中暴击，持续与反应伤害不暴击', () => {
  const combat = createCombatStats({});
  combat.critChance = 1;
  const base = { amount: 2, element: 'fire', tags: ['fire'], rng: () => 0 };
  assert.equal(resolveDamage(combat, { ...base, channel: 'direct' }).crit, true);
  assert.equal(resolveDamage(combat, { ...base, channel: 'derived' }).crit, true);
  assert.equal(resolveDamage(combat, { ...base, channel: 'dot' }).crit, false);
  assert.equal(resolveDamage(combat, { ...base, channel: 'reaction' }).crit, false);
});

test('固定种子复现：暴击判定来自独立且可复现的 RNG 流', () => {
  const roll = (seed) => {
    const battle = createBattle({ seed, floor: 1, attributes: { agility: 20 } });
    const out = [];
    for (let i = 0; i < 40; i += 1) {
      const result = resolveDamage(battle.combat, {
        amount: 1,
        channel: 'direct',
        rng: battle.combatRng,
      });
      out.push(result.crit ? 1 : 0);
    }
    return out.join('');
  };
  assert.equal(roll(11), roll(11));
  assert.notEqual(roll(11), roll(12));
});

test('升级发放属性点：加点改变战斗属性，生命上限与当前生命同步增加', () => {
  const battle = battleFor();
  assert.equal(battle.attributePoints, 0);
  awardXp(battle, 8);
  assert.equal(battle.level, 2);
  assert.equal(battle.attributePoints, 1, '每次升级 +1 属性点');

  const beforeCells = battle.player.cells;
  assert.equal(allocateAttribute(battle, 'vitality'), true);
  assert.equal(battle.attributes.vitality, 1);
  assert.equal(battle.attributePoints, 0);
  assert.equal(battle.player.maxCells, 25);
  assert.equal(battle.player.cells, beforeCells + 1, '最大生命提升时当前生命同步增加');

  assert.equal(allocateAttribute(battle, 'strength'), false, '没有点数时拒绝分配');
  assert.equal(allocateAttribute(battle, 'luck'), false, '未知属性被拒绝');
  assert.equal(battle.combat.armor, 0);
});

test('属性点与技能三选一互不竞争：同一次升级各拿一份', () => {
  const battle = battleFor();
  awardXp(battle, 8);
  assert.equal(battle.pending, 1, '偶数级给一次技能三选一');
  assert.equal(battle.attributePoints, 1, '升级同时给一个属性点');
  assert.equal(battle.offer !== null, true);
});

test('战斗属性进入实际伤害：智力 +2% 生效，分裂按自身基础伤害单独结算', () => {
  const battle = battleFor({ intellect: 5 });
  battle.combat.critChance = 0;
  const primary = makeEnemy(1, 80, 72, { cells: 100 });
  const secondary = makeEnemy(2, 90, 72, { cells: 100 });
  battle.enemies = [primary, secondary];

  fireHit(
    battle,
    1,
    { damage: 2, element: 'fire', modifier: contentById('split') },
    ['projectile', 'fire'],
  );

  approx(primary.cells, 100 - 2.2, 1e-9, '直接命中 2 × 1.1');
  approx(secondary.cells, 100 - 1.1, 1e-9, '分裂 2 × 50% × 1.1，不叠加通用加成');
  approx(battle.stats.damage['skill-1'], 3.3, 1e-9);
});

test('持续伤害吃通用加成但不暴击', () => {
  const battle = battleFor({ intellect: 5 });
  battle.combat.critChance = 1;
  battle.skills = [];
  const enemy = makeEnemy(1, 90, 72, { cells: 50 });
  battle.enemies = [enemy];
  applyStatus(enemy, 'burn', 2, { skillInstanceId: 'skill-1', element: 'fire' });

  for (let i = 0; i < 120; i += 1) step(battle, 1 / 60);
  approx(enemy.cells, 50 - 2 * 1.1, 1e-9, '2 层灼烧 × 1.1');
  assert.equal(battle.stats.crits, 0, '持续伤害不暴击');
});

test('攻击速度缩短实际施放冷却', () => {
  const casts = (attributes) => {
    const battle = battleFor(attributes);
    battle.enemies = [makeEnemy(1, 120, 72, { cells: 99999 })];
    for (let i = 0; i < 60 * 6; i += 1) step(battle, 1 / 60);
    return battle.stats.casts['skill-1'] ?? 0;
  };
  const slow = casts({});
  const fast = casts({ agility: 100 });
  assert.ok(slow > 0, '基础构筑应该至少施放一次');
  assert.ok(fast >= slow * 1.7, `攻速 +100% 应显著提高施放次数：${fast} vs ${slow}`);
});

test('护甲减伤：敌人伤害按公式结算，并记录被减免的部分', () => {
  const battle = battleFor({ strength: 10 });
  battle.skills = [];
  const enemy = makeEnemy(1, 86, 72, { cells: 999 });
  enemy.damage = 6;
  enemy.attackTimer = 0;
  battle.enemies = [enemy];

  step(battle, 1 / 60);
  approx(battle.player.cells, 24 - 5, 1e-6, '6 点伤害 × (1 - 20/120)');
  approx(battle.stats.mitigated, 1, 1e-6);
});

test('升级界面预览：「力量 3 → 4，护甲 6 → 8」', () => {
  assert.equal(previewAttribute({ strength: 3 }, 'strength').text, '护甲 6 → 8');
  assert.equal(previewAttribute({ agility: 1 }, 'agility').text, '攻速 1% → 2% · 暴击 5.5% → 6%');
  assert.equal(previewAttribute({}, 'intellect').text, '伤害 +0% → +2%');
  assert.equal(previewAttribute({}, 'vitality').text, '生命 24 → 25');
  assert.equal(previewAttribute({ vitality: 4 }, 'vitality').nextPoints, 5);
  assert.equal(previewAttribute({}, 'nope'), null);
});

test('存档迁移：没有属性字段时按等级推算未分配点数', () => {
  assert.equal(unspentPointsFor(1, {}), 0);
  assert.equal(unspentPointsFor(5, {}), 4);
  assert.equal(unspentPointsFor(5, { strength: 3 }), 1);
  assert.equal(unspentPointsFor(3, { strength: 9 }), 0);
  assert.deepEqual(normalizeAttributes({ strength: 2.7, agility: -3, luck: 9 }), {
    strength: 2,
    agility: 0,
    intellect: 0,
    vitality: 0,
  });
  assert.deepEqual(emptyAttributes(), { strength: 0, agility: 0, intellect: 0, vitality: 0 });
  assert.equal(spentPoints({ strength: 1, agility: 2 }), 3);
  assert.deepEqual(ATTRIBUTE_IDS, ['strength', 'agility', 'intellect', 'vitality']);
});

test('战斗属性摘要与属性快照可读', () => {
  const text = describeCombatStats(createCombatStats({ strength: 1, intellect: 5 }));
  assert.ok(text.includes('护甲 2'), text);
  assert.ok(text.includes('伤害 +10%'), text);
  assert.ok(text.includes('×1.5'), text);

  const battle = battleFor();
  awardXp(battle, 8);
  const summary = attributeSummary(battle);
  assert.equal(summary.points, 1);
  assert.equal(summary.spent, 0);
  assert.equal(summary.previews.length, 4);
  assert.ok(summary.text.includes('暴击 5%'), summary.text);
});
