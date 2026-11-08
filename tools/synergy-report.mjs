#!/usr/bin/env node
// 跨技能配合观察：同一层、同一 seed 下比较单技能与两技能构筑的
// 反应触发、伤害来源和存活时间。用于人工试玩前的结构验证，不代表玩家体验。
//
// 用法: node tools/synergy-report.mjs

import { TIME_LIMIT, createBattle, runToEnd } from '../src/game/arena.js';

const BUILDS = {
  fireAlone: {
    label: '火焰飞弹',
    movement: 'keepDistance',
    skills: [{ id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' }],
  },
  frostAlone: {
    label: '冰霜光环',
    movement: 'keepDistance',
    skills: [{ id: 'skill-1', action: 'aura', element: 'frost', modifier: 'pull' }],
  },
  fireFrost: {
    label: '火焰飞弹 + 冰霜光环',
    movement: 'auto',
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'aura', element: 'frost', modifier: 'pull' },
    ],
  },
  shatter: {
    label: '冰霜光环 + 冰霜冲击',
    movement: 'auto',
    skills: [
      { id: 'skill-1', action: 'aura', element: 'frost', modifier: 'pull' },
      { id: 'skill-2', action: 'impact', element: 'frost', modifier: null },
    ],
  },
  detonate: {
    label: '火焰飞弹 + 引爆冲击',
    movement: 'auto',
    skills: [
      { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
      { id: 'skill-2', action: 'impact', element: 'fire', modifier: 'detonate' },
    ],
  },
  swordArt: {
    label: '飞剑穿敌 + 剑阵',
    movement: 'auto',
    skills: [
      { id: 'skill-1', action: 'swordPierce', element: 'fire', modifier: null },
      { id: 'skill-2', action: 'swordArray', element: 'frost', modifier: 'echo' },
    ],
  },
  swordArc: {
    label: '弧光飞剑 + 雷电剑阵',
    movement: 'keepDistance',
    skills: [
      { id: 'skill-1', action: 'arcSword', element: 'frost', modifier: null },
      { id: 'skill-2', action: 'swordArray', element: 'thunder', modifier: null },
    ],
  },
};

function toBuild(entry) {
  return {
    version: 3,
    skills: entry.skills.map((skill, index) => ({
      id: skill.id ?? `skill-${index + 1}`,
      action: skill.action,
      element: skill.element ?? null,
      modifier: skill.modifier ?? null,
    })),
    reserve: [],
  };
}

const rows = [];
for (const floor of [6, 10]) {
  for (const entry of Object.values(BUILDS)) {
    const battle = createBattle({
      floor,
      build: toBuild(entry),
      seed: 7,
      movementStrategy: entry.movement,
    });
    runToEnd(battle, { maxSeconds: TIME_LIMIT + 10 });
    const reactions = Object.entries(battle.stats.reactions)
      .filter(([, stat]) => stat.count > 0)
      .map(([id, stat]) => `${id}×${stat.count}`);
    const modifiers = Object.entries(battle.stats.modifiers ?? {})
      .filter(([, count]) => count > 0)
      .map(([id, count]) => `${id}×${count}`);
    const reactionText = [...reactions, ...modifiers].join(' ');
    const damage = Object.values(battle.stats.damage).reduce((sum, value) => sum + value, 0);
    rows.push({
      floor,
      label: entry.label,
      result: battle.state,
      time: battle.time,
      damage: Math.round(damage),
      overflow: Math.round(battle.stats.overflow ?? 0),
      reactions: reactionText === '' ? '—' : reactionText,
    });
  }
}

console.log('## 跨技能配合观察（seed 7）\n');
console.log('| 层 | build | 结果 | 用时 | 有效伤害 | 溢出 | 反应 / 修饰 |');
console.log('|---|---|---|---|---|---|---|');
for (const row of rows) {
  const result = row.result === 'cleared' ? '清' : row.result === 'dead' ? '亡' : '超时';
  console.log(
    `| ${row.floor} | ${row.label} | ${result} | ${row.time.toFixed(0)}s | ${row.damage} | ${row.overflow} | ${row.reactions} |`,
  );
}

console.log('\n说明：该表只展示结构上是否出现跨技能反应与伤害归因，不证明组合丰富度或玩家理解成本。');
