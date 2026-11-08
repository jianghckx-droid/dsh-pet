// 属性定义：命中时附带什么效果。
//
// 属性只声明 requires 与 onHit。相同属性装到不同动作上沿用同一套规则，
// 不存在"毒飞弹 / 毒光环"这类组合代码。

export const ELEMENT_DEFS = [
  {
    id: 'fire',
    kind: 'element',
    label: '火焰',
    color: '#ff9f45',
    requires: ['hit'],
    bonusDamage: 0,
    onHit: [{ type: 'applyStatus', status: 'burn', stacks: 1 }],
    desc: '命中造成伤害并施加灼烧。',
  },
  {
    id: 'frost',
    kind: 'element',
    label: '冰霜',
    color: '#9fd8ff',
    requires: ['hit'],
    bonusDamage: 0,
    onHit: [{ type: 'applyStatus', status: 'chill', stacks: 1 }],
    desc: '命中造成伤害并施加寒冷。',
  },
  {
    id: 'thunder',
    kind: 'element',
    label: '雷电',
    color: '#ffe066',
    requires: ['hit'],
    bonusDamage: 1,
    onHit: [{ type: 'applyStatus', status: 'charge', stacks: 1 }],
    desc: '命中造成更高伤害并施加充能。',
  },
];
