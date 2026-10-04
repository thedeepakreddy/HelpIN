// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from './en';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function leaves(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' && v ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

const keys = new Set(leaves(en).map((k) => k.replace(/_(one|other|zero|few|many)$/, '')));

/** Turns `create.${step}.blocked` into a regex that must match at least one real key. */
const toPattern = (template: string) => new RegExp(`^${template.replace(/[.]/g, '\\.').replace(/\$\{[^}]+\}/g, '[^.]+')}$`);

describe('i18n', () => {
  const used = files(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/\bt\(\s*['`]([^'`]+)['`]/g)].map((m) => ({ key: m[1]!, file })),
  );

  it('finds keys in the code', () => {
    expect(used.length).toBeGreaterThan(100);
  });

  it('every key used in code exists in en.ts', () => {
    const missing = used.filter(({ key }) => (key.includes('${') ? ![...keys].some((k) => toPattern(key).test(k)) : !keys.has(key)));
    expect(missing.map((m) => `${m.key} (${m.file.replace(SRC, '')})`)).toEqual([]);
  });
});
