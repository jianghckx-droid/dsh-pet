// 地图随机数：显式种子 + 哈希派生。
//
// 地图生成不使用 Math.random()。所有结构、类型与内容都从主种子经
// hashSeed(...) 派生，同版本生成器、配置和内容池使用相同种子时结果完全一致。
// 固定算法：FNV-1a（32 位）哈希 + mulberry32 序列，参数属于存档兼容范围，
// 修改会改变同种子生成的地图，必须同时提升 MAP_VERSION。

export const MAP_RNG_VERSION = 1;

/** 把任意串与多个部分拼成稳定的 32 位种子。 */
export function hashSeed(...parts) {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    // 分隔符：避免 ("ab","c") 与 ("a","bc") 派生出同一序列。
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32：固定序列、无隐藏状态、跨平台一致。 */
export function createRng(seed) {
  let state = Number(seed) >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 闭区间整数。 */
export function rngInt(rng, min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function rngPick(rng, list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** 按权重取一项：entries 形如 [[value, weight], ...]，权重必须为正。 */
export function pickWeighted(rng, entries) {
  let total = 0;
  for (const entry of entries) {
    const weight = Number(entry[1]);
    if (Number.isFinite(weight) && weight > 0) total += weight;
  }
  if (total <= 0) return entries.length === 0 ? undefined : entries[0][0];
  let roll = rng() * total;
  for (const entry of entries) {
    const weight = Number(entry[1]);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    roll -= weight;
    if (roll <= 0) return entry[0];
  }
  return entries[entries.length - 1][0];
}

export function rngShuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
