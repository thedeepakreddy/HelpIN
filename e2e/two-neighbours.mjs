/**
 * End-to-end: two neighbours in two browsers against the real API, worker and web app.
 * Arjun offers to lend Wei a drill; Wei accepts; they chat and the message arrives live.
 *
 * Needs `pnpm db:reset && pnpm db:seed` and `pnpm dev` running. Then:
 *   node e2e/two-neighbours.mjs            (screenshots land in e2e/screenshots/)
 * PLAYWRIGHT_MODULE / CHROMIUM_PATH override where Playwright and Chromium come from.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/Budapest' };
const errors = [];

async function signIn(local) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${local}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/tile|openfreemap|Failed to load resource/i.test(m.text()) && errors.push(`${local}: ${m.text()}`));
  await page.goto(`${WEB}/login?mode=login`);
  await page.getByRole('button', { name: 'Use a code instead' }).click();
  await page.getByPlaceholder('30 123 4567').fill(local);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByPlaceholder('••••••').fill('123456');
  await page.getByRole('button', { name: /^Verify$/ }).click();
  await page.getByRole('button', { name: /Let.s go/ }).click();
  await page.waitForURL(/\/problems/);
  return page;
}

/** The desktop layout keeps some lists in the DOM while hidden on phones; only match what's visible. */
const vis = (loc) => loc.locator('visible=true').first();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const step = (m) => console.log(`✓ ${m}`);

try {
  const arjun = await signIn('30 000 0002');
  step('Arjun signed in');
  await arjun.goto(`${WEB}/problems?view=list`);
  await vis(arjun.getByText('Can someone lend a drill for an hour?')).waitFor();
  await shot(arjun, '01-problems-list');
  await vis(arjun.getByText('Can someone lend a drill for an hour?')).click();
  await arjun.waitForURL(/\/p\//);
  await vis(arjun.getByRole('button', { name: /I can help/ })).waitFor();
  await shot(arjun, '02-problem');
  await vis(arjun.getByRole('button', { name: /I can help/ })).click();
  await arjun.getByRole('dialog').getByRole('textbox').fill('I have a drill with masonry bits. I can drop it off tonight.');
  await shot(arjun, '03-offer-sheet');
  await arjun.getByRole('dialog').getByRole('button', { name: /Send offer|Offer help/ }).click();
  await vis(arjun.getByText(/You offered to help|Offer sent/)).waitFor();
  step('Arjun offered help');

  const wei = await signIn('30 000 0008');
  step('Wei signed in');
  await wei.goto(`${WEB}/notifications`);
  await vis(wei.getByText(/Arjun/)).waitFor();
  await shot(wei, '04-notifications');
  await wei.goto(`${WEB}/profile`);
  await vis(wei.getByText('Can someone lend a drill for an hour?')).waitFor({ timeout: 5000 }).catch(() => undefined);
  await shot(wei, '05-profile');

  // Open the problem from "My problems" (or directly by its link from the notification).
  await wei.goto(`${WEB}/notifications`);
  await vis(wei.getByText(/Arjun/)).click();
  await wei.waitForURL(/\/p\//);
  // Accept Arjun's offer (the card quoting his message), not Bence's.
  const accept = vis(wei.getByText(/masonry bits/)).locator('xpath=..').getByRole('button', { name: /^Accept/ });
  await accept.waitFor();
  await shot(wei, '06-offers-for-asker');
  await accept.click();
  await wei.waitForURL(/\/chat\//);
  step('Wei accepted the offer');

  await wei.getByPlaceholder(/Message/).fill('Thank you! I’m home after 7, Kosztolányi tér side.');
  await wei.getByRole('button', { name: 'Send', exact: true }).click();

  await arjun.goto(`${WEB}/chat`);
  await vis(arjun.getByText(/Wei/)).click();
  await arjun.getByText('Thank you! I’m home after 7, Kosztolányi tér side.').waitFor();
  step('Arjun sees the message');
  await arjun.getByPlaceholder(/Message/).fill('Perfect, see you at 7:15!');
  await arjun.getByRole('button', { name: 'Send', exact: true }).click();
  await wei.getByText('Perfect, see you at 7:15!').waitFor({ timeout: 10000 });
  step('Wei got the reply live');
  await shot(wei, '07-chat');

  await arjun.goto(`${WEB}/community`);
  await vis(arjun.getByText(/Huge thanks to Zsófi/)).waitFor();
  await shot(arjun, '08-feed');
  await arjun.goto(`${WEB}/settings`);
  await shot(arjun, '09-settings');

  if (errors.length) {
    console.error('Browser errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('All good.');
} catch (e) {
  console.error(e);
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
