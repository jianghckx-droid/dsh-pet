import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

function loadDefinition() {
  let definition = null;
  const store = new Map();
  const window = {
    __ModuleLoader__: {
      load(def) {
        definition = def;
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
  const sandbox = { window, performance: { now: () => 0 }, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  return definition;
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useReducer: (_fn, value) => [value, () => {}],
};

function loadModule() {
  const def = loadDefinition();
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
    imageSmoothingEnabled: true,
  };
}

test('client.js 以单文件 loader 格式注册', () => {
  const def = loadDefinition();
  assert.equal(def.id, 'dsh-pet');
  assert.equal(typeof def.factory, 'function');
});

test('核心已内联，且不只是标记', () => {
  assert.ok(source.includes('// ---- arena.js ----'));
  assert.ok(source.includes('function createBattle'));
  assert.ok(source.includes('function resolveHit'));
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

test('接入路径：建角色 → 打层 → 自动进入下一层', () => {
  const { createEntry, tick, draw } = loadModule().__debug;
  const entry = createEntry('test', 7);
  assert.equal(entry.floor, 1);
  assert.equal(entry.battle.floor, 1);

  const c = fakeContext();
  draw(c, entry);
  assert.ok(c.calls.length > 0, 'draw should paint something');

  for (let i = 0; i < 60 * 40; i += 1) tick(entry, 1 / 60);
  assert.ok(entry.floor >= 2, `expected floor >= 2, got ${entry.floor}`);
  assert.ok(Number.isFinite(entry.battle.player.cells));
});

test('切换 build 后重开第 1 层，卡片数随之变化', () => {
  const { createEntry, startFloor, BUILDS } = loadModule().__debug;
  const entry = createEntry('test', 7);
  assert.equal(entry.battle.cards.length, BUILDS.fire.cards.length);
  entry.buildId = 'pure';
  startFloor(entry, 1);
  assert.equal(entry.battle.cards.length, 1);
  assert.equal(entry.battle.player.maxCells, 12);
});

test('三选一：选卡进槽，并在下一层保留', () => {
  const { createEntry, startFloor, pickCard, awardXp } = loadModule().__debug;
  const entry = createEntry('test', 7);
  awardXp(entry.battle, 8);
  assert.ok(entry.battle.offer, 'expected an offer');
  const id = entry.battle.offer[0];
  assert.equal(pickCard(entry, id), true);
  assert.equal(entry.battle.slots.length, 1);
  assert.ok(entry.drafted.includes(id));

  startFloor(entry, 2);
  assert.equal(entry.battle.floor, 2);
  assert.equal(entry.battle.slots.length, 1);
  assert.ok(entry.battle.cards.some((card) => card.id === id));
});

test('属性点：花掉后写进存档，再次进入角色仍在', () => {
  const { createEntry, awardXp, spend } = loadModule().__debug;
  const first = createEntry('persist-key', 7);
  awardXp(first.battle, 20);
  assert.ok(first.battle.points > 0, 'expected points from level-ups');
  assert.equal(spend(first, 'body'), true);
  assert.equal(first.attrs.body, 1);
  assert.equal(first.battle.player.maxCells, 14);

  const second = createEntry('persist-key', 7);
  assert.equal(second.attrs.body, 1);
  assert.equal(second.points, first.points);
});

test('属性点跨层保留', () => {
  const { createEntry, startFloor, awardXp } = loadModule().__debug;
  const entry = createEntry('pts-key', 7);
  awardXp(entry.battle, 6);
  const points = entry.battle.points;
  assert.ok(points > 0, 'expected a point from level 2');
  startFloor(entry, 2);
  assert.equal(entry.battle.points, points);
  assert.equal(entry.points, points);
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

test('纯数值在第 6 层会被挡住（客户端同一套规则）', () => {
  const { createEntry, startFloor, tick } = loadModule().__debug;
  const entry = createEntry('test', 7);
  entry.buildId = 'pure';
  startFloor(entry, 6);
  let guard = 0;
  while (entry.lastResult === null && guard < 60 * 60) {
    tick(entry, 1 / 60);
    guard += 1;
  }
  assert.ok(entry.lastResult !== null, 'expected a result');
  assert.notEqual(entry.lastResult.kind, 'cleared');
});
