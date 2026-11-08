// 共享常量：场地尺寸由战斗世界、移动决策和渲染共同使用。
// 单独成文件避免 movement / runtime / arena 互相导入造成循环。

export const ARENA = Object.freeze({ w: 160, h: 144 });
