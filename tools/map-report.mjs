#!/usr/bin/env node
// 批量生成地图并做结构与数值检查。
//
// 用法:
//   node tools/map-report.mjs              # 99 层，200 个种子
//   node tools/map-report.mjs --seeds 500
//   node tools/map-report.mjs --prototype  # 11 层原型配置
//
// 输出：生成成功率、重试与保底模板使用率、耗时、类型分布、路线抽样、
// 休息 / 商店最大间隔、地图相似度与金币收支估算。这些数字是调参依据，
// 不是「已验证平衡」的结论。

import {
  MAP_CONFIG,
  MAP_VERSION,
  mapConfig,
  prototypeConfig,
} from '../src/game/map/config.js';
import { generateMap } from '../src/game/map/generate.js';
import { routeStates, countRoutes, validateMap } from '../src/game/map/validate.js';
import { createRng, hashSeed } from '../src/game/map/rng.js';
import { shopPriceRange } from '../src/game/map/content.js';
import { MAP_DEPTH } from '../src/game/floors.js';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const prototype = args.includes('--prototype');
const seeds = readArg('--seeds', prototype ? 200 : 200);
const config = prototype ? prototypeConfig() : MAP_CONFIG;
const depth = config.depth;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

function sampleRoute(rng, nodes, rows) {
  let node = (rows.get(1) ?? [])[0];
  const path = [];
  while (node !== undefined) {
    path.push(node);
    if (node.next.length === 0) break;
    const nextId = node.next[Math.min(node.next.length - 1, Math.floor(rng() * node.next.length))];
    node = (rows.get(node.floor + 1) ?? []).find((entry) => entry.id === nextId);
  }
  return path;
}

function maxGap(path, type) {
  let gap = 0;
  let max = 0;
  for (const node of path) {
    if (node.type === type) gap = 0;
    else {
      gap += 1;
      max = Math.max(max, gap);
    }
  }
  return max;
}

const started = Date.now();
const typeTotals = {};
const restGaps = [];
const shopGaps = [];
const routeTypeCounts = {};
const goldPerFloor = new Map();
const nodeCounts = [];
const routeCounts = [];
const attemptCounts = [];
const failures = [];
const signatures = new Map();
let fallbackCount = 0;
let invalidCount = 0;

for (let seed = 1; seed <= seeds; seed += 1) {
  const map = generateMap({ seed: seed * 7919, config });
  if (map.valid !== true) {
    invalidCount += 1;
    failures.push({ seed, errors: map.errors.slice(0, 2) });
    continue;
  }
  if (map.fallback) fallbackCount += 1;
  attemptCounts.push(map.attempts);
  nodeCounts.push(map.nodes.length);
  routeCounts.push(countRoutes(map.nodes, config));

  const rows = new Map();
  for (const node of map.nodes) {
    if (!rows.has(node.floor)) rows.set(node.floor, []);
    rows.get(node.floor).push(node);
    typeTotals[node.type] = (typeTotals[node.type] ?? 0) + 1;
    if (node.content?.gold !== undefined) {
      const floorGold = goldPerFloor.get(node.floor) ?? { total: 0, count: 0 };
      floorGold.total += node.content.gold;
      floorGold.count += 1;
      goldPerFloor.set(node.floor, floorGold);
    }
  }
  for (const row of rows.values()) row.sort((a, b) => a.column - b.column);

  // 相似度：把每层类型序列拼成签名，统计不同地图的重复率
  const signature = [...rows.entries()]
    .map(([floor, row]) => floor + ':' + row.map((node) => node.type[0]).join(''))
    .join('|');
  signatures.set(signature, (signatures.get(signature) ?? 0) + 1);

  const rng = createRng(hashSeed(seed, 'report-route'));
  for (let i = 0; i < 40; i += 1) {
    const path = sampleRoute(rng, map.nodes, rows);
    restGaps.push(maxGap(path, 'rest'));
    shopGaps.push(maxGap(path, 'shop'));
    for (const node of path) routeTypeCounts[node.type] = (routeTypeCounts[node.type] ?? 0) + 1;
  }
}

const elapsed = Date.now() - started;
const totalNodes = Object.values(typeTotals).reduce((sum, value) => sum + value, 0) || 1;
const totalRouteNodes = Object.values(routeTypeCounts).reduce((sum, value) => sum + value, 0) || 1;
const duplicateMaps = [...signatures.values()].filter((count) => count > 1)
  .reduce((sum, count) => sum + (count - 1), 0);

const share = (value, total) => ((value / total) * 100).toFixed(1) + '%';
const ordered = ['normal', 'elite', 'rest', 'event', 'shop', 'boss'];

console.log(`# 地图批量检查 · ${prototype ? '11 层原型' : '99 层'} · v${MAP_VERSION}`);
console.log('');
console.log(`种子数 ${seeds} · 总耗时 ${elapsed}ms（平均 ${(elapsed / seeds).toFixed(1)}ms/张）`);
console.log(`有效 ${seeds - invalidCount}/${seeds} · 保底模板 ${fallbackCount} · 重试上限内通过率 ${share(seeds - invalidCount - fallbackCount, seeds)}`);
console.log(`重试次数 p50 ${percentile(attemptCounts, 50)} / p95 ${percentile(attemptCounts, 95)} / max ${Math.max(0, ...attemptCounts)}`);
console.log(`节点数 p50 ${percentile(nodeCounts, 50)}（${Math.min(...nodeCounts)}–${Math.max(...nodeCounts)}）`);
console.log(`有效路线数 p50 ${percentile(routeCounts, 50)}（饱和计数上限 1e9）`);
console.log(`地图签名重复 ${duplicateMaps} 张 / ${seeds - invalidCount}（越低越随机）`);
console.log('');
console.log('## 类型分布（整图 / 抽样路线）');
console.log('| 类型 | 整图占比 | 单条路线平均 |');
console.log('|---|---|---|');
for (const id of ordered) {
  const whole = typeTotals[id] ?? 0;
  const route = routeTypeCounts[id] ?? 0;
  const perRoute = route === 0 ? 0 : route / (seeds * 40);
  console.log(`| ${id} | ${share(whole, totalNodes)} | ${perRoute.toFixed(2)} |`);
}
console.log('');
console.log(`## 路线保底（抽样 ${seeds * 40} 条完整路线）`);
console.log(`休息最大间隔 p50 ${percentile(restGaps, 50)} / p95 ${percentile(restGaps, 95)} / 上限 ${mapConfig(config).guards.restGap - 1} 层无休息`);
console.log(`商店最大间隔 p50 ${percentile(shopGaps, 50)} / p95 ${percentile(shopGaps, 95)} / 上限 ${mapConfig(config).guards.shopGap - 1} 层无商店`);
console.log('');
console.log('## 金币收支估算（单场战斗节点平均金币）');
const floors = [...goldPerFloor.keys()].sort((a, b) => a - b);
const picks = [2, Math.round(depth * 0.25), Math.round(depth * 0.5), Math.round(depth * 0.75), depth - 2]
  .filter((floor, index, list) => floor >= 2 && list.indexOf(floor) === index);
console.log('| 层 | 战斗金币 | 商店价格区间 |');
console.log('|---|---|---|');
for (const floor of picks) {
  const entry = goldPerFloor.get(floor);
  if (entry === undefined) continue;
  const average = entry.total / entry.count;
  const range = shopPriceRange(floor, mapConfig(config));
  console.log(`| ${floor} | ${average.toFixed(1)} | ${range.lowest}–${range.highest} |`);
}
console.log('');

if (invalidCount > 0) {
  console.log('## 失败样本');
  for (const failure of failures.slice(0, 5)) {
    console.log(`- 种子 ${failure.seed}：${failure.errors.map((error) => error.code).join(', ')}`);
  }
  console.log('');
}

// 结构性断言：报告同时充当一次轻量回归检查
const summary = generateMap({ seed: 2027, config });
const rows = new Map();
for (const node of summary.nodes) {
  if (!rows.has(node.floor)) rows.set(node.floor, []);
  rows.get(node.floor).push(node);
}
const violations = routeStates(summary.nodes, mapConfig(config)).violations;
const checked = validateMap(summary.nodes, mapConfig(config));
console.log(
  `示例地图（种子 2027）：${summary.nodes.length} 节点 · ${checked.stats?.edges ?? 0} 连线 · ` +
  `${checked.stats?.routes ?? 0} 条路线 · 违规 ${violations.length} · ${summary.fallback ? '保底模板' : '第 ' + summary.attempts + ' 次通过'}`,
);
if (!checked.ok || invalidCount > 0) {
  console.error('地图检查未通过：存在无效地图');
  process.exitCode = 1;
}
