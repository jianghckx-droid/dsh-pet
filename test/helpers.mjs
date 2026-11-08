// 测试辅助：手工摆敌人、直接投递命中命令、固定步长推进。
//
// 这些函数不改变战斗规则，只是把"布置场景"从用例里抽出来。

import { createBattle, step } from '../src/game/arena.js';
import { enqueue, processCommands, queueDeathReactions } from '../src/game/skills/resolve.js';

export function makeBattle(build, { floor = 1, seed = 3 } = {}) {
  const battle = createBattle({ floor, build, seed });
  battle.spawned = 999;
  battle.total = 999;
  battle.player.speed = 0;
  battle.player.x = 80;
  battle.player.y = 72;
  battle.enemies = [];
  return battle;
}

export function makeEnemy(id, x, y, { cells = 10, type = 'swarm' } = {}) {
  return {
    id,
    kind: 'enemy',
    type,
    x,
    y,
    cells,
    maxCells: cells,
    radius: 3,
    r: 3,
    speed: 0,
    damage: 1,
    behavior: 'chase',
    preferredRange: 0,
    shot: null,
    attackTimer: 99,
    statuses: {},
    dead: false,
    deathHandled: false,
    flash: 0,
    elite: false,
  };
}

export function run(battle, seconds, dt = 1 / 20) {
  const count = Math.round(seconds / dt);
  for (let i = 0; i < count; i += 1) step(battle, dt);
}

export function fireHit(battle, targetId, payload = {}, tags = []) {
  enqueue(battle, {
    type: 'hit',
    targetId,
    sourceEntityId: 'player',
    skillInstanceId: payload.skillInstanceId ?? 'skill-1',
    tags: ['primary', ...tags],
    payload: {
      damage: 1,
      damageScale: 1,
      element: null,
      modifier: null,
      action: 'projectile',
      castId: 'test-cast',
      centerX: 80,
      centerY: 72,
      ...payload,
    },
  });
  processCommands(battle);
}

/** 让所有 cells<=0 的敌人走完死亡结算与反应命令。 */
export function settleDeaths(battle) {
  const dead = battle.enemies.filter((enemy) => enemy.cells <= 0 && !enemy.deathHandled);
  for (const enemy of dead) {
    enemy.deathHandled = true;
    battle.kills += 1;
    battle.stats.kills += 1;
    queueDeathReactions(battle, enemy);
  }
  battle.enemies = battle.enemies.filter((enemy) => !enemy.deathHandled);
  processCommands(battle);
}
