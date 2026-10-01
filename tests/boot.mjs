// Shared setup for the browser tests: boots the real index.html against the
// live Firebase stub, with a fixed clock and every CDN answered locally.
//
//   import { launch, boot, dailyLogs, Checks } from './boot.mjs';
//
// Run `sh tests/setup.sh` once for real Tailwind and Leaflet (screenshots look
// like the phone). Without it, Tailwind is reduced to `.hidden` and Leaflet to a
// do-nothing fake — fine for behaviour, not for judging layout.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPS = join(HERE, '.deps');
export const BASE = process.env.A2A_BASE || 'http://127.0.0.1:8899';

const stub = readFileSync(join(HERE, 'fb-live.mjs'), 'utf8');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const tailwindCss = read(join(DEPS, 'tailwind.css'));
const leafletJs = read(join(DEPS, 'node_modules/leaflet/dist/leaflet.js'));
const leafletCss = read(join(DEPS, 'node_modules/leaflet/dist/leaflet.css'));

export const realStyles = !!tailwindCss;
export const realLeaflet = !!leafletJs;

const FAKE_LEAFLET = `window.L=(()=>{const chain=()=>new Proxy(function(){},{get:(t,k)=>k==='then'?undefined:chain(),apply:()=>chain()});
  return {map:()=>chain(),tileLayer:()=>chain(),layerGroup:()=>chain(),marker:()=>chain(),circleMarker:()=>chain(),
  polyline:()=>chain(),divIcon:o=>o,icon:o=>o,latLng:(a,b)=>({lat:a,lng:b}),latLngBounds:()=>chain(),featureGroup:()=>chain()};})();`;

// A plain warm-grey square for every map tile, so maps render without the network.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJ2gPmJ0zvmwAAAABJRU5ErkJggg==', 'base64');

// Playwright is installed globally on the dev container rather than as a repo
// dependency, so look for it there if a plain import can't see it.
async function playwright() {
  try { return await import('playwright'); } catch (e) { /* fall through */ }
  for (const p of ['/opt/node22/lib/node_modules/playwright/index.mjs', '/usr/local/lib/node_modules/playwright/index.mjs', '/usr/lib/node_modules/playwright/index.mjs']) {
    if (existsSync(p)) return import(p);
  }
  throw new Error('Playwright not found — npm i -g playwright');
}

export async function launch() {
  const { chromium } = await playwright();
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1194/chrome-linux/chrome'),
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  ].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  return chromium.launch(executablePath ? { executablePath } : {});
}

/**
 * Boot the app. Returns { page, errors }.
 *   time       Date the page's clock starts at (default: noon, 2 Oct 2026)
 *   fixture    { logs: [...], users: { user1: {...} }, docs: { id: {...} } }
 *              log dates may be Date or ISO strings
 *   path       page to open (default 'index.html'; add a query string freely)
 *   viewport   default 390×844, the phone the app is used on
 *   init       extra init scripts (strings)
 *   geocode    answer for nominatim lookups: [{ display_name, lat, lon }]
 *   storage    localStorage entries to set before the page loads
 *   wrappedSeen  default true: Year One Wrapped counts as already watched
 */
export async function boot(browser, { time = new Date(2026, 9, 2, 12, 0), fixture = {}, path = 'index.html',
  viewport = { width: 390, height: 844 }, init = [], geocode = [], reducedMotion = 'no-preference', storage = {}, wrappedSeen = true } = {}) {
  // Year One Wrapped plays itself on the first open after 1 October. Most tests
  // aren't about that, so count it as watched unless told otherwise.
  if (wrappedSeen) storage = { 'a2a-wrapped-seen-y1': '1', ...storage };
  // No service worker in tests: it would cache the page between runs.
  const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|fonts\.g|ERR_CERT|net::ERR|404|Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  const fx = {
    ...fixture,
    logs: (fixture.logs || []).map((l) => ({ ...l, date: l.date instanceof Date ? l.date.toISOString() : l.date }))
  };
  await page.addInitScript(`window.__fixture = ${JSON.stringify(fx)};`);
  await page.addInitScript(`try { ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')} } catch (e) {}`);
  // Milestone confetti is called by name; a missing global would abort the handler.
  await page.addInitScript('window.confetti = () => {};');
  for (const s of init) await page.addInitScript(s);
  await page.clock.install({ time });

  await page.route('**/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await page.route('https://cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `(function(){const s=document.createElement('style');s.textContent=${JSON.stringify(tailwindCss || '.hidden{display:none!important}')};document.head.prepend(s);})();` }));
  await page.route('https://cdn.tailwindcss.com', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `(function(){const s=document.createElement('style');s.textContent=${JSON.stringify(tailwindCss || '.hidden{display:none!important}')};document.head.prepend(s);})();` }));
  await page.route('https://unpkg.com/leaflet@*/dist/leaflet.js', (r) => r.fulfill({ contentType: 'text/javascript', body: leafletJs || FAKE_LEAFLET }));
  await page.route('https://unpkg.com/leaflet@*/dist/leaflet.css', (r) => r.fulfill({ contentType: 'text/css', body: leafletCss || '' }));
  await page.route('**/canvas-confetti*/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(/tile\.openstreetmap|basemaps\.cartocdn|arcgisonline/, (r) => r.fulfill({ contentType: 'image/png', body: TILE }));
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(geocode) }));

  await page.goto(`${BASE}/${path}`);
  // Let the stubbed snapshots land and the first render settle.
  await page.waitForTimeout(400);
  return { page, errors, context };
}

/** Pick a profile, type steps, press Add. */
export async function logSteps(page, who, steps) {
  await page.click(`#user-selector button:has-text("${who}")`);
  await page.fill('#step-input', String(steps));
  await page.click('#step-form button[type="submit"]');
  await page.waitForTimeout(300);
}

/** Every day from..to (inclusive) for both of you, with deterministic steps. */
export function dailyLogs(from, to, { skip = () => false, extra = () => ({}) } = {}) {
  const out = [];
  let i = 0;
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    i++;
    for (const uid of ['user1', 'user2']) {
      if (skip(uid, d, i)) continue;
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 30);
      out.push({ id: `${uid}-${i}`, userId: uid, steps: 8000 + ((i * (uid === 'user1' ? 37 : 53)) % 6000), note: '', date: at, ...extra(uid, at, i) });
    }
  }
  return out;
}

/** Tiny check collector that prints like the old drivers did. */
export class Checks {
  constructor(name) { this.name = name; this.ok = []; this.bad = []; }
  check(label, cond, extra = '') { (cond ? this.ok : this.bad).push(label + (extra !== '' && extra != null ? ` — ${extra}` : '')); }
  done() {
    console.log(`\n${this.name}: PASS (${this.ok.length})`);
    this.ok.forEach((t) => console.log('  ✓ ' + t));
    if (this.bad.length) {
      console.log(`\nFAIL (${this.bad.length})`);
      this.bad.forEach((t) => console.log('  ✗ ' + t));
      process.exitCode = 1;
    }
  }
}
