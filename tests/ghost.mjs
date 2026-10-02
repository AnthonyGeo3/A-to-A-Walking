// The faint "you last year" triangle on each bar: tap it for a bubble with what
// you walked on this day last year and what you'd done by then. Tap to hide.
import { launch, boot, dailyLogs, logSteps, Checks } from './boot.mjs';
import { mkdirSync } from 'node:fs';
const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const c = new Checks('ghost');
const browser = await launch();
const time = new Date(2026, 9, 14, 21, 30); // 14 Oct, Year 2
const logs = dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 14));
// What the bubble should say, worked out from the fixture rather than the app.
const want = (uid) => {
  const mine = logs.filter((l) => l.userId === uid);
  const day = mine.filter((l) => l.date.getFullYear() === 2025 && l.date.getMonth() === 9 && l.date.getDate() === 14).reduce((a, l) => a + l.steps, 0);
  const by = mine.filter((l) => l.date >= new Date(2025, 9, 1) && l.date < new Date(2025, 9, 15)).reduce((a, l) => a + l.steps, 0);
  return { day: day.toLocaleString('en-GB'), by: by.toLocaleString('en-GB') };
};
const bubble = (row) => page.$eval(`${row} .ghost-bubble`, (b) => [...b.querySelectorAll('strong')].map((s) => s.textContent)).catch(() => null);

let { page, errors } = await boot(browser, { time, fixture: { logs } });
c.check('no bubbles to start with', (await page.$$('.ghost-bubble')).length === 0);
c.check('each faint triangle can be tapped', (await page.$$('.ghost-hit')).length === 2);
const hitBox = await page.locator('#ant-progress-row .ghost-hit').boundingBox();
c.check('with a finger-sized target', hitBox && hitBox.width >= 30 && hitBox.height >= 28, hitBox && `${hitBox.width}×${hitBox.height}`);

await page.click('#ant-progress-row .ghost-hit');
let ant = await bubble('#ant-progress-row');
const a = want('user1');
c.check('tapping Ant\'s says his steps that day last year, and by then', ant && ant[0] === a.day && ant[1] === a.by, `${JSON.stringify(ant)} vs ${a.day}, ${a.by}`);
c.check('only his', (await page.$$('.ghost-bubble')).length === 1);
const geo = await page.evaluate(() => {
  const tri = document.querySelector('#ant-progress-row .marker-ghost').getBoundingClientRect();
  const b = document.querySelector('#ant-progress-row .ghost-bubble');
  const r = b.getBoundingClientRect();
  const tail = getComputedStyle(b, '::after');
  const tailX = r.left + parseFloat(tail.left);
  const card = document.querySelector('#ant-progress-row .card-ant').getBoundingClientRect();
  return { triX: tri.left + tri.width / 2, tailX, above: r.bottom <= tri.top + 2, inside: r.left >= card.left - 1 && r.right <= card.right + 1 };
});
c.check('it speaks from the triangle', Math.abs(geo.triX - geo.tailX) < 4 && geo.above, JSON.stringify(geo));
c.check('and stays on the card', geo.inside);
await page.locator('#ant-progress-row').screenshot({ path: OUT + 'ghost-ant.png' });

await page.click('#amy-progress-row .ghost-hit');
const amy = await bubble('#amy-progress-row');
const m = want('user2');
c.check('Amy\'s says hers', amy && amy[0] === m.day && amy[1] === m.by, `${JSON.stringify(amy)} vs ${m.day}, ${m.by}`);
c.check('both can be open at once', (await page.$$('.ghost-bubble')).length === 2);

// A new log re-draws the bars; an open bubble stays open.
await logSteps(page, 'Amy', 4000);
c.check('a log landing doesn\'t snap it shut', (await page.$$('.ghost-bubble')).length === 2);

await page.click('#ant-progress-row .ghost-hit');
c.check('tapping again hides it', !await page.$('#ant-progress-row .ghost-bubble') && !!await page.$('#amy-progress-row .ghost-bubble'));
await page.click('#amy-progress-row .ghost-hit');
c.check('and hides Amy\'s too', (await page.$$('.ghost-bubble')).length === 0);
c.check('no page errors', errors.length === 0, errors.join(' | '));
await page.context().close();

// Year 1 had no last year: nothing to tap.
({ page, errors } = await boot(browser, { time: new Date(2026, 5, 1, 21), fixture: { logs: logs.filter((l) => l.date < new Date(2026, 5, 2)) } }));
c.check('in Year 1 there is no triangle to tap', (await page.$$('.ghost-hit')).length === 0);
c.check('no page errors in Year 1', errors.length === 0, errors.join(' | '));

await browser.close();
c.done();
