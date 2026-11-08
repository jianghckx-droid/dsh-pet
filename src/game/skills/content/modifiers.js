// 修饰定义：改变技能行为，声明能力要求，不直接修改其他技能实例。
//
// split  需要 targeted：首次命中后向附近目标产生较弱效果
// echo   需要 hit：一次效果结束后延迟触发一次较弱效果
// expand 需要 area：扩大影响范围，同时降低触发频率
// pull   需要 area：把命中目标向效果中心拉近

export const MODIFIER_DEFS = [
  {
    id: 'split',
    kind: 'modifier',
    label: '分裂',
    color: '#c9b3ff',
    requires: ['ranged'],
    transform: { type: 'split', count: 2, damageScale: 0.5, radius: 40 },
    desc: '首次命中后向附近目标产生较弱的后续效果。',
  },
  {
    id: 'echo',
    kind: 'modifier',
    label: '回响',
    color: '#a0e7c8',
    requires: ['hit'],
    transform: { type: 'echo', delay: 0.7, damageScale: 0.5 },
    desc: '技能效果结束后延迟触发一次较弱效果。',
  },
  {
    id: 'expand',
    kind: 'modifier',
    label: '扩大',
    color: '#ffd166',
    requires: ['area'],
    transform: { type: 'expand', radiusScale: 1.45, cooldownScale: 1.25 },
    desc: '影响范围更大，但触发更慢。',
  },
  {
    id: 'pull',
    kind: 'modifier',
    label: '牵引',
    color: '#8fd8ff',
    requires: ['area'],
    transform: { type: 'pull', strength: 16 },
    desc: '命中时把敌人向效果中心拉近。',
  },
  {
    id: 'detonate',
    kind: 'modifier',
    label: '引爆',
    color: '#ff6b6b',
    requires: ['hit'],
    transform: {
      type: 'detonate',
      damagePerStack: 2,
      radius: 24,
      maxTargets: 3,
      cooldownScale: 1.2,
    },
    desc: '消耗目标已有状态，在目标处造成范围伤害。',
  },
];
