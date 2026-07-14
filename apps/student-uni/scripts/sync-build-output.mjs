import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ENTRY_FILE = 'app.json';
const PRIVATE_IDE_CONFIG_FILES = new Set(['project.private.config.json']);

function syncDirectory(sourceDir, destinationDir, root = false) {
  mkdirSync(destinationDir, { recursive: true });
  const sourceEntries = new Set(readdirSync(sourceDir));

  for (const entry of sourceEntries) {
    if (root && (entry === ENTRY_FILE || PRIVATE_IDE_CONFIG_FILES.has(entry))) continue;
    const source = resolve(sourceDir, entry);
    const destination = resolve(destinationDir, entry);
    if (statSync(source).isDirectory()) {
      if (existsSync(destination) && !statSync(destination).isDirectory()) {
        rmSync(destination, { recursive: true, force: true });
      }
      syncDirectory(source, destination);
    } else {
      if (existsSync(destination) && statSync(destination).isDirectory()) {
        rmSync(destination, { recursive: true, force: true });
      }
      cpSync(source, destination, { force: true });
    }
  }

  for (const entry of readdirSync(destinationDir)) {
    if (root && (entry === ENTRY_FILE || PRIVATE_IDE_CONFIG_FILES.has(entry))) continue;
    if (!sourceEntries.has(entry)) {
      rmSync(resolve(destinationDir, entry), { recursive: true, force: true });
    }
  }
}

export function syncBuildOutput(sourceDir, destinationDir) {
  if (!existsSync(resolve(sourceDir, ENTRY_FILE))) {
    throw new Error(`小程序构建产物不完整：缺少 ${ENTRY_FILE}`);
  }

  // 原构建会先清空输出目录，开发者工具会在这段空窗期加载失败。
  // 先同步页面和脚本并清理陈旧产物，最后更新入口文件；仅保留开发者私有设置。
  syncDirectory(sourceDir, destinationDir, true);

  cpSync(resolve(sourceDir, ENTRY_FILE), resolve(destinationDir, ENTRY_FILE), { force: true });

  for (const configFile of PRIVATE_IDE_CONFIG_FILES) {
    const sourceFile = resolve(sourceDir, configFile);
    const destinationFile = resolve(destinationDir, configFile);
    if (existsSync(sourceFile) && !existsSync(destinationFile)) cpSync(sourceFile, destinationFile);
  }
}
