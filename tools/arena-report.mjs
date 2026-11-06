#!/usr/bin/env node
// 空间状态机报告：用 src/game/arena.js 真实跑一遍，和 tools/balance-sim.mjs
// 的抽象模型对照。两者应当给出同样的结论（谁过、谁不过），否则说明
// 模型假设和真实走位之间有一方错了。
//
// 用法: node tools/arena-report.mjs

import { createBattle, runToEnd, TIME_LIMIT } from '../src/game/arena.js';
import { FIRE_BUILD } from '../src/game/cards.js';
import { FLOORS } from '../src/game/floors.js';

const BUILDS = {
  pure: { label: '纯数值', build: ['orb_phys'], attrs: { edge: 10, body: 0 } },
  pureTank: { label: '纯数值+体魄', build: ['orb_phys'], attrs: { edge: 5, body: 5 } },
  fire: { label: '灼烧', build: [...FIRE_BUILD], attrs: { edge: 0, body: 10 } },
  fireHybrid: { label: '灼烧混合', build: [...FIRE_BUILD], attrs: { edge: 6, body: 4 } },
};

const fmt = (b) => {
  const tag = b.state === 'cleared' ? '过' : b.state === 'dead' ? '死' : '超时';
  return `${tag} ${b.time.toFixed(0)}s/${b.player.cells}`;
};

console.log(`| 层 | 锁 | ${Object.values(BUILDS).map((b) => b.label).join(' | ')} |`);
console.log(`|---|---|${Object.values(BUILDS).map(() => '---').join('|')}|`);

for (const def of FLOORS) {
  const cells = [];
  for (const preset of Object.values(BUILDS)) {
    const battle = createBattle({
      floor: def.floor,
      build: preset.build,
      attrs: preset.attrs,
      seed: 7,
    });
    runToEnd(battle, { maxSeconds: TIME_LIMIT + 10 });
    cells.push(fmt(battle));
  }
  console.log(`| ${def.floor} | ${def.locks.join('+') || '—'} | ${cells.join(' | ')} |`);
}

console.log('\n格式：结果 用时/剩余生命。seed 固定为 7。');
