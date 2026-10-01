// The app boots, renders both of you, and the everyday loop works: log steps,
// see them, delete them. Everything else assumes this much.
import { launch, boot, dailyLogs, logSteps, Checks, realStyles } from './boot.mjs';

const c = new Checks('smoke');
const browser = await launch();
const logs = dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 1));
const { page, errors } = await boot(browser, { fixture: { logs } });

c.check('both profiles to pick from', (await page.$$('#user-selector button')).length === 2);
c.check('both progress cards render', await page.isVisible('#ant-progress-row') && await page.isVisible('#amy-progress-row'));
const before = await page.$$eval('#user1-log .log-entry', (n) => n.length);
c.check('log lists render', before > 100, before);

await logSteps(page, 'Ant', 12345);
const after = await page.$$eval('#user1-log .log-entry', (n) => n.length);
c.check('a new log appears', after === before + 1, `${before} → ${after}`);
c.check('it shows the steps', (await page.textContent('#user1-log')).includes('12,345'));
const stored = await page.evaluate(() => [...window.__fb.cols[Object.keys(window.__fb.cols).find((k) => /challengeLogs$/.test(k))].values()].filter((l) => l.steps === 12345).length);
c.check('and it was written', stored === 1);

// Delete it again through the modal.
const id = await page.evaluate(() => [...document.querySelectorAll('#user1-log .del-log')].find((b) => b.dataset.steps === '12345').dataset.id);
await page.click(`#user1-log .del-log[data-id="${id}"]`);
await page.click('#modal-confirm');
await page.waitForTimeout(300);
c.check('delete removes it', (await page.$$eval('#user1-log .log-entry', (n) => n.length)) === before);

c.check('no page errors', errors.length === 0, errors.join(' | '));
if (!realStyles) console.log('  (no tests/.deps — run sh tests/setup.sh for real styles)');
await browser.close();
c.done();
