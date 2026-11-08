// 构筑编辑与升级候选：放置规则、替换、备用栏与三选一。
//
// 放置只做"哪个技能的哪个槽位"的判断；是否合法仍由 compile.js 复核，
// 所以 UI 预览与真正装入不会给出不同结果。

import { BUILD_LIMITS } from './schema.js';
import { contentById, contentList } from './registry.js';
import { compileBuild, normalizeBuild } from './compile.js';

const SLOT_OF_KIND = Object.freeze({ element: 'element', modifier: 'modifier' });

function cloneBuild(input) {
  const build = normalizeBuild(input);
  return {
    version: build.version,
    skills: build.skills.map((skill) => ({ ...skill })),
    reserve: [...build.reserve],
  };
}

function actionOf(skill) {
  const def = contentById(skill.action);
  return def !== undefined && def.kind === 'action' ? def : null;
}

export function placementLabel(build, placement) {
  const skill = build.skills[placement.skillIndex];
  const action = skill === undefined ? null : actionOf(skill);
  const name = action === null ? `技能 ${placement.skillIndex + 1}` : action.label;
  if (placement.kind === 'action') {
    return placement.replacing ? `${name} · 动作槽（替换）` : `新技能 ${placement.skillIndex + 1}`;
  }
  return `${name} · ${placement.kind === 'element' ? '属性' : '修饰'}槽`;
}

/** 空槽位：动作创建新技能，属性/修饰填入兼容的空槽。 */
export function placementsFor(input, id) {
  const build = normalizeBuild(input);
  const def = contentById(id);
  if (def === undefined) return [];
  if (def.kind === 'action') {
    if (build.skills.length >= BUILD_LIMITS.maxSkills) return [];
    if (build.skills.some((skill) => skill.action === id)) return [];
    return [{ kind: 'action', skillIndex: build.skills.length, replacing: false }];
  }
  const slot = SLOT_OF_KIND[def.kind];
  if (slot === undefined) return [];
  const out = [];
  build.skills.forEach((skill, skillIndex) => {
    const action = actionOf(skill);
    if (action === null) return;
    if (skill[slot] !== null) return;
    if (!def.requires.every((cap) => action.capabilities.includes(cap))) return;
    out.push({ kind: def.kind, skillIndex, replacing: false });
  });
  return out;
}

/**
 * 替换槽位：已经装了同类组件时，玩家可以换掉它。
 * 动作只在两个技能槽都满时提供替换，替换会改变该技能的运行身份。
 */
export function replacementsFor(input, id) {
  const build = normalizeBuild(input);
  const def = contentById(id);
  if (def === undefined) return [];
  if (def.kind === 'action') {
    if (build.skills.length < BUILD_LIMITS.maxSkills) return [];
    if (build.skills.some((skill) => skill.action === id)) return [];
    return build.skills.map((skill, skillIndex) => ({
      kind: 'action',
      skillIndex,
      replacing: true,
    }));
  }
  const slot = SLOT_OF_KIND[def.kind];
  if (slot === undefined) return [];
  const out = [];
  build.skills.forEach((skill, skillIndex) => {
    const action = actionOf(skill);
    if (action === null) return;
    if (skill[slot] === null) return;
    if (skill[slot] === id) return;
    if (!def.requires.every((cap) => action.capabilities.includes(cap))) return;
    out.push({ kind: def.kind, skillIndex, replacing: true });
  });
  return out;
}

export function upgradeSlots(build, id) {
  const placements = placementsFor(build, id);
  if (placements.length > 0) return placements;
  return replacementsFor(build, id);
}

/** 装入组件。替换下来的旧组件进入备用栏；备用栏满时丢弃最旧的一个。 */
export function installChoice(input, id, placement) {
  const build = cloneBuild(input);
  const def = contentById(id);
  if (def === undefined) return { ok: false, reason: 'unknown-component', build };
  if (placement === undefined || placement === null) {
    const first = upgradeSlots(build, id)[0];
    if (first === undefined) return { ok: false, reason: 'no-slot', build };
    placement = first;
  }
  const warnings = [];
  if (def.kind === 'action') {
    if (placement.kind !== 'action') return { ok: false, reason: 'wrong-slot', build };
    const reserve = build.reserve;
    const incomingIndex = reserve.indexOf(id);
    if (incomingIndex >= 0) reserve.splice(incomingIndex, 1);

    if (placement.replacing === true) {
      const skill = build.skills[placement.skillIndex];
      if (skill === undefined) return { ok: false, reason: 'no-skill', build };
      const moved = [];
      let nextElement = skill.element;
      let nextModifier = skill.modifier;
      const caps = new Set(def.capabilities);
      if (nextElement !== null) {
        const element = contentById(nextElement);
        if (element === undefined || !element.requires.every((cap) => caps.has(cap))) {
          moved.push(nextElement);
          nextElement = null;
        }
      }
      if (nextModifier !== null) {
        const modifier = contentById(nextModifier);
        if (modifier === undefined || !modifier.requires.every((cap) => caps.has(cap))) {
          moved.push(nextModifier);
          nextModifier = null;
        }
      }
      if (skill.action !== null) moved.push(skill.action);
      const free = BUILD_LIMITS.maxReserve - reserve.length;
      if (moved.length > free) {
        return {
          ok: false,
          reason: 'reserve-full',
          build,
          moved,
          free,
          required: moved.length,
        };
      }
      for (const component of moved) {
        if (!reserve.includes(component)) reserve.push(component);
      }
      skill.action = id;
      skill.element = nextElement;
      skill.modifier = nextModifier;
      return {
        ok: true,
        build,
        warnings,
        moved,
        retained: [nextElement, nextModifier].filter((component) => component !== null),
      };
    }

    if (build.skills.length >= BUILD_LIMITS.maxSkills) {
      return { ok: false, reason: 'too-many-skills', build };
    }
    if (build.skills.some((skill) => skill.action === id)) {
      return { ok: false, reason: 'duplicate-action', build };
    }
    let number = build.skills.length + 1;
    const used = new Set(build.skills.map((skill) => skill.id));
    while (used.has(`skill-${number}`)) number += 1;
    build.skills.push({ id: `skill-${number}`, action: id, element: null, modifier: null });
  } else {
    if (placement.kind !== def.kind) return { ok: false, reason: 'wrong-slot', build };
    const slot = SLOT_OF_KIND[def.kind];
    const skill = build.skills[placement.skillIndex];
    if (skill === undefined || slot === undefined) return { ok: false, reason: 'no-skill', build };
    const action = actionOf(skill);
    if (action === null || !def.requires.every((cap) => action.capabilities.includes(cap))) {
      return { ok: false, reason: 'capability-mismatch', build };
    }
    const previous = skill[slot];
    // 原子替换：先取出本次装配组件，再放入旧组件；只有取出后仍无空位才丢弃最旧项。
    const incomingIndex = build.reserve.indexOf(id);
    if (incomingIndex >= 0) build.reserve.splice(incomingIndex, 1);
    skill[slot] = id;
    if (previous !== null) {
      if (build.reserve.length >= BUILD_LIMITS.maxReserve) {
        const dropped = build.reserve.shift();
        warnings.push({ code: 'reserve-full', message: `备用栏已满，丢弃 ${dropped}` });
      }
      build.reserve.push(previous);
    }
  }
  return { ok: true, build, warnings };
}

/** 把备用栏组件装回构筑；优先空槽，其次替换同类槽位。 */
export function equipReserveComponent(input, id) {
  const build = normalizeBuild(input);
  if (!build.reserve.includes(id)) return { ok: false, reason: 'not-in-reserve', build };
  const slots = upgradeSlots(build, id);
  if (slots.length === 0) return { ok: false, reason: 'no-slot', build };
  return installChoice(build, id, slots[0]);
}

function candidatesFor(build, kind) {
  const defs = contentList(kind);
  return defs.filter((def) => {
    const slots = upgradeSlots(build, def.id);
    if (slots.length === 0) return false;
    return slots.some((slot) => installChoice(build, def.id, slot).ok);
  });
}

function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function stageKinds(build, draftCount) {
  const hasSkillRoom = build.skills.length < BUILD_LIMITS.maxSkills;
  if (draftCount === 0) return ['element'];
  if (draftCount <= 2) return ['modifier', 'element'];
  const hasActionOption = candidatesFor(build, 'action').length > 0;
  if (hasSkillRoom || hasActionOption) return ['action', 'modifier', 'element'];
  return ['modifier', 'element'];
}

export function stageLabel(build, draftCount) {
  if (draftCount === 0) return '选择属性';
  if (draftCount <= 2) return '选择修饰';
  if (build.skills.length < BUILD_LIMITS.maxSkills) return '选择动作';
  if (candidatesFor(build, 'action').length > 0) return '强化或更换动作';
  return '强化技能';
}

/**
 * 生成三选一候选。优先覆盖本阶段开放的类型，再随机补齐。
 * 池子为空时返回空数组，由战斗层保留 pending，稍后再试。
 */
export function offerUpgrades(input, rng, { draftCount = 0, count = 3 } = {}) {
  const build = normalizeBuild(input);
  const kinds = stageKinds(build, draftCount);
  const pools = {};
  for (const kind of kinds) pools[kind] = shuffled(candidatesFor(build, kind), rng);
  const picked = [];
  const seen = new Set();
  let guard = 0;
  while (picked.length < count && guard < 64) {
    guard += 1;
    let added = false;
    for (const kind of kinds) {
      if (picked.length >= count) break;
      const pool = pools[kind];
      if (pool.length === 0) continue;
      while (pool.length > 0 && seen.has(pool[0].id)) pool.shift();
      if (pool.length === 0) continue;
      const def = pool.shift();
      picked.push(def.id);
      seen.add(def.id);
      added = true;
    }
    if (!added) break;
  }
  return picked;
}

/** 选择界面里的一张候选：装入后的完整描述。 */
export function choiceInfo(build, id, placement) {
  const def = contentById(id);
  if (def === undefined) return null;
  const slots = upgradeSlots(build, id);
  const target = placement ?? slots[0] ?? null;
  let description = def.desc;
  let label = def.label;
  let blocked = false;
  let note = '';
  let moved = [];
  let retained = [];
  if (target !== null) {
    const installed = installChoice(build, id, target);
    if (installed.ok) {
      const compiled = compileBuild(installed.build);
      const plan = compiled.plans[target.skillIndex];
      if (plan !== undefined) {
        description = plan.description;
        label = plan.label;
      }
      moved = installed.moved ?? [];
      retained = installed.retained ?? [];
      if (moved.length > 0) {
        note = '将移入备用栏：' + moved.map((component) => contentById(component)?.label ?? component).join('、');
      }
    } else {
      blocked = true;
      moved = installed.moved ?? [];
      if (installed.reason === 'reserve-full') {
        note = `备用栏空间不足：需要 ${installed.required ?? moved.length} 格，只有 ${installed.free ?? 0} 格`;
      } else if (installed.reason === 'capability-mismatch') {
        note = '当前动作不支持该组件';
      } else if (installed.reason === 'duplicate-action') {
        note = '该动作已经在构筑中';
      } else {
        note = '无法装入该位置';
      }
    }
  }
  return {
    id,
    kind: def.kind,
    label,
    baseLabel: def.label,
    description,
    color: def.color ?? '#dbe7f0',
    slots,
    target,
    blocked,
    note,
    moved,
    retained,
  };
}
