// 数值格式化：编译、描述、脚本共用，避免每个模块各写一套取整规则。

export function fmtNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function percentText(scale) {
  return fmtNumber(Math.round(scale * 100));
}
