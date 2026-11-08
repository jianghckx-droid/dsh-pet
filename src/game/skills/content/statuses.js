// 状态定义：层数、时长、重复施加策略与周期处理器都由定义说明，不隐式继承。
//
// 第一版原型只有三种共享状态：
//   burn   灼烧：持续损失生命
//   chill  寒冷：降低移动速度
//   charge 充能：可被后续雷电效果消耗
//
// 数值是原型参数，集中放在这里，便于用 tools/balance-sim.mjs 校准。

export const STATUS_DEFS = [
  {
    id: 'burn',
    kind: 'status',
    label: '灼烧',
    color: '#ff9f45',
    cap: 5,
    duration: 6,
    stacking: 'add-refresh',
    tickSeconds: 1.5,
    damagePerStack: 1,
    desc: '每 1.5 秒按层数损失生命，最多 5 层',
  },
  {
    id: 'chill',
    kind: 'status',
    label: '寒冷',
    color: '#9fd8ff',
    cap: 5,
    duration: 5,
    stacking: 'add-refresh',
    slowPerStack: 0.08,
    maxSlow: 0.4,
    desc: '每层降低 8% 移动速度，最多 5 层',
  },
  {
    id: 'charge',
    kind: 'status',
    label: '充能',
    color: '#ffe066',
    cap: 3,
    duration: 8,
    stacking: 'add-refresh',
    desc: '可被下一次雷电命中消耗，引发导电',
  },
];
