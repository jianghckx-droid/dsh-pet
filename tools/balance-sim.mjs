#!/usr/bin/env node
// 数值原型：层数表 + 第 6 层墙
//
// 这不是游戏运行时，是一张可重跑的计算稿：把 design.md / cards.md 里的
// 格数、冷却、灼烧、甲壳规则搬进来，回答两个问题--
//   1. 第 6 层能不能形成一道"纯数值过不去、换 build 能过去"的墙？
//   2. 这道墙的容差有多宽（甲壳倍率 × 刷怪速度）？
//
// 用法:
//   node tools/balance-sim.mjs           # 层数表 + 第 6 层明细
//   node tools/balance-sim.mjs --sweep   # 追加参数扫描
//
// 模型假设（改动任何一个都要重跑）:
//   - 一次命中 = 1 次结算；灼烧每跳、雷每次跳都算独立命中
//   - 锋锐只加主攻击，不加灼烧跳（cards.md §1.3）
//   - 敌人 2 秒后到达并开始接触；之前可以被打（远程/弹道）
//   - 同时只有 2 只能贴身，每 2 秒攻击一次（走位的抽象）
//   - 属性点按层给：4 + 层数，上限 20（一轮内的成长）
//   - 不做随机，全部取期望值；结果可复现

const DT = 0.05;
const FLOOR_DURATION = 30; // 每层目标时长
const TRAVEL = 2.0; // 敌人到场时间
const ATTACK_INTERVAL = 2.0; // 敌人攻击间隔
const CONTACT_CAP = 2; // 同时贴身的上限
const PLAYER_BASE = 12; // 基础生命格
const BODY_PER_POINT = 2; // 体魄：+2 格/点
const EDGE_CAP = 10; // 锋锐：10 点封顶
const BURN_CAP = 5;
const BURN_TICK = 1.5;
const BURN_DAMAGE_PER_STACK = 1;

const CARDS = {
  iron: { name: '铁弹', cells: 1, cd: 0.7, burn: 0, aoe: 0 },
  rocket: { name: '火箭', cells: 1, cd: 0.9, burn: 1, aoe: 0 },
  sea: { name: '火海', cells: 1, cd: 1.5, burn: 1, aoe: 3 },
  spirit: { name: '火灵', cells: 1, cd: 1.2, burn: 1, aoe: 0 },
};

// 属性分配策略：points 由层数决定，build 决定怎么花
const BUILDS = {
  pure: {
    label: '纯数值',
    cards: ['iron'],
    alloc: (p) => ({ edge: Math.min(EDGE_CAP, p), body: Math.max(0, p - EDGE_CAP) }),
  },
  pureTank: {
    label: '纯数值+体魄',
    cards: ['iron'],
    alloc: (p) => ({ edge: Math.min(EDGE_CAP, Math.ceil(p / 2)), body: Math.floor(p / 2) }),
  },
  fire: {
    label: '灼烧（全体魄）',
    cards: ['iron', 'rocket', 'sea', 'spirit'],
    alloc: (p) => ({ edge: 0, body: p }),
  },
  fireHybrid: {
    label: '灼烧（锋锐+体魄）',
    cards: ['iron', 'rocket', 'sea', 'spirit'],
    alloc: (p) => ({ edge: Math.min(6, p), body: Math.max(0, p - 6) }),
  },
};

const LOCK_MUL = { carapace: 2, split: 1.2, regen: 1.5, shield: 1.5 };

const FLOORS = [
  { f: 1, n: 6, locks: [] },
  { f: 2, n: 7, locks: [] },
  { f: 3, n: 8, locks: [] },
  { f: 4, n: 9, locks: [] },
  { f: 5, n: 10, locks: [] },
  { f: 6, n: 10, locks: ['carapace'] },
  { f: 7, n: 10, locks: ['carapace'] },
  { f: 8, n: 11, locks: ['carapace'] },
  { f: 9, n: 10, locks: ['split'] },
  { f: 10, n: 11, locks: ['split'] },
  { f: 11, n: 12, locks: ['carapace', 'split'] },
  { f: 12, n: 12, locks: ['carapace', 'split'] },
];

const pointsAt = (f) => Math.min(20, 4 + f);
const enemyCells = (f, lock) =>
  Math.round((3 + 1.2 * f) * (lock ? LOCK_MUL[lock] : 1));

// 锁裁决：永远是最后一步
function resolve(enemy, cells, isMain) {
  let d = cells;
  if (enemy.lock === 'carapace') d = Math.min(d, 1);
  if (enemy.lock === 'shield' && isMain) d = Math.max(0, d - 1);
  return d;
}

function simulate(buildKey, floor) {
  const build = BUILDS[buildKey];
  const points = pointsAt(floor.f);
  const { edge, body } = build.alloc(points);
  const edgeCells = Math.floor(edge / 2); // 锋锐：每 2 点 +1 格
  const maxHp = PLAYER_BASE + body * BODY_PER_POINT;
  const sources = build.cards.map((id) => ({ ...CARDS[id], timer: 0 }));
  const spawnInterval = FLOOR_DURATION / floor.n;

  let hp = maxHp;
  let t = 0;
  let spawned = 0;
  let kills = 0;
  let dmgTaken = 0;
  let peak = 0;
  const enemies = [];

  const spawn = (cells, lock, canSplit, primary) => {
    enemies.push({
      cells,
      max: cells,
      lock,
      primary,
      canSplit,
      arrive: t + (primary ? TRAVEL : 0.5),
      atk: ATTACK_INTERVAL,
      burn: 0,
      burnT: BURN_TICK,
      dead: false,
    });
  };

  while (t < 300) {
    if (spawned < floor.n && t >= spawned * spawnInterval) {
      const lock = floor.locks.length ? floor.locks[spawned % floor.locks.length] : null;
      spawn(enemyCells(floor.f, lock), lock, lock === 'split', true);
      spawned += 1;
    }

    // 玩家出手（可以打到还在路上的敌人）
    for (const s of sources) {
      s.timer -= DT;
      if (s.timer > 0) continue;
      s.timer += s.cd;
      const alive = enemies.filter((e) => e.cells > 0 && !e.dead);
      if (alive.length === 0) continue;
      const targets = s.aoe ? alive.slice(0, s.aoe) : [alive[0]];
      for (const e of targets) {
        e.cells -= resolve(e, s.cells + edgeCells, true);
        if (s.burn) e.burn = Math.min(BURN_CAP, e.burn + s.burn);
      }
    }

    // 灼烧跳：独立命中，不吃锋锐，不吃护盾
    for (const e of enemies) {
      if (e.dead || e.cells <= 0 || e.burn <= 0) continue;
      e.burnT -= DT;
      if (e.burnT > 0) continue;
      e.burnT += BURN_TICK;
      e.cells -= resolve(e, e.burn * BURN_DAMAGE_PER_STACK, false);
    }

    // 死亡结算（分裂在这里发生）
    for (const e of enemies) {
      if (e.dead || e.cells > 0) continue;
      e.dead = true;
      if (e.primary) kills += 1;
      if (e.canSplit && e.primary) {
        const child = Math.max(1, Math.ceil(e.max * 0.5));
        spawn(child, null, false, false);
        spawn(child, null, false, false);
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
      const dmg = floor.f >= 8 ? 2 : 1;
      hp -= dmg;
      dmgTaken += dmg;
    }

    if (hp <= 0) {
      return { result: 'dead', time: t, hp: 0, dmgTaken, peak, kills, maxHp, edge, body };
    }
    if (spawned >= floor.n && aliveNow.length === 0) {
      return { result: 'clear', time: t, hp, dmgTaken, peak, kills, maxHp, edge, body };
    }
    t += DT;
  }
  return { result: 'timeout', time: t, hp, dmgTaken, peak, kills, maxHp, edge, body };
}

const fmt = (r) =>
  r.result === 'clear' ? `过 ${r.time.toFixed(0)}s` : r.result === 'dead' ? `死 ${r.time.toFixed(0)}s` : '超时';

function printTable() {
  console.log('## 层数表（同一套属性曲线：4 + 层数，上限 20）\n');
  console.log('| 层 | 敌人 | 单只格数 | 锁 | 刷怪 | 属性点 | 纯数值 | 纯数值+体魄 | 灼烧 | 灼烧混合 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const floor of FLOORS) {
    const lock = floor.locks.length ? floor.locks.join('+') : '—';
    const cells = enemyCells(floor.f, floor.locks[0] ?? null);
    const spawn = (FLOOR_DURATION / floor.n).toFixed(1);
    console.log(
      `| ${floor.f} | ${floor.n} | ${cells} | ${lock} | ${spawn}s | ${pointsAt(floor.f)} | ` +
        `${fmt(simulate('pure', floor))} | ${fmt(simulate('pureTank', floor))} | ` +
        `${fmt(simulate('fire', floor))} | ${fmt(simulate('fireHybrid', floor))} |`,
    );
  }
}

function printFloor6() {
  const floor = FLOORS.find((x) => x.f === 6);
  console.log('\n## 第 6 层明细（10 只甲壳，20 格/只，每 3 秒一只）\n');
  console.log('| build | 属性 | 生命 | 结果 | 用时 | 承伤 | 峰值同屏 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const key of Object.keys(BUILDS)) {
    const r = simulate(key, floor);
    console.log(
      `| ${BUILDS[key].label} | 锋锐 ${r.edge} / 体魄 ${r.body} | ${r.maxHp} | ${r.result} | ` +
        `${r.time.toFixed(1)}s | ${r.dmgTaken} | ${r.peak} |`,
    );
  }
}

function sweep() {
  const mults = [1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
  const counts = [8, 9, 10, 11, 12];
  console.log('\n## 第 6 层参数扫描（A=纯数值，B=灼烧，属性点固定 10）\n');
  console.log(`| 甲壳倍率 | ${counts.map((n) => `${n} 敌`).join(' | ')} |`);
  console.log(`|---|${counts.map(() => '---').join('|')}|`);
  const saved = LOCK_MUL.carapace;
  for (const m of mults) {
    LOCK_MUL.carapace = m;
    const row = counts.map((n) => {
      const floor = { f: 6, n, locks: ['carapace'] };
      const a = simulate('pure', floor);
      const b = simulate('fire', floor);
      return `${a.result === 'clear' ? 'A过' : 'A死'}/${b.result === 'clear' ? 'B过' : 'B死'}`;
    });
    console.log(`| ×${m.toFixed(1)} | ${row.join(' | ')} |`);
  }
  LOCK_MUL.carapace = saved;
  console.log('\nA = 锋锐 10（6 格/发，被甲壳压到 1）；B = 体魄 10（1 格/发 + 灼烧）。');
}

printTable();
printFloor6();
if (process.argv.includes('--sweep')) sweep();
