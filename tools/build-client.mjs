#!/usr/bin/env node
// 把 src/game/ 下的核心模块内联进 client.js 的 `// <core>` 区域。
//
// 为什么需要这一步：client.js 是宿主的单文件 loader 格式
// （window.__ModuleLoader__.load({ factory(require) })），第三方插件没有打包器，
// 不能 import 本地相对路径。所以核心以 ESM 维护，构建时内联成单文件。
//
// 用法:
//   node tools/build-client.mjs          # 写入 client.js
//   node tools/build-client.mjs --check  # 只校验是否过期（CI/提交前用）
//
// 约定:
//   - 区域标记必须成对出现：`// <core>` 与 `// </core>`
//   - 文件顺序就是内联后的声明顺序，被依赖的模块必须排在前面
//   - src/game 里不要写 default export，也不要用与彼此冲突的顶层名字

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client.js');
const FILES = [
  'skills/schema.js',
  'skills/constants.js',
  'skills/format.js',
  'skills/content/statuses.js',
  'skills/content/actions.js',
  'skills/content/elements.js',
  'skills/content/modifiers.js',
  'skills/content/reactions.js',
  'skills/content/styles.js',
  'skills/actions/contracts.js',
  'skills/modifiers/index.js',
  'skills/registry.js',
  'skills/actions/projectile.js',
  'skills/actions/aura.js',
  'skills/actions/impact.js',
  'skills/actions/swing.js',
  'skills/actions/orbitSword.js',
  'skills/actions/swordPierce.js',
  'skills/actions/swordArray.js',
  'skills/actions/trap.js',
  'skills/actions/index.js',
  'skills/compile.js',
  'skills/status.js',
  'skills/reactions.js',
  'skills/resolve.js',
  'skills/world.js',
  'skills/entities/projectile.js',
  'skills/entities/orbitSword.js',
  'skills/entities/piercingSword.js',
  'skills/entities/swordArray.js',
  'skills/entities/trap.js',
  'skills/entities/index.js',
  'skills/runtime.js',
  'skills/draft.js',
  'skills/styles.js',
  'movement.js',
  'enemies.js',
  'floors.js',
  'arena.js',
];
const START = '// <core>';
const END = '// </core>';

/** 去掉 import 语句与 export 关键字，留下纯声明。 */
function stripModule(source) {
  return source
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/^\s*\n/gm, '\n');
}

function buildCore() {
  const parts = FILES.map((name) => {
    const file = path.join(ROOT, 'src', 'game', name);
    const body = stripModule(fs.readFileSync(file, 'utf8')).trimEnd();
    return `// ---- ${name} ----\n${body}`;
  });
  return parts.join('\n\n');
}

function indent(text, width) {
  const pad = ' '.repeat(width);
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

function render(clientSource) {
  const start = clientSource.indexOf(START);
  const end = clientSource.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`client.js 缺少 ${START} / ${END} 区域标记`);
  }
  const head = clientSource.slice(0, start + START.length);
  const tail = clientSource.slice(end);
  const banner =
    '\n    // 由 tools/build-client.mjs 从 src/game/ 生成，不要手改这一段。\n';
  return `${head}${banner}${indent(buildCore(), 4)}\n${tail}`;
}

const source = fs.readFileSync(CLIENT, 'utf8');
const next = render(source);
const check = process.argv.includes('--check');

if (next === source) {
  console.log('client.js 已是最新');
  process.exit(0);
}

if (check) {
  console.error('client.js 与 src/game/ 不一致，请运行 node tools/build-client.mjs');
  process.exit(1);
}

fs.writeFileSync(CLIENT, next);
console.log(`已内联 ${FILES.length} 个模块到 client.js`);
