// 战斗状态机（无渲染、无 DOM、可复现）。
//
// 这一层是游戏真正的核心：位置、走位、刷怪、命中、状态、层推进。
// client.js 以后只负责把 battle 画出来；测试直接跑这里。
//
// 设计约束：
//   - 纯函数式推进：step(battle, dt)，不读全局、不用 Math.random
//   - 同一 seed + 同一 dt 序列 → 同一结果
//   - 所有伤害都走 rules.js 的 resolveHit，锁不会在这里被绕过
//   - 召唤物在 MVP 里是"炮台"：会攻击，但不会被敌人选为目标
//
// 已知取舍：
//   - 没有寻路，敌人直线追玩家；160×144 的场地不需要
//   - 走位是"绕最近目标 + 回中心"的启发式，不是完整 AI（轮次 5 再做）

import { cardsById } from './cards.js';
import {
  advanceStatus,
  applyBurn,
  attackCells,
  createStatus,
  playerCells,
  resolveHit,
} from './rules.js';
import { enemyCells, enemyDamage, floorDef, spawnSeconds } from './floors.js';

export const ARENA = Object.freeze({ w: 160, h: 144 });

const PLAYER_SPEED = 52;
const PLAYER_RADIUS = 3;
const CONTACT_PAD = 1.5;
const ENEMY_ATTACK_INTERVAL = 1.6;
const ENEMY_SPEED_BASE = 24;
const ENEMY_SPEED_PER_FLOOR = 1.2;
const ORB_RANGE = 74;
const FIELD_RADIUS = 30;
const SUMMON_RANGE = 42;
const BULLET_SPEED = 180;
const BULLET_HIT_RADIUS = 3.5;
const KEEP_DISTANCE = 42;
const CENTER_PULL = 56;
const TIME_LIMIT = 45;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function enemyRadius(cells) {
  return 2.5 + Math.min(3.5, cells / 10);
}

function spawnPoint(rng) {
  const edge = Math.floor(rng() * 4);
  if (edge === 0) return { x: rng() * ARENA.w, y: -6 };
  if (edge === 1) return { x: ARENA.w + 6, y: rng() * ARENA.h };
  if (edge === 2) return { x: rng() * ARENA.w, y: ARENA.h + 6 };
  return { x: -6, y: rng() * ARENA.h };
}

export function createBattle({ floor, build, attrs = {}, seed = 1 }) {
  const def = floorDef(floor);
  const maxCells = playerCells(attrs);
  return {
    def,
    floor,
    attrs,
    cards: cardsById(build),
    rng: mulberry32(seed),
    time: 0,
    state: 'fighting',
    player: {
      x: ARENA.w / 2,
      y: ARENA.h / 2,
      cells: maxCells,
      maxCells,
      speed: PLAYER_SPEED,
    },
    enemies: [],
    bullets: [],
    summons: [],
    sources: [],
    spawned: 0,
    kills: 0,
    events: [],
    nextId: 1,
    seed,
  };
}

function initSources(battle) {
  for (const card of battle.cards) {
    if (card.carrier === 'summon') {
      battle.summons.push({
        id: battle.nextId++,
        card,
        x: battle.player.x - 8,
        y: battle.player.y - 8,
        timer: card.cd * 0.5,
      });
    } else {
      battle.sources.push({ card, timer: card.cd * 0.5 });
    }
  }
}

function nearestEnemy(battle, from, range = Infinity) {
  let best = null;
  let bestD = range;
  for (const e of battle.enemies) {
    if (e.cells <= 0) continue;
    const d = dist(from, e);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

function spawnTick(battle) {
  const interval = spawnSeconds(battle.def);
  while (battle.spawned < battle.def.enemies && battle.time >= battle.spawned * interval) {
    const index = battle.spawned;
    const lock = battle.def.locks.length ? battle.def.locks[index % battle.def.locks.length] : null;
    const locks = lock ? [lock] : [];
    const cells = enemyCells(battle.floor, locks);
    const at = spawnPoint(battle.rng);
    battle.enemies.push({
      id: battle.nextId++,
      x: at.x,
      y: at.y,
      cells,
      maxCells: cells,
      locks,
      primary: true,
      canSplit: lock === 'split',
      r: enemyRadius(cells),
      speed: ENEMY_SPEED_BASE + battle.floor * ENEMY_SPEED_PER_FLOOR + battle.rng() * 4,
      damage: enemyDamage(battle.floor),
      attackTimer: ENEMY_ATTACK_INTERVAL,
      status: createStatus(),
      flash: 0,
    });
    battle.spawned += 1;
  }
}

function playerMove(battle, dt) {
  const p = battle.player;
  const nearest = nearestEnemy(battle, p);
  let vx = 0;
  let vy = 0;
  if (nearest) {
    const dx = p.x - nearest.x;
    const dy = p.y - nearest.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < KEEP_DISTANCE - 8) {
      vx += dx / d;
      vy += dy / d;
    } else if (d > KEEP_DISTANCE + 8) {
      vx -= dx / d;
      vy -= dy / d;
    } else {
      vx += -dy / d;
      vy += dx / d;
    }
  }
  const cx = ARENA.w / 2 - p.x;
  const cy = ARENA.h / 2 - p.y;
  const cd = Math.hypot(cx, cy) || 1;
  if (cd > CENTER_PULL) {
    vx += (cx / cd) * 0.7;
    vy += (cy / cd) * 0.7;
  }
  const len = Math.hypot(vx, vy);
  if (len < 0.001) return;
  p.x = clamp(p.x + (vx / len) * p.speed * dt, 6, ARENA.w - 6);
  p.y = clamp(p.y + (vy / len) * p.speed * dt, 6, ARENA.h - 6);
}

function fireBullet(battle, from, card, target) {
  battle.bullets.push({
    id: battle.nextId++,
    x: from.x,
    y: from.y,
    targetId: target.id,
    cells: attackCells(card, battle.attrs),
    burn: card.burn ?? 0,
    life: 1.2,
  });
  battle.events.push({ type: 'shot', x: from.x, y: from.y, card: card.id });
}

function pulse(battle, card) {
  const targets = battle.enemies
    .filter((e) => e.cells > 0 && dist(battle.player, e) <= FIELD_RADIUS + e.r)
    .slice(0, card.aoe || 1);
  for (const e of targets) {
    hitEnemy(battle, e, card);
  }
  if (targets.length > 0) {
    battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: card.id });
  }
}

function hitEnemy(battle, enemy, card) {
  const dealt = resolveHit(enemy, attackCells(card, battle.attrs), { main: true });
  enemy.cells -= dealt;
  enemy.flash = 0.12;
  if (card.burn) applyBurn(enemy.status, card.burn);
  battle.events.push({ type: 'hit', x: enemy.x, y: enemy.y, cells: dealt });
}

function attackTick(battle, dt) {
  for (const source of battle.sources) {
    source.timer -= dt;
    if (source.timer > 0) continue;
    source.timer += source.card.cd;
    if (source.card.carrier === 'field') {
      pulse(battle, source.card);
      continue;
    }
    const target = nearestEnemy(battle, battle.player, ORB_RANGE);
    if (target) fireBullet(battle, battle.player, source.card, target);
  }

  for (const summon of battle.summons) {
    // 炮台跟随，简化成围绕玩家的偏移
    const tx = battle.player.x - 10;
    const ty = battle.player.y - 10;
    summon.x += (tx - summon.x) * Math.min(1, dt * 3);
    summon.y += (ty - summon.y) * Math.min(1, dt * 3);
    summon.timer -= dt;
    if (summon.timer > 0) continue;
    summon.timer += summon.card.cd;
    const target = nearestEnemy(battle, summon, SUMMON_RANGE);
    if (target) fireBullet(battle, summon, summon.card, target);
  }
}

function bulletsTick(battle, dt) {
  const alive = [];
  for (const bullet of battle.bullets) {
    const target = battle.enemies.find((e) => e.id === bullet.targetId && e.cells > 0);
    if (!target) {
      bullet.life -= dt;
      if (bullet.life > 0) alive.push(bullet);
      continue;
    }
    const dx = target.x - bullet.x;
    const dy = target.y - bullet.y;
    const d = Math.hypot(dx, dy) || 1;
    const travel = BULLET_SPEED * dt;
    if (d <= travel + BULLET_HIT_RADIUS) {
      hitEnemy(battle, target, { cells: bullet.cells, burn: bullet.burn });
      continue;
    }
    bullet.x += (dx / d) * travel;
    bullet.y += (dy / d) * travel;
    alive.push(bullet);
  }
  battle.bullets = alive;
}

function enemiesTick(battle, dt) {
  const p = battle.player;
  for (const e of battle.enemies) {
    if (e.cells <= 0) continue;
    e.flash = Math.max(0, e.flash - dt);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = e.r + PLAYER_RADIUS + CONTACT_PAD;
    if (d > reach) {
      const step = Math.min(e.speed * dt, d - reach);
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
      e.attackTimer = Math.min(e.attackTimer, ENEMY_ATTACK_INTERVAL);
      continue;
    }
    e.attackTimer -= dt;
    if (e.attackTimer > 0) continue;
    e.attackTimer += ENEMY_ATTACK_INTERVAL;
    p.cells -= e.damage;
    battle.events.push({ type: 'hurt', x: p.x, y: p.y, cells: e.damage });
    if (p.cells <= 0) {
      p.cells = 0;
      battle.state = 'dead';
      return;
    }
  }
}

function statusTick(battle, dt) {
  for (const e of battle.enemies) {
    if (e.cells <= 0) continue;
    const burn = advanceStatus(e.status, dt);
    if (burn <= 0) continue;
    const dealt = resolveHit(e, burn, { main: false });
    e.cells -= dealt;
    battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: dealt });
  }
}

function resolveDeaths(battle) {
  const alive = [];
  for (const e of battle.enemies) {
    if (e.cells > 0) {
      alive.push(e);
      continue;
    }
    battle.kills += 1;
    battle.events.push({ type: 'kill', x: e.x, y: e.y, id: e.id });
    if (e.canSplit && e.primary) {
      const child = Math.max(1, Math.ceil(e.maxCells * 0.5));
      for (let i = 0; i < 2; i += 1) {
        alive.push({
          ...e,
          id: battle.nextId++,
          cells: child,
          maxCells: child,
          primary: false,
          canSplit: false,
          locks: [],
          r: enemyRadius(child),
          status: createStatus(),
          flash: 0,
        });
      }
    }
  }
  battle.enemies = alive;
}

function checkEnd(battle) {
  if (battle.state !== 'fighting') return;
  if (battle.player.cells <= 0) {
    battle.state = 'dead';
    return;
  }
  if (battle.spawned >= battle.def.enemies && battle.enemies.length === 0) {
    battle.state = 'cleared';
    return;
  }
  if (battle.time >= TIME_LIMIT) {
    battle.state = 'timeout';
  }
}

/** 推进一帧，返回这一帧产生的事件。 */
export function step(battle, dt) {
  if (battle.state !== 'fighting') return [];
  battle.events = [];
  if (battle.sources.length === 0 && battle.summons.length === 0) initSources(battle);
  battle.time += dt;
  spawnTick(battle);
  playerMove(battle, dt);
  attackTick(battle, dt);
  bulletsTick(battle, dt);
  enemiesTick(battle, dt);
  statusTick(battle, dt);
  resolveDeaths(battle);
  checkEnd(battle);
  return battle.events;
}

/** 一直跑到结束，返回同一场战斗。dt 固定，保证可复现。 */
export function runToEnd(battle, { dt = 1 / 60, maxSeconds = 120 } = {}) {
  while (battle.state === 'fighting' && battle.time < maxSeconds) {
    step(battle, dt);
  }
  return battle;
}

export { TIME_LIMIT };
