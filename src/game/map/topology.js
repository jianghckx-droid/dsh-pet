// 地图结构：分层有向图。
//
// 第 1 层只有起点，第 2–depth-2 层每层 3–5 个节点，倒数第 2 层单个休息点，
// 最后一层单个最终 Boss。连线只指向下一层，允许分叉与汇合，不允许横移或跳层。
// 构建阶段就保证：每个节点至少有一条入边（起点除外）、至少一条出边（Boss 除外）。

import { rngInt } from './rng.js';

export function nodeId(floor, column) {
  return `${floor}-${column}`;
}

/** 每层宽度：起点、休息、Boss 固定 1，其余在配置区间内取，并偏好与上一层相近。 */
function floorWidths(rng, config) {
  const widths = new Array(config.depth + 1).fill(1);
  let previous = rngInt(rng, config.width.min, config.width.max);
  for (let floor = 2; floor <= config.depth - 2; floor += 1) {
    // 70% 沿用上一层宽度，避免整张图锯齿状抖动。
    const next = rng() < 0.7 ? previous : rngInt(rng, config.width.min, config.width.max);
    widths[floor] = next;
    previous = next;
  }
  return widths;
}

const mapClamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

/**
 * 按「比例映射 + 覆盖补边」连线：
 * 1. 每个源节点先连到比例位置对应的目标节点；
 * 2. 45% 概率再连到相邻目标，形成分叉；
 * 3. 任何没有入边的目标补一条最近源的边，避免孤立节点。
 */
export function buildTopology(rng, config) {
  const widths = floorWidths(rng, config);
  const byFloor = new Map();
  const nodes = [];
  for (let floor = 1; floor <= config.depth; floor += 1) {
    const width = widths[floor];
    const row = [];
    for (let column = 0; column < width; column += 1) {
      const node = {
        id: nodeId(floor, column),
        floor,
        column,
        type: null,
        next: [],
        content: {},
      };
      row.push(node);
      nodes.push(node);
    }
    byFloor.set(floor, row);
  }

  for (let floor = 1; floor < config.depth; floor += 1) {
    const from = byFloor.get(floor);
    const to = byFloor.get(floor + 1);
    const positions = from.map((source) => (from.length === 1 ? 0 : (source.column + 0.5) / from.length));
    const incoming = new Set();

    from.forEach((source, index) => {
      const base = mapClamp(Math.round(positions[index] * (to.length - 1)), 0, to.length - 1);
      const targets = new Set([base]);
      if (to.length > 1 && rng() < 0.45) {
        const offset = rng() < 0.5 ? -1 : 1;
        targets.add(mapClamp(base + offset, 0, to.length - 1));
      }
      for (const target of [...targets].sort((a, b) => a - b)) {
        source.next.push(to[target].id);
        incoming.add(target);
      }
    });

    // 覆盖补边：没有入边的目标节点接回最近源，保证不会产生无法进入的节点。
    for (let target = 0; target < to.length; target += 1) {
      if (incoming.has(target)) continue;
      let bestIndex = 0;
      let bestDistance = Infinity;
      positions.forEach((position, index) => {
        const distance = Math.abs(position * (to.length - 1) - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      from[bestIndex].next.push(to[target].id);
      incoming.add(target);
    }
  }

  return { nodes, byFloor, width: widths };
}

/** 按层分组的只读视图；nodes 顺序即生成顺序。 */
export function groupNodesByFloor(nodes, depth) {
  const byFloor = new Map();
  for (let floor = 1; floor <= depth; floor += 1) byFloor.set(floor, []);
  for (const node of nodes) {
    if (!byFloor.has(node.floor)) byFloor.set(node.floor, []);
    byFloor.get(node.floor).push(node);
  }
  for (const row of byFloor.values()) row.sort((a, b) => a.column - b.column);
  return byFloor;
}
