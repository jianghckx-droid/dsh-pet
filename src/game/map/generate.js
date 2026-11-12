// 地图生成：尝试 → 修正 → 验证 → 保底模板。
//
// 每次新游戏用主种子生成整张地图。相同种子、版本与配置必须得到完全一致的
// 结果；不同种子产生不同路线。生成失败时先换确定性重试种子，超过上限后使用
// 同样经过验证的保底模板，绝不无限循环。

import { MAP_VERSION, mapConfig, snapshotMapConfig } from './config.js';
import { createRng, hashSeed, rngInt } from './rng.js';
import { buildTopology } from './topology.js';
import { assignNodeTypes, repairNodeTypes } from './types.js';
import { fillNodeContent } from './content.js';
import { validateMap } from './validate.js';

/**
 * 锚点层：整排同类型的休息 / 商店。
 *
 * 为什么需要：随机权重无法满足逐路线约束。12% 休息权重下，一条长度为 12 的
 * 路线仍有约 22% 概率完全没有休息点；靠事后修补会把休息点挤成一串相邻层。
 * 因此休息与商店改为「整排锚点 + 层间距抖动」：任何路线每层必经过一个节点，
 * 所以只要锚点层间距不超过保底间隔，逐路线约束就成立，同时保留了层间距的随机性。
 */
export function planAnchorFloors(rng, config, byFloor = null) {
  const mode = config.anchors?.mode === 'node' ? 'node' : 'row';
  const occupied = new Set([1, config.depth - 1, config.depth]);
  const restFloors = new Set();
  const shopFloors = new Set();
  const restColumns = new Map();
  const shopColumns = new Map();
  const separation = Math.max(1, Math.floor(config.anchors?.minSeparation ?? 2));
  const tooClose = (floor) => {
    for (let offset = -separation; offset <= separation; offset += 1) {
      if (occupied.has(floor + offset)) return true;
    }
    return false;
  };
  const fill = (target, columns, spacing) => {
    const min = Math.max(1, Math.floor(spacing.min));
    const max = Math.max(min, Math.floor(spacing.max));
    let floor = 2 + rngInt(rng, min, max);
    while (floor <= config.depth - 2) {
      if (!tooClose(floor)) {
        target.add(floor);
        occupied.add(floor);
        if (mode === 'node') {
          const width = (byFloor?.get(floor) ?? []).length || config.width.min;
          columns.set(floor, rngInt(rng, 0, width - 1));
        }
        floor += rngInt(rng, min, max);
      } else {
        floor += 1;
      }
    }
  };
  fill(restFloors, restColumns, config.anchors.restSpacing);
  fill(shopFloors, shopColumns, config.anchors.shopSpacing);
  return { mode, restFloors, shopFloors, restColumns, shopColumns };
}


/**
 * 保底模板：确定性的「走廊」图。
 * 每隔 (restGap-1) 层整层休息、每隔 (shopGap-1) 层整层商店，其余普通怪，
 * 因此每条有效路线都必然满足间隔约束；精英只在允许的楼层出现。
 */
export function buildTemplateNodes(seed, config) {
  const rng = createRng(hashSeed(seed, 'template'));
  const { nodes, byFloor } = buildTopology(rng, config);
  // 比保底间隔更紧的步长，给「休息与商店同时到期」留出回旋余地。
  const restStep = Math.max(1, config.guards.restGap - 2);
  const shopStep = Math.max(1, config.guards.shopGap - 3);
  let lastRest = 1; // 第 1 层是普通战斗
  let lastShop = 1;
  let lastAnchor = 'shop';
  for (let floor = 2; floor <= config.depth - 2; floor += 1) {
    const restDue = floor - lastRest >= restStep;
    const shopDue = floor - lastShop >= shopStep;
    let type = 'normal';
    if (restDue && shopDue) {
      // 两者同时到期时交替，避免某一类被长期饿死；间距留了 2–3 层余量。
      type = lastAnchor === 'rest' ? 'shop' : 'rest';
    } else if (restDue) {
      type = 'rest';
    } else if (shopDue) {
      type = 'shop';
    }
    for (const node of byFloor.get(floor) ?? []) node.type = type;
    if (type === 'rest') {
      lastRest = floor;
      lastAnchor = 'rest';
    } else if (type === 'shop') {
      lastShop = floor;
      lastAnchor = 'shop';
    }
  }
  for (const node of nodes) {
    if (node.floor === 1) node.type = 'normal';
    else if (node.floor === config.depth) node.type = 'boss';
    else if (node.floor === config.depth - 1) node.type = 'rest';
  }
  return { nodes, byFloor };
}

function makeMap(seed, cfg, nodes, byFloor, meta) {
  return {
    mapVersion: cfg.version,
    seed,
    depth: cfg.depth,
    config: snapshotMapConfig(cfg),
    nodes,
    startId: byFloor.get(1)[0].id,
    bossId: byFloor.get(cfg.depth)[0].id,
    attempts: meta.attempts,
    fallback: meta.fallback === true,
    valid: meta.valid,
    errors: meta.errors ?? [],
    stats: meta.stats ?? null,
    diagnostics: meta.diagnostics ?? [],
  };
}

export function generateMap({ seed = 1, config = {} } = {}) {
  const cfg = mapConfig(config === null || config === undefined ? {} : config);
  const diagnostics = [];
  const attempts = Math.max(1, cfg.attempts);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptSeed = hashSeed(seed, 'attempt', attempt, cfg.version, cfg.depth);
    const topologyRng = createRng(hashSeed(attemptSeed, 'topology'));
    const typeRng = createRng(hashSeed(attemptSeed, 'node-types'));
    const anchorRng = createRng(hashSeed(attemptSeed, 'anchors'));
    const built = buildTopology(topologyRng, cfg);
    const nodes = built.nodes;
    const anchors = planAnchorFloors(anchorRng, cfg, built.byFloor);
    assignNodeTypes(nodes, typeRng, cfg, anchors);
    repairNodeTypes(nodes, cfg);
    const result = validateMap(nodes, cfg);
    diagnostics.push({
      attempt,
      ok: result.ok,
      errors: result.errors.slice(0, 3).map((error) => error.code),
    });
    if (result.ok) {
      fillNodeContent(nodes, seed, cfg);
      return makeMap(seed, cfg, nodes, built.byFloor, {
        attempts: attempt + 1,
        fallback: false,
        valid: true,
        stats: result.stats,
        diagnostics,
      });
    }
  }

  // 保底模板：结构与内容都确定，仍然走完整验证。
  const built = buildTemplateNodes(seed, cfg);
  repairNodeTypes(built.nodes, cfg);
  fillNodeContent(built.nodes, seed, cfg);
  const result = validateMap(built.nodes, cfg);
  return makeMap(seed, cfg, built.nodes, built.byFloor, {
    attempts,
    fallback: true,
    valid: result.ok,
    errors: result.errors,
    stats: result.stats,
    diagnostics,
  });
}

/** 生成结果的简短诊断文本，报告和存档提示共用。 */
export function describeGeneration(map) {
  if (map === null || map === undefined) return '没有地图';
  const parts = [`种子 ${map.seed}`, `v${map.mapVersion}`, `${map.depth} 层`];
  if (map.stats !== null && map.stats !== undefined) parts.push(`${map.stats.nodes} 节点`);
  parts.push(map.fallback ? '保底模板' : `第 ${map.attempts} 次尝试通过`);
  return parts.join(' · ');
}

export { MAP_VERSION };
