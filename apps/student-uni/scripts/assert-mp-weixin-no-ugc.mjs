import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.wxml', '.wxss']);
const FORBIDDEN_MARKERS = [
  'pages/forum/index',
  '/forum/topics',
  '/comments',
  '/posts',
  '/replies',
  '发帖',
  '评论',
  '回复',
  '交流',
  '说点什么',
];

function textFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

export function assertMpWeixinHasNoPublicUgc(outputDir) {
  const offenders = [];
  for (const file of textFiles(outputDir)) {
    const source = readFileSync(file, 'utf8');
    for (const marker of FORBIDDEN_MARKERS) {
      if (source.includes(marker)) offenders.push(`${relative(outputDir, file)} -> ${marker}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(`微信个人主体构建仍包含公开 UGC：\n${offenders.join('\n')}`);
  }
}
