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
  const { createEntry, advance, currentNode } = loadModule().__debug;
  const entry = createEntry('retry-key', 7);
  const node = currentNode(entry.map);
  assert.ok(node !== null, '开局应有当前节点');
  entry.pending = 0;
  entry.lastResult = { kind: 'dead', floor: node.floor };
  entry.phase = 'result';
  advance(entry);
  assert.equal(entry.floor, node.floor, '失败后停留在同一层');
  assert.equal(entry.battle.floor, node.floor);
  assert.equal(entry.pending, 1, '失败补一次三选一');
  assert.ok(entry.battle.offer !== null);
  assert.equal(entry.map.failures, 1, '失败次数记在地图上');
  assert.equal(entry.battle.attributes.strength, 0);
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
  const dbg = firstMod.__debug;
  const first = dbg.createEntry('lobby-save', 7);
  // 在地图上真正走一步，再重开面板继续
  dbg.completeNode(first.map, dbg.currentNode(first.map).id, { life: 18 });
  const targets = dbg.availableNodes(first.map);
  const target = targets.find((node) => dbg.isBattleNode(node)) ?? targets[0];
  assert.equal(dbg.chooseMapNode(first, target.id), true);
  const floor = first.floor;
  assert.equal(floor, target.floor);

  const mod = loadModule(store);
  const second = mod.__debug.createEntry('lobby-save', 7, { autostart: false });
  assert.equal(second.battle, null);
  assert.equal(second.floor, floor, '大厅读出存档所在层');
  assert.equal(mod.__debug.continueGame(second), true);
  assert.equal(second.floor, floor);
  if (mod.__debug.isBattleNode(target)) {
    assert.equal(second.phase, 'fight');
    assert.equal(second.battle.floor, floor);
  } else {
    assert.equal(second.phase, 'node');
  }
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

function flatText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) flatText(item, out);
    return out;
  }
  for (const child of node.children ?? []) flatText(child, out)
  return out;
}

test('属性点：升级得到点数，分配后写进存档，重进角色仍在', () => {
  const store = new Map();
  const mod = loadModule(store);
  const entry = mod.__debug.createEntry('attr-key', 7);
  assert.equal(entry.battle.player.maxCells, 24);
  assert.equal(entry.battle.attributePoints, 0);

  mod.__debug.awardXp(entry.battle, 8);
  assert.equal(entry.battle.attributePoints, 1);
  assert.equal(mod.__debug.spendAttributePoint(entry, 'vitality'), true);
  assert.equal(entry.battle.player.maxCells, 25);
  assert.equal(entry.battle.player.cells, 25, '最大生命提升时当前生命同步增加');
  assert.equal(entry.battle.attributePoints, 0);
  assert.equal(mod.__debug.spendAttributePoint(entry, 'strength'), false);

  const saved = JSON.parse(store.get('dsh.pet.v5.attr-key'));
  assert.deepEqual(saved.attributes, { strength: 0, agility: 0, intellect: 0, vitality: 1 });
  assert.equal(saved.attributePoints, 0);

  const second = loadModule(store).__debug.createEntry('attr-key', 7);
  assert.equal(second.battle.attributes.vitality, 1);
  assert.equal(second.battle.player.maxCells, 25);
  assert.equal(second.battle.combat.maxLife, 25);
});

test('属性点：阵亡重试保留，通关新层保留，新游戏重置', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('attr-run', 7);
  mod.__debug.awardXp(entry.battle, 8);
  assert.equal(mod.__debug.spendAttributePoint(entry, 'strength'), true);
  assert.equal(entry.battle.combat.armor, 2);

  entry.pending = 0;
  entry.lastResult = { kind: 'dead', floor: 1 };
  entry.phase = 'result';
  mod.__debug.advance(entry);
  assert.equal(entry.battle.attributes.strength, 1, '阵亡重试保留本轮已分配的属性点');

  assert.equal(mod.__debug.startNewGame(entry, 0, 'ranged'), true);
  assert.equal(entry.battle.attributes.strength, 0, '新游戏重置本轮成长');
  assert.equal(entry.battle.attributePoints, 0);
  assert.equal(entry.battle.player.maxCells, 24);
});

test('构筑栏：默认折叠成一行，点标题展开技能详情与备用栏', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('build-ui', 7);
  assert.equal(entry.buildOpen, false, '普通状态默认折叠');

  const collapsed = mod.__debug.buildPanel(entry, () => {});
  const collapsedText = flatText(collapsed).join('|');
  assert.ok(collapsedText.includes('构筑'), collapsedText);
  assert.ok(collapsedText.includes('1/2 技能'), collapsedText);
  assert.ok(!collapsedText.includes('飞弹'), '折叠时不展示技能详情');

  collapsed.children[0].props.onClick();
  assert.equal(entry.buildOpen, true, '点击标题展开');
  const expanded = mod.__debug.buildPanel(entry, () => {});
  const text = flatText(expanded).join('|');
  assert.ok(text.includes('飞弹'), text);
  assert.ok(text.includes('动作 · 飞弹'), text);
  assert.ok(text.includes('备用'), text);
  assert.equal(mod.__debug.toggleBuild(entry), false, '再点一次收起');
});

test('战场面板：不再显示风格栏与移动栏', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('status-ui', 7);
  const text = flatText(mod.__debug.statusPanel(entry, () => {})).join('|');
  assert.ok(text.includes('属性'), text);
  assert.ok(text.includes('构筑'), text);
  assert.ok(text.includes('生命 24/24'), text);
  assert.ok(!text.includes('风格'), text);
  assert.ok(!text.includes('移动'), text);
});

test('属性栏：默认折叠只占一行，点击后展开四项属性与投入预览', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('attr-ui', 7);
  mod.__debug.awardXp(entry.battle, 8);

  assert.equal(entry.attributesOpen, false, '普通状态默认折叠');
  const collapsedText = flatText(mod.__debug.attributePanel(entry, () => {})).join('|');
  assert.ok(collapsedText.includes('属性'), collapsedText);
  assert.ok(collapsedText.includes('可用 1 点'), collapsedText);
  assert.ok(collapsedText.includes('护甲 0'), collapsedText);
  assert.ok(!collapsedText.includes('体魄'), '折叠时不展示四项属性');

  assert.equal(mod.__debug.toggleAttributes(entry), true);
  assert.equal(entry.attributesOpen, true);
  const panel = mod.__debug.attributePanel(entry, () => {});
  const text = flatText(panel).join('|');
  for (const label of ['力量', '敏捷', '智力', '体魄']) {
    assert.ok(text.includes(label), label + ' missing');
  }
  assert.ok(text.includes('可用 1 点'), text);
  assert.ok(text.includes('护甲 0 → 2'), text);
  assert.ok(text.includes('生命 24 → 25'), text);
  assert.ok(text.includes('暴击 5% ×1.5'), text);
  assert.equal(collectButtons(panel).length, 5, '折叠标题 + 四个加点按钮');

  mod.__debug.spendAttributePoint(entry, 'strength');
  const after = flatText(mod.__debug.attributePanel(entry, () => {})).join('|');
  assert.ok(after.includes('没有可用属性点'), after);
  assert.ok(after.includes('护甲 2 → 4'), after);
  assert.equal(entry.attributesOpen, true, '加点后保持展开');
});

// ---- 地图接入 ----

function mapChipButtons(node) {
  return collectButtons(node).filter((button) => String(button.props.className ?? '').startsWith('dsh-pet-node'))
}

test('地图：面板默认折叠，展开后按层列出节点，可点击查看说明', () => {
  const mod = loadModule();
  const entry = mod.__debug.createEntry('map-ui', 7);
  assert.equal(entry.mapOpen, false);
  const collapsed = flatText(mod.__debug.mapPanel(entry, () => {})).join('|');
  assert.ok(collapsed.includes('地图'), collapsed);
  assert.ok(collapsed.includes('1/99'), collapsed);
  assert.ok(collapsed.includes('当前'), collapsed);
  assert.ok(!collapsed.includes('查看完整地图'), '折叠时不展开楼层列表');

  entry.mapOpen = true;
  const panel = mod.__debug.mapPanel(entry, () => {});
  const text = flatText(panel).join('|');
  for (const label of ['自动', '手动', '稳健', '均衡', '冒险', '种子']) {
    assert.ok(text.includes(label), label + ' 缺失');
  }
  const chips = mapChipButtons(panel);
  assert.ok(chips.length >= 5, '应列出当前层与后续几层的节点');
  assert.ok(chips.some((chip) => String(chip.props.className).includes('cur')), '当前节点应高亮');

  // 未到达的节点点击后显示类型说明，而不是直接进入
  const dim = chips.find((chip) => String(chip.props.className).includes('dim'));
  assert.ok(dim !== undefined);
  dim.props.onClick();
  assert.ok(entry.mapInspect !== null, '点击节点应展示说明');
  const detail = flatText(mod.__debug.mapPanel(entry, () => {})).join('|');
  assert.ok(detail.includes('层'), detail);
});

test('地图：完成当前节点后出现下一站按钮，点击进入下一层', () => {
  const mod = loadModule();
  const d = mod.__debug;
  const entry = d.createEntry('map-step', 7);
  const node = d.currentNode(entry.map);
  d.completeNode(entry.map, node.id, { life: 20 });
  entry.battle = null;
  entry.phase = 'map';
  const row = d.mapChoicesRow(entry, () => {});
  const buttons = collectButtons(row).filter((button) => button.props.className === 'dsh-pet-choice');
  assert.ok(buttons.length >= 1, '分叉时应显示下一站');
  buttons[0].props.onClick();
  assert.notEqual(entry.map.currentNodeId, node.id);
  assert.ok(entry.map.visited.length >= 2);
  assert.ok(entry.floor >= 2);
  assert.ok(d.nodeStatus(entry.map, node.id) === 'done');
});

test('地图：自动路线能连续跨过战斗与非战斗节点', () => {
  const mod = loadModule();
  const d = mod.__debug;
  const entry = d.createEntry('map-auto', 7);
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const node = d.currentNode(entry.map);
    if (node === null) break;
    if (d.isBattleNode(node)) {
      d.completeNode(entry.map, node.id, { life: entry.map.lifeMax });
      d.applyMapEffects(entry, []);
      entry.battle = null;
      d.advanceMap(entry);
    } else {
      entry.phase = 'node';
      d.autoResolveNode(entry);
    }
    if (entry.phase === 'result') break;
  }
  assert.ok(entry.map.visited.length > 20, '自动路线应连续推进：' + entry.map.visited.length);
  assert.ok(entry.map.gold > 0, '经过节点应积累金币');
  assert.ok(entry.map.failures === 0);
  assert.ok(entry.map.life >= 1);
});

test('地图：手动路线在分叉处停下，等待玩家选择', () => {
  const mod = loadModule();
  const d = mod.__debug;
  const entry = d.createEntry('map-manual', 7);
  d.setMapAutoMode(entry, 'manual');
  const node = d.currentNode(entry.map);
  d.completeNode(entry.map, node.id, { life: 20 });
  entry.battle = null;
  d.advanceMap(entry);
  assert.equal(entry.phase, 'map');
  assert.ok(entry.mapNotice.includes('手动'), entry.mapNotice);
  const choices = collectButtons(d.mapChoicesRow(entry, () => {}))
    .filter((button) => button.props.className === 'dsh-pet-choice');
  assert.ok(choices.length >= 1);
});

test('地图：休息 / 事件 / 商店面板能生成选项并结算', () => {
  const mod = loadModule();
  const d = mod.__debug;
  const setup = (type) => {
    const entry = d.createEntry('map-node-' + type, 7);
    let guard = 0;
    while (guard < 60) {
      guard += 1;
      const node = d.currentNode(entry.map);
      if (node === null) break;
      if (node.type === type) {
        entry.phase = 'node';
        return entry;
      }
      if (d.isBattleNode(node)) {
        d.completeNode(entry.map, node.id, { life: entry.map.lifeMax });
        entry.battle = null;
        d.advanceMap(entry);
      } else {
        entry.phase = 'node';
        d.autoResolveNode(entry);
      }
    }
    return entry;
  };

  const rest = setup('rest');
  const restPanel = d.nodePanel(rest, () => {});
  assert.equal(restPanel.type, 'div');
  const restText = flatText(restPanel).join('|');
  assert.ok(restText.includes('休息点'), restText);
  assert.ok(restText.includes('恢复'), restText);
  // 满血时治疗置灰，但可以选强化或离开
  const restButtons = collectButtons(restPanel).filter((button) =>
    String(button.props.className).includes('dsh-pet-node-option'));
  assert.ok(restButtons.length >= 2);
  assert.equal(d.restChoice(rest, 'upgrade'), true);
  assert.ok(rest.pending >= 1, '强化应给一次三选一');

  const shop = setup('shop');
  const shopPanel = d.nodePanel(shop, () => {});
  const shopText = flatText(shopPanel).join('|');
  assert.ok(shopText.includes('商店') || shopText.includes('金币'), shopText);
  const items = collectButtons(shopPanel).filter((button) =>
    String(button.props.className).includes('dsh-pet-node-option'));
  assert.ok(items.length >= 2, '商店应有商品与离开按钮');

  const event = setup('event');
  const eventPanel = d.nodePanel(event, () => {});
  const eventText = flatText(eventPanel).join('|');
  assert.ok(eventText.includes('代价'), eventText);
});

test('存档：地图进度写进 v7，重新载入得到同一张地图', () => {
  const store = new Map();
  const mod = loadModule(store);
  const d = mod.__debug;
  const entry = d.createEntry('map-persist', 7);
  d.completeNode(entry.map, d.currentNode(entry.map).id, { life: 19 });
  d.advanceMap(entry);
  const saved = JSON.parse(store.get('dsh.pet.v5.map-persist'));
  assert.equal(saved.version, 7);
  assert.equal(saved.map.depth, 99);
  assert.ok(Array.isArray(saved.map.nodes) && saved.map.nodes.length > 300);
  assert.equal(saved.map.currentNodeId, entry.map.currentNodeId);

  const second = loadModule(store).__debug.createEntry('map-persist', 7, { autostart: false });
  assert.equal(second.map.seed, entry.map.seed);
  assert.equal(second.map.currentNodeId, entry.map.currentNodeId);
  assert.equal(second.map.gold, entry.map.gold);
  assert.deepEqual([...second.map.visited], [...entry.map.visited]);
  assert.equal(second.floor, entry.floor);
});

test('迁移：没有地图字段的旧存档按存档层数补生成地图', () => {
  const store = new Map();
  store.set(
    'dsh.pet.v5.old-map-key',
    JSON.stringify({
      version: 5,
      style: 'ranged',
      movement: 'keepDistance',
      build: { version: 3, skills: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }], reserve: [] },
      stats: { kills: 3, bestFloor: 12, maxFloorKills: 2, drafts: 1 },
      floor: 12,
      best: 12,
      level: 6,
      xp: 1,
      xpNext: 18,
      pending: 0,
      draftCount: 1,
    }),
  );
  const entry = loadModule(store).__debug.createEntry('old-map-key', 7);
  assert.ok(entry.map !== null, '旧存档应补出一张地图');
  assert.equal(entry.floor, 12);
  assert.ok(String(entry.map.currentNodeId).startsWith('12-'), entry.map.currentNodeId);
  // 该层节点可能是战斗，也可能是休息 / 事件 / 商店：两种入口都要接住
  if (entry.battle === null) {
    assert.equal(entry.phase, 'node');
  } else {
    assert.equal(entry.battle.floor, 12);
  }
});

test('地图：连续失败 3 次后暂停自动重试，手动点「重试当前节点」恢复', () => {
  const mod = loadModule();
  const d = mod.__debug;
  const entry = d.createEntry('retry-hold', 7);
  const node = d.currentNode(entry.map);
  for (let i = 0; i < 3; i += 1) {
    entry.lastResult = { kind: 'dead', floor: node.floor };
    entry.phase = 'result';
    d.advance(entry);
  }
  assert.equal(entry.retryHold, true, '连续失败应暂停自动重试');
  assert.equal(entry.phase, 'map');
  assert.equal(entry.battle, null);
  assert.ok(entry.mapNotice.includes('连续失败'), entry.mapNotice);
  assert.equal(entry.map.failures, 3);

  // 暂停期间 tick 不会偷偷重开
  for (let i = 0; i < 200; i += 1) d.tick(entry, 1 / 60);
  assert.equal(entry.battle, null, '暂停期间不应自动重开战斗');
  assert.equal(entry.phase, 'map');

  const row = d.mapChoicesRow(entry, () => {});
  const retry = collectButtons(row).find((button) =>
    String(button.props.className).includes('dsh-pet-choice'));
  assert.ok(retry !== undefined, '应有重试按钮');
  retry.props.onClick();
  assert.equal(entry.retryHold, false);
  assert.equal(entry.phase, 'fight');
  assert.equal(entry.battle.floor, node.floor);
  assert.ok(entry.battle.offer !== null, '失败后补的三选一仍在');
});

