import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

function makeWindow(store) {
  return {
    __ModuleLoader__: {
      load(def) {
        this.definition = def;
      },
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => {
      throw new Error('offline');
    },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
}

function loadDefinition(store = new Map()) {
  const window = makeWindow(store);
  const sandbox = { window, performance: { now: () => 0 }, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  return window.__ModuleLoader__.definition;
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useReducer: (_fn, value) => [value, () => {}],
};

function loadModule(store = new Map()) {
  const def = loadDefinition(store);
  return def.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unknown module: ' + id);
  });
}

function fakeContext() {
  const calls = [];
  return {
    calls,
    setTransform: () => {},
    fillRect: () => calls.push(1),
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  };
}

test('client.js 以单文件 loader 格式注册', () => {
  const def = loadDefinition();
  assert.equal(def.id, 'dsh-pet');
  assert.equal(typeof def.factory, 'function');
});

test('技能核心已内联，而不只是留下标记', () => {
  assert.ok(source.includes('// ---- skills/schema.js ----'));
  assert.ok(source.includes('function createBattle'));
  assert.ok(source.includes('function compileBuild'));
  assert.ok(source.includes('function applyStatus'));
  assert.ok(source.includes('function evaluateReactions'));
  assert.ok(source.includes('function processCommands'));
});

test('apply 注册了侧栏 tab、正文与触发按钮', () => {
  const mod = loadModule();
  const registrations = [];
  const ctx = {
    effect(fn) {
      fn();
    },
    slots: {
      inject(_name, fn) {
        fn();
      },
      register(spec) {
        registrations.push(spec);
        return () => {};
      },
    },
    sidebarRightTabs: {
      register(spec) {
        registrations.push(spec);
        return () => {};
      },
    },
    sidebarRight: { openTab: () => {} },
  };
  mod.apply(ctx);
  const tab = registrations.find((r) => r.kind === 'pet');
  assert.ok(tab, 'missing tab registration');
  assert.equal(tab.keepMounted, true);
  const body = registrations.find((r) => r.name === 'sidebar.right.pane.tab');
  assert.ok(body, 'missing pane registration');
  assert.equal(body.key, 'dsh-pet');
  const trigger = registrations.find((r) => r.name === 'conversation.input.right');
  assert.ok(trigger, 'missing trigger registration');
});

test('接入路径：建角色 → 自动打层 → 进入下一层', () => {
  const { createEntry, tick, draw } = loadModule().__debug;
  const entry = createEntry('test', 7);
  assert.equal(entry.floor, 1);
  assert.equal(entry.battle.floor, 1);
  assert.equal(entry.battle.plans.length, 1);
  assert.equal(entry.battle.plans[0].action.id, 'projectile');

  const c = fakeContext();
  draw(c, entry);
  assert.ok(c.calls.length > 0, 'draw should paint something');

  for (let i = 0; i < 60 * 40; i += 1) tick(entry, 1 / 60);
  assert.ok(entry.floor >= 2, `expected floor >= 2, got ${entry.floor}`);
  assert.ok(Number.isFinite(entry.battle.player.cells));
});

test('升级：第一次只出属性，选中后写进构筑并在下一层保留', () => {
  const { createEntry, startFloor, pickUpgrade, awardXp } = loadModule().__debug;
  const entry = createEntry('test', 7);
  awardXp(entry.battle, 8);
  assert.ok(entry.battle.offer, 'expected an offer');
  assert.ok(entry.battle.offer.every((id) => ['fire', 'frost', 'thunder'].includes(id)));
  const id = entry.battle.offer[0];
  assert.equal(pickUpgrade(entry, id), true);
  assert.equal(entry.battle.build.skills[0].element, id);
  assert.equal(entry.stats.drafts, 1);

  startFloor(entry, 2);
  assert.equal(entry.battle.floor, 2);
  assert.equal(entry.battle.build.skills[0].element, id);
  assert.equal(entry.battle.plans[0].element.id, id);
});

test('升级多槽位：指定装入位置', () => {
  const { createEntry, awardXp, pickUpgrade } = loadModule().__debug;
  const entry = createEntry('slot-key', 7);
  awardXp(entry.battle, 8);
  const id = entry.battle.offer[0];
  assert.equal(pickUpgrade(entry, id, { kind: 'element', skillIndex: 0, replacing: false }), true);
  assert.equal(entry.battle.build.skills[0].element, id);
});

test('备用栏：替换下来的组件进入备用栏，可再装回', () => {
  const { createEntry, awardXp, pickUpgrade, equipFromReserve } = loadModule().__debug;
  const entry = createEntry('reserve-key', 7);
  awardXp(entry.battle, 8);
  const first = entry.battle.offer[0];
  pickUpgrade(entry, first);
  awardXp(entry.battle, 30);
  const second = entry.battle.offer.find((id) => ['fire', 'frost', 'thunder'].includes(id) && id !== first);
  if (second !== undefined) {
    assert.equal(pickUpgrade(entry, second, { kind: 'element', skillIndex: 0, replacing: true }), true);
    assert.ok(entry.build.reserve.includes(first));
    assert.equal(equipFromReserve(entry, first), true);
    assert.equal(entry.build.skills[0].element, first);
  }
});

test('存档：构筑与累计战绩写进 v4 存档，再进角色仍在', () => {
  const { createEntry, awardXp, pickUpgrade } = loadModule().__debug;
  const store = new Map();
  const mod = loadModule(store);
  const first = mod.__debug.createEntry('persist-key', 7);
  mod.__debug.awardXp(first.battle, 20);
  assert.ok(first.battle.offer);
  const id = first.battle.offer[0];
  assert.equal(mod.__debug.pickUpgrade(first, id), true);
  assert.equal(first.stats.drafts, 1);

  const second = loadModule(store).__debug.createEntry('persist-key', 7);
  assert.equal(second.build.skills[0].element, id);
  assert.equal(second.stats.drafts, 1);
  assert.equal(second.floor, 1);
});

test('迁移：旧 v3 存档只保留累计战绩，不硬映射旧卡牌与属性', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v3.old-key',
    JSON.stringify({
      attrs: { edge: 10, body: 10 },
      points: 4,
      cores: ['core_ember'],
      stats: { kills: 123, bestFloor: 7, maxFloorKills: 20, drafts: 9 },
    }),
  );
  const { createEntry } = loadModule(store).__debug;
  const entry = createEntry('old-key', 7);
  assert.ok(entry.notice.includes('旧版存档'));
  assert.equal(entry.stats.kills, 123);
  assert.equal(entry.best, 7);
  assert.equal(entry.build.skills.length, 1);
  assert.equal(entry.build.skills[0].action, 'projectile');
  assert.equal(entry.build.skills[0].element, null);
});

test('迁移：v4 存档保留构筑与进度，生成 v5 且不删除 v4', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v4.old-v4-key',
    JSON.stringify({
      version: 4,
      build: {
        version: 2,
        skills: [{ id: 'skill-1', action: 'aura', element: 'fire', modifier: 'expand' }],
        reserve: ['echo'],
      },
      stats: { kills: 5, bestFloor: 3, maxFloorKills: 2, drafts: 2 },
      floor: 3,
      best: 3,
      level: 4,
      xp: 2,
      xpNext: 14,
      pending: 0,
      draftCount: 2,
    }),
  );
  const { createEntry } = loadModule(store).__debug;
  const entry = createEntry('old-v4-key', 7);
  assert.ok(entry.notice.includes('v4 存档已迁移'));
  assert.equal(entry.build.skills[0].action, 'aura');
  assert.equal(entry.build.skills[0].element, 'fire');
  assert.equal(entry.build.skills[0].modifier, 'expand');
  assert.equal(entry.floor, 3);
  assert.equal(entry.stats.kills, 5);
  assert.equal(entry.style, 'ranged');
  assert.ok(store.has('dsh.pet.v4.old-v4-key'), 'v4 原存档应保留');
  assert.ok(store.has('dsh.pet.v5.old-v4-key'), '迁移应写入 v5');
});

test('修复：v5 存档里的失效组件被安全清空并显示提示', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v5.broken-key',
    JSON.stringify({
      version: 5,
      style: 'ranged',
      movement: 'keepDistance',
      build: {
        version: 3,
        skills: [{ id: 'skill-1', action: 'projectile', element: 'poison', modifier: 'split' }],
        reserve: ['gone'],
      },
      stats: { kills: 1, bestFloor: 2, maxFloorKills: 1, drafts: 1 },
      floor: 2,
      best: 2,
      level: 3,
      xp: 1,
      xpNext: 10,
      pending: 0,
      draftCount: 1,
    }),
  );
  const { createEntry } = loadModule(store).__debug;
  const entry = createEntry('broken-key', 7);
  assert.ok(entry.notice.includes('已移除'));
  assert.equal(entry.build.skills[0].element, null);
  assert.equal(entry.build.skills[0].modifier, 'split');
  assert.equal(entry.build.reserve.length, 0);
  assert.equal(entry.floor, 2);
  assert.ok(store.has('dsh.pet.v5.broken-key.bak'), '修复前必须保留原始存档备份');
});

test('token 驱动：输出 token 换成额外敌人', () => {
  const { createEntry, pushTokens } = loadModule().__debug;
  const entry = createEntry('tok-key', 7);
  assert.equal(entry.battle.extra, 0);
  pushTokens(entry, 1200);
  assert.equal(entry.battle.extra, 2);
  assert.equal(entry.tokenQueue, 200);
  pushTokens(entry, 300);
  assert.equal(entry.battle.extra, 3);
  assert.equal(entry.tokenQueue, 0);
});

test('token 过载潮：攒满触发', () => {
  const { createEntry, pushTokens } = loadModule().__debug;
  const entry = createEntry('surge-key', 7);
  assert.equal(entry.battle.surge, false);
  pushTokens(entry, 3000);
  assert.equal(entry.battle.surge, true);
});

test('绘制在多帧之后仍然稳定', () => {
  const { createEntry, tick, draw } = loadModule().__debug;
  const entry = createEntry('draw-key', 7);
  const c = fakeContext();
  for (let i = 0; i < 600; i += 1) {
    tick(entry, 1 / 60);
    draw(c, entry);
    assert.ok(Number.isFinite(entry.shake), 'shake must stay finite');
    assert.ok(entry.particles.length <= 220, 'particles must be capped');
    assert.ok(entry.fx.length <= 240, 'fx must stay bounded');
  }
  assert.ok(c.calls.length > 500, 'expected a lot of draw calls');
});

test('失败后停在原层重试，并补一次升级选择', () => {
  const { createEntry, startFloor, advance } = loadModule().__debug;
  const entry = createEntry('retry-key', 7);
  entry.floor = 6;
  startFloor(entry, 6);
  entry.pending = 0;
  entry.lastResult = { kind: 'dead', floor: 6 };
  entry.phase = 'result';
  advance(entry);
  assert.equal(entry.floor, 6);
  assert.equal(entry.battle.floor, 6);
  assert.equal(entry.pending, 1);
  assert.ok(entry.battle.offer !== null);
});

test('风格与移动策略：默认远程，切换近战会按新风格重开本轮', () => {
  const { createEntry, setStyle, setMovement, tick } = loadModule().__debug;
  const entry = createEntry('style-key', 7);
  assert.equal(entry.style, 'ranged');
  assert.equal(entry.movement, 'keepDistance');
  assert.equal(entry.battle.build.skills[0].action, 'projectile');
  assert.equal(entry.battle.movement.strategy, 'keepDistance');

  assert.equal(setStyle(entry, 'melee'), true);
  assert.equal(entry.style, 'melee');
  assert.equal(entry.movement, 'approach');
  assert.equal(entry.floor, 1);
  assert.equal(entry.battle.build.skills[0].action, 'swing');

  assert.equal(setStyle(entry, 'sword'), false, '剑修需要最高层 3');
  entry.floor = 3;
  entry.battle.state = 'cleared';
  tick(entry, 1 / 60);
  assert.ok(entry.stats.bestFloor >= 3, '清层应更新累计最高层');
  assert.equal(setStyle(entry, 'sword'), true);
  assert.equal(entry.battle.build.skills[0].action, 'orbitSword');

  assert.equal(setMovement(entry, 'auto'), true);
  assert.equal(entry.movement, 'auto');
  assert.equal(entry.battle.movement.strategy, 'auto');
  assert.equal(setMovement(entry, 'nope'), false);
});

test('存档：v5 保存风格与移动策略，重新进入角色仍在', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('style-persist', 7);
  assert.equal(mod.__debug.setStyle(entry, 'melee'), true);
  assert.equal(mod.__debug.setMovement(entry, 'auto'), true);

  const second = loadModule(store).__debug.createEntry('style-persist', 7);
  assert.equal(second.style, 'melee');
  assert.equal(second.movement, 'auto');
  assert.equal(second.battle.build.skills[0].action, 'swing');
  assert.equal(second.battle.movement.strategy, 'auto');
});

test('新动作接入：御剑与陷阱能创建实体并完成战斗绘制', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('new-actions', 7);
  entry.stats.bestFloor = 5;
  assert.equal(mod.__debug.setStyle(entry, 'sword'), true);
  const c = fakeContext();
  for (let i = 0; i < 600; i += 1) {
    mod.__debug.tick(entry, 1 / 60);
    mod.__debug.draw(c, entry);
  }
  assert.ok(c.calls.length > 500);
  assert.ok(Array.isArray(entry.battle.orbitSwords));

  entry.stats.bestFloor = 5;
  assert.equal(mod.__debug.setStyle(entry, 'trapper'), true);
  for (let i = 0; i < 600; i += 1) mod.__debug.tick(entry, 1 / 60);
  assert.ok(Array.isArray(entry.battle.traps));

  entry.build = {
    version: 3,
    skills: [
      { id: 'skill-1', action: 'swordPierce', element: 'fire', modifier: null },
      { id: 'skill-2', action: 'swordArray', element: 'frost', modifier: 'echo' },
    ],
    reserve: [],
  };
  mod.__debug.startFloor(entry, 1);
  for (let i = 0; i < 600; i += 1) {
    mod.__debug.tick(entry, 1 / 60);
    mod.__debug.draw(c, entry);
  }
  assert.ok(Array.isArray(entry.battle.piercingSwords));
  assert.ok(Array.isArray(entry.battle.swordArrays));
});

test('战斗报告：伤害来源与反应次数可读', () => {
  const { createEntry, awardXp, pickUpgrade, tick, damageReport, reactionReport } = loadModule().__debug;
  const entry = createEntry('report-key', 7);
  awardXp(entry.battle, 8);
  pickUpgrade(entry, entry.battle.offer[0]);
  for (let i = 0; i < 60 * 20; i += 1) tick(entry, 1 / 60);
  const report = damageReport(entry)
  assert.equal(typeof report, 'string')
  assert.equal(typeof reactionReport(entry), 'string')
});
