// Trip scrapbooks: trips you took together become cards and pages by themselves.
import { launch, boot, dailyLogs, Checks } from './boot.mjs';
import { mkdirSync } from 'node:fs';
const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const c = new Checks('trips');
const browser = await launch();

const WREXHAM = { lat: 53.046, lng: -2.99, locationName: 'Wrexham' };
const VEGAS = { lat: 36.116, lng: -115.174, locationName: 'Caesars Palace' };
const BELLAGIO = { lat: 36.113, lng: -115.176, locationName: 'The Bellagio' };
const LONDON = { lat: 51.507, lng: -0.128, locationName: 'London' };
const YORK = { lat: 53.959, lng: -1.082, locationName: 'York Minster' };
const EDINBURGH = { lat: 55.953, lng: -3.188, locationName: 'Edinburgh Castle' };
const photo = (hue, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},55%,60%)"/><text x="100" y="110" font-size="22" fill="#fff" text-anchor="middle">${label}</text></svg>`);

const inRange = (d, y, m, from, to) => d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() >= from && d.getDate() <= to;
const logs = dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 13), {
  extra: (uid, at, i) => {
    if (inRange(at, 2026, 4, 3, 9)) {
      const day = at.getDate();
      return { ...(day % 2 ? VEGAS : BELLAGIO), ...(uid === 'user1' && day === 7 ? { photoUrl: photo(30, 'wedding'), note: 'Rob and Sian got married!', steps: 21000 } : {}),
               ...(uid === 'user2' && day === 5 ? { photoUrl: photo(200, 'strip') } : {}), ...(uid === 'user1' && day === 4 ? { exercise: ['dancing'] } : {}) };
    }
    if (inRange(at, 2026, 5, 5, 7)) return uid === 'user1' ? LONDON : WREXHAM;                  // Ant's work trip
    if (inRange(at, 2026, 7, 4, 4)) return YORK;                                                   // a day in York
    if (inRange(at, 2026, 8, 1, 2)) return uid === 'user2' && at.getDate() === 2 ? {} : EDINBURGH; // Amy forgot to tag day 2
    return i % 5 === 0 ? WREXHAM : {};
  }
});
const reverse = (url) => {
  const lat = Number(new URL(url).searchParams.get('lat'));
  if (lat < 40) return { address: { city: 'Las Vegas', country_code: 'us' } };
  if (lat > 55) return { address: { city: 'Edinburgh', country_code: 'gb' } };
  return { address: { city: 'York', country_code: 'gb' } };
};

let { page, errors } = await boot(browser, { fixture: { logs }, geocode: reverse, time: new Date(2026, 9, 14, 21, 0) });
// Place lookups run one at a time, a second apart: let the queue drain.
for (let i = 0; i < 12; i++) {
  const named = await page.$$eval('.trip-card', (n) => n.filter((x) => /Las Vegas|York 4|Edinburgh 1/.test(x.textContent.replace(/\s+/g, ' '))).length);
  if (named === 3) break;
  await page.clock.runFor(1200);
  await page.waitForTimeout(150);
}

const cards = await page.$$eval('.trip-card', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
c.check('the Trips section is showing', await page.isVisible('#trips-section'));
c.check('three trips, newest first', cards.length === 3 && /Edinburgh/.test(cards[0]) && /York/.test(cards[1]) && /Las Vegas/.test(cards[2]), JSON.stringify(cards));
c.check('the solo London work trip is not one of them', !cards.some((x) => /London/.test(x)));
c.check('Vegas reads right', /Las Vegas 🇺🇸/.test(cards[2]) && /3–9 Apr 2026/.test(cards[2]) && /7 days/.test(cards[2]), cards[2]);
c.check('no flag for trips at home in the UK', !/🇬🇧/.test(cards.join(' ')));
c.check('York is a one-day trip', /1 day ·/.test(cards[1]), cards[1]);
c.check('Edinburgh holds together though Amy forgot to tag a day', /2 days/.test(cards[0]), cards[0]);
c.check('a card with a photo uses it as the cover', await page.$eval('.trip-card[data-trip="2026-04-03"] img.trip-card-cover', (i) => i.src.includes('wedding')).catch(() => false));
await page.locator('#trips-section').screenshot({ path: OUT + 'trips-row.png' });

// The main map before opening a trip.
const mainMap = () => page.evaluate(() => {
  const pane = document.querySelector('#map .leaflet-map-pane');
  return { transform: pane ? pane.style.transform : null, markers: document.querySelectorAll('#map .leaflet-marker-icon').length };
});
const before = await mainMap();

// --- the trip page ---
await page.click('.trip-card[data-trip="2026-04-03"]');
await page.waitForTimeout(400);
c.check('the trip page opens', await page.isVisible('#trip-page'));
const text = (await page.textContent('#trip-page')).replace(/\s+/g, ' ');
c.check('titled, dated, flagged', /Las Vegas 🇺🇸/.test(text) && /3–9 Apr 2026 · 7 days/.test(text), text.slice(0, 120));
const vegas = logs.filter((l) => l.date.getMonth() === 3 && l.date.getDate() >= 3 && l.date.getDate() <= 9 && l.date.getFullYear() === 2026);
const sum = (uid) => vegas.filter((l) => !uid || l.userId === uid).reduce((a, l) => a + l.steps, 0);
c.check('steps each and together', text.includes(sum().toLocaleString('en-GB')) && text.includes(sum('user1').toLocaleString('en-GB')) && text.includes(sum('user2').toLocaleString('en-GB')));
c.check('every photo from both of you', (await page.$$('#trip-page .trip-photo')).length === 2);
c.check('captions name the place and day', /Caesars Palace · Tue,? 7 Apr/.test(text), text.match(/Caesars Palace · [^C]{0,12}/));
c.check('the furthest point', /km from Wrexham/.test(text));
c.check('a day-by-day list of all seven days', (await page.$$('#trip-page .border-b')).length === 7);
c.check('notes are in it', text.includes('Rob and Sian got married!'));
c.check('so is exercise', text.includes('💃'));
c.check('its own small map, with your pins', (await page.$$('#trip-map .leaflet-interactive')).length === 14, (await page.$$('#trip-map .leaflet-interactive')).length);
c.check('the page behind stops scrolling', await page.evaluate(() => document.body.classList.contains('trip-lock')));
await page.screenshot({ path: OUT + 'trip-page.png', fullPage: false });
await page.evaluate(() => { document.getElementById('trip-page').scrollTop = 99999; });
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + 'trip-page-end.png' });
await page.evaluate(() => { document.getElementById('trip-page').scrollTop = 0; });

// A photo opens on top of the page.
await page.click('#trip-page .trip-photo');
await page.waitForTimeout(150);
const onTop = await page.evaluate(() => { const el = document.elementFromPoint(195, 300); return !!el && !!el.closest('#lightbox-overlay'); });
c.check('a photo opens full size, on top of the trip', await page.isVisible('#lightbox-overlay') && onTop);
await page.click('#lightbox-close');

// --- renaming ---
await page.click('#trip-rename');
await page.fill('#m-trip-name', 'Vegas wedding');
await page.click('#modal-confirm');
await page.waitForTimeout(300);
const saved = await page.evaluate(() => {
  const k = Object.keys(window.__fb.cols).find((p) => /challengeData$/.test(p));
  return window.__fb.cols[k].get('trips');
});
c.check('the name is saved, shared, by the first day', saved && saved.names && saved.names['2026-04-03'] === 'Vegas wedding', JSON.stringify(saved));
c.check('the page shows it', (await page.textContent('#trip-page h2')).includes('Vegas wedding'));
c.check('and so does the card', (await page.textContent('.trip-card[data-trip="2026-04-03"]')).includes('Vegas wedding'));
await page.click('#trip-rename');
await page.fill('#m-trip-name', '');
await page.click('#modal-confirm');
await page.waitForTimeout(300);
const cleared = await page.evaluate(() => {
  const k = Object.keys(window.__fb.cols).find((p) => /challengeData$/.test(p));
  return window.__fb.cols[k].get('trips');
});
c.check('clearing it really removes it', cleared && !('2026-04-03' in cleared.names), JSON.stringify(cleared));
c.check('and the place name comes back', (await page.textContent('#trip-page h2')).includes('Las Vegas'));

// --- closing ---
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
c.check('Escape closes it', !await page.isVisible('#trip-page') && !await page.evaluate(() => document.body.classList.contains('trip-lock')));
await page.click('.trip-card[data-trip="2026-07-04"]');
await page.click('#trip-close');
c.check('so does Back', !await page.isVisible('#trip-page'));
const after = await mainMap();
c.check('the main map is exactly as it was', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
c.check('the console audit lists the trips', await page.evaluate(() => window.tripAudit()) === 3);
c.check('no page errors', errors.length === 0, errors.join(' | '));
await page.context().close();

// --- no trips at all ---
({ page, errors } = await boot(browser, { fixture: { logs: dailyLogs(new Date(2026, 8, 1), new Date(2026, 9, 13)) } }));
c.check('with no trips, the section stays hidden', !await page.isVisible('#trips-section'));
c.check('no page errors without trips', errors.length === 0, errors.join(' | '));
await page.context().close();

// --- offline: the place lookup fails, the guess stands ---
({ page, errors } = await boot(browser, { fixture: { logs }, geocode: () => { throw new Error('offline'); } }));
await page.waitForTimeout(300);
const offline = await page.$$eval('.trip-card', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
c.check('offline, trips still show under the place you tagged', offline.length === 3 && offline.some((x) => /Caesars Palace|The Bellagio/.test(x)), JSON.stringify(offline));
c.check('no page errors offline', errors.length === 0, errors.join(' | '));
// --- the real Vegas trip, as it was logged, and fixing dates by hand ---
const PLACES = {
  4: [{ lat: 51.47, lng: -0.4543, locationName: 'Heathrow Airport' }, { lat: 36.084, lng: -115.1537, locationName: 'Harry Reid International Airport' }],
  5: [{ lat: 36.1023, lng: -115.1745, locationName: 'New York New York Hotel and Casino' }, { lat: 36.1707, lng: -115.1462, locationName: 'Fremont Street' }],
  6: [{ lat: 36.1125, lng: -115.1707, locationName: 'Eiffel Tower' }, { lat: 36.0121, lng: -113.8107, locationName: 'Grand Canyon Skywalk' }],
  7: [{ lat: 36.1513, lng: -115.1527, locationName: 'Little White Chapel' }, { lat: 36.1172, lng: -115.1727, locationName: "Gordon Ramsay's Hell's Kitchen" }],
  8: [{ lat: 36.1208, lng: -115.1622, locationName: 'Sphere' }, { lat: 36.1247, lng: -115.1677, locationName: 'The Palazzo Theater' }],
  9: [{ lat: 36.1126, lng: -115.1767, locationName: 'Kalologie | The Bellagio | IV Therapy & More' }, { lat: 36.1126, lng: -115.1741, locationName: 'Fountains of Bellagio' }],
  10: [{ lat: 36.084, lng: -115.1537, locationName: 'Harry Reid International Airport' }, { lat: 51.47, lng: -0.4543, locationName: 'Heathrow Airport' }]
};
const realLogs = dailyLogs(new Date(2026, 2, 1), new Date(2026, 4, 1), {
  extra: (uid, at) => {
    if (at.getMonth() !== 3) return {};
    const p = PLACES[at.getDate()];
    const out = p ? p[uid === 'user1' ? 0 : 1] : {};
    if (at.getDate() === 3 && uid === 'user1') return { ...out, photoUrl: photo(90, 'packing') };
    if (at.getDate() === 7 && uid === 'user1') return { ...out, photoUrl: photo(30, 'wedding') };
    return out;
  }
});
({ page, errors } = await boot(browser, { fixture: { logs: realLogs }, geocode: () => ({ address: { county: 'Clark County', country_code: 'us' } }), time: new Date(2026, 9, 14, 21, 0) }));
await page.waitForTimeout(400);
let real = await page.$$eval('.trip-card', (n) => n.map((x) => [x.dataset.trip, x.textContent.replace(/\s+/g, ' ').trim()]));
c.check('the real Vegas trip comes out as one trip', real.length === 1, JSON.stringify(real));
c.check('from the 4th to the 10th', real.length === 1 && real[0][0] === '2026-04-04' && /4–10 Apr 2026/.test(real[0][1]) && /7 days/.test(real[0][1]), real[0] && real[0][1]);

// Name it, then widen the dates by hand: the 3rd (packing) to the 11th.
await page.click('.trip-card[data-trip="2026-04-04"]');
await page.click('#trip-rename'); await page.fill('#m-trip-name', 'Vegas wedding'); await page.click('#modal-confirm');
await page.waitForTimeout(250);
await page.click('#trip-dates');
c.check('the dates editor starts on the trip as it is', await page.inputValue('#m-trip-start') === '2026-04-04' && await page.inputValue('#m-trip-end') === '2026-04-10');
await page.fill('#m-trip-start', '2026-04-03');
await page.fill('#m-trip-end', '2026-04-11');
await page.click('#modal-confirm');
await page.waitForTimeout(400);
let doc = await page.evaluate(() => { const k = Object.keys(window.__fb.cols).find((p) => /challengeData$/.test(p)); return window.__fb.cols[k].get('trips'); });
c.check('your dates are saved, shared', doc && JSON.stringify(doc.custom) === '[{"start":"2026-04-03","end":"2026-04-11"}]', JSON.stringify(doc));
c.check('the name follows the trip to its new first day', doc && doc.names['2026-04-03'] === 'Vegas wedding' && !('2026-04-04' in doc.names), JSON.stringify(doc && doc.names));
const pageText = (await page.textContent('#trip-page')).replace(/\s+/g, ' ');
c.check('the open page redraws with the new dates', /Vegas wedding/.test(pageText) && /3–11 Apr 2026 · 9 days/.test(pageText), pageText.slice(0, 120));
c.check('and the photos fill in from them, the packing one included', (await page.$$('#trip-page .trip-photo')).length === 2);
c.check('nine days in the day-by-day list', (await page.$$('#trip-page .border-b')).length === 9);
await page.click('#trip-close');
real = await page.$$eval('.trip-card', (n) => n.map((x) => x.dataset.trip));
c.check('still just one card', JSON.stringify(real) === '["2026-04-03"]', JSON.stringify(real));

// Undo: back to the automatic dates.
await page.click('.trip-card[data-trip="2026-04-03"]');
await page.click('#trip-dates');
c.check('a trip with your dates offers to undo them', /Undo my dates/.test(await page.textContent('#modal-content')));
await page.check('#m-trip-undo');
await page.click('#modal-confirm');
await page.waitForTimeout(400);
real = await page.$$eval('.trip-card', (n) => n.map((x) => [x.dataset.trip, x.textContent.replace(/\s+/g, ' ').trim()]));
c.check('undoing goes back to the automatic trip', real.length === 1 && real[0][0] === '2026-04-04', JSON.stringify(real));
c.check('and keeps its name', real.length === 1 && /Vegas wedding/.test(real[0][1]));

// "This isn't a trip."
await page.click('.trip-card[data-trip="2026-04-04"]');
await page.click('#trip-dates');
c.check('an automatic trip offers to remove it', /isn't a trip/.test(await page.textContent('#modal-content')));
await page.check('#m-trip-undo');
await page.click('#modal-confirm');
await page.waitForTimeout(400);
c.check('removing it takes the card away', (await page.$$('.trip-card')).length === 0 && !await page.isVisible('#trip-page'));
doc = await page.evaluate(() => { const k = Object.keys(window.__fb.cols).find((p) => /challengeData$/.test(p)); return window.__fb.cols[k].get('trips'); });
c.check('remembered as not a trip', doc && doc.hidden.includes('2026-04-04'), JSON.stringify(doc));
c.check('no page errors editing trips', errors.length === 0, errors.join(' | '));

await browser.close();
c.done();
