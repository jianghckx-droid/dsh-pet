// 战斗状态机（无渲染、无 DOM、可复现）。
//
// 这一层是游戏真正的核心：位置、走位、刷怪、命中、状态、层推进、三选一。
// client.js 只负责把 battle 画出来；测试直接跑这里。
//
// 设计约束：
//   - 纯函数式推进：step(battle, dt)，不读全局、不用 Math.random
//   - 同一 seed + 同一 dt 序列 → 同一结果
//   - 所有伤害都走 rules.js 的 resolveHit，锁不会在这里被绕过
//   - 抽卡只在 arena 里发生，UI 只调用 chooseCard
//
// 已知取舍：
//   - 没有寻路，敌人直线追玩家；160×144 的场地不需要
//   - 走位是"绕最近目标 + 回中心"的启发式，不是完整 AI（轮次 5 再做）
//   - 召唤物是炮台：会攻击，但不会被敌人选为目标
//   - 分裂子体不给经验，避免刷经验

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
export const TIME_LIMIT = 45;
export const MAX_SLOTS = 3;

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

const SELF_RADIUS = 20;
const BOOM_RADIUS = 14;
const FREEZE_SECONDS = 1.2;
const ANCHOR_SECONDS = 10;
const COMBO_EVERY = 4;
const EXECUTE_THRESHOLD = 2;
const XP_PER_CELL = 3;

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

function hasRule(battle, id) {
  return battle.rules.some((rule) => rule.id === id);
}

/** 把一张卡加进当前战斗。开局 build 与抽卡都走这里。 */
export function addCard(battle, id) {
  const card = cardsById([id])[0];
  battle.cards.push(card);
  if (card.carrier === 'rule') {
    battle.rules.push(card);
    return card;
  }
  if (card.carrier === 'self') {
    battle.selfs.push({ card, timer: card.cd });
    return card;
  }
  if (card.carrier === 'summon') {
    battle.summons.push({
      id: battle.nextId++,
      card,
      x: battle.player.x - 8,
      y: battle.player.y - 8,
      timer: card.cd * 0.5,
    });
    return card;
  }
  battle.sources.push({ card, timer: card.cd * 0.5 });
  return card;
}

function rollOffer(battle) {
  if (battle.offer !== null || battle.pending <= 0) return;
  if (battle.slots.length >= MAX_SLOTS) return;
  const owned = new Set(battle.cards.map((card) => card.id));
  const available = battle.pool.filter((id) => !owned.has(id));
  if (available.length === 0) return;
  const picked = [];
  while (picked.length < 3 && available.length > 0) {
    const index = Math.floor(battle.rng() * available.length);
    picked.push(available.splice(index, 1)[0]);
  }
  battle.offer = picked;
}

export function awardXp(battle, amount) {
  battle.xp += amount;
  while (battle.xp >= battle.xpNext) {
    battle.xp -= battle.xpNext;
    battle.level += 1;
    battle.xpNext = 6 + battle.level * 2;
    if (battle.level % 2 === 0) battle.pending += 1;
  }
  rollOffer(battle);
}

/** 选中一张卡：进槽、生效、刷新下一次 offer。 */
export function chooseCard(battle, id) {
  if (battle.offer === null || !battle.offer.includes(id)) return false;
  if (battle.slots.length >= MAX_SLOTS) return false;
  battle.slots.push(id);
  battle.offer = null;
  battle.pending = Math.max(0, battle.pending - 1);
  addCard(battle, id);
  battle.events.push({ type: 'draft', id });
  rollOffer(battle);
  return true;
}

export function createBattle({ floor, build, attrs = {}, seed = 1, pool = [], drafted = [] }) {
  const def = floorDef(floor);
  const maxCells = playerCells(attrs);
  const battle = {
    def,
    floor,
    attrs,
    pool: [...pool],
    slots: [...drafted],
    cards: [],
    rules: [],
    selfs: [],
    sources: [],
    summons: [],
    enemies: [],
    bullets: [],
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
    level: 1,
    xp: 0,
    xpNext: 8,
    pending: 0,
    offer: null,
    hitCount: 0,
    anchorTimer: 0,
    spawned: 0,
    kills: 0,
    events: [],
    nextId: 1,
    seed,
  };
  for (const id of build) addCard(battle, id);
  return battle;
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
      freeze: 0,
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

function rawHit(battle, enemy, cells, burn = 0) {
  const dealt = resolveHit(enemy, cells, { main: true });
  enemy.cells -= dealt;
  enemy.flash = 0.12;
  if (burn) applyBurn(enemy.status, burn);
  battle.events.push({ type: 'hit', x: enemy.x, y: enemy.y, cells: dealt });
  return dealt;
}

function hitEnemy(battle, enemy, card) {
  rawHit(battle, enemy, attackCells(card, battle.attrs), card.burn ?? 0);

  if (hasRule(battle, 'rule_execute') && enemy.cells > 0 && enemy.cells <= EXECUTE_THRESHOLD) {
    enemy.cells = 0;
    battle.events.push({ type: 'execute', x: enemy.x, y: enemy.y });
  }

  if (hasRule(battle, 'rule_combo')) {
    battle.hitCount += 1;
    if (battle.hitCount % COMBO_EVERY === 0) {
      const extra = nearestEnemy(battle, battle.player, ORB_RANGE);
      if (extra && extra !== enemy && extra.cells > 0) rawHit(battle, extra, 1);
    }
  }
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
  for (const e of targets) hitEnemy(battle, e, card);
  if (targets.length > 0) {
    battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: card.id });
  }
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

function selfTick(battle, dt) {
  for (const self of battle.selfs) {
    self.timer -= dt;
    if (self.timer > 0) continue;
    self.timer += self.card.cd;
    const targets = battle.enemies.filter(
      (e) => e.cells > 0 && dist(battle.player, e) <= SELF_RADIUS + e.r,
    );
    for (const e of targets) hitEnemy(battle, e, self.card);
    if (targets.length > 0) {
      battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: self.card.id });
    }
  }
}

function rulesTick(battle, dt) {
  if (!hasRule(battle, 'rule_anchor')) return;
  battle.anchorTimer += dt;
  if (battle.anchorTimer < ANCHOR_SECONDS) return;
  battle.anchorTimer -= ANCHOR_SECONDS;
  for (const e of battle.enemies) {
    if (e.cells > 0) e.freeze = Math.max(e.freeze, FREEZE_SECONDS);
  }
  battle.events.push({ type: 'freeze' });
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
    if (e.freeze > 0) {
      e.freeze = Math.max(0, e.freeze - dt);
      continue;
    }
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
  const booms = [];
  for (const e of battle.enemies) {
    if (e.cells > 0) {
      alive.push(e);
      continue;
    }
    battle.kills += 1;
    battle.events.push({ type: 'kill', x: e.x, y: e.y, id: e.id });
    if (e.primary) {
      awardXp(battle, Math.max(1, Math.round(e.maxCells / XP_PER_CELL)));
      if (hasRule(battle, 'rule_boom')) booms.push({ x: e.x, y: e.y });
    }
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
          freeze: 0,
          flash: 0,
        });
      }
    }
  }
  battle.enemies = alive;

  for (const at of booms) {
    for (const e of alive) {
      if (e.cells <= 0) continue;
      if (dist(e, at) > BOOM_RADIUS) continue;
      e.cells -= 1;
      e.cells -= 1;
      e.flash = 0.1;
      battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: 2 });
    }
  }
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
  battle.time += dt;
  spawnTick(battle);
  playerMove(battle, dt);
  attackTick(battle, dt);
  selfTick(battle, dt);
  rulesTick(battle, dt);
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
