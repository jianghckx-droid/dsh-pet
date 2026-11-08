// 共享反应定义：订阅语义事件，声明条件、消耗和产生的命令。
//
// 三个初版反应都有显式终止条件：
//   传火：传过去的灼烧不能再触发传火
//   导电：雷击不施加充能，也不能再触发导电
//   碎裂：碎裂伤害没有 heavy 标签，不能再触发碎裂
// 数值与范围都在这里，不能靠递归副作用隐式决定。

export const REACTION_DEFS = [
  {
    id: 'spreadFire',
    kind: 'reaction',
    handler: 'spreadFire',
    label: '传火',
    event: 'entityDied',
    priority: 10,
    color: '#ff9f45',
    config: { radius: 40, targets: 2, transferRatio: 0.5, minStacks: 1, maxStacks: 5, maxChain: 4 },
    desc: '灼烧中的敌人被击败时，把一部分灼烧传给附近敌人。',
  },
  {
    id: 'conductive',
    kind: 'reaction',
    handler: 'conductive',
    label: '导电',
    event: 'hitResolved',
    priority: 20,
    color: '#ffe066',
    config: { consume: 3, radius: 44, targets: 3, damage: 3 },
    desc: '带充能的敌人再次受到雷电命中时，消耗充能并对附近敌人造成雷击。',
  },
  {
    id: 'shatter',
    kind: 'reaction',
    handler: 'shatter',
    label: '碎裂',
    event: 'hitResolved',
    priority: 30,
    color: '#9fd8ff',
    config: { status: 'chill', threshold: 3, radius: 28, targets: 4, damage: 3 },
    desc: '寒冷达到 3 层的敌人受到强力命中时，消耗寒冷并对周围造成范围伤害。',
  },
];
