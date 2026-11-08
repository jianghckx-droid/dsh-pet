// 战斗风格目录：只提供起始构筑、默认移动偏好与视觉主题，不拥有独立结算。
//
// 解锁条件使用账户累计战绩（bestFloor）。新玩家先能选近战与远程；剑修、陷阱师
// 随最高层数开放。战斗核心不按风格 ID 判断伤害规则。

export const STYLE_DEFS = [
  {
    id: 'ranged',
    kind: 'style',
    label: '远程射手',
    visualTheme: 'ranged',
    movementPreference: 'keepDistance',
    defaultStyle: true,
    unlockedBy: { bestFloor: 1 },
    startingBuild: [{ id: 'skill-1', action: 'projectile', element: null, modifier: null }],
    desc: '用弹体与射程处理目标，默认保持距离。',
  },
  {
    id: 'melee',
    kind: 'style',
    label: '近战斗士',
    visualTheme: 'melee',
    movementPreference: 'approach',
    unlockedBy: { bestFloor: 1 },
    startingBuild: [{ id: 'skill-1', action: 'swing', element: null, modifier: null }],
    desc: '靠近敌人用扇形挥斩覆盖近身目标。',
  },
  {
    id: 'sword',
    kind: 'style',
    label: '剑修',
    visualTheme: 'sword',
    movementPreference: 'keepDistance',
    unlockedBy: { bestFloor: 3 },
    startingBuild: [{ id: 'skill-1', action: 'arcSword', element: null, modifier: null }],
    desc: '驭使飞剑从中距离划出弧线追击，敌人贴近时后撤；也可改装穿敌、剑阵或环身御剑。',
  },
  {
    id: 'trapper',
    kind: 'style',
    label: '陷阱师',
    visualTheme: 'trap',
    movementPreference: 'keepDistance',
    unlockedBy: { bestFloor: 5 },
    startingBuild: [{ id: 'skill-1', action: 'trap', element: null, modifier: null }],
    desc: '把陷阱留在敌人必经之路，再引其踏入。',
  },
];
