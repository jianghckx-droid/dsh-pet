// 战斗风格读取：起始构筑、默认移动偏好、解锁与视觉主题。
// 风格只引用组件，不拥有独立结算代码。

import { BUILD_VERSION } from './compile.js';
import { contentById, contentList } from './registry.js';

export function listStyles() {
  return contentList('style');
}

export function styleById(id) {
  const def = contentById(id);
  return def !== undefined && def.kind === 'style' ? def : undefined;
}

export function defaultStyle() {
  const styles = listStyles();
  return styles.find((style) => style.defaultStyle === true) ?? styles[0];
}

export function isStyleUnlocked(style, stats) {
  if (style === undefined) return false;
  const needed = style.unlockedBy?.bestFloor ?? 1;
  return (stats?.bestFloor ?? 1) >= needed;
}

export function availableStyles(stats) {
  return listStyles().filter((style) => isStyleUnlocked(style, stats));
}

/** 未知或被锁定的风格安全回退到默认风格，不覆盖已保存构筑。 */
export function resolveStyle(id, stats) {
  const style = styleById(id);
  if (style !== undefined && isStyleUnlocked(style, stats)) return style;
  return defaultStyle();
}

/** 由风格生成一轮的起始构筑；已有存档的构筑不会被隐式替换。 */
export function buildFromStyle(style) {
  const source = style ?? defaultStyle();
  const skills = source.startingBuild.map((skill, index) => ({
    id: typeof skill.id === 'string' && skill.id.length > 0 ? skill.id : `skill-${index + 1}`,
    action: skill.action,
    element: skill.element ?? null,
    modifier: skill.modifier ?? null,
  }));
  return { version: BUILD_VERSION, skills, reserve: [] };
}
