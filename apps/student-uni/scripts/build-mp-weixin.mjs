import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

const localEnv = [
  resolve(appDir, '..', '..', '.env'),
  resolve(appDir, '..', '..', 'backend-pre', '.env'),
  resolve(appDir, '.env'),
  resolve(appDir, '.env.local'),
].reduce((all, path) => ({ ...all, ...readEnvFile(path) }), {});

const appId =
  process.env.VITE_WECHAT_MINI_APP_ID ||
  process.env.WECHAT_MINI_APP_ID ||
  localEnv.VITE_WECHAT_MINI_APP_ID ||
  localEnv.WECHAT_MINI_APP_ID ||
  '';

if (!appId) {
  throw new Error('缺少 WECHAT_MINI_APP_ID（或 VITE_WECHAT_MINI_APP_ID），无法生成正式小程序项目');
}

if (!/^wx[A-Za-z0-9]{16}$/.test(appId)) {
  throw new Error('WECHAT_MINI_APP_ID must be a valid 18-character WeChat Mini Program AppID.');
}

const inputDir = mkdtempSync(resolve(tmpdir(), 'airacm-mp-'));
cpSync(resolve(appDir, 'src'), inputDir, { recursive: true });
const manifestPath = resolve(inputDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest['mp-weixin'] = { ...(manifest['mp-weixin'] || {}), appid: appId };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

try {
  const cli = resolve(appDir, 'node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js');
  const result = spawnSync(process.execPath, [cli, 'build', '-p', 'mp-weixin'], {
    cwd: appDir,
    env: { ...process.env, UNI_INPUT_DIR: inputDir },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(inputDir, { recursive: true, force: true });
}
