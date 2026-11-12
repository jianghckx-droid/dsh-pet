// 地图系统单测：确定性、结构、逐路线保底、存档、进度与自动路线。
//
// 保底验证既走实现在里的全量状态传播，也走独立的随机路线抽样，
// 避免"生成器和验证器共用同一个 bug"时测试一起变绿。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_CONFIG,
  MAP_VERSION,
  mapConfig,
  prototypeConfig,
  snapshotMapConfig,
  NODE_TYPES,
} from '../src/game/map/config.js';
import { hashSeed, createRng } from '../src/game/map/rng.js';
import { generateMap, buildTemplateNodes } from '../src/game/map/generate.js';
import { validateMap, routeStates, countRoutes } from '../src/game/map/validate.js';
import { fillNodeContent, nodeBattlePlan } from '../src/game/map/content.js';
import {
  availableNodeIds,
  availableNodes,
  beginNode,
  buyShopItem,
  completeNode,
  createMapRun,
  currentNode,
  eventView,
  leaveNode,
  leaveShop,
  mapRunSummary,
  nodeStatus,
  pickNextNode,
  resolveEvent,
  resolveRest,
  restOptions,
  restoreMapRun,
  retryNode,
  serializeMapRun,
  setAutoMode,
  shopView,
} from '../src/game/map/run.js';
import { createBattle } from '../src/game/arena.js';
import { deepFloorPlan } from '../src/game/floors.js';

const BUILD = {
  version: 3,
  skills: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
  reserve: [],
};

function mapOf(seed, config) {
  return generateMap({ seed, config });
}

function floorsOf(nodes) {
  const rows = new Map();
  for (const node of nodes) {
    if (!rows.has(node.floor)) rows.set(node.floor, []);
    rows.get(node.floor).push(node);
  }
  for (const row of rows.values()) row.sort((a, b) => a.column - b.column);
  return rows;
}

/** 独立抽样：随机走若干条完整路线，检查休息 / 商店间隔与精英连续。 */
function sampleRoutes(nodes, config, count = 300, seed = 1) {
  const rng = createRng(hashSeed(seed, 'route-sample'));
  const rows = floorsOf(nodes);
  const start = rows.get(1)[0];
  const problems = [];
  for (let n = 0; n < count; n += 1) {
    let node = start;
    let restGap = 0;
    let shopGap = 0;
    let prevElite = false;
    const path = [];
    while (node !== undefined) {
      path.push(node);
      restGap = node.type === 'rest' ? 0 : restGap + 1;
      shopGap = node.type === 'shop' ? 0 : shopGap + 1;
      const elite = node.type === 'elite';
      if (restGap >= config.guards.restGap) problems.push({ kind: 'rest-gap', nodeId: node.id });
      if (shopGap >= config.guards.shopGap) problems.push({ kind: 'shop-gap', nodeId: node.id });
      if (prevElite && elite) problems.push({ kind: 'elite-chain', nodeId: node.id });
      if (elite && node.floor < config.guards.eliteFrom) problems.push({ kind: 'elite-early', nodeId: node.id });
      prevElite = elite;
      if (node.next.length === 0) break;
      const nextId = node.next[Math.min(node.next.length - 1, Math.floor(rng() * node.next.length))];
      const row = rows.get(node.floor + 1) ?? [];
      node = row.find((entry) => entry.id === nextId);
    }
    if (path[path.length - 1].type !== 'boss') problems.push({ kind: 'no-boss', nodeId: path[path.length - 1].id });
  }
  return problems;
}

/** 手工构造三层小地图，用来精确测试节点行为与自动路线。 */
function tinyRun({ types = ['normal', 'rest', 'elite'], autoMode = 'balanced', life = 24, lifeMax = 24, gold = 0 } = {}) {
  const nodes = [
    {
      id: '1-0',
      floor: 1,
      column: 0,
      type: 'normal',
      next: types.map((_, index) => `2-${index}`),
      content: {},
    },
    ...types.map((type, index) => ({
      id: `2-${index}`,
      floor: 2,
      column: index,
      type,
      next: ['3-0'],
      content: {},
    })),
    { id: '3-0', floor: 3, column: 0, type: 'boss', next: [], content: {} },
  ];
  fillNodeContent(nodes, 4242, MAP_CONFIG);
  return {
    mapVersion: MAP_VERSION,
    seed: 4242,
    depth: 3,
    config: snapshotMapConfig(MAP_CONFIG),
    nodes,
    startId: '1-0',
    bossId: '3-0',
    currentNodeId: '1-0',
    visited: ['1-0'],
    nodeStates: { '1-0': { status: 'done' } },
    gold,
    life,
    lifeMax,
    autoMode,
    failures: 0,
    finished: false,
    notice: '',
    generation: { attempts: 1, fallback: false, valid: true },
  };
}

test('确定性：同种子同配置得到完全一致的地图，不同种子不同', () => {
  const a = mapOf(482719);
  const b = mapOf(482719);
  assert.equal(JSON.stringify(a.nodes), JSON.stringify(b.nodes));
  assert.equal(a.startId, b.startId);
  assert.equal(a.bossId, b.bossId);

  const c = mapOf(482720);
  assert.notEqual(JSON.stringify(a.nodes), JSON.stringify(c.nodes));
});

test('结构：99 层、固定层、只连下一层、无死路', () => {
  const map = mapOf(7);
  const rows = floorsOf(map.nodes);
  assert.equal(map.depth, 99);
  assert.equal(rows.get(1).length, 1);
  assert.equal(rows.get(1)[0].type, 'normal');
  assert.equal(rows.get(98).length, 1);
  assert.equal(rows.get(98)[0].type, 'rest');
  assert.equal(rows.get(99).length, 1);
  assert.equal(rows.get(99)[0].type, 'boss');

  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  for (let floor = 2; floor <= 97; floor += 1) {
    const row = rows.get(floor);
    assert.ok(row.length >= 3 && row.length <= 5, `第 ${floor} 层宽度 ${row.length}`);
    for (const node of row) {
      assert.ok(node.next.length >= 1, `${node.id} 没有出边`);
      for (const nextId of node.next) {
        const target = byId.get(nextId);
        assert.ok(target !== undefined, `${node.id} 指向不存在的 ${nextId}`);
        assert.equal(target.floor, node.floor + 1);
      }
    }
    const incoming = map.nodes.filter((node) => node.floor === floor - 1 && node.next.some((id) => byId.get(id).floor === floor));
    assert.ok(incoming.length > 0, `第 ${floor} 层没有入边`);
  }
  assert.equal(validateMap(map.nodes, mapConfig(map.config)).ok, true);
});

test('可达性：每个节点都能从起点到达并通向 Boss', () => {
  const map = mapOf(12345);
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const start = map.startId;
  const forward = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop();
    if (forward.has(id)) continue;
    forward.add(id);
    for (const nextId of byId.get(id).next) stack.push(nextId);
  }
  assert.equal(forward.size, map.nodes.length, '存在无法从起点到达的节点');

  const parents = new Map();
  for (const node of map.nodes) {
    for (const nextId of node.next) {
      const list = parents.get(nextId) ?? [];
      list.push(node.id);
      parents.set(nextId, list);
    }
  }
  const backward = new Set();
  const back = [map.bossId];
  while (back.length > 0) {
    const id = back.pop();
    if (backward.has(id)) continue;
    backward.add(id);
    for (const prevId of parents.get(id) ?? []) back.push(prevId);
  }
  assert.equal(backward.size, map.nodes.length, '存在无法通往 Boss 的节点');
});

test('保底：每条有效路线都有休息点、商店且不连续经过精英', () => {
  for (const seed of [1, 2, 3, 11, 482719]) {
    const map = mapOf(seed);
    const config = mapConfig(map.config);
    const state = routeStates(map.nodes, config);
    assert.deepEqual(state.violations, [], `种子 ${seed} 存在逐路线违规`);
    assert.deepEqual(sampleRoutes(map.nodes, config, 200), [], `种子 ${seed} 抽样路线违规`);
  }
});

test('保底：前 3 层无精英、同层不全精英、精英不连续', () => {
  const map = mapOf(99);
  const rows = floorsOf(map.nodes);
  for (let floor = 1; floor <= 3; floor += 1) {
    assert.ok(rows.get(floor).every((node) => node.type !== 'elite'), `第 ${floor} 层出现精英`);
  }
  for (const [floor, row] of rows) {
    if (row.length === 0) continue;
    assert.ok(row.some((node) => node.type !== 'elite'), `第 ${floor} 层全是精英`);
  }
  for (const node of map.nodes) {
    for (const nextId of node.next) {
      const target = map.nodes.find((entry) => entry.id === nextId);
      assert.ok(!(node.type === 'elite' && target.type === 'elite'), `${node.id}→${nextId} 连续精英`);
    }
  }
});

test('验证器能抓住人为破坏的地图', () => {
  const config = mapConfig({ depth: 99 });
  const map = mapOf(2026);
  const nodes = map.nodes.map((node) => ({ ...node, next: [...node.next], content: { ...node.content } }));
  // 1) 把一段 13 层里的休息节点全部改成普通：经过这段的路线必然超过 12 层没有休息点
  const restRows = [...floorsOf(nodes).entries()].filter(([, row]) => row.some((node) => node.type === 'rest'));
  assert.ok(restRows.length > 2, '示例地图应有休息层');
  const start = restRows[1][0];
  for (const node of nodes) {
    if (node.floor >= start && node.floor <= start + 12 && node.type === 'rest') node.type = 'normal';
  }
  const restBroken = validateMap(nodes, config);
  assert.equal(restBroken.ok, false);
  assert.ok(restBroken.errors.some((error) => error.code === 'route-rest-gap'));

  // 2) 相邻两层都变精英：连续精英应被拒绝
  const map2 = mapOf(2026);
  const nodes2 = map2.nodes.map((node) => ({ ...node, next: [...node.next], content: { ...node.content } }));
  const rows2 = floorsOf(nodes2);
  const target = rows2.get(20)[0];
  const nextNode = nodes2.find((node) => node.id === target.next[0]);
  target.type = 'elite';
  nextNode.type = 'elite';
  const eliteBroken = validateMap(nodes2, config);
  assert.equal(eliteBroken.ok, false);
  assert.ok(eliteBroken.errors.some((error) => error.code === 'route-elite-chain'));
});

test('批量生成：100 个种子全部有效，耗时在预算内', () => {
  const started = Date.now();
  let fallbacks = 0;
  let maxAttempts = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const map = mapOf(seed * 37);
    assert.equal(map.valid, true, `种子 ${seed} 生成失败`);
    assert.ok(map.nodes.length > 300);
    const config = mapConfig(map.config);
    assert.deepEqual(routeStates(map.nodes, config).violations, []);
    if (map.fallback) fallbacks += 1;
    maxAttempts = Math.max(maxAttempts, map.attempts);
  }
  const elapsed = Date.now() - started;
  assert.ok(fallbacks <= 2, `保底模板使用过多：${fallbacks}/100`);
  assert.ok(maxAttempts <= 5, `重试次数过多：${maxAttempts}`);
  assert.ok(elapsed < 6000, `生成 100 张地图耗时 ${elapsed}ms`);
});

test('保底模板：无法满足约束时退化为确定性模板且仍然验证', () => {
  // 锚点间距 40 层远大于 12 层的休息保底，一次尝试 + 一次修正不可能通过
  const config = mapConfig({
    depth: 60,
    attempts: 1,
    repairPasses: 1,
    anchors: { restSpacing: { min: 40, max: 40 }, shopSpacing: { min: 45, max: 45 }, minSeparation: 1 },
  });
  const map = generateMap({ seed: 5, config });
  assert.equal(map.fallback, true);
  assert.equal(map.valid, true, JSON.stringify(map.errors.slice(0, 3)));
  const again = generateMap({ seed: 5, config });
  assert.equal(JSON.stringify(map.nodes), JSON.stringify(again.nodes));
});

test('极端配置：无法满足时返回可诊断错误，不无限重试', () => {
  // 休息与商店间隔同为 2 层时，第 2 层必须同时是休息与商店，约束不可能同时成立
  const config = mapConfig({ depth: 40, attempts: 2, guards: { restGap: 2, shopGap: 2 } });
  const started = Date.now();
  const map = generateMap({ seed: 3, config });
  assert.equal(map.fallback, true);
  assert.equal(map.valid, false);
  assert.ok(map.errors.length > 0, '失败时应给出可诊断的错误');
  assert.ok(Date.now() - started < 3000, '生成失败必须很快返回');
});

test('原型配置：11 层，含普通 / 精英 / 休息 / 事件 / 商店与测试 Boss', () => {
  const config = prototypeConfig();
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5]) {
    const map = generateMap({ seed, config });
    assert.equal(map.depth, 11);
    assert.equal(map.valid, true);
    const rows = floorsOf(map.nodes);
    assert.equal(rows.get(1)[0].type, 'normal');
    assert.equal(rows.get(10)[0].type, 'rest');
    assert.equal(rows.get(11)[0].type, 'boss');
    for (const node of map.nodes) seen.add(node.type);
    assert.deepEqual(routeStates(map.nodes, config).violations, []);
  }
  for (const id of ['normal', 'elite', 'rest', 'event', 'shop', 'boss']) {
    assert.ok(seen.has(id), `原型地图缺少 ${id}`);
  }
});

test('内容：节点内容由主种子与节点 ID 派生，改路线不影响其他节点', () => {
  const first = createMapRun({ seed: 777, lifeMax: 24 });
  const snapshot = JSON.stringify(first.nodes.map((node) => [node.id, node.content]));

  completeNode(first, '1-0', { life: 20 });
  const options = availableNodeIds(first).slice();
  assert.ok(options.length > 0);
  const pick = availableNodeIds(first)[0];
  beginNode(first, pick);
  // 走到分叉后，未进入的节点内容必须保持不变
  const after = JSON.stringify(first.nodes.map((node) => [node.id, node.content]));
  assert.equal(after, snapshot);

  const second = createMapRun({ seed: 777, lifeMax: 24 });
  assert.equal(JSON.stringify(second.nodes.map((node) => [node.id, node.content])), snapshot);
});

test('进度：只能沿连线前进，完成才发奖，重试不重复发奖', () => {
  const run = tinyRun();
  assert.deepEqual(availableNodeIds(run).sort(), ['2-0', '2-1', '2-2']);
  assert.equal(beginNode(run, '3-0'), null, '不能跳层');
  const node = beginNode(run, '2-2');
  assert.equal(node.id, '2-2');
  assert.equal(nodeStatus(run, '2-2'), 'active');
  assert.deepEqual(availableNodeIds(run), [], '当前节点未结算时不能选下一站');

  const before = run.gold;
  const reward = completeNode(run, '2-2', { life: 17 });
  assert.equal(run.gold, before + reward.gold);
  assert.ok(reward.gold > 0);
  assert.equal(run.life, 17);
  const repeat = completeNode(run, '2-2', { life: 17 });
  assert.equal(repeat.alreadyDone, true);
  assert.equal(repeat.gold, 0);
  assert.equal(run.gold, before + reward.gold, '重复结算不应再发金币');

  // 失败重试：同一节点、只累计失败次数、生命回满
  const retryRun = tinyRun();
  beginNode(retryRun, '2-0');
  retryNode(retryRun, '2-0');
  assert.equal(retryRun.failures, 1);
  assert.equal(retryRun.life, retryRun.lifeMax);
  assert.equal(nodeStatus(retryRun, '2-0'), 'active');
  assert.equal(retryRun.gold, 0);
});

test('休息点：回血与强化二选一，满血时治疗不可用但仍能离开', () => {
  const run = tinyRun({ types: ['rest'], life: 10, lifeMax: 24 });
  beginNode(run, '2-0');
  const options = restOptions(run);
  assert.equal(options.find((entry) => entry.id === 'heal').available, true);
  const resolved = resolveRest(run, '2-0', 'heal');
  assert.equal(resolved.ok, true);
  assert.equal(run.life, 10 + Math.round(24 * 0.3));
  assert.equal(nodeStatus(run, '2-0'), 'done');

  const full = tinyRun({ types: ['rest'], life: 24, lifeMax: 24 });
  beginNode(full, '2-0');
  assert.equal(restOptions(full).find((entry) => entry.id === 'heal').available, false);
  assert.equal(resolveRest(full, '2-0', 'heal').ok, false);
  assert.equal(resolveRest(full, '2-0', 'leave').ok, true);
  assert.equal(full.life, 24);
});

test('事件：代价不足时不可选，选择后扣除代价并结算效果', () => {
  const run = tinyRun({ types: ['event'], gold: 0, life: 24, lifeMax: 24 });
  beginNode(run, '2-0');
  const view = eventView(run, '2-0');
  assert.ok(view !== null);
  assert.ok(view.options.length >= 2);
  const free = view.options.find((option) => option.costText === '无代价' && option.resultText !== '没有变化');
  const paid = view.options.find((option) => option.costText !== '无代价');
  if (paid !== undefined) assert.equal(paid.available, false, '金币不足时付费选项应置灰');
  assert.equal(resolveEvent(run, '2-0', paid?.id ?? 'nope').ok, false);
  if (free !== undefined) {
    const result = resolveEvent(run, '2-0', free.id);
    assert.equal(result.ok, true);
    assert.equal(nodeStatus(run, '2-0'), 'done');
    assert.ok(run.life >= 1 && run.life <= run.lifeMax);
    assert.ok(run.gold >= 0);
  }
  assert.equal(run.life >= 1, true, '事件不应直接把玩家扣死');
});

test('商店：金币不足不能买，购买后扣钱且同件不可重复购买', () => {
  const run = tinyRun({ types: ['shop'], gold: 500, life: 10, lifeMax: 24 });
  beginNode(run, '2-0');
  const view = shopView(run, '2-0');
  assert.ok(view.items.length >= 1);
  const item = view.items[0];
  assert.equal(item.price > 0, true);
  const goldBefore = run.gold;
  const bought = buyShopItem(run, '2-0', item.index);
  assert.equal(bought.ok, true);
  assert.equal(run.gold, goldBefore - item.price);
  assert.equal(buyShopItem(run, '2-0', item.index).ok, false, '同件商品不能重复购买');
  assert.equal(nodeStatus(run, '2-0'), 'active', '看商店时不应自动离开');
  assert.equal(leaveShop(run, '2-0'), true);
  assert.equal(nodeStatus(run, '2-0'), 'done');

  const poor = tinyRun({ types: ['shop'], gold: 0 });
  beginNode(poor, '2-0');
  const poorView = shopView(poor, '2-0');
  assert.equal(poorView.items.every((entry) => entry.available === false), true);
  assert.equal(buyShopItem(poor, '2-0', 0).reason, 'no-gold');
  assert.equal(poor.gold, 0);
});

test('自动路线：手动模式停下，稳健避开精英，冒险优先精英', () => {
  const manual = tinyRun({ types: ['normal', 'rest', 'elite'], autoMode: 'manual' });
  const manualPick = pickNextNode(manual);
  assert.equal(manualPick.paused, true);
  assert.equal(manualPick.nodeId, null);

  const steady = tinyRun({ types: ['normal', 'rest', 'elite'], autoMode: 'steady', life: 8, lifeMax: 24 });
  const steadyPick = pickNextNode(steady);
  assert.equal(steadyPick.paused, false);
  const steadyNode = steady.nodes.find((node) => node.id === steadyPick.nodeId);
  assert.equal(steadyNode.type, 'rest');

  const risky = tinyRun({ types: ['normal', 'rest', 'elite'], autoMode: 'risky', life: 24, lifeMax: 24 });
  const riskyPick = pickNextNode(risky);
  const riskyNode = risky.nodes.find((node) => node.id === riskyPick.nodeId);
  assert.equal(riskyNode.type, 'elite');

  const balanced = tinyRun({ types: ['normal', 'event', 'elite'], autoMode: 'balanced', life: 24, lifeMax: 24 });
  const balancedPick = pickNextNode(balanced);
  assert.equal(balancedPick.paused, false);
  assert.ok(balancedPick.scores.length === 3);
});

test('自动路线：低生命且没有休息点时暂停并给出原因', () => {
  const run = tinyRun({ types: ['normal', 'event', 'elite'], autoMode: 'steady', life: 3, lifeMax: 24 });
  const pick = pickNextNode(run);
  assert.equal(pick.paused, true);
  assert.equal(pick.nodeId, null);
  assert.equal(pick.reason, 'low-life-no-rest');

  const allElite = tinyRun({ types: ['elite', 'elite'], autoMode: 'balanced', life: 6, lifeMax: 24 });
  const second = pickNextNode(allElite);
  assert.equal(second.paused, true);
  assert.equal(second.reason, 'all-elite-low-life');
});

test('自动路线：至少看未来 3 层，状态差时避开通往精英的路线', () => {
  const run = tinyRun({ types: ['normal', 'event'], autoMode: 'balanced', life: 9, lifeMax: 24 });
  // 把 2-0 后面接两个精英，2-1 后面接作息，验证前瞻会影响选择
  const restNode = { id: '3-rest', floor: 3, column: 0, type: 'rest', next: [], content: {} };
  const eliteA = { id: '3-eliteA', floor: 3, column: 1, type: 'elite', next: [], content: {} };
  const eliteB = { id: '3-eliteB', floor: 3, column: 2, type: 'elite', next: [], content: {} };
  run.nodes.push(restNode, eliteA, eliteB);
  run.nodes.find((node) => node.id === '2-0').next = ['3-eliteA', '3-eliteB'];
  run.nodes.find((node) => node.id === '2-1').next = ['3-rest'];
  run.nodes.find((node) => node.id === '3-0').type = 'rest';
  fillNodeContent(run.nodes.slice(-3), 99, MAP_CONFIG);
  const pick = pickNextNode(run);
  assert.equal(pick.nodeId, '2-1', '应选通往休息点的一侧');
});

test('存档：地图、进度、事件与商店状态往返一致', () => {
  const run = createMapRun({ seed: 31337, lifeMax: 26 });
  completeNode(run, '1-0', { life: 21 });
  const nextId = availableNodeIds(run)[0];
  beginNode(run, nextId);
  const node = currentNode(run);
  let state = { life: 21 };
  if (node.type === 'event') {
    const view = eventView(run, node.id);
    const pick = view.options.find((option) => option.available) ?? view.options[view.options.length - 1];
    resolveEvent(run, node.id, pick.id);
  } else if (node.type === 'rest') {
    resolveRest(run, node.id, 'upgrade');
  } else if (node.type === 'shop') {
    const view = shopView(run, node.id);
    if (view.items[0].available) buyShopItem(run, node.id, view.items[0].index);
    leaveShop(run, node.id);
  } else {
    completeNode(run, node.id, { life: 12 });
  }
  const raw = JSON.parse(JSON.stringify(serializeMapRun(run)));
  const restored = restoreMapRun(raw);
  assert.ok(restored !== null);
  assert.equal(JSON.stringify(serializeMapRun(restored)), JSON.stringify(raw));
  assert.equal(restored.gold, run.gold);
  assert.equal(restored.life, run.life);
  assert.equal(restored.currentNodeId, run.currentNodeId);
  assert.deepEqual(availableNodeIds(restored).sort(), availableNodeIds(run).sort());

  // 版本或结构不符时拒绝读档，交给上层重新生成
  assert.equal(restoreMapRun({ ...raw, mapVersion: 999 }), null);
  assert.equal(restoreMapRun({ ...raw, nodes: [] }), null);
  assert.equal(restoreMapRun(null), null);
});

test('存档：同种子重新启动得到同一张地图', () => {
  const first = createMapRun({ seed: 555, lifeMax: 24 });
  const raw = JSON.parse(JSON.stringify(serializeMapRun(first)));
  const restored = restoreMapRun(raw);
  assert.equal(JSON.stringify(restored.nodes), JSON.stringify(first.nodes));
  const again = createMapRun({ seed: 555, lifeMax: 24 });
  assert.equal(JSON.stringify(again.nodes), JSON.stringify(first.nodes));
});

test('战斗接入：节点战斗构成、Boss 修饰与跨节点生命', () => {
  const map = mapOf(2027);
  const boss = map.nodes.find((node) => node.type === 'boss');
  const elite = map.nodes.find((node) => node.type === 'elite');
  const normal = map.nodes.find((node) => node.type === 'normal' && node.floor > 20);

  const bossBattle = createBattle({ floor: boss.floor, plan: nodeBattlePlan(boss), seed: 1, build: BUILD, life: 15 });
  assert.equal(bossBattle.modifier, 'boss');
  assert.equal(bossBattle.player.cells, 15);
  assert.equal(bossBattle.total, 8);

  const eliteBattle = createBattle({ floor: elite.floor, plan: nodeBattlePlan(elite), seed: 1, build: BUILD });
  assert.equal(eliteBattle.modifier, 'elite');
  assert.equal(eliteBattle.player.cells, eliteBattle.player.maxCells);

  const normalBattle = createBattle({ floor: normal.floor, plan: nodeBattlePlan(normal), seed: 1, build: BUILD });
  assert.equal(normalBattle.modifier, null);
  assert.equal(normalBattle.total, deepFloorPlan(normal.floor).count);
});

test('进度摘要：UI 需要的字段齐全', () => {
  const run = createMapRun({ seed: 8, lifeMax: 24 });
  const summary = mapRunSummary(run);
  assert.equal(summary.floor, 1);
  assert.equal(summary.currentType, 'normal');
  assert.equal(summary.autoMode, 'balanced');
  assert.ok(summary.depth === 99);
  assert.equal(summary.percent > 0 && summary.percent < 100, true);
  assert.equal(setAutoMode(run, 'risky'), true);
  assert.equal(mapRunSummary(run).autoLabel, '冒险');
  assert.equal(setAutoMode(run, 'nope'), false);
  assert.ok(NODE_TYPES[summary.currentType].icon.length > 0);
});

test('生成诊断：路线计数与类型统计可用', () => {
  const map = mapOf(4242);
  const config = mapConfig(map.config);
  assert.ok(countRoutes(map.nodes, config) > 1000);
  assert.equal(map.stats.nodes, map.nodes.length);
  assert.equal(
    Object.values(map.stats.typeCounts).reduce((sum, value) => sum + value, 0),
    map.nodes.length,
  );
  const template = buildTemplateNodes(9, config);
  assert.equal(template.nodes.length > 0, true);
  assert.equal(validateMap(template.nodes, mapConfig({ ...config, anchors: config.anchors, guards: config.guards })).ok, true);
});
