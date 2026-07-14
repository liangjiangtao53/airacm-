import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function vueFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.name.endsWith('.vue') ? [path] : [];
  });
}

describe('mini program tap handlers', () => {
  it('uses explicit calls for named handlers', () => {
    const offenders = [];
    for (const file of vueFiles(resolve(scriptDir, '..', 'src'))) {
      const source = readFileSync(file, 'utf8');
      const bareHandler = /@tap(?:\.[\w-]+)*="([A-Za-z_$][\w$]*)"/g;
      for (const match of source.matchAll(bareHandler)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} @tap="${match[1]}"`);
      }
    }

    expect(offenders, 'Current UniApp compiler does not invoke bare named tap handlers').toEqual([]);
  });
});
