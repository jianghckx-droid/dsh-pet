#!/usr/bin/env node
// 空间状态机报告：用 src/game/arena.js 真实跑一遍全部层，和 balance-sim 的
// 解析模型对照。两者应给出相同方向的结论；不一致说明模型假设或走位有问题。
//
// 用法: node tools/arena-report.mjs

import { TIME_LIMIT, createBattle, runToEnd } from '../src/game/arena.js';
import { FLOORS } from '../src/game/floors.js';

const BUILDS = {
  starter: {
    label: '基础飞弹',
    build: {
      skills: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
      reserve: [],
    },
  },
  fireSplit: {
    label: '火焰分裂',
    build: {
      skills: [
        { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
        { id: 'skill-2', action: 'aura', element: 'fire', modifier: 'expand' },
      ],
      reserve: [],
    },
  },
  frostShatter: {
    label: '冰霜碎裂',
    build: {
      skills: [
        { id: 'skill-1', action: 'aura', element: 'frost', modifier: 'pull' },
        { id: 'skill-2', action: 'impact', element: 'frost', modifier: 'echo' },
      ],
      reserve: [],
    },
  },
  thunderChain: {
    label: '雷电回响',
    movement: 'keepDistance',
    build: {
      skills: [
        { id: 'skill-1', action: 'projectile', element: 'thunder', modifier: 'echo' },
        { id: 'skill-2', action: 'aura', element: 'thunder', modifier: 'expand' },
      ],
      reserve: [],
    },
  },
  melee: {
    label: '近战挥斩',
    movement: 'approach',
    build: {
      skills: [
        { id: 'skill-1', action: 'swing', element: 'fire', modifier: 'expand' },
        { id: 'skill-2', action: 'impact', element: 'frost', modifier: null },
      ],
      reserve: [],
    },
  },
  sword: {
    label: '环身御剑',
    movement: 'approach',
    build: {
      skills: [
        { id: 'skill-1', action: 'orbitSword', element: 'fire', modifier: 'echo' },
        { id: 'skill-2', action: 'impact', element: 'frost', modifier: null },
      ],
      reserve: [],
    },
  },
  swordArc: {
    label: '弧光剑阵',
    movement: 'keepDistance',
    build: {
      skills: [
        { id: 'skill-1', action: 'arcSword', element: 'frost', modifier: null },
        { id: 'skill-2', action: 'swordArray', element: 'thunder', modifier: null },
      ],
      reserve: [],
    },
  },
  trapper: {
    label: '陷阱',
    movement: 'keepDistance',
    build: {
      skills: [
        { id: 'skill-1', action: 'trap', element: 'thunder', modifier: 'expand' },
        { id: 'skill-2', action: 'projectile', element: 'thunder', modifier: null },
      ],
      reserve: [],
    },
  },
  swordArt: {
    label: '剑阵穿敌',
    movement: 'auto',
    build: {
      skills: [
        { id: 'skill-1', action: 'swordPierce', element: 'fire', modifier: null },
        { id: 'skill-2', action: 'swordArray', element: 'frost', modifier: 'echo' },
      ],
      reserve: [],
    },
  },
};

const fmt = (battle) => {
  const tag = battle.state === 'cleared' ? '清' : battle.state === 'dead' ? '亡' : '超时';
  const reactions = Object.entries(battle.stats.reactions)
    .filter(([, stat]) => stat.count > 0)
    .map(([id, stat]) => id.slice(0, 4) + stat.count)
    .join('');
  return `${tag} ${battle.time.toFixed(0)}s/${Math.max(0, Math.ceil(battle.player.cells))}${reactions === '' ? '' : '[' + reactions + ']'}`;
};

console.log(`| 层 | 敌人 | ${Object.values(BUILDS).map((entry) => entry.label).join(' | ')} |`);
console.log(`|---|---|${Object.values(BUILDS).map(() => '---').join('|')}|`);

for (const def of FLOORS) {
  const cells = [];
  for (const preset of Object.values(BUILDS)) {
    const battle = createBattle({
      floor: def.floor,
      build: preset.build,
      seed: 7,
      movementStrategy: preset.movement ?? 'auto',
    });
    runToEnd(battle, { maxSeconds: TIME_LIMIT + 10 });
    cells.push(fmt(battle));
  }
  console.log(`| ${def.floor} | ${def.count} | ${cells.join(' | ')} |`);
}

console.log('\n格式：结果 用时/剩余生命[反应缩写+次数]。seed 固定为 7。');
console.log('反应缩写：spre=传火，cond=导电，shat=碎裂。');
