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
      removeItem: (key) => store.delete(key),
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

function collectButtons(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectButtons(item, out);
    return out;
  }
  if (node.type === 'button') out.push(node);
  for (const child of node.children ?? []) collectButtons(child, out);
  return out;
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

test('存档：构筑与累计战绩写进 v5 存档，再进角色仍在', () => {
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

test('兼容：旧剑修存档仍保留环身御剑，不静默替换为弧光飞剑', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v5.old-sword-key',
    JSON.stringify({
      version: 5,
      style: 'sword',
      movement: 'approach',
      build: {
        version: 3,
        skills: [{ id: 'skill-1', action: 'orbitSword', element: 'fire', modifier: 'echo' }],
        reserve: [],
      },
      stats: { kills: 10, bestFloor: 4, maxFloorKills: 5, drafts: 2 },
      floor: 4,
      best: 4,
      level: 5,
      xp: 1,
      xpNext: 12,
      pending: 0,
      draftCount: 2,
    }),
  );
  const { createEntry } = loadModule(store).__debug;
  const entry = createEntry('old-sword-key', 7);
  assert.equal(entry.style, 'sword');
  assert.equal(entry.movement, 'approach');
  assert.equal(entry.build.skills[0].action, 'orbitSword');
  assert.equal(entry.battle.plans[0].action.id, 'orbitSword');
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
  assert.equal(entry.battle.build.skills[0].action, 'arcSword');
  assert.equal(entry.movement, 'keepDistance');

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

test('开发者模式：开启后解锁全部风格，关闭后恢复门槛', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('dev-style-key', 7);
  assert.equal(entry.stats.bestFloor, 1);
  assert.equal(mod.__debug.setStyle(entry, 'sword'), false);
  assert.equal(mod.__debug.debugEnabled(), false);

  assert.equal(mod.__debug.setDebugEnabled(true), true);
  assert.equal(mod.__debug.debugEnabled(), true);
  assert.equal(JSON.parse(store.get('dsh.pet.debug')), true);
  assert.equal(mod.__debug.setStyle(entry, 'sword'), true);
  assert.equal(entry.style, 'sword');
  assert.equal(entry.battle.build.skills[0].action, 'arcSword');

  assert.equal(mod.__debug.setDebugEnabled(false), true);
  assert.equal(mod.__debug.debugEnabled(), false);
  assert.equal(JSON.parse(store.get('dsh.pet.debug')), false);
  assert.equal(mod.__debug.setStyle(entry, 'trapper'), false);
});

test('开发者模式：新游戏界面的锁定风格按钮变为可选', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('dev-menu-key', 7, { autostart: false });
  mod.__debug.openNewGameMenu(entry, 0);

  const styleButtons = () => collectButtons(mod.__debug.menuPanel(entry, () => {}))
    .filter((node) => String(node.props.className ?? '').includes('dsh-pet-style'))
    .map((node) => ({ label: node.children.join(''), disabled: node.props.disabled === true }));

  const before = styleButtons();
  assert.equal(before.find((row) => row.label === '剑修').disabled, true);
  assert.equal(before.find((row) => row.label === '陷阱师').disabled, true);

  mod.__debug.setDebugEnabled(true);
  const after = styleButtons();
  assert.equal(after.find((row) => row.label === '剑修').disabled, false);
  assert.equal(after.find((row) => row.label === '陷阱师').disabled, false);
});

test('开发者模式：锁定的存档风格在开启后仍能读取', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v5.dev-saved-style',
    JSON.stringify({
      version: 5,
      style: 'sword',
      movement: 'keepDistance',
      build: { version: 3, skills: [{ id: 'skill-1', action: 'arcSword', element: 'fire', modifier: null }], reserve: [] },
      stats: { kills: 2, bestFloor: 1, maxFloorKills: 1, drafts: 0 },
      floor: 1,
      best: 1,
      level: 2,
      xp: 0,
      xpNext: 10,
      pending: 0,
      draftCount: 0,
    }),
  );
  const off = loadModule(store).__debug.createEntry('dev-saved-style', 7, { autostart: false });
  assert.equal(off.style, 'ranged');

  const mod = loadModule(store);
  mod.__debug.setDebugEnabled(true);
  const on = mod.__debug.createEntry('dev-saved-style', 7, { autostart: false });
  assert.equal(on.style, 'sword');
  assert.equal(on.build.skills[0].action, 'arcSword');
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
  assert.ok(Array.isArray(entry.battle.arcSwords));
  assert.ok((entry.battle.stats.casts['skill-1'] ?? 0) > 0, '剑修应发射弧光飞剑');

  entry.build = {
    version: 3,
    skills: [{ id: 'skill-1', action: 'orbitSword', element: null, modifier: null }],
    reserve: [],
  };
  mod.__debug.startFloor(entry, 1);
  for (let i = 0; i < 120; i += 1) mod.__debug.tick(entry, 1 / 60);
  assert.ok(entry.battle.orbitSwords.length > 0, '环身御剑仍可作为可获取动作使用');

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

test('大厅：没有存档时不开战也不写盘，继续游戏不可用', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('lobby-empty', 7, { autostart: false });
  assert.equal(entry.battle, null);
  assert.equal(entry.phase, 'menu');
  assert.equal(store.size, 0, '只是打开面板不应创建存档');
  assert.equal(mod.__debug.latestSlot('lobby-empty'), -1);
  assert.equal(mod.__debug.continueGame(entry), false);
});

test('继续游戏：从最近存档开打，不清空构筑与进度', () => {
  const store = new Map();
  const firstMod = loadModule(store);
  const first = firstMod.__debug.createEntry('lobby-save', 7);
  first.floor = 4;
  first.best = 4;
  first.stats.bestFloor = 4;
  firstMod.__debug.startFloor(first, 4);

  const mod = loadModule(store);
  const second = mod.__debug.createEntry('lobby-save', 7, { autostart: false });
  assert.equal(second.battle, null);
  assert.equal(second.floor, 4);
  assert.equal(mod.__debug.continueGame(second), true);
  assert.equal(second.battle.floor, 4);
  assert.equal(second.phase, 'fight');
});

test('存档槽位：新游戏写进指定槽位，读取后恢复该槽构筑', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('slots-key', 7);
  mod.__debug.awardXp(entry.battle, 8);
  const id = entry.battle.offer[0];
  assert.equal(mod.__debug.pickUpgrade(entry, id), true);
  assert.equal(entry.build.skills[0].element, id);

  entry.stats.bestFloor = 5;
  entry.best = 5;
  assert.equal(mod.__debug.startNewGame(entry, 1, 'sword'), true);
  assert.equal(entry.slot, 1);
  assert.equal(entry.floor, 1);
  assert.equal(entry.battle.floor, 1);
  assert.equal(entry.battle.build.skills[0].action, 'arcSword');
  assert.equal(entry.stats.kills, 0);
  assert.ok(store.has('dsh.pet.v5.slots-key.slot2'), '第二个槽位应写入独立键');

  const restored = mod.__debug.createEntry('slots-key', 7, { autostart: false });
  assert.equal(restored.slot, 1);
  assert.equal(mod.__debug.loadSlot(restored, 0), true);
  assert.equal(restored.slot, 0);
  assert.equal(restored.build.skills[0].element, id);
  assert.equal(restored.battle.build.skills[0].element, id);
});

test('新游戏：只重置本轮，累计战绩与风格解锁保留', () => {
  const { createEntry, startNewGame } = loadModule().__debug;
  const entry = createEntry('new-run-key', 7);
  entry.stats = { kills: 12, bestFloor: 6, maxFloorKills: 3, drafts: 4 };
  entry.best = 6;
  assert.equal(startNewGame(entry, 0, 'trapper'), true);
  assert.equal(entry.floor, 1);
  assert.equal(entry.level, 1);
  assert.equal(entry.pending, 0);
  assert.equal(entry.draftCount, 0);
  assert.equal(entry.style, 'trapper');
  assert.equal(entry.battle.build.skills[0].action, 'trap');
  assert.equal(entry.stats.kills, 12);
  assert.equal(entry.stats.bestFloor, 6);
  assert.ok(entry.notice.includes('新游戏'));
});

test('删除存档：当前槽位被清空，战斗回到大厅', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('delete-key', 7);
  assert.ok(store.has('dsh.pet.v5.delete-key'));
  mod.__debug.openMenu(entry);
  assert.equal(mod.__debug.deleteSave(entry, 0), true);
  assert.equal(store.has('dsh.pet.v5.delete-key'), false);
  assert.equal(entry.battle, null);
  assert.ok(entry.menu !== null, '删除后应留在大厅');
  assert.equal(mod.__debug.listSaveSlots('delete-key')[0].empty, true);
});

test('手动保存：战斗内等级、经验与待选会同步进存档', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('manual-save', 7);
  mod.__debug.awardXp(entry.battle, 30);
  assert.ok(entry.battle.level > 1);
  assert.equal(entry.level, 1, '未结算前账户字段仍是旧的');
  mod.__debug.saveProgress(entry);
  const saved = JSON.parse(store.get('dsh.pet.v5.manual-save'));
  assert.equal(saved.level, entry.battle.level);
  assert.equal(saved.xp, entry.battle.xp);
  assert.equal(saved.pending, entry.battle.pending);
  assert.equal(saved.draftCount, entry.battle.draftCount);
});

test('大厅预读损坏存档不写盘，继续时再备份并修复', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v5.broken-lobby',
    JSON.stringify({
      version: 5,
      style: 'ranged',
      movement: 'keepDistance',
      build: {
        version: 3,
        skills: [{ id: 'skill-1', action: 'projectile', element: 'poison', modifier: null }],
        reserve: [],
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
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('broken-lobby', 7, { autostart: false });
  assert.ok(entry.notice.includes('已移除'));
  assert.equal(store.has('dsh.pet.v5.broken-lobby.bak'), false, '大厅预读不应写备份');
  assert.equal(mod.__debug.continueGame(entry), true);
  assert.ok(store.has('dsh.pet.v5.broken-lobby.bak'), '开始游戏前应备份原存档');
  assert.equal(entry.battle.build.skills[0].element, null);
});

test('删除槽位 1 会连同 v4 源档清理，避免旧档复活', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v4.delete-legacy',
    JSON.stringify({
      version: 4,
      build: { version: 2, skills: [{ id: 'skill-1', action: 'aura', element: 'fire', modifier: null }], reserve: [] },
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
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('delete-legacy', 7);
  assert.ok(store.has('dsh.pet.v5.delete-legacy'));
  mod.__debug.openMenu(entry);
  assert.equal(mod.__debug.deleteSave(entry, 0), true);
  assert.equal(store.has('dsh.pet.v5.delete-legacy'), false);
  assert.equal(store.has('dsh.pet.v4.delete-legacy'), false);
  assert.equal(mod.__debug.listSaveSlots('delete-legacy')[0].empty, true);
});

test('菜单渲染：大厅与新建页面都能生成元素', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('menu-key', 7, { autostart: false });
  mod.__debug.openMenu(entry);
  assert.equal(mod.__debug.menuPanel(entry, () => {}).type, 'div');
  mod.__debug.openNewGameMenu(entry, 1);
  assert.equal(entry.menu.screen, 'new');
  assert.equal(mod.__debug.menuPanel(entry, () => {}).type, 'div');
});
