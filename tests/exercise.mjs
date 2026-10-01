// Exercise days: the tick when logging, the emoji on the entry, the dot on the
// calendar, and the Active days card. None of it touches the steps.
import { launch, boot, dailyLogs, logSteps, submitLog, Checks } from './boot.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync(new URL('./.out/', import.meta.url), { recursive: true });
const OUT = new URL('./.out/', import.meta.url).pathname;

const c = new Checks('exercise');
const browser = await launch();
// Wednesday 14 October 2026, at bedtime.
const time = new Date(2026, 9, 14, 21, 45);
const logs = dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 13));
const stored = (page) => page.evaluate(() => {
  const k = Object.keys(window.__fb.cols).find((p) => /challengeLogs$/.test(p));
  return [...window.__fb.cols[k].entries()].map(([id, d]) => ({ id, ...d, date: d.date && d.date.toMillis() }));
});
const newest = async (page, uid) => (await stored(page)).filter((l) => l.userId === uid).sort((a, b) => b.date - a.date)[0];

let { page, errors } = await boot(browser, { time, fixture: { logs } });

// --- before anyone has ticked anything ---
c.check('the Active days card stays out of the way until it is used', !await page.isVisible('#active-days'));
await page.click('#user-selector button:has-text("Ant")');
c.check('the pill is there, off', await page.getAttribute('#exercise-toggle', 'aria-pressed') === 'false');
c.check('no chips until it is on', !await page.isVisible('#exercise-form-picker'));

// --- a plain log is unchanged ---
await logSteps(page, 'Ant', 9100);
let l = await newest(page, 'user1');
c.check('a log without the tick has no exercise field at all', l.steps === 9100 && !('exercise' in l) && !('exerciseOther' in l), JSON.stringify(l));

// --- the pill and chips ---
await page.fill('#step-input', '11200');
await page.click('#exercise-toggle');
c.check('the chips open', await page.isVisible('#exercise-form-picker .exercise-chips'));
c.check('all six activities', (await page.$$('#exercise-form-picker .exercise-chip')).length === 6);
const addBox = await page.locator('#step-form button[type="submit"]').boundingBox();
c.check('Add stays on screen with the chips open', addBox && addBox.y + addBox.height < 844, addBox && Math.round(addBox.y));
await page.click('#exercise-form-picker [data-activity="running"]');
await page.click('#exercise-form-picker [data-activity="badminton"]');
await page.locator('#step-form').screenshot({ path: OUT + 'exercise-form.png' }).catch(() => {});
await submitLog(page);
l = await newest(page, 'user1');
c.check('both activities are saved', JSON.stringify(l.exercise) === '["running","badminton"]', JSON.stringify(l.exercise));
c.check('the steps are exactly what was typed', l.steps === 11200);
c.check('the pill resets after Add', await page.getAttribute('#exercise-toggle', 'aria-pressed') === 'false' && !await page.isVisible('#exercise-form-picker'));
c.check('both emoji show on the entry', (await page.textContent('#user1-log .log-entry')).includes('🏃🏸'));

// --- pill on, nothing chosen ---
await page.fill('#step-input', '8000');
await page.click('#exercise-toggle');
await submitLog(page);
l = await newest(page, 'user1');
c.check('the pill with no chip still counts, as Other', JSON.stringify(l.exercise) === '["other"]', JSON.stringify(l.exercise));

// --- Other with a name ---
await page.click('#user-selector button:has-text("Amy")');
await page.fill('#step-input', '7000');
await page.click('#exercise-toggle');
await page.click('#exercise-form-picker [data-activity="other"]');
c.check('Other asks what it was', await page.isVisible('#exercise-form-picker .exercise-other'));
await page.fill('#exercise-form-picker .exercise-other', 'Climbing');
await submitLog(page);
l = await newest(page, 'user2');
c.check('the name is kept', l.exerciseOther === 'Climbing' && JSON.stringify(l.exercise) === '["other"]', JSON.stringify(l));

// --- the card ---
c.check('the card appears once someone has ticked', await page.isVisible('#active-days'));
const card = (await page.textContent('#active-days')).replace(/\s+/g, ' ');
// Ant: three logs today, two with exercise → 1 day.
c.check('a day with two exercise logs counts once', /Ant 1 this week 1 this month · 1 this year/.test(card), card);
c.check('it never reads as a fraction of the week', !/\/\s*7/.test(card));

// --- backfilling an old log ---
const oldId = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#user2-log .edit-exercise')];
  return rows[3].dataset.id; // a few days back
});
await page.click(`#user2-log .edit-exercise[data-id="${oldId}"]`);
await page.click('#m-exercise [data-activity="pilates"]');
await page.click('#modal-confirm');
await page.waitForTimeout(300);
l = (await stored(page)).find((x) => x.id === oldId);
c.check('backfilling through 💪 saves it', JSON.stringify(l.exercise) === '["pilates"]', JSON.stringify(l.exercise));
const card2 = (await page.textContent('#active-days')).replace(/\s+/g, ' ');
c.check('and the card counts it straight away', /Amy \d+ this week \d+ this month · 2 this year/.test(card2), card2);
c.check('top activities are listed', card2.includes('🧘 1'));

// Clearing it again.
await page.click(`#user2-log .edit-exercise[data-id="${oldId}"]`);
await page.click('#m-exercise [data-activity="pilates"]');
await page.click('#modal-confirm');
await page.waitForTimeout(300);
l = (await stored(page)).find((x) => x.id === oldId);
c.check('picking nothing in the editor clears it', Array.isArray(l.exercise) && l.exercise.length === 0);

// --- the heatmap dot ---
const dots = await page.evaluate(() => [...document.querySelectorAll('#heatmap-container .heatmap-cell.has-moved')]
  .map((n) => ({ name: n.dataset.name, day: n.dataset.day, ring: getComputedStyle(n).getPropertyValue('--moved-ring').trim(),
                 after: getComputedStyle(n, '::after').content })));
c.check('today gets a dot on each calendar', dots.some((d) => d.name === 'Ant' && d.day === '14') && dots.some((d) => d.name === 'Amy' && d.day === '14'), JSON.stringify(dots));
c.check('in the right person\'s colour', dots.every((d) => d.ring === (d.name === 'Ant' ? '#16a34a' : '#9333ea')));
c.check('the dot actually draws', dots.every((d) => d.after !== 'none'));
// Tolerant clicks: if the feature is broken, report the failed check, don't hang.
const tap = (sel) => page.click(sel, { timeout: 2000 }).catch(() => {});
await tap('#heatmap-container .heatmap-cell.has-moved[data-name="Ant"][data-day="14"]');
c.check('tapping the day names what you did', (await page.textContent('#heatmap-tap-info')).includes('🏃 Running · 🏸 Badminton · ✨ Other'), await page.textContent('#heatmap-tap-info'));
await page.locator('#heatmap-container').screenshot({ path: OUT + 'exercise-heatmap.png' }).catch(() => {});
await page.locator('#active-days').screenshot({ path: OUT + 'exercise-card.png' }).catch(() => {});
await page.locator('#user1-log').screenshot({ path: OUT + 'exercise-entries.png', clip: undefined }).catch(() => {});
await page.evaluate(() => document.querySelector('#user1-log').scrollIntoView());
await page.screenshot({ path: OUT + 'exercise-entries-top.png' });
// The entry text keeps its width: the steps and date stay on one line.
const squeezed = await page.evaluate(() => [...document.querySelectorAll('#user1-log .log-entry')].slice(0, 4).map((e) => {
  const steps = e.querySelector('span.font-bold'), date = e.querySelector('.edit-date');
  return Math.abs(steps.getBoundingClientRect().top - date.getBoundingClientRect().top) > 4;
}));
c.check('steps and date stay on one line', squeezed.every((x) => !x), JSON.stringify(squeezed));

// --- nothing else moved ---
const bar = await page.evaluate(() => document.querySelector('#ant-progress-row').textContent.replace(/\s+/g, ' '));
const yearSteps = (await stored(page)).filter((l) => l.userId === 'user1' && l.date >= new Date(2026, 9, 1).getTime()).reduce((a, l) => a + l.steps, 0);
c.check('the steps on the bar are just the steps', bar.includes(yearSteps.toLocaleString('en-GB') + ' steps'), `${yearSteps} · ${bar.slice(0, 60)}`);

c.check('no page errors', errors.length === 0, errors.join(' | '));
await page.close();

// --- the Year One Recap calendar, with one run backfilled into Year 1 ---
({ page, errors } = await boot(browser, { time, fixture: { logs: dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 13), {
  extra: (uid, at) => (uid === 'user1' && at.getMonth() === 8 && at.getDate() === 20 && at.getFullYear() === 2026 ? { exercise: ['running'] } : {})
}) } }));
await page.click('#wrapped-recap .recap-toggle');
await page.waitForTimeout(200);
const recapDots = await page.$$eval('#wrapped-recap .recap-heat-cell.has-moved', (n) => n.map((x) => x.dataset.when + ' ' + x.dataset.who));
c.check('the Recap calendar dots the backfilled run', recapDots.length === 1 && recapDots[0] === '20 Sept 2026 Ant', JSON.stringify(recapDots));
await page.click('#wrapped-recap .recap-heat-cell.has-moved', { timeout: 2000 }).catch(() => {});
c.check('and says so when tapped', (await page.textContent('#wrapped-recap [data-readout]')).includes('💪 active'));
c.check('no page errors on the Recap', errors.length === 0, errors.join(' | '));
await browser.close();
c.done();
