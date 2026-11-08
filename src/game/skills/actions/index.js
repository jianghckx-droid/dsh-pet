// 动作实现表：契约与运行时处理器在同一处合并，任何一边缺失都会在加载时失败。
//
// registry.js 只读 contracts.js（避免把世界依赖带进内容校验），runtime.js 读
// 本文件；测试会核对两边的 ID 集合一致。

import { ACTION_CONTRACTS } from './contracts.js';
import { projectileAction } from './projectile.js';
import { auraAction } from './aura.js';
import { impactAction } from './impact.js';
import { swingAction } from './swing.js';
import { arcSwordAction } from './arcSword.js';
import { orbitSwordAction } from './orbitSword.js';
import { swordPierceAction } from './swordPierce.js';
import { swordArrayAction } from './swordArray.js';
import { trapAction } from './trap.js';

const HANDLERS = Object.freeze({
  projectile: projectileAction,
  aura: auraAction,
  impact: impactAction,
  swing: swingAction,
  arcSword: arcSwordAction,
  orbitSword: orbitSwordAction,
  swordPierce: swordPierceAction,
  swordArray: swordArrayAction,
  trap: trapAction,
});

for (const id of Object.keys(ACTION_CONTRACTS)) {
  if (HANDLERS[id] === undefined) throw new Error(`缺少动作处理器实现：${id}`);
}
for (const id of Object.keys(HANDLERS)) {
  if (ACTION_CONTRACTS[id] === undefined) throw new Error(`缺少动作契约：${id}`);
}

export const ACTION_IMPLEMENTATIONS = Object.freeze(
  Object.fromEntries(
    Object.keys(HANDLERS).map((id) => [
      id,
      Object.freeze({ contract: ACTION_CONTRACTS[id], handler: HANDLERS[id] }),
    ]),
  ),
);

export const IMPLEMENTED_ACTION_IDS = Object.freeze(Object.keys(ACTION_IMPLEMENTATIONS));

export function actionImplementation(id) {
  return ACTION_IMPLEMENTATIONS[id];
}
