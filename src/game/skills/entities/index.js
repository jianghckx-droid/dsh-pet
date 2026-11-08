// 持续实体生命周期分派：固定步推进、稳定 ID 顺序、清理与只读视图。
//
// 新实体在本帧施放后同帧首次推进；这条规则由测试锁定，避免以后改变时序却
// 没有可见说明。遍历和候选目标都使用稳定 ID / 距离加 ID 排序。

import { createEntityContext } from '../world.js';
import { diagnose } from '../resolve.js';
import { projectileEntity } from './projectile.js';
import { orbitSwordEntity } from './orbitSword.js';
import { piercingSwordEntity } from './piercingSword.js';
import { swordArrayEntity } from './swordArray.js';
import { trapEntity } from './trap.js';

export const ENTITY_HANDLERS = Object.freeze({
  projectile: projectileEntity,
  orbitSword: orbitSwordEntity,
  piercingSword: piercingSwordEntity,
  swordArray: swordArrayEntity,
  trap: trapEntity,
});

export function updateEntities(world, dt) {
  if (!Array.isArray(world.entities)) world.entities = [];
  world.entities.sort((a, b) => a.id - b.id);
  for (const entity of world.entities) {
    if (entity.dead) continue;
    const handler = ENTITY_HANDLERS[entity.kind];
    if (handler === undefined) {
      diagnose(world, 'unknown-entity', { kind: String(entity.kind), id: entity.id });
      entity.dead = true;
      continue;
    }
    handler.update(createEntityContext(world, entity), dt);
  }
  world.entities = world.entities.filter((entity) => !entity.dead);
  // 客户端和既有测试使用只读分类视图；权威列表仍是 world.entities。
  world.projectiles = world.entities.filter((entity) => entity.kind === 'projectile');
  world.orbitSwords = world.entities.filter((entity) => entity.kind === 'orbitSword');
  world.piercingSwords = world.entities.filter((entity) => entity.kind === 'piercingSword');
  world.swordArrays = world.entities.filter((entity) => entity.kind === 'swordArray');
  world.traps = world.entities.filter((entity) => entity.kind === 'trap');
}
