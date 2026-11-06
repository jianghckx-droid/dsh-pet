#!/usr/bin/env node
// 数值原型：层数表 + 第 6 层墙
//
// 规则与卡片从 src/game/ 取，和游戏端共用一份，避免"设计数字"与"跑起来"分叉。
// 这里只保留模拟器特有的部分：刷怪节奏、贴身上限、逐帧推进。
//
// 用法:
//   node tools/balance-sim.mjs           # 层数表 + 第 6 层明细
//   node tools/balance-sim.mjs --sweep   # 追加参数扫描
//
// 模型假设（改动任何一个都要重跑）:
//   - 敌人 2 秒后到达并开始接触；之前可以被打（远程/弹道）
//   - 同时只有 2 只能贴身，每 2 秒攻击一次（走位的抽象）
//   - 属性点按层给：4 + 层数，上限 20
//   - 不做随机，全部取期望值；结果可复现

import { CARDS, FIRE_BUILD } from '../src/game/cards.js';
import {
  advanceStatus,
  applyBurn,
  attackCells,
  createStatus,
  playerCells,
  resolveHit,
  steadyDps,
} from '../src/game/rules.js';
import {
  FLOORS,
  baseCells,
  enemyCells,
  enemyDamage,
  floorDef,
  lockMultiplier,
  spawnSeconds,
} from '../src/game/floors.js';

const DT = 0.05;
const TRAVEL = 2.0;
const ATTACK_INTERVAL = 2.0;
const CONTACT_CAP = 2;
const EDGE_CAP = 10;
const MAX_POINTS = 20;

const BUILDS = {
  pure: {
    label: '纯数值',
    cardIds: ['orb_phys'],
    alloc: (p) => ({ edge: Math.min(EDGE_CAP, p), body: Math.max(0, p - EDGE_CAP) }),
  },
  pureTank: {
    label: '纯数值+体魄',
    cardIds: ['orb_phys'],
    alloc: (p) => ({ edge: Math.min(EDGE_CAP, Math.ceil(p / 2)), body: Math.floor(p / 2) }),
  },
  fire: {
    label: '灼烧（全体魄）',
    cardIds: [...FIRE_BUILD],
    alloc: (p) => ({ edge: 0, body: p }),
  },
  fireHybrid: {
    label: '灼烧混合',
    cardIds: [...FIRE_BUILD],
    alloc: (p) => ({ edge: Math.min(6, p), body: Math.max(0, p - 6) }),
  },
};

const pointsAt = (floor) => Math.min(MAX_POINTS, 4 + floor);

function simulate(buildKey, def, { cellsMul } = {}) {
  const build = BUILDS[buildKey];
  const points = pointsAt(def.floor);
  const { edge, body } = build.alloc(points);
  const attrs = { edge, body };
  const maxHp = playerCells(attrs);
  const sources = build.cardIds.map((id) => ({ card: CARDS[id], timer: 0 }));
  const spawnInterval = spawnSeconds(def);

  let hp = maxHp;
  let t = 0;
  let spawned = 0;
  let kills = 0;
  let dmgTaken = 0;
  let peak = 0;
  const enemies = [];

  const spawn = (cells, locks, canSplit, primary) => {
    enemies.push({
      cells,
      max: cells,
      locks,
      primary,
      canSplit,
      arrive: t + (primary ? TRAVEL : 0.5),
      atk: ATTACK_INTERVAL,
      status: createStatus(),
      dead: false,
    });
  };

  while (t < 300) {
    if (spawned < def.enemies && t >= spawned * spawnInterval) {
      const lock = def.locks.length ? def.locks[spawned % def.locks.length] : null;
      const locks = lock ? [lock] : [];
      // cellsMul 是"替换锁的血量倍率"，不是叠乘——扫描器用它替代甲壳的 ×2。
      const mul = cellsMul ?? lockMultiplier(locks);
      const cells = Math.round(baseCells(def.floor) * mul);
      spawn(cells, locks, lock === 'split', true);
      spawned += 1;
    }

    // 玩家出手（可以打到还在路上的敌人）
    for (const s of sources) {
      s.timer -= DT;
      if (s.timer > 0) continue;
      s.timer += s.card.cd;
      const alive = enemies.filter((e) => !e.dead && e.cells > 0);
      if (alive.length === 0) continue;
      const targets = s.card.aoe ? alive.slice(0, s.card.aoe) : [alive[0]];
      for (const e of targets) {
        e.cells -= resolveHit(e, attackCells(s.card, attrs), { main: true });
        if (s.card.burn) applyBurn(e.status, s.card.burn);
      }
    }

    // 灼烧跳：独立命中，不吃锋锐，不吃护盾
    for (const e of enemies) {
      if (e.dead || e.cells <= 0) continue;
      const burn = advanceStatus(e.status, DT);
      if (burn > 0) e.cells -= resolveHit(e, burn, { main: false });
    }

    // 死亡结算（分裂在这里发生）
    for (const e of enemies) {
      if (e.dead || e.cells > 0) continue;
      e.dead = true;
      if (e.primary) kills += 1;
      if (e.canSplit && e.primary) {
        const child = Math.max(1, Math.ceil(e.max * 0.5));
        spawn(child, [], false, false);
        spawn(child, [], false, false);
      }
    }

    const aliveNow = enemies.filter((e) => !e.dead);
    peak = Math.max(peak, aliveNow.length);

    const arrived = aliveNow
      .filter((e) => e.arrive <= t)
      .sort((a, b) => a.arrive - b.arrive)
      .slice(0, CONTACT_CAP);
    for (const e of arrived) {
      e.atk -= DT;
      if (e.atk > 0) continue;
      e.atk += ATTACK_INTERVAL;
      const dmg = enemyDamage(def.floor);
      hp -= dmg;
      dmgTaken += dmg;
    }

    if (hp <= 0) {
      return { result: 'dead', time: t, hp: 0, dmgTaken, peak, kills, maxHp, edge, body };
    }
    if (spawned >= def.enemies && aliveNow.length === 0) {
      return { result: 'clear', time: t, hp, dmgTaken, peak, kills, maxHp, edge, body };
    }
    t += DT;
  }
  return { result: 'timeout', time: t, hp, dmgTaken, peak, kills, maxHp, edge, body };
}

const fmt = (r) =>
  r.result === 'clear'
    ? `过 ${r.time.toFixed(0)}s`
    : r.result === 'dead'
      ? `死 ${r.time.toFixed(0)}s`
      : '超时';

function printTable() {
  console.log('## 层数表（属性曲线：4 + 层数，上限 20）\n');
  console.log('| 层 | 敌人 | 单只格数 | 锁 | 刷怪 | 属性点 | 纯数值 | 纯数值+体魄 | 灼烧 | 灼烧混合 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const def of FLOORS) {
    const lock = def.locks.length ? def.locks.join('+') : '—';
    const cells = enemyCells(def.floor, def.locks.slice(0, 1));
    console.log(
      `| ${def.floor} | ${def.enemies} | ${cells} | ${lock} | ${spawnSeconds(def).toFixed(1)}s | ` +
        `${pointsAt(def.floor)} | ${fmt(simulate('pure', def))} | ${fmt(simulate('pureTank', def))} | ` +
        `${fmt(simulate('fire', def))} | ${fmt(simulate('fireHybrid', def))} |`,
    );
  }
}

function printFloor6() {
  const def = floorDef(6);
  console.log('\n## 第 6 层明细（10 只甲壳，20 格/只，每 3 秒一只）\n');
  console.log('| build | 属性 | 生命 | 结果 | 用时 | 承伤 | 峰值同屏 | 稳态 DPS |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const key of Object.keys(BUILDS)) {
    const r = simulate(key, def);
    const attrs = { edge: r.edge, body: r.body };
    const cards = BUILDS[key].cardIds.map((id) => CARDS[id]);
    const dps = steadyDps(cards, attrs, { locks: ['carapace'] });
    console.log(
      `| ${BUILDS[key].label} | 锋锐 ${r.edge} / 体魄 ${r.body} | ${r.maxHp} | ${r.result} | ` +
        `${r.time.toFixed(1)}s | ${r.dmgTaken} | ${r.peak} | ${dps.toFixed(2)} |`,
    );
  }
}

function sweep() {
  const mults = [1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
  const counts = [8, 9, 10, 11, 12];
  console.log('\n## 第 6 层参数扫描（A=纯数值，B=灼烧，属性点固定 10）\n');
  console.log(`| 甲壳倍率 | ${counts.map((n) => `${n} 敌`).join(' | ')} |`);
  console.log(`|---|${counts.map(() => '---').join('|')}|`);
  for (const m of mults) {
    const row = counts.map((n) => {
      const def = { floor: 6, enemies: n, locks: ['carapace'] };
      const a = simulate('pure', def, { cellsMul: m });
      const b = simulate('fire', def, { cellsMul: m });
      return `${a.result === 'clear' ? 'A过' : 'A死'}/${b.result === 'clear' ? 'B过' : 'B死'}`;
    });
    console.log(`| ×${m.toFixed(1)} | ${row.join(' | ')} |`);
  }
  console.log('\nA = 锋锐 10（6 格/发，被甲壳压到 1）；B = 体魄 10（1 格/发 + 灼烧）。');
}

printTable();
printFloor6();
if (process.argv.includes('--sweep')) sweep();
