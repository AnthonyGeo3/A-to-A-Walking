// Signing in, the read-only view, notes and photos kept private, text that
// can't run as code, and the backup file.
//
// Runs against the stand-in's locked rules (the same as firestore.rules): a
// visitor can read the shared logs, only Ant and Amy can write, and only they
// can read the private notes and photos.
import { launch, boot, dailyLogs, logSteps, dismissMilestone, Checks } from './boot.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const c = new Checks('security');
const browser = await launch();
const time = new Date(2026, 9, 28, 21, 30);
const PARIS = { lat: 48.8584, lng: 2.2945, locationName: 'Eiffel Tower' };
const PHOTO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#a855f7"/></svg>');
const XSS_NOTE = '<img src=x onerror="window.__xss=1">ha';
const XSS_PLACE = '<img src=x onerror="window.__xss=2">Bad place';

// Every log carries `note: ''` the way old ones do, plus a trip to Paris.
const logs = dailyLogs(new Date(2026, 9, 1), new Date(2026, 9, 18), {
  extra: (uid, at, i) => (i >= 10 && i <= 12 ? { ...PARIS, ...(uid === 'user1' && i === 11 ? { note: 'Trip secret note' } : {}) } : {})
}).concat([
  { id: 'legacy-note', userId: 'user1', steps: 9100, date: new Date(2026, 9, 20, 21), note: 'Secret squirrel note', locationName: 'Chester Zoo', lat: 53.227, lng: -2.884 },
  { id: 'legacy-photo', userId: 'user2', steps: 9200, date: new Date(2026, 9, 21, 21), note: 'Purple sunset', photoUrl: PHOTO, photoPath: 'photos/legacy-photo.jpg' },
  { id: 'legacy-newer', userId: 'user1', steps: 9300, date: new Date(2026, 9, 22, 21), note: 'old public note' },
  { id: 'xss', userId: 'user2', steps: 9400, date: new Date(2026, 9, 23, 21), note: XSS_NOTE, locationName: XSS_PLACE, lat: 53.05, lng: -2.99 },
  { id: 'moved', userId: 'user1', steps: 9500, date: new Date(2026, 9, 24, 21), exercise: ['running'] }
]);
const fixture = (extra = {}) => ({
  logs,
  private: { 'legacy-newer': { note: 'newer private note' } },
  users: { user1: { stretch: { label: '<img src=x onerror="window.__xss=3">Watch', steps: 1500000, reward: '⌚' } } },
  rules: 'locked',
  ...extra
});
const SECRETS = ['Secret squirrel note', 'Purple sunset', 'old public note', 'newer private note', 'Trip secret note'];

const col = (page, re) => page.evaluate((re) => {
  const k = Object.keys(window.__fb.cols).find((p) => new RegExp(re).test(p));
  return k ? Object.fromEntries([...window.__fb.cols[k].entries()].map(([id, d]) => [id, JSON.parse(JSON.stringify(d))])) : {};
}, re);
const text = (page) => page.evaluate(() => document.body.innerText);
const visible = (page, sel) => page.isVisible(sel).catch(() => false);
const count = (page, sel) => page.$$eval(sel, (els) => els.length);
const EDIT = '.edit-note, .del-log, .edit-photo, .edit-loc, .edit-date, .edit-exercise, .stretch-edit-btn';
const injected = (page) => page.evaluate(() => ({ ran: window.__xss || null, imgs: document.querySelectorAll('img[onerror]').length }));

async function signIn(page, email, password = 'walk-walk') {
  if (!await visible(page, '#sign-in-form')) await page.click('#sign-in-open');
  await page.fill('#sign-in-email', email);
  await page.fill('#sign-in-password', password);
  await page.click('#sign-in-form button[type="submit"]');
  await page.waitForTimeout(300);
}

// --- Someone with the link, not signed in -------------------------------------
let { page, errors } = await boot(browser, { time, fixture: fixture({ user: null }), geocode: { address: { city: 'Paris', country_code: 'fr' } } });
try {
  c.check('visitor: says view only, with a way to sign in', await visible(page, '#view-only') && /View only/.test(await page.textContent('#view-only-text')) && await visible(page, '#sign-in-open'));
  c.check('visitor: no one to log as, no form', !await visible(page, '#user-selector button') && !await visible(page, '#step-form'));
  c.check('visitor: no backup or sign out', !await visible(page, '#account-bar'));
  c.check('visitor: not a single edit button', await count(page, EDIT) === 0, String(await count(page, EDIT)));
  c.check('visitor: the logs and steps are there', await count(page, '#user1-log .log-entry') >= 18 && await count(page, '#user2-log .log-entry') >= 18);
  const t = await text(page);
  c.check('visitor: no notes anywhere on the page', SECRETS.every((s) => !t.includes(s)), SECRETS.filter((s) => t.includes(s)).join(', '));
  c.check('visitor: no photos', await count(page, '.log-photo-thumb, .photo-pin, .trip-card-cover[src]') === 0);
  c.check('visitor: places still show', t.includes('Chester Zoo'));
  c.check('visitor: the map has its pins', await count(page, '.leaflet-marker-icon') >= 3);
  c.check('visitor: exercise shows, but as a plain mark', await count(page, '#user1-log span.log-exercise') === 1 && await count(page, '.log-exercise-empty, button.log-exercise') === 0);
  c.check('visitor: no goal pencil', await count(page, '.stretch-edit-btn') === 0);
  let x = await injected(page);
  c.check('visitor: a place written as code shows as text', !x.ran && x.imgs === 0 && t.includes('Bad place'), JSON.stringify(x));
  await page.click('.show-location:has-text("Bad place")');
  await page.waitForTimeout(100);
  x = await injected(page);
  c.check('visitor: and in its pop-up too', !x.ran && x.imgs === 0 && (await page.textContent('#modal-content')).includes('<img src=x'), JSON.stringify(x));
  await page.click('#modal-confirm');
  await page.screenshot({ path: OUT + 'security-visitor.png' });

  if (await count(page, '.trip-card')) {
    await page.click('.trip-card');
    await page.waitForTimeout(200);
    const tp = await page.textContent('#trip-page');
    c.check('visitor: a trip opens, without its edit buttons or notes', !await page.$('#trip-dates') && !await page.$('#trip-rename') && !tp.includes('Trip secret note') && tp.includes('Eiffel Tower'));
    await page.click('#trip-close');
  } else c.check('visitor: the Paris trip is found', false);

  c.check('visitor: nothing written at all', (await page.evaluate(() => window.__fb.writes.length)) === 0);
  const pub = await col(page, 'challengeLogs$');
  c.check('visitor: old notes stay put until one of you signs in', pub['legacy-note'] && pub['legacy-note'].note === 'Secret squirrel note');

  // --- Signing in -------------------------------------------------------------
  await signIn(page, 'ant@test.example', 'wrong');
  c.check('wrong password: says so, still view only', /don't match/.test(await page.textContent('#sign-in-error')) && await visible(page, '#view-only') && await count(page, EDIT) === 0);

  await signIn(page, 'Ant@test.example ');
  c.check('signed in: view only goes, the form and backup come', !await visible(page, '#view-only') && await visible(page, '#user-selector button') && await visible(page, '#account-bar'));
  c.check('signed in: the edit buttons are back', await count(page, '.del-log') >= 40 && await count(page, '.stretch-edit-btn') === 2);
  const t2 = await text(page);
  c.check('signed in: notes show', ['Secret squirrel note', 'Purple sunset', 'newer private note'].every((s) => t2.includes(s)));
  c.check('signed in: a note saved since wins over the old copy', !t2.includes('old public note'));
  c.check('signed in: photos show', await count(page, '.log-photo-thumb') === 1);
  x = await injected(page);
  c.check('signed in: notes and goals written as code show as text', !x.ran && x.imgs === 0 && t2.includes('<img src=x onerror="window.__xss=1">ha') && t2.includes('Watch'), JSON.stringify(x));

  // The move: notes and photos off the shared logs, into the private store.
  const pub2 = await col(page, 'challengeLogs$');
  const priv = await col(page, 'challengePrivate$');
  const leftover = Object.entries(pub2).filter(([, d]) => ['note', 'photoUrl', 'photoPath'].some((k) => k in d)).map(([id]) => id);
  c.check('moved: no shared log keeps a note or photo, not even an empty one', leftover.length === 0, leftover.slice(0, 5).join(', '));
  c.check('moved: every note and photo arrived', priv['legacy-note'] && priv['legacy-note'].note === 'Secret squirrel note'
    && priv['legacy-photo'] && priv['legacy-photo'].note === 'Purple sunset' && priv['legacy-photo'].photoUrl === PHOTO && priv['legacy-photo'].photoPath === 'photos/legacy-photo.jpg'
    && priv['user1-11'] && priv['user1-11'].note === 'Trip secret note' && priv.xss && priv.xss.note === XSS_NOTE, JSON.stringify(Object.keys(priv)));
  c.check('moved: the newer private note was left alone', priv['legacy-newer'] && priv['legacy-newer'].note === 'newer private note');
  c.check('moved: empty notes weren\'t copied', !priv['user1-1'] && !priv['user2-5']);
  c.check('moved: and nothing else changed', pub2['legacy-note'].steps === 9100 && pub2['legacy-note'].locationName === 'Chester Zoo' && Object.keys(pub2).length === logs.length);
  const copy = await page.evaluate(() => JSON.parse(localStorage.getItem('a2a-private-move-copy') || '{}'));
  c.check('moved: with a copy kept on the phone first', copy['legacy-photo'] && copy['legacy-photo'].photoUrl === PHOTO && copy['legacy-note'].note === 'Secret squirrel note');

  // Editing a note lands in the private store.
  await page.click('button.edit-note[data-id="xss"]');
  c.check('editing: a note with code in it comes back exactly as typed', (await page.inputValue('#m-note')) === XSS_NOTE);
  await page.click('#modal-cancel');
  await page.click('button.edit-note[data-id="legacy-note"]');
  await page.fill('#m-note', 'Squirrels at the zoo');
  await page.click('#modal-confirm');
  await page.waitForTimeout(200);
  let p = await col(page, 'challengePrivate$');
  let q = await col(page, 'challengeLogs$');
  c.check('editing: the note saves privately', p['legacy-note'].note === 'Squirrels at the zoo' && !('note' in q['legacy-note']) && (await text(page)).includes('Squirrels at the zoo'));

  // A new log has no note on it at all.
  await logSteps(page, 'Ant', 4321);
  q = await col(page, 'challengeLogs$');
  const fresh = Object.values(q).find((d) => d.steps === 4321);
  c.check('logging: works once signed in, and the shared log has no note field', fresh && !('note' in fresh) && fresh.userId === 'user1');

  // A photo goes to the private store.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('button.edit-photo[data-id="moved"]')]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJ2gPmJ0zvmwAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForTimeout(800);
  p = await col(page, 'challengePrivate$');
  q = await col(page, 'challengeLogs$');
  c.check('photos: a new one saves privately', p.moved && p.moved.photoPath === 'photos/moved.jpg' && !!p.moved.photoUrl && !('photoUrl' in q.moved), JSON.stringify(p.moved));

  // Deleting a log takes its notes and photo with it.
  await page.click('button.del-log[data-id="legacy-photo"]');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);
  p = await col(page, 'challengePrivate$');
  q = await col(page, 'challengeLogs$');
  c.check('deleting: the log and its private notes both go', !q['legacy-photo'] && !p['legacy-photo']);

  // The backup file.
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#backup-btn')]);
  const backup = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  const blog = backup.logs.find((l) => l.id === 'legacy-note');
  c.check('backup: a file named for the day', /^a-to-a-backup-2026-10-28\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  c.check('backup: every log, with its note', backup.logs.length === Object.keys(q).length && blog && blog.note === 'Squirrels at the zoo' && blog.steps === 9100);
  c.check('backup: dates written out plainly', blog && blog.date === new Date(2026, 9, 20, 21).toISOString());
  c.check('backup: both of you and the trips', backup.users.user1.name === 'Ant' && backup.users.user2.name === 'Amy' && backup.trips && Array.isArray(backup.trips.custom));
  c.check('backup: oldest first', backup.logs[0].date <= backup.logs[backup.logs.length - 1].date);

  // Once is enough: still signed in after closing and reopening. (The stand-in's
  // data starts again from the fixture on a reload; the sign-in is what carries.)
  await page.reload();
  await page.waitForTimeout(500);
  c.check('reopened: still signed in, no password asked', !await visible(page, '#view-only') && await visible(page, '#account-bar') && (await text(page)).includes('Secret squirrel note'));
  await page.screenshot({ path: OUT + 'security-signed-in.png' });
  await page.locator('#account-bar').screenshot({ path: OUT + 'security-account-bar.png' });

  // Signing out.
  page.once('dialog', (d) => d.accept());
  await page.click('#sign-out-btn');
  await page.waitForTimeout(300);
  const t3 = await text(page);
  c.check('signed out: back to view only, notes gone again', await visible(page, '#view-only') && !await visible(page, '#account-bar') && await count(page, EDIT) === 0 && SECRETS.every((s) => !t3.includes(s)));
  c.check('no errors along the way', errors.length === 0, errors.join(' | '));
} catch (e) {
  c.check('visitor and sign-in run finished', false, String(e).split('\n')[0]);
  await page.screenshot({ path: OUT + 'security-crash.png' }).catch(() => {});
}
await page.context().close();

// --- An account the rules don't list ---------------------------------------
({ page, errors } = await boot(browser, { time, fixture: fixture({ user: null }) }));
try {
  await signIn(page, 'someone@test.example');
  await page.waitForTimeout(200);
  c.check('other account: told the rules don\'t let it in', /rules don't let this account/.test(await page.textContent('#view-only-text')) && (await page.textContent('#sign-in-open')) === 'Sign out');
  c.check('other account: no edit buttons, no notes, no backup', await count(page, EDIT) === 0 && !(await text(page)).includes('Secret squirrel') && !await visible(page, '#account-bar'));
  c.check('other account: nothing written', (await page.evaluate(() => window.__fb.writes.length)) === 0);
  page.once('dialog', (d) => d.accept());
  await page.click('#sign-in-open');
  await page.waitForTimeout(200);
  c.check('other account: can sign out again', /View only/.test(await page.textContent('#view-only-text')) && (await page.textContent('#sign-in-open')) === 'Sign in');
} catch (e) {
  c.check('other-account run finished', false, String(e).split('\n')[0]);
}
await page.context().close();

// --- Before the rules are pasted in -----------------------------------------
// Everything is still open, so a visitor *could* write. The page never does,
// and still shows no notes, even though the old copies are readable.
({ page, errors } = await boot(browser, { time, fixture: fixture({ user: null, rules: undefined }) }));
try {
  const t = await text(page);
  c.check('old rules, visitor: still no notes or photos shown', SECRETS.every((s) => !t.includes(s)) && await count(page, '.log-photo-thumb') === 0);
  c.check('old rules, visitor: still writes nothing', (await page.evaluate(() => window.__fb.writes.length)) === 0);
} catch (e) {
  c.check('old-rules run finished', false, String(e).split('\n')[0]);
}
await page.context().close();

// --- Anonymous sign-in switched off -----------------------------------------
({ page, errors } = await boot(browser, { time, fixture: fixture({ user: null, anonymousOff: true }) }));
try {
  c.check('no anonymous sign-in: the page still loads for visitors', await count(page, '#user1-log .log-entry') >= 18 && await visible(page, '#view-only'));
  c.check('no anonymous sign-in: without errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  c.check('anonymous-off run finished', false, String(e).split('\n')[0]);
}
await page.context().close();

await browser.close();
c.done();
