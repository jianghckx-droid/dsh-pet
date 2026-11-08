#!/usr/bin/env node
// 技能数值概览：把编译后的技能计划折算成可比较的 DPS 形状。
//
// 这是"设计用"的解析模型；真正跑起来的结果由 tools/arena-report.mjs 用
// src/game/arena.js 验证。两者使用同一份内容与编译结果，避免各算各的。
//
// 用法:
//   node tools/balance-sim.mjs
//   node tools/balance-sim.mjs --sweep

import { compileBuild } from '../src/game/skills/compile.js';
import { contentById } from '../src/game/skills/registry.js';
import { bagOf, enemyCellsAt } from '../src/game/enemies.js';
import { FLOORS, floorModifier } from '../src/game/floors.js';

const BUILDS = {
  starter: {
    label: '基础飞弹',
    build: {
      skills: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
      reserve: [],
    },
  },
  fireSplit: {
    label: '火焰分裂飞弹',
    build: {
      skills: [
        { id: 'skill-1', action: 'projectile', element: 'fire', modifier: 'split' },
        { id: 'skill-2', action: 'aura', element: 'fire', modifier: 'expand' },
      ],
      reserve: [],
    },
  },
  frostShatter: {
    label: '冰霜冲击',
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
    build: {
      skills: [
        { id: 'skill-1', action: 'swing', element: 'fire', modifier: 'expand' },
        { id: 'skill-2', action: 'impact', element: 'frost', modifier: null },
      ],
      reserve: [],
    },
  },
  sword: {
    label: '御剑',
    build: {
      skills: [
        { id: 'skill-1', action: 'orbitSword', element: 'fire', modifier: 'echo' },
        { id: 'skill-2', action: 'impact', element: 'frost', modifier: null },
      ],
      reserve: [],
    },
  },
  trapper: {
    label: '陷阱',
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
    build: {
      skills: [
        { id: 'skill-1', action: 'swordPierce', element: 'fire', modifier: null },
        { id: 'skill-2', action: 'swordArray', element: 'frost', modifier: 'echo' },
      ],
      reserve: [],
    },
  },
};

const fmt = (value) => value.toFixed(1);

function statusStacks(plan, hitsPerSecond) {
  if (plan.element === null) return 0;
  const burn = plan.effects.find((effect) => effect.status === 'burn');
  if (burn === undefined) return 0;
  const status = contentById('burn');
  const stacks = Math.min(status.cap, hitsPerSecond * burn.stacks * status.duration);
  return stacks * (status.damagePerStack / status.tickSeconds);
}

function planDps(plan) {
  const handler = plan.action.handler;
  let hitsPerSecond = 1 / plan.cooldown;
  let direct;
  if (handler === 'orbitSword') {
    // 稳态下最多 maxActive 柄飞剑同时存在，按单目标接触估算。
    const active = Math.min(plan.maxActive, plan.duration / plan.cooldown);
    hitsPerSecond = active / Math.max(0.01, plan.hitInterval);
    direct = plan.damage * hitsPerSecond;
  } else if (handler === 'swordArray') {
    const uptime = Math.min(1, plan.duration / plan.cooldown);
    hitsPerSecond = (uptime / Math.max(0.01, plan.tickInterval)) * Math.min(plan.maxTargets, 2);
    direct = plan.damage * hitsPerSecond;
  } else if (handler === 'swordPierce') {
    hitsPerSecond = (Math.min(plan.maxHits, 2) / plan.cooldown);
    direct = plan.damage * hitsPerSecond;
  } else {
    direct = plan.damage * hitsPerSecond;
    if (handler === 'aura' || handler === 'impact' || handler === 'swing' || handler === 'trap') {
      direct *= Math.min(plan.maxTargets, 2);
    }
  }
  const element = plan.element;
  let bonus = statusStacks(plan, hitsPerSecond);
  if (plan.modifier !== null) {
    const t = plan.modifier.transform;
    if (t.type === 'echo') bonus += plan.damage * t.damageScale * hitsPerSecond;
    if (t.type === 'split') bonus += plan.damage * t.damageScale * t.count * hitsPerSecond;
  }
  return { direct, bonus, total: direct + bonus, element: element === null ? null : element.id };
}

function buildDps(build) {
  const compiled = compileBuild(build);
  const plans = compiled.plans.map(planDps);
  const direct = plans.reduce((sum, part) => sum + part.direct, 0);
  const bonus = plans.reduce((sum, part) => sum + part.bonus, 0);
  return { ok: compiled.ok, direct, bonus, total: direct + bonus, plans };
}

function floorHp(def) {
  const bag = bagOf(def.mix);
  const modifier = floorModifier(def.floor);
  let total = 0;
  let count = def.count;
  if (modifier === 'crowded') count = Math.round(count * 1.5);
  for (let i = 0; i < count; i += 1) {
    const type = bag[i % bag.length];
    let cells = enemyCellsAt(def.floor, type);
    if (modifier === 'crowded') cells = Math.round(cells * 0.7);
    if (modifier === 'elite' && i === count - 1) cells = Math.round(cells * 2.5);
    total += cells;
  }
  return { total, count };
}

function main() {
  console.log('## 技能计划 DPS（单目标形状；范围动作按 2 个目标估算）\n');
  console.log('| build | 直接 DPS | 状态/修饰 DPS | 合计 | 技能 |');
  console.log('|---|---|---|---|---|');
  const results = {};
  for (const [key, entry] of Object.entries(BUILDS)) {
    const dps = buildDps(entry.build);
    results[key] = dps;
    console.log(
      `| ${entry.label} | ${fmt(dps.direct)} | ${fmt(dps.bonus)} | ${fmt(dps.total)} | ` +
        `${dps.plans.map((part) => part.element ?? '物理').join(' + ')} |`,
    );
  }

  console.log('\n## 层数压力（30 秒内清完需要的 DPS）\n');
  const keys = Object.keys(BUILDS);
  console.log(`| 层 | 敌人 | 总生命 | 需要 DPS | ${keys.map((key) => BUILDS[key].label).join(' | ')} |`);
  console.log(`|---|---|---|---|${keys.map(() => '---').join('|')}|`);
  for (const def of FLOORS) {
    const hp = floorHp(def);
    const need = hp.total / 30;
    const cells = keys.map((key) => {
      const dps = results[key].total;
      return dps >= need ? `${fmt(dps)} ✓` : `${fmt(dps)}`;
    });
    console.log(`| ${def.floor} | ${hp.count} | ${hp.total} | ${fmt(need)} | ${cells.join(' | ')} |`);
  }
}

function sweep() {
  console.log('\n## 修饰取舍：同一动作装不同修饰的 DPS\n');
  const modifiers = ['', 'split', 'echo', 'expand', 'pull'];
  for (const action of ['projectile', 'aura', 'impact', 'swing', 'orbitSword', 'swordPierce', 'swordArray', 'trap']) {
    const cells = [];
    for (const modifier of modifiers) {
      const compiled = compileBuild({
        skills: [{ id: 'skill-1', action, element: 'fire', modifier: modifier || null }],
        reserve: [],
      });
      cells.push(compiled.ok ? fmt(planDps(compiled.plans[0]).total) : '×');
    }
    console.log(`| ${action} | ${cells.join(' | ')} |`);
  }
  console.log(`\n列：${modifiers.map((id) => (id === '' ? '无修饰' : contentById(id).label)).join(' / ')}`);
}

main();
if (process.argv.includes('--sweep')) sweep();
