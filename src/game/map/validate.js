// 地图验证：结构、可达性、固定层与「每条有效路线」的保底约束。
//
// 保底不能只看某一层有没有休息点：必须覆盖每条从起点到终点的路线。
// 这里用逐层传播状态集合来精确判定 —— 每个节点保留所有可能到达的状态
// （距离上次休息 / 商店的层数、上一节点是否精英），并按 Pareto 支配剪枝。
// 只保留「最优历史」会漏判，所以剪枝只丢弃被完全支配的状态。

import { NODE_TYPES, fixedNodeType } from './config.js';
import { groupNodesByFloor } from './topology.js';

export function indexNodeMap(nodes) {
  const map = new Map();
  for (const node of nodes) map.set(node.id, node);
  return map;
}

export function floorRows(nodes, depth) {
  return groupNodesByFloor(nodes, depth);
}

const encodeState = (state) => `${state.restGap},${state.shopGap},${state.prevElite ? 1 : 0}`;

/** 同 prevElite 下，restGap 与 shopGap 都不大于另一状态时才被支配。 */
function pushState(store, state, limit = 48) {
  for (const existing of store.values()) {
    if (
      existing.prevElite === state.prevElite &&
      existing.restGap <= state.restGap &&
      existing.shopGap <= state.shopGap
    ) return;
  }
  for (const [key, existing] of [...store]) {
    if (
      existing.prevElite === state.prevElite &&
      state.restGap <= existing.restGap &&
      state.shopGap <= existing.shopGap
    ) store.delete(key);
  }
  if (store.size >= limit) {
    // 兜底：状态数上限只为防止病态图，正常地图远达不到。
    const first = store.keys().next();
    if (!first.done) store.delete(first.value);
  }
  store.set(encodeState(state), state);
}

/**
 * 逐层传播所有路线的状态，返回每个节点的后状态集合与违规列表。
 * 只处理从起点可达的节点；不可达节点由 validateMap 单独报错。
 */
export function routeStates(nodes, config) {
  const rows = floorRows(nodes, config.depth);
  const states = new Map();
  const violations = new Map();
  const incoming = new Map();

  const startRow = rows.get(1) ?? [];
  for (const node of startRow) {
    incoming.set(node.id, [{ restGap: 0, shopGap: 0, prevElite: false }]);
  }

  for (let floor = 1; floor <= config.depth; floor += 1) {
    const row = rows.get(floor) ?? [];
    for (const node of row) {
      const list = incoming.get(node.id);
      if (list === undefined || list.length === 0) continue;
      const post = new Map();
      for (const state of list) {
        const restGap = node.type === 'rest' ? 0 : state.restGap + 1;
        const shopGap = node.type === 'shop' ? 0 : state.shopGap + 1;
        const prevElite = node.type === 'elite';
        if (restGap >= config.guards.restGap) {
          violations.set('rest:' + node.id, { kind: 'rest-gap', nodeId: node.id, value: restGap });
        }
        if (shopGap >= config.guards.shopGap) {
          violations.set('shop:' + node.id, { kind: 'shop-gap', nodeId: node.id, value: shopGap });
        }
        if (state.prevElite && prevElite) {
          violations.set('elite:' + node.id, { kind: 'elite-chain', nodeId: node.id });
        }
        if (prevElite && node.floor < config.guards.eliteFrom) {
          violations.set('early:' + node.id, { kind: 'elite-early', nodeId: node.id });
        }
        pushState(post, { restGap, shopGap, prevElite });
      }
      states.set(node.id, [...post.values()]);
      for (const nextId of node.next) {
        const bucket = incoming.get(nextId) ?? [];
        for (const state of post.values()) bucket.push(state);
        // 入边最多 5 条、状态已被支配剪枝，这里只做去重上限保护。
        incoming.set(nextId, bucket.length > 96 ? bucket.slice(-96) : bucket);
      }
    }
  }

  return { states, violations: [...violations.values()], rows };
}

function forwardReach(nodes, startId) {
  const byId = indexNodeMap(nodes);
  const seen = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node === undefined) continue;
    for (const nextId of node.next) stack.push(nextId);
  }
  return seen;
}

function backwardReach(nodes, endId) {
  const parents = new Map();
  for (const node of nodes) {
    for (const nextId of node.next) {
      const list = parents.get(nextId) ?? [];
      list.push(node.id);
      parents.set(nextId, list);
    }
  }
  const seen = new Set();
  const stack = [endId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const prevId of parents.get(id) ?? []) stack.push(prevId);
  }
  return seen;
}

/** 统计从起点到终点的有效路线数量（饱和计数，避免天文数字溢出）。 */
export function countRoutes(nodes, config) {
  const rows = floorRows(nodes, config.depth);
  const counts = new Map();
  for (const node of rows.get(1) ?? []) counts.set(node.id, 1);
  for (let floor = 1; floor < config.depth; floor += 1) {
    for (const node of rows.get(floor) ?? []) {
      const value = counts.get(node.id) ?? 0;
      if (value === 0) continue;
      for (const nextId of node.next) {
        counts.set(nextId, Math.min(1e9, (counts.get(nextId) ?? 0) + value));
      }
    }
  }
  const bossRow = rows.get(config.depth) ?? [];
  return bossRow.reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0);
}

/** 结构 + 类型 + 保底验证。返回可诊断的错误列表，不做隐式修正。 */
export function validateMap(nodes, config) {
  const errors = [];
  const byId = indexNodeMap(nodes);
  const rows = floorRows(nodes, config.depth);

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, errors: [{ code: 'empty-map', message: '地图没有节点' }], stats: null };
  }
  if (byId.size !== nodes.length) {
    errors.push({ code: 'duplicate-id', message: '节点 ID 不唯一' });
  }

  const startRow = rows.get(1) ?? [];
  const bossRow = rows.get(config.depth) ?? [];
  const preBossRow = rows.get(config.depth - 1) ?? [];
  if (startRow.length !== 1) {
    errors.push({ code: 'start-count', message: `第 1 层应只有 1 个节点，实际 ${startRow.length}` });
  }
  if (bossRow.length !== 1) {
    errors.push({ code: 'boss-count', message: `第 ${config.depth} 层应只有 1 个节点，实际 ${bossRow.length}` });
  }
  if (preBossRow.length !== 1) {
    errors.push({
      code: 'rest-count',
      message: `第 ${config.depth - 1} 层应只有 1 个休息节点，实际 ${preBossRow.length}`,
    });
  }

  for (let floor = 1; floor <= config.depth; floor += 1) {
    const row = rows.get(floor) ?? [];
    if (row.length === 0) {
      errors.push({ code: 'floor-empty', message: `第 ${floor} 层没有节点`, floor });
      continue;
    }
    const columns = new Set();
    for (const node of row) {
      if (node.floor !== floor) {
        errors.push({ code: 'floor-mismatch', message: `节点 ${node.id} 的层数不一致`, nodeId: node.id });
      }
      if (!Number.isInteger(node.column) || node.column < 0 || columns.has(node.column)) {
        errors.push({ code: 'bad-column', message: `节点 ${node.id} 的列号非法`, nodeId: node.id });
      }
      columns.add(node.column);
      if (NODE_TYPES[node.type] === undefined) {
        errors.push({ code: 'bad-type', message: `节点 ${node.id} 类型未知：${String(node.type)}`, nodeId: node.id });
      }
      if (!Array.isArray(node.next)) {
        errors.push({ code: 'bad-next', message: `节点 ${node.id} 缺少连线数组`, nodeId: node.id });
        continue;
      }
      const seen = new Set();
      for (const nextId of node.next) {
        if (seen.has(nextId)) {
          errors.push({ code: 'duplicate-edge', message: `节点 ${node.id} 有重复连线 ${nextId}`, nodeId: node.id });
        }
        seen.add(nextId);
        const target = byId.get(nextId);
        if (target === undefined) {
          errors.push({ code: 'dangling-edge', message: `节点 ${node.id} 指向不存在的 ${nextId}`, nodeId: node.id });
          continue;
        }
        if (target.floor !== node.floor + 1) {
          errors.push({ code: 'edge-floor', message: `节点 ${node.id} 跨越了层数指向 ${nextId}`, nodeId: node.id });
        }
      }
      if (floor < config.depth && node.next.length === 0) {
        errors.push({ code: 'dead-end', message: `节点 ${node.id} 没有通往下一层的路`, nodeId: node.id });
      }
    }
    if (floor < config.depth) {
      const elites = row.filter((node) => node.type === 'elite');
      if (elites.length === row.length && row.length > 0) {
        errors.push({ code: 'all-elite', message: `第 ${floor} 层全部是精英`, floor });
      }
      if (elites.length > config.guards.maxElitePerFloor) {
        errors.push({
          code: 'elite-cap',
          message: `第 ${floor} 层精英过多（${elites.length} > ${config.guards.maxElitePerFloor}）`,
          floor,
        });
      }
    }
  }

  for (const node of nodes) {
    const fixed = fixedNodeType(node.floor, config);
    if (fixed !== null && node.type !== fixed) {
      errors.push({
        code: 'fixed-type',
        message: `第 ${node.floor} 层必须是 ${fixed}，实际 ${String(node.type)}`,
        nodeId: node.id,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, stats: null };
  }

  const startId = startRow[0].id;
  const bossId = bossRow[0].id;
  const forward = forwardReach(nodes, startId);
  const backward = backwardReach(nodes, bossId);
  for (const node of nodes) {
    if (!forward.has(node.id)) {
      errors.push({ code: 'unreachable', message: `节点 ${node.id} 无法从起点到达`, nodeId: node.id });
    } else if (!backward.has(node.id)) {
      errors.push({ code: 'no-exit', message: `节点 ${node.id} 无法通往 Boss`, nodeId: node.id });
    }
  }

  const route = routeStates(nodes, config);
  for (const violation of route.violations) {
    errors.push({
      code: 'route-' + violation.kind,
      message: constraintMessage(violation, config),
      nodeId: violation.nodeId,
    });
  }

  const typeCounts = {};
  for (const node of nodes) typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
  const edges = nodes.reduce((sum, node) => sum + node.next.length, 0);

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      floors: config.depth,
      nodes: nodes.length,
      edges,
      routes: countRoutes(nodes, config),
      typeCounts,
    },
  };
}

export function constraintMessage(violation, config) {
  if (violation.kind === 'rest-gap') {
    return `连续 ${config.guards.restGap} 层没有休息点（${violation.nodeId}）`;
  }
  if (violation.kind === 'shop-gap') {
    return `连续 ${config.guards.shopGap} 层没有商店（${violation.nodeId}）`;
  }
  if (violation.kind === 'elite-chain') return `路线连续经过两个精英（${violation.nodeId}）`;
  if (violation.kind === 'elite-early') return `前 ${config.guards.eliteFrom - 1} 层不允许出现精英（${violation.nodeId}）`;
  return violation.kind;
}

/**
 * 汇总需要修正的类型问题。修正方向只做「更安全」的转换：
 * 精英 → 普通 / 事件，普通 → 休息 / 商店，不会把已满足的约束改坏。
 */
export function collectTypeProblems(nodes, config) {
  const rows = floorRows(nodes, config.depth);
  const problems = [];
  const seen = new Set();
  const push = (problem) => {
    const key = problem.kind + ':' + problem.nodeId;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(problem);
  };

  const route = routeStates(nodes, config);
  for (const violation of route.violations) {
    if (violation.kind === 'rest-gap') push({ kind: 'rest-gap', nodeId: violation.nodeId, fix: 'rest' });
    else if (violation.kind === 'shop-gap') push({ kind: 'shop-gap', nodeId: violation.nodeId, fix: 'shop' });
    else push({ kind: violation.kind, nodeId: violation.nodeId, fix: 'normal' });
  }

  for (let floor = 1; floor <= config.depth; floor += 1) {
    const row = rows.get(floor) ?? [];
    if (row.length === 0) continue;
    const fixed = fixedNodeType(floor, config);
    if (fixed !== null) {
      for (const node of row) {
        if (node.type !== fixed) push({ kind: 'fixed-type', nodeId: node.id, fix: fixed });
      }
      continue;
    }
    const elites = row.filter((node) => node.type === 'elite');
    if (elites.length === row.length) {
      const target = elites[elites.length - 1];
      push({ kind: 'all-elite', nodeId: target.id, fix: 'event' });
    } else if (elites.length > config.guards.maxElitePerFloor) {
      for (const node of elites.slice(config.guards.maxElitePerFloor)) {
        push({ kind: 'elite-cap', nodeId: node.id, fix: 'normal' });
      }
    }
    for (const node of row) {
      if (node.type === 'elite' && floor < config.guards.eliteFrom) {
        push({ kind: 'elite-early', nodeId: node.id, fix: 'normal' });
      }
    }
  }

  return problems;
}
