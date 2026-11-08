#!/usr/bin/env node
// 在同一个进程里依次加载所有测试文件。
//
// 为什么不用 `node --test`：Windows 沙箱里测试运行器会用管道 spawn 子进程，
// 在没有命名管道权限的环境会直接 EPERM。导入式运行仍然使用 node:test 的
// 断言与报告，只是不 fork，适合本地与受限环境。
//
// 用法: node tools/run-tests.mjs

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');
const files = fs
  .readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.error('没有找到测试文件');
  process.exit(1);
}

for (const file of files) {
  await import(pathToFileURL(path.join(TEST_DIR, file)).href);
}
