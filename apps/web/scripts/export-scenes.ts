/**
 * Exports the design's illustrated scenes as SVG files for the API dev seed, which turns them
 * into real uploaded photos. Run: pnpm --filter @helpin/web exec tsx scripts/export-scenes.ts
 */
import { writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ILLUSTRATION_KEYS, Illustration } from '../src/components/domain/Illustration';

const out = new URL('../../api/src/seed/scenes/', import.meta.url);
for (const name of ILLUSTRATION_KEYS.filter((k) => k !== 'thanks')) {
  const svg = renderToStaticMarkup(createElement(Illustration, { name }))
    .replace(/ class="[^"]*"/, '')
    .replace(' aria-hidden="true"', '')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" ');
  writeFileSync(new URL(`${name}.svg`, out), svg + '\n');
  console.log(name);
}
