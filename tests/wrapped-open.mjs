// Year Wrapped opens in exactly two ways: logging the last day of a year, and
// the Play button in the Recap. Never on its own when the app loads.
import { launch, boot, dailyLogs, logSteps, dismissMilestone, Checks } from './boot.mjs';

const c = new Checks('wrapped-open');
const browser = await launch();
const overlay = (page) => page.$('.wrapped-overlay').then((x) => x !== null);
const close = async (page, slides = 3) => {
  for (let i = 0; i < slides; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80); }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
};
const yearOne = dailyLogs(new Date(2025, 9, 1), new Date(2026, 8, 30));
const shortOfLastDay = dailyLogs(new Date(2025, 9, 1), new Date(2026, 8, 29));

// Whatever happens, report what was checked: a regression that leaves the show
// open would otherwise end the run in a timeout with nothing printed.
let page, errors;
try {
  // --- after the year, never watched: still nothing on load ---
  ({ page, errors } = await boot(browser, { time: new Date(2026, 9, 2, 21, 0), fixture: { logs: yearOne }, wrappedSeen: false }));
  await page.waitForTimeout(500);
  c.check('opening the app never plays it', !await overlay(page));
  // If it did open, get it out of the way so the rest still reports.
  const clear = async () => { if (await overlay(page)) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
  await clear();
  c.check('there is no "ready" banner', !await page.$('#wrapped-banner') && !/Wrapped is ready/.test(await page.textContent('body')));
  c.check('the Recap is at the bottom', await page.isVisible('#wrapped-recap-section .recap-tiles'));
  c.check('its Play button is tucked away in Show more', !await page.isVisible('#wrapped-recap-section .recap-play'));
  c.check('and the "figures are live" line is gone', !/Figures are live/.test(await page.textContent('#wrapped-recap-section')));
  await page.reload(); await page.waitForTimeout(500);
  c.check('nor on a second load', !await overlay(page));
  await clear();
  // The old secret long press does nothing now.
  const box = await page.locator('#header-subtitle').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up(); await page.waitForTimeout(300);
  c.check('a long press on the subtitle does nothing', !await overlay(page));
  // Logging an ordinary day doesn't either.
  await logSteps(page, 'Amy', 9000);
  c.check('logging an ordinary day does not open it', !await overlay(page));
  // Play does.
  await page.click('#wrapped-recap-section .recap-toggle');
  c.check('Show more reveals Play', await page.isVisible('#wrapped-recap-section .recap-play'));
  await page.click('#wrapped-recap-section .recap-play');
  await page.waitForTimeout(300);
  c.check('the Recap Play button opens it', await overlay(page));
  c.check('on the cover', (await page.textContent('.wrapped-slide')).includes('Year One'));
  c.check('no page errors', errors.length === 0, errors.join(' | '));
  await page.context().close();

  // --- the last night ---
  ({ page, errors } = await boot(browser, { time: new Date(2026, 8, 30, 21, 30), fixture: { logs: shortOfLastDay }, wrappedSeen: false }));
  await page.waitForTimeout(400);
  c.check('the last evening, before logging: nothing', !await overlay(page));
  await logSteps(page, 'Amy', 9200);
  c.check('logging the last day opens it there and then', await overlay(page));
  await close(page);
  c.check('watching marks it seen', await page.evaluate(() => localStorage.getItem('a2a-wrapped-seen-y1-user2')) === '1');
  await logSteps(page, 'Amy', 500);
  c.check('a second log that night does not open it again', !await overlay(page));
  await page.reload(); await page.waitForTimeout(500);
  c.check('and a reload does not either', !await overlay(page));
  c.check('no page errors on the last night', errors.length === 0, errors.join(' | '));
  await page.context().close();

  // --- the other of you on the same phone ---
  ({ page, errors } = await boot(browser, { time: new Date(2026, 8, 30, 21, 30), fixture: { logs: shortOfLastDay }, wrappedSeen: false }));
  await page.waitForTimeout(300);
  await logSteps(page, 'Amy', 9200); await close(page);
  await logSteps(page, 'Ant', 11000);
  c.check('the second of you to log gets their own show', await overlay(page));
  await page.context().close();

  // --- closed on the cover: it doesn't come back by itself ---
  // Booted with Amy's last-day log already saved, as after a real reload.
  const amyDone = [...shortOfLastDay, { id: 'amy-last', userId: 'user2', steps: 9200, note: '', date: new Date(2026, 8, 30, 21, 20) }];
  ({ page, errors } = await boot(browser, { time: new Date(2026, 8, 30, 21, 30), fixture: { logs: amyDone }, wrappedSeen: false }));
  await page.waitForTimeout(500);
  c.check('closed on the cover and reloaded, it still never opens on load', !await overlay(page));
  await page.click('#user-selector button:has-text("Amy")');
  c.check('but the Recap is there for it once she picks her name', await page.isVisible('#wrapped-recap-section .recap-tiles'));
  await page.click('#user-selector button:has-text("Ant")');
  c.check('and not for the one who has not logged the last day yet', !await page.isVisible('#wrapped-recap-section'));
  await page.context().close();

  // --- logged after midnight, as "yesterday" ---
  ({ page, errors } = await boot(browser, { time: new Date(2026, 9, 1, 0, 20), fixture: { logs: shortOfLastDay }, wrappedSeen: false }));
  await page.waitForTimeout(400);
  c.check('just after midnight, before logging: nothing', !await overlay(page));
  await page.click('#user-selector button:has-text("Amy")');
  await page.click('#date-prev');
  c.check('the date reads Yesterday', (await page.textContent('#date-display')).includes('Yesterday'));
  await page.fill('#step-input', '9200');
  await page.click('#step-form button[type="submit"]');
  await page.waitForTimeout(400);
  await dismissMilestone(page);
  c.check('logging the 30th after midnight still opens it', await overlay(page));
  c.check('no page errors after midnight', errors.length === 0, errors.join(' | '));
  await page.context().close();

  // --- a milestone on the same log ---
  ({ page, errors } = await boot(browser, { time: new Date(2026, 8, 30, 21, 30), fixture: { logs: shortOfLastDay }, wrappedSeen: false }));
  await page.waitForTimeout(300);
  await page.click('#user-selector button:has-text("Amy")');
  await page.fill('#step-input', '900000');
  await page.click('#step-form button[type="submit"]');
  await page.waitForTimeout(400);
  c.check('the milestone gets the screen first', await page.evaluate(() => !document.getElementById('modal-overlay').classList.contains('hidden')));
  c.check('the show waits behind it', !await overlay(page));
  await page.click('#modal-confirm', { force: true }).catch(() => {});
  await page.waitForTimeout(300);
  c.check('closing the milestone hands over to the show', await overlay(page));
  c.check('no page errors with both', errors.length === 0, errors.join(' | '));

} catch (e) {
  c.check('the run got to the end', false, String(e.message).split('\n')[0]);
} finally {
  await browser.close();
  c.done();
}
