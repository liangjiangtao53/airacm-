import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertMpWeixinHasNoPublicUgc } from './assert-mp-weixin-no-ugc.mjs';

const tempDirs = [];

function tempDir() {
  const dir = mkdtempSync(resolve(tmpdir(), 'airacm-no-ugc-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('assertMpWeixinHasNoPublicUgc', () => {
  it('accepts a learning-only mini program build', () => {
    const output = tempDir();
    writeFileSync(resolve(output, 'app.json'), JSON.stringify({ pages: ['pages/study/index'] }));
    writeFileSync(resolve(output, 'app.js'), 'wx.createApp({})');

    expect(() => assertMpWeixinHasNoPublicUgc(output)).not.toThrow();
  });

  it('rejects forum pages and public-content APIs', () => {
    const output = tempDir();
    mkdirSync(resolve(output, 'pages', 'forum'), { recursive: true });
    writeFileSync(resolve(output, 'app.json'), JSON.stringify({ pages: ['pages/forum/index'] }));
    writeFileSync(resolve(output, 'pages', 'forum', 'index.js'), 'request("/posts/1/replies")');

    expect(() => assertMpWeixinHasNoPublicUgc(output)).toThrow(/pages\/forum\/index/);
  });
});
