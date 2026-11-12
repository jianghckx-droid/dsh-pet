// 地图进度：本局状态、节点进入 / 结算、自动路线与存档。
//
// 地图只负责「下一步去哪、这一站给什么」，战斗仍然由 arena 负责。
// 生命与金币跨节点保留，节点奖励只在完成时发放一次；失败重试不重复发奖。

import {
  AUTO_MODES,
  AUTO_MODE_IDS,
  MAP_VERSION,
  NODE_TYPES,
  mapConfig,
  snapshotMapConfig,
} from './config.js';
import { generateMap } from './generate.js';
import { nodeBattlePlan, nodeSummary } from './content.js';
import { indexNodeMap, validateMap } from './validate.js';

const RUN_INDEX = new WeakMap();

function nodeIndex(run) {
  let map = RUN_INDEX.get(run);
  if (map === undefined) {
    map = indexNodeMap(run.nodes);
    RUN_INDEX.set(run, map);
  }
  return map;
}

export function mapNode(run, id) {
  if (run === null || run === undefined) return null;
  return nodeIndex(run).get(id) ?? null;
}

export function currentNode(run) {
  if (run === null || run === undefined) return null;
  return mapNode(run, run.currentNodeId);
}

export function nodeStatus(run, id) {
  const state = run.nodeStates[id];
  return state === undefined ? 'unvisited' : state.status;
}

/** 当前可进入的下一层节点；当前节点还没结算时没有可选项。 */
export function availableNodeIds(run) {
  const node = currentNode(run);
  if (node === null) return [];
  if (nodeStatus(run, node.id) !== 'done') return [];
  return node.next.filter((id) => nodeStatus(run, id) === 'unvisited');
}

export function availableNodes(run) {
  const ids = availableNodeIds(run);
  const out = [];
  for (const id of ids) {
    const node = mapNode(run, id);
    if (node !== null) out.push(node);
  }
  return out;
}

export function createMapRun({
  seed = 1,
  config = {},
  map = null,
  gold = 0,
  life = null,
  lifeMax = 24,
  autoMode = 'balanced',
} = {}) {
  const cfg = mapConfig(config === null || config === undefined ? {} : config);
  const generated = map ?? generateMap({ seed, config: cfg });
  const startId = generated.startId;
  const run = {
    mapVersion: generated.mapVersion,
    seed: generated.seed,
    depth: generated.depth,
    config: generated.config ?? snapshotMapConfig(cfg),
    nodes: generated.nodes,
    startId,
    bossId: generated.bossId,
    currentNodeId: startId,
    visited: [startId],
    nodeStates: { [startId]: { status: 'active' } },
    gold: Math.max(0, Math.floor(Number(gold) || 0)),
    lifeMax: Math.max(1, Math.floor(Number(lifeMax) || 24)),
    life: null,
    autoMode: AUTO_MODE_IDS.includes(autoMode) ? autoMode : 'balanced',
    failures: 0,
    finished: false,
    notice: '',
    generation: {
      attempts: generated.attempts ?? 1,
      fallback: generated.fallback === true,
      valid: generated.valid !== false,
    },
  };
  run.life = life === null || life === undefined
    ? run.lifeMax
    : Math.max(1, Math.min(run.lifeMax, Math.round(Number(life) || run.lifeMax)));
  return run;
}

/** 进入一个可选的下一层节点。返回 null 表示当前不可选。 */
export function beginNode(run, id) {
  if (nodeStatus(run, id) !== 'unvisited') return null;
  if (!availableNodeIds(run).includes(id)) return null;
  const node = mapNode(run, id);
  if (node === null) return null;
  run.currentNodeId = id;
  run.visited.push(id);
  run.nodeStates[id] = { status: 'active' };
  return node;
}

/** 非战斗节点的安全离开：不领取奖励，直接标记完成。 */
export function leaveNode(run, id = run.currentNodeId) {
  const node = mapNode(run, id);
  if (node === null || nodeStatus(run, id) !== 'active') return false;
  run.nodeStates[id] = { ...(run.nodeStates[id] ?? {}), status: 'done' };
  return true;
}

/**
 * 完成当前节点：写回生命、发放节点金币与奖励。
 * 同一节点只会发奖一次（重复调用返回 alreadyDone）。
 */
export function completeNode(run, id = run.currentNodeId, { life = null } = {}) {
  const node = mapNode(run, id);
  if (node === null) return null;
  const state = run.nodeStates[id] ?? { status: 'unvisited' };
  if (Number.isFinite(Number(life))) {
    run.life = Math.max(1, Math.min(run.lifeMax, Math.round(Number(life))));
  }
  if (state.status === 'done') return { node, alreadyDone: true, gold: 0, effects: [] };
  const reward = Math.max(0, Math.floor(Number(node.content?.gold) || 0));
  run.gold += reward;
  run.failures = 0;
  const effects = [];
  const draft = Math.max(0, Math.floor(Number(node.content?.draft) || 0));
  if (draft > 0) effects.push({ kind: 'draft', count: draft });
  run.nodeStates[id] = { ...state, status: 'done' };
  if (node.type === 'boss') run.finished = true;
  return { node, alreadyDone: false, gold: reward, effects };
}

/** 战斗失败：保留节点与构筑，只累计失败次数；奖励不会重复发放。 */
export function retryNode(run, id = run.currentNodeId) {
  if (nodeStatus(run, id) !== 'active') return run.failures;
  run.failures += 1;
  run.life = run.lifeMax;
  return run.failures;
}

function canPay(run, cost) {
  if (cost === null || cost === undefined) return true;
  if (Number.isFinite(cost.gold) && run.gold < cost.gold) return false;
  if (Number.isFinite(cost.lifeRatio)) {
    const price = Math.ceil(run.lifeMax * cost.lifeRatio);
    if (run.life - price < 1) return false;
  }
  return true;
}

function applyEffects(run, effects) {
  const external = [];
  for (const effect of effects ?? []) {
    if (effect === null || typeof effect !== 'object') continue;
    if (effect.kind === 'gold') {
      run.gold = Math.max(0, run.gold + Math.floor(Number(effect.amount) || 0));
    } else if (effect.kind === 'life') {
      run.life += Math.floor(Number(effect.amount) || 0);
    } else if (effect.kind === 'lifeRatio') {
      run.life += Math.round(run.lifeMax * (Number(effect.value) || 0));
    } else if (effect.kind === 'draft' || effect.kind === 'attributePoint') {
      external.push({ kind: effect.kind, count: Math.max(1, Math.floor(Number(effect.count) || 1)) });
    }
  }
  run.life = Math.max(1, Math.min(run.lifeMax, Math.round(run.life)));
  return external;
}

// ---- 休息点 ----

export function restOptions(run, id = run.currentNodeId) {
  const node = mapNode(run, id);
  const ratio = Number(node?.content?.healRatio) || 0.3;
  const heal = Math.max(1, Math.round(run.lifeMax * ratio));
  const healed = Math.min(run.lifeMax, run.life + heal);
  return [
    {
      id: 'heal',
      label: '恢复生命',
      desc: `恢复 ${heal} 点：${run.life} → ${healed}`,
      available: run.life < run.lifeMax,
      reason: run.life < run.lifeMax ? '' : '生命已满',
      effect: { kind: 'life', amount: heal },
    },
    {
      id: 'upgrade',
      label: '构筑强化',
      desc: '获得一次三选一，下一次战斗开始时生效',
      available: true,
      reason: '',
      effect: { kind: 'draft', count: 1 },
    },
    {
      id: 'leave',
      label: '安全离开',
      desc: '不做选择，继续前进',
      available: true,
      reason: '',
      effect: null,
    },
  ];
}

export function resolveRest(run, id, choiceId) {
  const node = mapNode(run, id);
  if (node === null || node.type !== 'rest' || nodeStatus(run, id) !== 'active') {
    return { ok: false, reason: 'not-rest' };
  }
  const option = restOptions(run, id).find((entry) => entry.id === choiceId);
  if (option === undefined) return { ok: false, reason: 'unknown-option' };
  if (!option.available) return { ok: false, reason: option.reason || 'unavailable' };
  const effects = option.effect === null ? [] : applyEffects(run, [option.effect]);
  run.nodeStates[id] = { ...(run.nodeStates[id] ?? {}), status: 'done', choice: choiceId };
  return { ok: true, choice: choiceId, effects, message: option.label };
}

// ---- 事件点 ----

export function eventView(run, id = run.currentNodeId) {
  const node = mapNode(run, id);
  if (node === null || node.type !== 'event') return null;
  const content = node.content ?? {};
  const options = (content.options ?? []).map((option) => ({
    id: option.id,
    label: option.label,
    costText: option.costText,
    resultText: option.resultText,
    text: option.text,
    available: nodeStatus(run, id) === 'active' && canPay(run, option.cost),
    reason: canPay(run, option.cost) ? '' : '资源不足',
  }));
  return {
    id: node.id,
    label: content.label ?? '事件',
    desc: content.desc ?? '',
    options,
  };
}

export function resolveEvent(run, id, optionId) {
  const node = mapNode(run, id);
  if (node === null || node.type !== 'event' || nodeStatus(run, id) !== 'active') {
    return { ok: false, reason: 'not-event' };
  }
  const option = (node.content?.options ?? []).find((entry) => entry.id === optionId);
  if (option === undefined) return { ok: false, reason: 'unknown-option' };
  if (!canPay(run, option.cost)) return { ok: false, reason: 'cannot-pay' };
  const cost = option.cost ?? {};
  if (Number.isFinite(cost.gold)) run.gold = Math.max(0, run.gold - cost.gold);
  if (Number.isFinite(cost.lifeRatio)) {
    run.life = Math.max(1, run.life - Math.ceil(run.lifeMax * cost.lifeRatio));
  }
  const effects = applyEffects(run, option.effects);
  run.nodeStates[id] = { ...(run.nodeStates[id] ?? {}), status: 'done', choice: optionId };
  return { ok: true, choice: optionId, effects, text: option.text ?? '', message: option.label };
}

// ---- 商店 ----

export function shopView(run, id = run.currentNodeId) {
  const node = mapNode(run, id);
  if (node === null || node.type !== 'shop') return null;
  const purchases = run.nodeStates[id]?.purchases ?? [];
  return {
    id: node.id,
    items: (node.content?.items ?? []).map((item) => {
      const sold = purchases.includes(item.index);
      return {
        index: item.index,
        id: item.id,
        label: item.label,
        desc: item.desc,
        price: item.price,
        sold,
        available: !sold && nodeStatus(run, id) === 'active' && run.gold >= item.price,
      };
    }),
  };
}

export function buyShopItem(run, id, index) {
  const node = mapNode(run, id);
  if (node === null || node.type !== 'shop' || nodeStatus(run, id) !== 'active') {
    return { ok: false, reason: 'not-shop' };
  }
  const item = (node.content?.items ?? []).find((entry) => entry.index === index);
  if (item === undefined) return { ok: false, reason: 'unknown-item' };
  const state = run.nodeStates[id] ?? { status: 'active' };
  const purchases = state.purchases ?? [];
  if (purchases.includes(index)) return { ok: false, reason: 'sold' };
  if (run.gold < item.price) return { ok: false, reason: 'no-gold' };
  run.gold -= item.price;
  const effects = applyEffects(run, [item.effect]);
  run.nodeStates[id] = { ...state, purchases: [...purchases, index] };
  return { ok: true, item, effects, message: item.label };
}

export function leaveShop(run, id = run.currentNodeId) {
  return leaveNode(run, id);
}

// ---- 自动路线 ----

const TYPE_SCORES = {
  steady: { normal: 3, rest: 6, event: 2, shop: 3, elite: -6, boss: 0 },
  balanced: { normal: 3, rest: 4, event: 3, shop: 3, elite: 1.5, boss: 0 },
  risky: { normal: 2, rest: 0, event: 3.5, shop: 2, elite: 5, boss: 0 },
};

function lookaheadTypes(run, node, steps) {
  const seen = new Set();
  const found = new Map();
  let frontier = node.next.map((id) => ({ id, depth: 1 }));
  while (frontier.length > 0) {
    const next = [];
    for (const entry of frontier) {
      if (entry.depth > steps) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const target = mapNode(run, entry.id);
      if (target === null) continue;
      found.set(target.type, (found.get(target.type) ?? 0) + 1);
      for (const id of target.next) next.push({ id, depth: entry.depth + 1 });
    }
    frontier = next;
  }
  return found;
}

function scoreNode(run, node, mode, context) {
  const table = TYPE_SCORES[mode] ?? TYPE_SCORES.balanced;
  let score = table[node.type] ?? 0;
  const learned = lookaheadTypes(run, node, run.config?.auto?.lookahead ?? 3);
  const hasRestAhead = (learned.get('rest') ?? 0) > 0;

  if (node.type === 'rest' && context.lifeRatio < 0.55) score += 3;
  if (node.type === 'elite' && context.lifeRatio < 0.45) score -= 4;
  if (node.type === 'shop' && context.gold >= 70) score += 2;
  if (node.type === 'event' && context.lifeRatio < 0.3) score -= 1;
  if (mode !== 'risky' && (learned.get('elite') ?? 0) > 0 && context.lifeRatio < 0.5) score -= 1.5;
  if (context.lifeRatio < 0.6 && !hasRestAhead && node.type !== 'rest') score -= 1;
  if (mode === 'risky' && node.type === 'rest' && context.lifeRatio > 0.75) score -= 2;
  return score;
}

function pauseReason(run, options, context) {
  const limits = run.config?.auto ?? {};
  const lowLife = limits.pauseLowLife ?? 0.2;
  const allEliteLimit = limits.pauseAllElite ?? 0.35;
  if (options.length === 0) return 'no-options';
  if (context.lifeRatio <= lowLife && options.every((node) => node.type !== 'rest')) {
    return 'low-life-no-rest';
  }
  if (context.lifeRatio < allEliteLimit && options.every((node) => node.type === 'elite')) {
    return 'all-elite-low-life';
  }
  return null;
}

/**
 * 自动路线：返回 { nodeId, paused, reason, scores }。
 * manual 模式永远返回 paused=true（reason='manual'），由玩家自己点。
 * 自动时至少考虑未来 2–3 层的连线，而不是只看眼前一个节点。
 */
export function pickNextNode(run, profile = {}) {
  const mode = AUTO_MODE_IDS.includes(run.autoMode) ? run.autoMode : 'balanced';
  if (mode === 'manual') return { nodeId: null, paused: true, reason: 'manual', scores: [] };
  if (run.finished === true) return { nodeId: null, paused: true, reason: 'finished', scores: [] };
  const options = availableNodes(run);
  if (options.length === 0) return { nodeId: null, paused: true, reason: 'no-options', scores: [] };
  if (options.length === 1) {
    return { nodeId: options[0].id, paused: false, reason: 'single', scores: [] };
  }
  const lifeMax = Math.max(1, Number(profile.lifeMax ?? run.lifeMax) || run.lifeMax);
  const life = Math.max(0, Number(profile.life ?? run.life) || 0);
  const context = { lifeRatio: lifeMax > 0 ? life / lifeMax : 1, gold: run.gold };
  const scored = options.map((node) => ({
    node,
    score: scoreNode(run, node, mode, context),
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.node.column - b.node.column));
  const blocked = pauseReason(run, options, context);
  if (blocked !== null) {
    return {
      nodeId: null,
      paused: true,
      reason: blocked,
      scores: scored.map((entry) => ({ nodeId: entry.node.id, score: entry.score })),
    };
  }
  return {
    nodeId: scored[0].node.id,
    paused: false,
    reason: mode,
    scores: scored.map((entry) => ({ nodeId: entry.node.id, score: entry.score })),
  };
}

export function autoReasonText(reason) {
  if (reason === 'manual') return '手动路线：等你选择下一站';
  if (reason === 'no-options') return '当前没有可选节点';
  if (reason === 'finished') return '本局已经结束';
  if (reason === 'single') return '唯一路线，自动前进';
  if (reason === 'steady') return '稳健：优先恢复，避开精英';
  if (reason === 'balanced') return '均衡：兼顾恢复、商店与成长';
  if (reason === 'risky') return '冒险：优先精英与高风险事件';
  if (reason === 'low-life-no-rest') return '自动暂停：生命偏低且下一站没有休息点';
  if (reason === 'all-elite-low-life') return '自动暂停：可选节点全是精英且生命偏低';
  return '';
}

// ---- 存档 ----

export function serializeMapRun(run) {
  if (run === null || run === undefined) return null;
  return {
    mapVersion: run.mapVersion,
    seed: run.seed,
    depth: run.depth,
    config: run.config,
    nodes: run.nodes,
    startId: run.startId,
    bossId: run.bossId,
    currentNodeId: run.currentNodeId,
    visited: [...run.visited],
    nodeStates: run.nodeStates,
    gold: run.gold,
    life: run.life,
    lifeMax: run.lifeMax,
    autoMode: run.autoMode,
    failures: run.failures,
    finished: run.finished,
  };
}

/** 读档：结构不合法（版本不符、缺节点、指针指向不存在的节点）返回 null。 */
export function restoreMapRun(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  if (raw.mapVersion !== MAP_VERSION) return null;
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) return null;
  const cfg = mapConfig({ ...(raw.config ?? {}), depth: raw.depth ?? raw.config?.depth });
  const byId = indexNodeMap(raw.nodes);
  if (!byId.has(raw.startId) || !byId.has(raw.bossId)) return null;
  const currentNodeId = byId.has(raw.currentNodeId) ? raw.currentNodeId : raw.startId;
  const validation = validateMap(raw.nodes, cfg);
  if (!validation.ok) return null;
  const nodeStates = {};
  for (const [id, state] of Object.entries(raw.nodeStates ?? {})) {
    if (!byId.has(id) || state === null || typeof state !== 'object') continue;
    nodeStates[id] = { ...state };
  }
  const run = {
    mapVersion: raw.mapVersion,
    seed: raw.seed,
    depth: raw.depth,
    config: snapshotMapConfig(cfg),
    nodes: raw.nodes,
    startId: raw.startId,
    bossId: raw.bossId,
    currentNodeId,
    visited: Array.isArray(raw.visited) ? raw.visited.filter((id) => byId.has(id)) : [raw.startId],
    nodeStates,
    gold: Math.max(0, Math.floor(Number(raw.gold) || 0)),
    lifeMax: Math.max(1, Math.floor(Number(raw.lifeMax) || 24)),
    life: null,
    autoMode: AUTO_MODE_IDS.includes(raw.autoMode) ? raw.autoMode : 'balanced',
    failures: Math.max(0, Math.floor(Number(raw.failures) || 0)),
    finished: raw.finished === true,
    notice: '',
    generation: { attempts: 1, fallback: false, valid: true },
  };
  run.life = Math.max(1, Math.min(run.lifeMax, Math.round(Number(raw.life) || run.lifeMax)));
  return run;
}

/** 进度摘要：UI 顶部、存档卡片与报告共用。 */
export function mapRunSummary(run) {
  if (run === null || run === undefined) return null;
  const node = currentNode(run);
  return {
    seed: run.seed,
    depth: run.depth,
    floor: node === null ? 1 : node.floor,
    percent: Math.round(((node === null ? 1 : node.floor) / run.depth) * 100),
    currentId: run.currentNodeId,
    currentType: node === null ? null : node.type,
    currentLabel: node === null ? '' : NODE_TYPES[node.type]?.label ?? '',
    currentSummary: nodeSummary(node),
    status: nodeStatus(run, run.currentNodeId),
    gold: run.gold,
    life: run.life,
    lifeMax: run.lifeMax,
    autoMode: run.autoMode,
    autoLabel: AUTO_MODES[run.autoMode]?.label ?? '',
    failures: run.failures,
    finished: run.finished,
    visited: [...run.visited],
    generation: { ...(run.generation ?? {}) },
  };
}

/** 战斗节点的战斗构成；非战斗节点返回 null。 */
export function nodePlan(node) {
  return nodeBattlePlan(node);
}

export function setAutoMode(run, mode) {
  if (!AUTO_MODE_IDS.includes(mode)) return false;
  run.autoMode = mode;
  return true;
}

export { AUTO_MODES, AUTO_MODE_IDS, NODE_TYPES, nodeSummary };
