import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncBuildOutput } from './sync-build-output.mjs';

const tempDirs = [];

function tempDir(prefix) {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('syncBuildOutput', () => {
  it('keeps the existing project usable while replacing generated files', () => {
    const source = tempDir('airacm-build-source-');
    const destination = tempDir('airacm-build-destination-');
    writeFileSync(resolve(source, 'app.json'), '{"pages":["pages/login/index"]}');
    writeFileSync(resolve(source, 'app.js'), 'new app');
    writeFileSync(resolve(source, 'project.config.json'), 'generated public config');
    writeFileSync(resolve(source, 'project.private.config.json'), 'generated private config');
    writeFileSync(resolve(destination, 'app.json'), '{"pages":[]}');
    writeFileSync(resolve(destination, 'app.js'), 'old app');
    writeFileSync(resolve(destination, 'project.config.json'), 'developer public settings');
    writeFileSync(resolve(destination, 'project.private.config.json'), 'developer settings');

    syncBuildOutput(source, destination);

    expect(readFileSync(resolve(destination, 'app.js'), 'utf8')).toBe('new app');
    expect(readFileSync(resolve(destination, 'app.json'), 'utf8')).toContain('pages/login/index');
    expect(readFileSync(resolve(destination, 'project.config.json'), 'utf8')).toBe('generated public config');
    expect(readFileSync(resolve(destination, 'project.private.config.json'), 'utf8')).toBe('developer settings');
  });

  it('removes generated files and nested chunks that are no longer in the build', () => {
    const source = tempDir('airacm-build-source-');
    const destination = tempDir('airacm-build-destination-');
    mkdirSync(resolve(source, 'common'));
    mkdirSync(resolve(destination, 'common'));
    writeFileSync(resolve(source, 'app.json'), '{}');
    writeFileSync(resolve(source, 'common', 'current.js'), 'current');
    writeFileSync(resolve(destination, 'obsolete.js'), 'obsolete');
    writeFileSync(resolve(destination, 'common', 'old.js'), 'old');

    syncBuildOutput(source, destination);

    expect(() => readFileSync(resolve(destination, 'obsolete.js'), 'utf8')).toThrow();
    expect(() => readFileSync(resolve(destination, 'common', 'old.js'), 'utf8')).toThrow();
    expect(readFileSync(resolve(destination, 'common', 'current.js'), 'utf8')).toBe('current');
  });

  it('rejects an incomplete build before changing the destination', () => {
    const source = tempDir('airacm-build-source-');
    const destination = tempDir('airacm-build-destination-');
    writeFileSync(resolve(source, 'app.js'), 'incomplete app');
    writeFileSync(resolve(destination, 'app.js'), 'working app');

    expect(() => syncBuildOutput(source, destination)).toThrow('缺少 app.json');
    expect(readFileSync(resolve(destination, 'app.js'), 'utf8')).toBe('working app');
  });
});
