// Seasons: the backdrop shifts, nothing that carries meaning does.
import { launch, boot, dailyLogs, Checks } from './boot.mjs';
import { mkdirSync } from 'node:fs';
const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const c = new Checks('seasons');
const browser = await launch();
const logs = dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 1));

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

async function look(page) {
  return page.evaluate(() => {
    const h = document.getElementById('app-header');
    const cs = getComputedStyle(h);
    return {
      season: document.documentElement.dataset.season, moment: document.documentElement.dataset.moment || null,
      bg: cs.backgroundImage, before: getComputedStyle(h, '::before').content, after: getComputedStyle(h, '::after').content,
      title: getComputedStyle(h.querySelector('h1')).color,
      stops: ['--head-a', '--head-b', '--head-c'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()),
      antFill: (() => { const f = document.querySelector('.progress-bar-fill-ant'); return f ? getComputedStyle(f).backgroundImage : ''; })(),
      bodyBg: getComputedStyle(document.body).backgroundImage
    };
  });
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const variants = [
  { q: '?season=autumn&moment=', season: 'autumn', motif: ['🍂', '🍁'] },
  { q: '?season=winter&moment=', season: 'winter', motif: ['❄️', '❄️'] },
  { q: '?season=spring&moment=', season: 'spring', motif: ['🌸', '🌱'] },
  { q: '?season=summer&moment=', season: 'summer', motif: ['🌼', '☀️'] },
  { q: '?season=winter&moment=christmas', season: 'winter', moment: 'christmas', motif: ['🎄', '✨'] },
  { q: '?season=autumn&moment=anniversary', season: 'autumn', moment: 'anniversary', motif: ['🍂', '❤️'] }
];
let antFill = null;
const seen = new Set();
for (const v of variants) {
  const { page, errors } = await boot(browser, { fixture: { logs }, path: 'index.html' + v.q, reducedMotion: 'reduce' });
  const l = await look(page);
  const name = v.moment || v.season;
  c.check(`${name}: marked on the page`, l.season === v.season && l.moment === (v.moment || null), `${l.season}/${l.moment}`);
  c.check(`${name}: its own header colours`, !seen.has(l.stops.join()) && l.stops.every((s) => l.bg.includes(`rgb(${hexRgb(s).join(', ')})`)), l.stops.join(' '));
  seen.add(l.stops.join());
  c.check(`${name}: its corner pieces`, l.before === `"${v.motif[0]}"` && l.after === `"${v.motif[1]}"`, `${l.before} ${l.after}`);
  const worst = Math.min(...l.stops.map((s) => contrast(rgb(l.title), hexRgb(s))));
  c.check(`${name}: the title stays readable`, worst >= 4.5, worst.toFixed(1));
  if (antFill === null) antFill = l.antFill;
  c.check(`${name}: Ant's bar is still Ant's green`, l.antFill === antFill && /74, 222, 128/.test(l.antFill));
  c.check(`${name}: no page errors`, errors.length === 0, errors.join(' | '));
  await page.locator('#app-header').screenshot({ path: `${OUT}season-${name}.png` });
  await page.context().close();
}

// --- on the real date, no flags ---
{
  const { page } = await boot(browser, { time: new Date(2026, 9, 26, 21, 0), fixture: { logs }, reducedMotion: 'reduce' });
  const l = await look(page);
  c.check('26 October is the anniversary without any flag', l.season === 'autumn' && l.moment === 'anniversary');
  await page.context().close();
}

// --- the decoration never gets in the way of a tap ---
{
  const { page, errors } = await boot(browser, { time: new Date(2026, 11, 20, 21, 0), fixture: { logs } });
  const pe = await page.evaluate(() => {
    const h = document.getElementById('app-header');
    return [getComputedStyle(h, '::before').pointerEvents, getComputedStyle(h, '::after').pointerEvents];
  });
  c.check('the corner pieces never take a tap', pe.every((x) => x === 'none'), pe.join(','));
  const box = await page.locator('#header-subtitle').boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [box.x + box.width / 2, box.y + box.height / 2]);
  c.check('the subtitle is still on top of them', hit === 'header-subtitle', hit);
  c.check('no page errors at Christmas', errors.length === 0, errors.join(' | '));
  await page.context().close();
}

// --- the drift: once a day, never with reduced motion ---
{
  const { page, context } = await boot(browser, { time: new Date(2026, 9, 14, 21, 0), fixture: { logs } });
  const first = await page.$$eval('.season-drift', (n) => n.length);
  c.check('the first open of the day drifts a few leaves', first >= 6 && first <= 10, first);
  await page.waitForTimeout(1800); // CSS animations run on real time
  await page.screenshot({ path: `${OUT}season-drift.png`, clip: { x: 0, y: 0, width: 390, height: 140 } });
  await page.waitForTimeout(100);
  await page.clock.runFor(8000);
  c.check('and they clear away', (await page.$$eval('.season-drift', (n) => n.length)) === 0);
  await page.reload(); await page.waitForTimeout(400);
  c.check('a second open that day stays still', (await page.$$eval('.season-drift', (n) => n.length)) === 0);
  await context.close();
}
{
  const { page, context } = await boot(browser, { time: new Date(2026, 9, 14, 21, 0), fixture: { logs }, reducedMotion: 'reduce' });
  c.check('never with reduced motion', (await page.$$eval('.season-drift', (n) => n.length)) === 0);
  await context.close();
}

await browser.close();
c.done();
