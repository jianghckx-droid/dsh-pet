// 战斗世界：位置、刷怪、走位、经验、抽选与胜负。
//
// 技能裁决全部在 src/game/skills/：这里只负责实体位置、敌人 AI 和战斗循环，
// 并按架构规定的固定步长顺序调用运行时。相同初始状态、seed 和 dt 序列
// 必须产生同一结果。

import { ARENA, castDueSkills, createSkillInstances, replaceSkillInstances } from './skills/runtime.js';
import { compileBuild, emptyBuild, pruneBuild } from './skills/compile.js';
import { queueDeathReactions, enqueue, ensureResolutionState, processCommands, advanceDelayed, diagnose } from './skills/resolve.js';
import { slowFactor, tickStatuses } from './skills/status.js';
import { offerUpgrades, equipReserveComponent, installChoice, stageLabel } from './skills/draft.js';
import { contentById } from './skills/registry.js';
import { updateEntities } from './skills/entities/index.js';
import { createMovementState, movePlayer, refreshMovementState, resolveDisplacements } from './movement.js';
import { FLOOR_SECONDS, TIME_LIMIT, floorDef, floorModifier, enemyTotal } from './floors.js';
import { bagOf, enemyCellsAt, enemyDamageAt, enemyType } from './enemies.js';
import {
  ATTRIBUTE_IDS,
  createCombatStats,
  describeCombatStats,
  mitigateDamage,
  normalizeAttributes,
  previewAttribute,
} from './attributes.js';

export { ARENA, TIME_LIMIT };
export const MAX_EXTRA = 18;
export const MAX_SKILLS = 2;

const PLAYER_SPEED = 52;
const PLAYER_RADIUS = 3;
const CONTACT_PAD = 1.5;
const ENEMY_ATTACK_INTERVAL = 1.6;
const ENEMY_SPEED_PER_FLOOR = 0.6;
const XP_PER_KILL_CAP = 6;

// 暴击使用独立 RNG 流：刷怪与抽选继续走 battle.rng，加入暴击不会改变已有种子
// 的刷怪顺序与三选一候选。
const COMBAT_RNG_SALT = 0x9e3779b9;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spawnPoint(rng) {
  const edge = Math.floor(rng() * 4);
  if (edge === 0) return { x: rng() * ARENA.w, y: -6 };
  if (edge === 1) return { x: ARENA.w + 6, y: rng() * ARENA.h };
  if (edge === 2) return { x: rng() * ARENA.w, y: ARENA.h + 6 };
  return { x: -6, y: rng() * ARENA.h };
}

function normalizeCompile(build) {
  const pruned = pruneBuild(build);
  const compiled = compileBuild(pruned.build);
  if (pruned.removed.length > 0) {
    compiled.warnings.push({
      code: 'pruned-build',
      path: 'skills',
      message: '已移除失效组件：' + pruned.removed.join('、'),
    });
  }
  if (compiled.plans.length > 0) return compiled;
  const fallback = compileBuild(emptyBuild());
  return {
    ...fallback,
    errors: [
      ...compiled.errors,
      {
        code: 'empty-build',
        path: 'skills',
        message: '构筑没有可运行的动作，已临时使用基础飞弹',
      },
    ],
    warnings: [...compiled.warnings, ...fallback.warnings],
  };
}

export function createBattle({
  floor = 1,
  build = emptyBuild(),
  seed = 1,
  extra = 0,
  level = 1,
  xp = 0,
  xpNext = 8,
  pending = 0,
  draftCount = 0,
  movementStrategy = 'auto',
  styleId = null,
  attributes = {},
  attributePoints = 0,
  bonuses = {},
  // 地图节点给出的战斗构成：{ def, modifier }。传入时不再查 15 层表。
  plan = null,
  // 地图跨节点保留的生命；不传则满生命开始。
  life = null,
} = {}) {
  const def = plan !== null && plan !== undefined && plan.def !== undefined ? plan.def : floorDef(floor);
  const compiled = normalizeCompile(build);
  const modifier = plan !== null && plan !== undefined
    ? (plan.modifier ?? null)
    : floorModifier(floor);
  const allocated = normalizeAttributes(attributes);
  const combat = createCombatStats(allocated, bonuses);
  const carried = life === null || life === undefined ? Number.NaN : Number(life);
  const startCells = Number.isFinite(carried)
    ? Math.max(1, Math.min(combat.maxLife, Math.round(carried)))
    : combat.maxLife;
  const player = {
    id: 'player',
    kind: 'player',
    x: ARENA.w / 2,
    y: ARENA.h / 2,
    radius: PLAYER_RADIUS,
    cells: startCells,
    maxCells: combat.maxLife,
    speed: PLAYER_SPEED,
  };
  const battle = {
    def,
    floor,
    modifier,
    styleId,
    build: compiled.build,
    plans: compiled.plans,
    compileErrors: compiled.errors,
    compileWarnings: compiled.warnings,
    skills: createSkillInstances(compiled.plans, combat),
    player,
    attributes: allocated,
    attributePoints: Math.max(0, Math.floor(Number(attributePoints) || 0)),
    bonuses: bonuses === null || typeof bonuses !== 'object' ? {} : { ...bonuses },
    combat,
    enemies: [],
    entities: [],
    projectiles: [],
    orbitSwords: [],
    arcSwords: [],
    piercingSwords: [],
    swordArrays: [],
    traps: [],
    enemyShots: [],
    commands: [],
    delayed: [],
    displacements: [],
    nextDisplacementSeq: 1,
    rootBudget: new Map(),
    splitCasts: new Set(),
    echoCasts: new Set(),
    events: [],
    diagnostics: [],
    time: 0,
    state: 'fighting',
    rng: mulberry32(seed),
    seed,
    combatRng: mulberry32((seed ^ COMBAT_RNG_SALT) >>> 0),
    nextId: 1,
    nextEventId: 1,
    bounds: ARENA,
    stats: {
      damage: {},
      bySkill: {},
      reactions: {},
      casts: {},
      modifiers: {},
      overflow: 0,
      kills: 0,
      killsByType: {},
      crits: 0,
      critExtra: 0,
      mitigated: 0,
    },
    movement: createMovementState(compiled.plans, movementStrategy),
    total: 0,
    spawned: 0,
    kills: 0,
    extra: Math.min(MAX_EXTRA, Math.max(0, extra)),
    level,
    xp,
    xpNext,
    pending,
    draftCount,
    offer: null,
    surge: false,
    lastStage: stageLabel(compiled.build, draftCount),
  };
  battle.total = enemyTotal(def, { modifier, extra: battle.extra });
  if (battle.pending > 0) rollOffer(battle);
  return battle;
}

function enemySequence(battle) {
  return bagOf(battle.def.mix);
}

function spawnTick(battle) {
  const total = enemyTotal(battle.def, { modifier: battle.modifier, extra: battle.extra });
  battle.total = total;
  const interval = FLOOR_SECONDS / total;
  const bag = enemySequence(battle);
  while (battle.spawned < total && battle.time >= battle.spawned * interval) {
    const index = battle.spawned;
    const type = bag.length === 0 ? 'swarm' : bag[index % bag.length];
    const typeDef = enemyType(type);
    const finalSpawn = index === total - 1;
    const isElite = finalSpawn && (battle.modifier === 'elite' || battle.modifier === 'boss');
    const isBoss = finalSpawn && battle.modifier === 'boss';
    let cells = enemyCellsAt(battle.floor, type);
    if (battle.modifier === 'crowded') cells = Math.round(cells * 0.7);
    if (isBoss) cells = Math.round(cells * 3.4);
    else if (isElite) cells = Math.round(cells * 2.5);
    const at = spawnPoint(battle.rng);
    const radius = typeDef.radius + (isBoss ? 2 : isElite ? 1 : 0);
    const enemy = {
      id: battle.nextId++,
      kind: 'enemy',
      type,
      x: at.x,
      y: at.y,
      cells,
      maxCells: cells,
      radius,
      r: radius,
      speed: typeDef.speed * (1 + battle.floor * ENEMY_SPEED_PER_FLOOR * 0.02) * (battle.modifier === 'frenzy' ? 1.3 : 1) * (isBoss ? 1.12 : 1),
      damage: enemyDamageAt(battle.floor, type) + (battle.modifier === 'frenzy' ? 1 : 0) + (isBoss ? 2 : isElite ? 1 : 0),
      behavior: typeDef.behavior,
      preferredRange: typeDef.preferredRange ?? 0,
      shot: typeDef.shot ?? null,
      attackTimer: typeDef.attackInterval,
      statuses: {},
      dead: false,
      deathHandled: false,
      flash: 0,
      elite: isElite && !isBoss,
      boss: isBoss,
    };
    battle.enemies.push(enemy);
    battle.spawned += 1;
    if (battle.spawned === total && isBoss) battle.events.push({ type: 'boss', x: enemy.x, y: enemy.y });
    else if (battle.spawned === total && isElite) battle.events.push({ type: 'elite', x: enemy.x, y: enemy.y });
  }
}

function moveEnemy(battle, enemy, dt) {
  const player = battle.player;
  const speed = enemy.speed * slowFactor(enemy);
  if (enemy.behavior === 'kite') {
    const d = distance(enemy, player) || 1;
    const ideal = enemy.preferredRange;
    let vx = 0;
    let vy = 0;
    if (d < ideal - 6) {
      vx = (enemy.x - player.x) / d;
      vy = (enemy.y - player.y) / d;
    } else if (d > ideal + 6) {
      vx = (player.x - enemy.x) / d;
      vy = (player.y - enemy.y) / d;
    } else {
      vx = -(player.y - enemy.y) / d;
      vy = (player.x - enemy.x) / d;
    }
    enemy.x = clamp(enemy.x + vx * speed * dt, enemy.r, ARENA.w - enemy.r);
    enemy.y = clamp(enemy.y + vy * speed * dt, enemy.r, ARENA.h - enemy.r);
    return;
  }
  const dx = player.x - enemy.x;
  const dy = player.y - enemy.y;
  const d = Math.hypot(dx, dy) || 1;
  const reach = enemy.r + PLAYER_RADIUS + CONTACT_PAD;
  if (d <= reach) return;
  const step = Math.min(speed * dt, d - reach);
  enemy.x += (dx / d) * step;
  enemy.y += (dy / d) * step;
}

function enemiesMove(battle, dt) {
  for (const enemy of battle.enemies) {
    if (enemy.cells <= 0 || enemy.dead) continue;
    enemy.flash = Math.max(0, enemy.flash - dt);
    moveEnemy(battle, enemy, dt);
  }
}

function hurtPlayer(battle, amount) {
  if (!(amount > 0) || battle.state !== 'fighting') return;
  // 护甲对当前所有敌人伤害统一生效；内部保留小数，界面显示时再取整。
  const taken = mitigateDamage(amount, battle.combat);
  if (!(taken > 0)) return;
  if (!battle.stats) battle.stats = {};
  battle.stats.mitigated = (battle.stats.mitigated ?? 0) + Math.max(0, amount - taken);
  battle.player.cells -= taken;
  battle.events.push({
    type: 'hurt',
    x: battle.player.x,
    y: battle.player.y,
    cells: taken,
    raw: amount,
  });
  if (battle.player.cells <= 0) {
    battle.player.cells = 0;
    battle.state = 'dead';
  }
}

function enemiesAttack(battle, dt) {
  const player = battle.player;
  for (const enemy of battle.enemies) {
    if (enemy.cells <= 0 || enemy.dead || battle.state !== 'fighting') continue;
    const d = distance(enemy, player);
    const inRange = enemy.behavior === 'kite' ? d <= 96 : d <= enemy.r + PLAYER_RADIUS + CONTACT_PAD + 1;
    if (!inRange) continue;
    enemy.attackTimer -= dt;
    if (enemy.attackTimer > 0) continue;
    enemy.attackTimer = enemy.behavior === 'kite' ? 2.4 : ENEMY_ATTACK_INTERVAL;
    if (enemy.behavior === 'kite' && enemy.shot !== null) {
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const length = Math.hypot(dx, dy) || 1;
      battle.enemyShots.push({
        id: battle.nextId++,
        x: enemy.x,
        y: enemy.y,
        vx: (dx / length) * enemy.shot.speed,
        vy: (dy / length) * enemy.shot.speed,
        life: enemy.shot.life,
        radius: enemy.shot.radius,
        damage: enemy.damage,
      });
      battle.events.push({ type: 'enemyShot', x: enemy.x, y: enemy.y });
      continue;
    }
    hurtPlayer(battle, enemy.damage);
  }
}

function updateEnemyShots(battle, dt) {
  const alive = [];
  for (const shot of battle.enemyShots) {
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    if (Math.hypot(shot.x - battle.player.x, shot.y - battle.player.y) <= shot.radius + PLAYER_RADIUS) {
      hurtPlayer(battle, shot.damage);
      continue;
    }
    if (shot.life > 0) alive.push(shot);
  }
  battle.enemyShots = alive;
}

export function awardXp(battle, amount) {
  battle.xp += amount;
  while (battle.xp >= battle.xpNext) {
    battle.xp -= battle.xpNext;
    battle.level += 1;
    battle.xpNext = 6 + battle.level * 2;
    // 每次升级 +1 基础属性点；与技能三选一互相独立，同一次升级可以各拿一份。
    battle.attributePoints = (battle.attributePoints ?? 0) + 1;
    if (battle.level % 2 === 0) battle.pending += 1;
    battle.events.push({ type: 'levelUp', level: battle.level, points: battle.attributePoints });
  }
  rollOffer(battle);
}

function rollOffer(battle) {
  if (battle.offer !== null || battle.pending <= 0) return;
  const offer = offerUpgrades(battle.build, battle.rng, { draftCount: battle.draftCount });
  if (offer.length === 0) return;
  battle.offer = offer;
  battle.lastStage = stageLabel(battle.build, battle.draftCount);
  battle.events.push({ type: 'offer' });
}

function deathRound(battle) {
  const dead = battle.enemies.filter((enemy) => enemy.cells <= 0 && !enemy.deathHandled);
  if (dead.length === 0) return false;
  for (const enemy of dead) {
    enemy.deathHandled = true;
    battle.kills += 1;
    battle.stats.kills += 1;
    battle.stats.killsByType[enemy.type] = (battle.stats.killsByType[enemy.type] ?? 0) + 1;
    battle.events.push({ type: 'kill', x: enemy.x, y: enemy.y, id: enemy.id, enemyType: enemy.type });
    queueDeathReactions(battle, enemy);
    if (enemy.boss) {
      battle.pending += 2;
      battle.events.push({ type: 'bossDown', x: enemy.x, y: enemy.y });
    } else if (enemy.elite) {
      battle.pending += 1;
      battle.events.push({ type: 'eliteDown', x: enemy.x, y: enemy.y });
    }
    const xp = enemy.boss ? enemyType(enemy.type).xp * 5 : enemy.elite ? enemyType(enemy.type).xp * 3 : enemyType(enemy.type).xp;
    awardXp(battle, Math.min(XP_PER_KILL_CAP, xp));
  }
  battle.enemies = battle.enemies.filter((enemy) => !enemy.deathHandled);
  return true;
}

function processAllCommands(battle) {
  processCommands(battle);
  let rounds = 0;
  while (deathRound(battle) && rounds < 8) {
    rounds += 1;
    processCommands(battle);
  }
  if (rounds >= 8) diagnose(battle, 'death-rounds', { rounds });
}

function statusTicks(battle, dt) {
  const ticks = tickStatuses(battle, dt);
  for (const tick of ticks) {
    enqueue(battle, {
      type: 'statusDamage',
      targetId: tick.targetId,
      sourceEntityId: tick.sourceEntityId,
      skillInstanceId: tick.skillInstanceId,
      rootEventId: tick.rootEventId ?? undefined,
      tags: ['status', tick.statusId],
      // 持续伤害吃通用与条件加成，但不暴击。
      payload: { damage: tick.damage, statusId: tick.statusId, channel: 'dot', element: tick.element },
    });
  }
}

function checkEnd(battle) {
  if (battle.state !== 'fighting') return;
  if (battle.player.cells <= 0) {
    battle.state = 'dead';
    return;
  }
  const total = enemyTotal(battle.def, { modifier: battle.modifier, extra: battle.extra });
  if (battle.spawned >= total && battle.enemies.length === 0) {
    battle.state = 'cleared';
    if (battle.surge) {
      battle.surge = false;
      battle.pending += 1;
      rollOffer(battle);
      battle.events.push({ type: 'surgeReward' });
    }
    return;
  }
  if (battle.time >= TIME_LIMIT) battle.state = 'timeout';
}

/** 推进一帧，返回这一帧产生的事件。 */
export function step(battle, dt) {
  if (battle.state !== 'fighting') return [];
  ensureResolutionState(battle);
  battle.events = [];
  battle.time += dt;

  // 1. 推进状态计时，周期伤害变成命令
  statusTicks(battle, dt);

  // 2. 刷怪与位置（常规移动由独立策略层统一处理）
  spawnTick(battle);
  movePlayer(battle, dt);
  enemiesMove(battle, dt);

  // 3. 到期技能产生动作，位移请求裁决，实体推进与碰撞
  castDueSkills(battle, dt);
  resolveDisplacements(battle);
  updateEntities(battle, dt);
  advanceDelayed(battle);

  // 4. 处理命中、反应与后续命令
  processAllCommands(battle);

  // 5. 敌人攻击与敌方弹体
  if (battle.state === 'fighting') {
    enemiesAttack(battle, dt);
    updateEnemyShots(battle, dt);
  }

  checkEnd(battle);
  return battle.events;
}

/** 一直跑到结束，返回同一场战斗。dt 固定，保证可复现。 */
export function runToEnd(battle, { dt = 1 / 60, maxSeconds = 120 } = {}) {
  while (battle.state === 'fighting' && battle.time < maxSeconds) step(battle, dt);
  return battle;
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

/** 过载潮：token 攒满时来一波额外的怪，清层后给一次三选一。 */
export function triggerSurge(battle, extra = 6) {
  if (battle.state !== 'fighting' || battle.surge) return false;
  addPressure(battle, extra);
  battle.surge = true;
  battle.events.push({ type: 'surge' });
  return true;
}

/** 切换移动策略；不改变已有构筑。 */
export function setMovementStrategy(battle, strategy) {
  battle.movement = createMovementState(battle.plans, strategy);
  return battle.movement.strategy;
}

/**
 * 重算战斗属性。属性点分配、装备变化后调用；
 * 已经飞出去的实体与延迟命令在命中结算时才读取，不做额外快照。
 */
export function recomputeCombat(battle) {
  const combat = createCombatStats(battle.attributes, battle.bonuses ?? {});
  battle.combat = combat;
  battle.player.maxCells = combat.maxLife;
  if (battle.player.cells > combat.maxLife) battle.player.cells = combat.maxLife;
  return combat;
}

/**
 * 自由分配基础属性点。
 * 最大生命提升时，当前生命同步增加相同数值（docs/character-attributes-design.md）。
 * 返回 false 表示属性未知或点数不足。
 */
export function allocateAttribute(battle, id, points = 1) {
  if (!ATTRIBUTE_IDS.includes(id)) return false;
  const spend = Math.max(1, Math.floor(Number(points) || 1));
  const available = Math.max(0, Math.floor(Number(battle.attributePoints) || 0));
  if (available < spend) return false;
  const attributes = normalizeAttributes(battle.attributes);
  attributes[id] += spend;
  battle.attributes = attributes;
  battle.attributePoints = available - spend;
  const beforeMax = battle.player.maxCells;
  const combat = recomputeCombat(battle);
  const gain = combat.maxLife - beforeMax;
  // 阵亡状态不再补血：本层已经结束，重试会从满生命开始。
  if (gain > 0 && battle.state !== 'dead') {
    battle.player.cells = Math.min(combat.maxLife, battle.player.cells + gain);
  }
  battle.events.push({ type: 'attribute', id, points: spend, value: attributes[id], combat });
  return true;
}

/** 属性与战斗属性的可读快照，供 UI、报告与测试读取。 */
export function attributeSummary(battle) {
  const attributes = normalizeAttributes(battle.attributes);
  const combat = battle.combat ?? createCombatStats(attributes, battle.bonuses ?? {});
  return {
    attributes: { ...attributes },
    spent: Object.values(attributes).reduce((sum, value) => sum + value, 0),
    points: Math.max(0, Math.floor(Number(battle.attributePoints) || 0)),
    combat,
    previews: ATTRIBUTE_IDS.map((id) => previewAttribute(attributes, id, battle.bonuses ?? {})),
    text: describeCombatStats(combat),
  };
}

/** 选中一张升级：装入组件、重编译、保留飞行中的计划快照。 */
export function chooseUpgrade(battle, id, placement) {
  if (battle.offer === null || !battle.offer.includes(id)) return false;
  const installed = installChoice(battle.build, id, placement);
  if (!installed.ok) {
    battle.lastUpgradeError = installed.reason ?? 'install-failed';
    return false;
  }
  const compiled = compileBuild(installed.build);
  if (!compiled.ok || compiled.plans.length === 0) return false;
  battle.build = compiled.build;
  battle.plans = compiled.plans;
  replaceSkillInstances(battle, compiled.plans);
  refreshMovementState(battle);
  battle.compileErrors = compiled.errors;
  battle.compileWarnings = [...compiled.warnings, ...(installed.warnings ?? [])];
  battle.offer = null;
  battle.pending = Math.max(0, battle.pending - 1);
  battle.draftCount += 1;
  battle.lastUpgradeError = null;
  battle.events.push({ type: 'upgrade', id });
  rollOffer(battle);
  return true;
}

/** 把备用栏组件装回战斗。 */
export function equipReserve(battle, id) {
  const result = equipReserveComponent(battle.build, id);
  if (!result.ok) return false;
  const compiled = compileBuild(result.build);
  if (!compiled.ok || compiled.plans.length === 0) return false;
  battle.build = compiled.build;
  battle.plans = compiled.plans;
  replaceSkillInstances(battle, compiled.plans);
  refreshMovementState(battle);
  battle.compileErrors = compiled.errors;
  battle.compileWarnings = [...compiled.warnings, ...(result.warnings ?? [])];
  battle.events.push({ type: 'upgrade', id });
  return true;
}

/** 当前技能计划的可读摘要，供 UI 与报告使用。 */
export function planSummary(battle) {
  return battle.plans.map((plan) => ({
    id: plan.id,
    label: plan.label,
    description: plan.description,
    color: plan.element === null ? plan.action.color : plan.element.color,
  }));
}

export function upgradeChoices(battle) {
  if (battle.offer === null) return [];
  return battle.offer.map((id) => contentById(id)).filter((def) => def !== undefined);
}
