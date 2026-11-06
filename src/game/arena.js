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
  ATTRIBUTES,
  BURN,
  advanceStatus,
  applyBurn,
  attackCells,
  cooldown,
  createStatus,
  damageTaken,
  normalizeAttrs,
  playerCells,
  regenPerSecond,
  resolveHit,
  visionScale,
} from './rules.js';
import { FLOOR_SECONDS, enemyCells, enemyDamage, floorDef } from './floors.js';

export const ARENA = Object.freeze({ w: 160, h: 144 });
export const TIME_LIMIT = 45;
export const MAX_SLOTS = 3;
export const MAX_EXTRA = 18;

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
const VORTEX_SPEED = 120;

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

const hasRule = (battle, id) => battle.rules.some((rule) => rule.id === id);
const hasCore = (battle, id) => battle.cards.some((card) => card.id === id);
const orbRange = (battle) => ORB_RANGE * visionScale(battle.attrs);
const fieldRadius = (battle) => FIELD_RADIUS * visionScale(battle.attrs);
const selfRadius = (battle) => SELF_RADIUS * visionScale(battle.attrs);
const summonRange = (battle) => SUMMON_RANGE * visionScale(battle.attrs);

function makeSummon(battle, card) {
  const hp = card.hp ?? 4;
  return {
    id: battle.nextId++,
    card,
    x: battle.player.x - 8,
    y: battle.player.y - 8,
    cells: hp,
    maxCells: hp,
    mode: card.mode ?? 'turret',
    timer: cooldown(card.cd, battle.attrs) * 0.5,
  };
}

function nearestSummon(battle, from, range = Infinity) {
  let best = null;
  let bestD = range;
  for (const s of battle.summons) {
    const d = dist(from, s);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

function refreshOneCooldown(battle) {
  const pool = [...battle.sources, ...battle.selfs];
  if (pool.length === 0) return;
  const pick = pool[Math.floor(battle.rng() * pool.length)];
  pick.timer = 0;
}

function killSummon(battle, summon) {
  const index = battle.summons.indexOf(summon);
  if (index < 0) return;
  battle.summons.splice(index, 1);
  if (hasRule(battle, 'sacrifice')) refreshOneCooldown(battle);
  battle.respawns.push({ card: summon.card, at: battle.time + 8 });
  battle.events.push({ type: 'summonDown', x: summon.x, y: summon.y });
}

/** 把一张卡加进当前战斗。开局 build 与抽卡都走这里。 */
export function addCard(battle, id) {
  const card = cardsById([id])[0];
  battle.cards.push(card);
  if (card.carrier === 'rule') {
    battle.rules.push(card);
    return card;
  }
  if (card.carrier === 'core') {
    return card;
  }
  if (card.carrier === 'verb') {
    battle.verbs.push({ card, timer: card.cd * 0.5 });
    return card;
  }
  if (card.carrier === 'self') {
    battle.selfs.push({ card, timer: cooldown(card.cd, battle.attrs) });
    return card;
  }
  if (card.carrier === 'summon') {
    battle.summons.push(makeSummon(battle, card));
    return card;
  }
  battle.sources.push({ card, timer: cooldown(card.cd, battle.attrs) * 0.5 });
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
    battle.points += 1;
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

export function createBattle({
  floor,
  build,
  attrs = {},
  seed = 1,
  pool = [],
  drafted = [],
  points = 0,
  level = 1,
  xp = 0,
  xpNext = 6,
  pending = 0,
  extra = 0,
  cores = [],
}) {
  const def = floorDef(floor);
  const normalized = normalizeAttrs(attrs);
  const maxCells = playerCells(normalized);
  const battle = {
    def,
    floor,
    attrs: normalized,
    points,
    pool: [...pool],
    slots: [...drafted],
    cards: [],
    rules: [],
    selfs: [],
    verbs: [],
    sources: [],
    summons: [],
    respawns: [],
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
    level,
    xp,
    xpNext,
    pending,
    extra: Math.min(MAX_EXTRA, Math.max(0, extra)),
    burnCap: BURN.cap,
    emberSpread: 1,
    echoKills: 0,
    offer: null,
    hitCount: 0,
    anchorTimer: 0,
    pinCd: 0,
    spawned: 0,
    kills: 0,
    events: [],
    nextId: 1,
    seed,
  };
  for (const id of build) addCard(battle, id);
  for (const id of cores) addCard(battle, id);
  battle.burnCap = hasCore(battle, 'core_ember') ? BURN.cap + 2 : BURN.cap;
  battle.emberSpread = hasCore(battle, 'core_ember') ? 3 : 1;
  return battle;
}

function nearestEnemy(battle, from, range = Infinity, excludeId = -1) {
  let best = null;
  let bestD = range;
  for (const e of battle.enemies) {
    if (e.cells <= 0 || e.id === excludeId) continue;
    const d = dist(from, e);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** 猎手核心：优先打格数最低的；标记规则：优先打带标记的。 */
function pickTarget(battle, from, range, excludeId = -1) {
  if (hasRule(battle, 'mark_hunter')) {
    let marked = null;
    let bestMark = 0;
    let bestD = Infinity;
    for (const e of battle.enemies) {
      if (e.cells <= 0 || e.id === excludeId || (e.mark ?? 0) <= 0) continue;
      const d = dist(from, e);
      if (d > range) continue;
      if (e.mark > bestMark || (e.mark === bestMark && d < bestD)) {
        marked = e;
        bestMark = e.mark;
        bestD = d;
      }
    }
    if (marked !== null) return marked;
  }
  if (!hasCore(battle, 'core_hunter')) return nearestEnemy(battle, from, range, excludeId);
  let best = null;
  let bestCells = Infinity;
  let bestD = Infinity;
  for (const e of battle.enemies) {
    if (e.cells <= 0 || e.id === excludeId) continue;
    const d = dist(from, e);
    if (d > range) continue;
    if (e.cells < bestCells || (e.cells === bestCells && d < bestD)) {
      best = e;
      bestCells = e.cells;
      bestD = d;
    }
  }
  return best;
}

function spawnTick(battle) {
  const total = battle.def.enemies + battle.extra;
  // 额外敌人不延长层时长，而是压缩刷怪间隔，否则压力永远刷不完
  const interval = FLOOR_SECONDS / total;
  while (battle.spawned < total && battle.time >= battle.spawned * interval) {
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
      speed:
        (ENEMY_SPEED_BASE + battle.floor * ENEMY_SPEED_PER_FLOOR + battle.rng() * 4) *
        (locks.includes('anchor') ? 0.7 : 1),
      damage: enemyDamage(battle.floor),
      attackTimer: ENEMY_ATTACK_INTERVAL,
      status: createStatus(),
      freeze: 0,
      root: 0,
      vortex: 0,
      wallCd: 0,
      mark: 0,
      markLeft: 0,
      cleanseCd: 3,
      devourCd: 6,
      flash: 0,
    });
    battle.spawned += 1;
    if (hasCore(battle, 'core_anchor') && battle.time < 3) {
      battle.enemies[battle.enemies.length - 1].freeze = 3;
    }
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
  if (burn) applyBurn(enemy.status, burn, battle.burnCap);
  battle.events.push({ type: 'hit', x: enemy.x, y: enemy.y, cells: dealt });
  return dealt;
}

function addMark(enemy, stacks) {
  enemy.mark = Math.min(3, (enemy.mark ?? 0) + stacks);
  enemy.markLeft = 6;
}

function hitEnemy(battle, enemy, card) {
  rawHit(battle, enemy, attackCells(card, battle.attrs), card.burn ?? 0);

  if (card.mark) addMark(enemy, card.mark);
  if (hasRule(battle, 'mark_hunter')) addMark(enemy, 1);

  if (hasRule(battle, 'rule_pin') && battle.pinCd <= 0) {
    enemy.root = Math.max(enemy.root, 1);
    battle.pinCd = 3;
  }

  if (hasRule(battle, 'rule_execute') && enemy.cells > 0 && enemy.cells <= EXECUTE_THRESHOLD) {
    enemy.cells = 0;
    battle.events.push({ type: 'execute', x: enemy.x, y: enemy.y });
  }

  if (
    hasRule(battle, 'execute_mark') &&
    (enemy.mark ?? 0) >= 3 &&
    enemy.cells > 0 &&
    enemy.cells <= 4
  ) {
    enemy.cells = 0;
    battle.events.push({ type: 'execute', x: enemy.x, y: enemy.y });
  }

  if (hasRule(battle, 'rule_combo')) {
    battle.hitCount += 1;
    if (battle.hitCount % COMBO_EVERY === 0) {
      const extra = pickTarget(battle, battle.player, orbRange(battle), enemy.id);
      if (extra !== null && extra.cells > 0) rawHit(battle, extra, 1);
    }
  }
}

function fireBullet(battle, from, card, target) {
  battle.bullets.push({
    id: battle.nextId++,
    x: from.x,
    y: from.y,
    targetId: target.id,
    // 存基础格数：命中时 hitEnemy 会再走一次 attackCells，否则锋锐会被加成两次
    cells: card.cells ?? 1,
    burn: card.burn ?? 0,
    mark: card.mark ?? 0,
    pierce: hasCore(battle, 'core_pierce') ? 1 : 0,
    life: 1.2,
  });
  battle.events.push({ type: 'shot', x: from.x, y: from.y, card: card.id });
}

function pulse(battle, card) {
  const targets = battle.enemies
    .filter((e) => e.cells > 0 && dist(battle.player, e) <= fieldRadius(battle) + e.r)
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
    source.timer += cooldown(source.card.cd, battle.attrs);
    if (source.card.carrier === 'field') {
      pulse(battle, source.card);
      continue;
    }
    const target = pickTarget(battle, battle.player, orbRange(battle));
    if (target) fireBullet(battle, battle.player, source.card, target);
  }

}

function summonsTick(battle, dt) {
  const p = battle.player;

  if (hasRule(battle, 'merge')) {
    for (let i = 0; i < battle.summons.length; i += 1) {
      for (let j = i + 1; j < battle.summons.length; j += 1) {
        const a = battle.summons[i];
        const b = battle.summons[j];
        if (dist(a, b) > 10) continue;
        a.cells += b.cells;
        a.maxCells += b.maxCells;
        a.merged = true;
        battle.summons.splice(j, 1);
        j -= 1;
        battle.events.push({ type: 'merge', x: a.x, y: a.y });
      }
    }
  }

  for (let i = battle.summons.length - 1; i >= 0; i -= 1) {
    const summon = battle.summons[i];

    if (summon.mode === 'totem') {
      summon.timer -= dt;
      if (summon.timer > 0) continue;
      summon.timer += cooldown(summon.card.cd, battle.attrs);
      for (const other of battle.summons) {
        if (other === summon) continue;
        if (dist(summon, other) > 30) continue;
        other.cells = Math.min(other.maxCells, other.cells + 1);
      }
      continue;
    }

    if (summon.mode === 'charge') {
      const target = nearestEnemy(battle, summon, 220);
      if (target === null) continue;
      const d = dist(summon, target) || 1;
      if (d <= target.r + 4) {
        for (const e of battle.enemies) {
          if (e.cells <= 0) continue;
          if (dist(e, summon) > (summon.card.radius ?? 18)) continue;
          rawHit(battle, e, summon.card.blast ?? 3);
        }
        battle.events.push({ type: 'blast', x: summon.x, y: summon.y });
        killSummon(battle, summon);
        continue;
      }
      summon.x += ((target.x - summon.x) / d) * 60 * dt;
      summon.y += ((target.y - summon.y) / d) * 60 * dt;
      continue;
    }

    const tx = p.x - 10;
    const ty = p.y - 10;
    summon.x += (tx - summon.x) * Math.min(1, dt * 3);
    summon.y += (ty - summon.y) * Math.min(1, dt * 3);
    summon.timer -= dt;
    if (summon.timer > 0) continue;
    summon.timer += cooldown(summon.card.cd, battle.attrs);
    const target = pickTarget(battle, summon, summonRange(battle));
    if (target !== null) fireBullet(battle, summon, summon.card, target);
  }
}

function selfTick(battle, dt) {
  for (const self of battle.selfs) {
    self.timer -= dt;
    if (self.timer > 0) continue;
    self.timer += cooldown(self.card.cd, battle.attrs);
    const targets = battle.enemies.filter(
      (e) => e.cells > 0 && dist(battle.player, e) <= selfRadius(battle) + e.r,
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
      hitEnemy(battle, target, { cells: bullet.cells, burn: bullet.burn, mark: bullet.mark });
      if (bullet.pierce > 0) {
        const next = pickTarget(battle, bullet, orbRange(battle), target.id);
        if (next !== null) {
          bullet.pierce -= 1;
          bullet.targetId = next.id;
          alive.push(bullet);
        }
      }
      continue;
    }
    bullet.x += (dx / d) * travel;
    bullet.y += (dy / d) * travel;
    alive.push(bullet);
  }
  battle.bullets = alive;
}

function placeEnemy(enemy, nx, ny) {
  const cx = clamp(nx, enemy.r, ARENA.w - enemy.r);
  const cy = clamp(ny, enemy.r, ARENA.h - enemy.r);
  const hitWall = cx !== nx || cy !== ny;
  enemy.x = cx;
  enemy.y = cy;
  return hitWall;
}

/** 撞墙伤害不看甲壳：位移是"撞"，不是"打"。 */
function wallSlam(battle, enemy) {
  if (!hasRule(battle, 'rule_wall_slam')) return;
  if (enemy.wallCd > 0) return;
  enemy.wallCd = 1;
  enemy.cells -= 2;
  battle.events.push({ type: 'wall', x: enemy.x, y: enemy.y });
}

function displacementTick(battle, dt) {
  const p = battle.player;
  for (const verb of battle.verbs) {
    verb.timer -= dt;
    if (verb.timer > 0) continue;
    verb.timer += verb.card.cd;
    const radius = verb.card.radius * visionScale(battle.attrs);

    if (verb.card.kind === 'pull') {
      for (const e of battle.enemies) {
        if (e.cells <= 0 || e.locks.includes('anchor')) continue;
        const d = dist(p, e) || 1;
        if (d > radius) continue;
        const hit = placeEnemy(
          e,
          e.x + ((p.x - e.x) / d) * verb.card.strength,
          e.y + ((p.y - e.y) / d) * verb.card.strength,
        );
        if (hit) wallSlam(battle, e);
      }
      battle.events.push({ type: 'pull', x: p.x, y: p.y });
      continue;
    }

    if (verb.card.kind === 'push') {
      for (const e of battle.enemies) {
        if (e.cells <= 0 || e.locks.includes('anchor')) continue;
        const d = dist(p, e) || 1;
        if (d > radius) continue;
        rawHit(battle, e, verb.card.cells);
        const hit = placeEnemy(
          e,
          e.x + ((e.x - p.x) / d) * verb.card.strength,
          e.y + ((e.y - p.y) / d) * verb.card.strength,
        );
        if (hit) wallSlam(battle, e);
      }
      battle.events.push({ type: 'push', x: p.x, y: p.y });
      continue;
    }

    if (verb.card.kind === 'vortex') {
      for (const e of battle.enemies) {
        if (e.cells <= 0 || e.locks.includes('anchor')) continue;
        if (dist(p, e) > radius) continue;
        e.vortex = Math.max(e.vortex, verb.card.duration);
      }
      battle.events.push({ type: 'vortex', x: p.x, y: p.y });
    }
  }
}

function enemiesTick(battle, dt) {
  const p = battle.player;
  for (const e of battle.enemies) {
    if (e.cells <= 0) continue;
    e.flash = Math.max(0, e.flash - dt);
    if (e.wallCd > 0) e.wallCd = Math.max(0, e.wallCd - dt);
    if (e.freeze > 0) {
      e.freeze = Math.max(0, e.freeze - dt);
      continue;
    }
    if (e.root > 0) {
      e.root = Math.max(0, e.root - dt);
      continue;
    }
    if (e.vortex > 0) {
      e.vortex = Math.max(0, e.vortex - dt);
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const hit = placeEnemy(
        e,
        e.x + (-dy / d) * VORTEX_SPEED * dt,
        e.y + (dx / d) * VORTEX_SPEED * dt,
      );
      if (hit) wallSlam(battle, e);
      continue;
    }
    if (e.locks.includes('devour')) {
      e.devourCd = (e.devourCd ?? 6) - dt;
      if (e.devourCd <= 0) {
        e.devourCd += 6;
        const prey = nearestSummon(battle, e, 12);
        if (prey !== null) {
          e.cells = Math.min(e.maxCells, e.cells + 3);
          killSummon(battle, prey);
        }
      }
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
    let dmg = damageTaken(e.damage, battle.attrs);
    if (hasRule(battle, 'link')) {
      const linked = nearestSummon(battle, p, 40);
      if (linked !== null) {
        const transfer = dmg * 0.5;
        linked.cells -= transfer;
        dmg -= transfer;
        if (linked.cells <= 0) killSummon(battle, linked);
      }
    }
    p.cells -= dmg;
    battle.events.push({ type: 'hurt', x: p.x, y: p.y, cells: dmg });
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
    if ((e.mark ?? 0) > 0) {
      e.markLeft = (e.markLeft ?? 0) - dt;
      if (e.markLeft <= 0) e.mark = 0;
    }
    if (e.locks.includes('cleanse')) {
      e.cleanseCd = (e.cleanseCd ?? 3) - dt;
      if (e.cleanseCd <= 0) {
        e.cleanseCd += 3;
        e.status.burn = 0;
        e.mark = 0;
      }
    }
    const burn = advanceStatus(e.status, dt);
    if (burn <= 0) continue;
    const dealt = resolveHit(e, burn, { main: false });
    e.cells -= dealt;
    battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: dealt });
  }
}

function refreshCooldowns(battle) {
  for (const source of battle.sources) source.timer = 0;
  for (const summon of battle.summons) summon.timer = 0;
  for (const self of battle.selfs) self.timer = 0;
}

function resolveDeaths(battle) {
  const alive = [];
  const booms = [];
  const embers = [];
  const marks = [];
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
      if (hasCore(battle, 'core_siphon')) {
        battle.player.cells = Math.min(battle.player.maxCells, battle.player.cells + 1);
      }
      if (e.status.burn > 0) embers.push({ x: e.x, y: e.y, burn: e.status.burn });
      if ((e.mark ?? 0) > 0) marks.push({ x: e.x, y: e.y, stacks: e.mark });
      if (hasCore(battle, 'core_echo')) {
        battle.echoKills += 1;
        if (battle.echoKills % 8 === 0) refreshCooldowns(battle);
      }
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

  // 余烬：灼烧目标死亡时把层数传给最近的敌人（核心把 1 个变成 3 个）
  for (const ember of embers) {
    const targets = alive
      .filter((other) => other.cells > 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - ember.x, a.y - ember.y) - Math.hypot(b.x - ember.x, b.y - ember.y),
      )
      .slice(0, battle.emberSpread);
    for (const target of targets) applyBurn(target.status, ember.burn, battle.burnCap);
  }

  // 引信：带标记的敌人死亡时按层数爆炸；传导：标记扩散给最近的两个
  for (const mark of marks) {
    if (hasRule(battle, 'fuse')) {
      for (const other of alive) {
        if (other.cells <= 0) continue;
        if (Math.hypot(other.x - mark.x, other.y - mark.y) > 18) continue;
        other.cells -= mark.stacks;
        battle.events.push({ type: 'burn', x: other.x, y: other.y, cells: mark.stacks });
      }
    }
    if (hasRule(battle, 'spread')) {
      const targets = alive
        .filter((other) => other.cells > 0)
        .sort(
          (a, b) =>
            Math.hypot(a.x - mark.x, a.y - mark.y) - Math.hypot(b.x - mark.x, b.y - mark.y),
        )
        .slice(0, 2);
      for (const target of targets) addMark(target, mark.stacks);
    }
  }

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
  if (battle.spawned >= battle.def.enemies + battle.extra && battle.enemies.length === 0) {
    battle.state = 'cleared';
    return;
  }
  if (battle.time >= TIME_LIMIT) {
    battle.state = 'timeout';
  }
}

/** 追加压力：token 换来的额外敌人，只加数量不改组成。 */
export function addPressure(battle, count) {
  if (battle.state !== 'fighting') return 0;
  const before = battle.extra;
  const add = Math.max(0, Math.floor(count));
  battle.extra = Math.min(MAX_EXTRA, battle.extra + add);
  if (battle.extra > before) battle.events.push({ type: 'pressure', extra: battle.extra });
  return battle.extra - before;
}

/** 花 1 点属性。体魄当场提高上限并补回等量生命。 */
export function spendPoint(battle, id) {
  const attr = ATTRIBUTES.find((a) => a.id === id);
  if (attr === undefined) return false;
  if (battle.points <= 0) return false;
  if ((battle.attrs[id] ?? 0) >= attr.max) return false;
  const before = playerCells(battle.attrs);
  battle.attrs[id] += 1;
  battle.points -= 1;
  const after = playerCells(battle.attrs);
  if (after !== before) {
    battle.player.maxCells = after;
    battle.player.cells = Math.min(after, battle.player.cells + (after - before));
  }
  battle.events.push({ type: 'spend', id });
  return true;
}

/** 推进一帧，返回这一帧产生的事件。 */
export function step(battle, dt) {
  if (battle.state !== 'fighting') return [];
  battle.events = [];
  battle.time += dt;
  spawnTick(battle);
  for (let i = battle.respawns.length - 1; i >= 0; i -= 1) {
    if (battle.time < battle.respawns[i].at) continue;
    const dead = battle.respawns.splice(i, 1)[0];
    if (battle.summons.length < 6) battle.summons.push(makeSummon(battle, dead.card));
  }
  playerMove(battle, dt);
  attackTick(battle, dt);
  summonsTick(battle, dt);
  displacementTick(battle, dt);
  if (battle.pinCd > 0) battle.pinCd -= dt;
  selfTick(battle, dt);
  rulesTick(battle, dt);
  bulletsTick(battle, dt);
  enemiesTick(battle, dt);
  statusTick(battle, dt);
  const regen = regenPerSecond(battle.attrs);
  if (regen > 0 && battle.player.cells > 0 && battle.player.cells < battle.player.maxCells) {
    battle.player.cells = Math.min(battle.player.maxCells, battle.player.cells + regen * dt);
  }
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
