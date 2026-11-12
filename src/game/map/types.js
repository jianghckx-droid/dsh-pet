// 地图类型分配与保底修正。
//
// 分配顺序：固定层（起点 / 休息 / Boss）→ 按权重抽取 → 初步限制（前几层无精英、
// 每层精英上限）→ 迭代修正（针对每条路线的休息 / 商店间隔与连续精英）。
// 修正只做更安全的类型转换，且不改写固定层。

import { NODE_TYPES, fixedNodeType } from './config.js';
import { pickWeighted } from './rng.js';
import { collectTypeProblems, floorRows } from './validate.js';

/** 可随机分配的类型；boss 只出现在固定层。 */
export const ASSIGNABLE_TYPES = Object.freeze(['normal', 'elite', 'rest', 'event', 'shop']);

/**
 * 类型分配：
 * 1. 固定层强制（起点 / 休息 / Boss）；
 * 2. 锚点整排（restFloors / shopFloors）——保证每条路线都经过休息与商店；
 * 3. 其余楼层按权重抽取普通 / 精英 / 事件（有锚点时不再抽休息与商店）；
 * 4. 初步限制：前几层无精英、每层精英上限。
 */
export function assignNodeTypes(nodes, rng, config, anchors = null) {
  const rows = floorRows(nodes, config.depth);
  const mode = anchors?.mode === 'node' ? 'node' : 'row';
  const restFloors = anchors?.restFloors ?? new Set();
  const shopFloors = anchors?.shopFloors ?? new Set();
  const restColumns = anchors?.restColumns ?? new Map();
  const shopColumns = anchors?.shopColumns ?? new Map();
  const randomTypes = mode === 'row'
    ? ASSIGNABLE_TYPES.filter((id) => id !== 'rest' && id !== 'shop')
    : ASSIGNABLE_TYPES;
  for (const node of nodes) {
    const fixed = fixedNodeType(node.floor, config);
    if (fixed !== null) {
      node.type = fixed;
      continue;
    }
    if (restFloors.has(node.floor) && (mode === 'row' || restColumns.get(node.floor) === node.column)) {
      node.type = 'rest';
      continue;
    }
    if (shopFloors.has(node.floor) && (mode === 'row' || shopColumns.get(node.floor) === node.column)) {
      node.type = 'shop';
      continue;
    }
    const entries = randomTypes.map((id) => [id, config.weights[id]]);
    node.type = pickWeighted(rng, entries) ?? 'normal';
  }
  for (const row of rows.values()) {
    let elites = 0;
    for (const node of row) {
      if (node.type !== 'elite') continue;
      elites += 1;
      if (elites > config.guards.maxElitePerFloor || node.floor < config.guards.eliteFrom) {
        node.type = 'normal';
        elites = Math.min(elites, config.guards.maxElitePerFloor);
      }
    }
  }
  return nodes;
}

/**
 * 迭代修正类型直到所有路线满足保底。返回是否收敛；
 * 未收敛时由 generateMap 换一次重试种子或使用保底模板。
 */
export function repairNodeTypes(nodes, config) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let pass = 0; pass < config.repairPasses; pass += 1) {
    const problems = collectTypeProblems(nodes, config);
    if (problems.length === 0) return true;
    const applied = new Set();
    for (const problem of problems) {
      const node = byId.get(problem.nodeId);
      if (node === undefined || applied.has(node.id)) continue;
      if (fixedNodeType(node.floor, config) !== null) continue;
      node.type = problem.fix;
      applied.add(node.id);
    }
    if (applied.size === 0) return false;
  }
  return collectTypeProblems(nodes, config).length === 0;
}

/** 类型分布的简短摘要，供报告与存档诊断使用。 */
export function typeSummary(nodes) {
  const counts = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
  return Object.keys(NODE_TYPES)
    .filter((id) => counts[id] !== undefined)
    .map((id) => `${NODE_TYPES[id].label} ${counts[id]}`)
    .join(' · ');
}
