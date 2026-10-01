// The world view: a second look at the same map, never the default, and it
// always gives you your map back exactly as you left it.
import { launch, boot, dailyLogs, Checks } from './boot.mjs';
import { mkdirSync } from 'node:fs';
const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const c = new Checks('journey');
const browser = await launch();
const time = new Date(2026, 9, 14, 21, 0);
const WREXHAM = { lat: 53.046, lng: -2.99, locationName: 'Wrexham' };
const logs = dailyLogs(new Date(2025, 9, 1), new Date(2026, 9, 13), { extra: (uid, at, i) => (i % 3 === 0 ? WREXHAM : {}) });

const state = (page) => page.evaluate(() => ({
  pressed: [...document.querySelectorAll('.map-switch button')].find((b) => b.getAttribute('aria-pressed') === 'true').dataset.view,
  pane: document.querySelector('#map .leaflet-map-pane').style.transform,
  zoomClass: [...document.querySelector('#map').classList].join(' '),
  pins: document.querySelectorAll('#map .leaflet-marker-icon').length,
  // Where every pin sits on screen: the same only if centre and zoom both are.
  pinSpots: [...document.querySelectorAll('#map .leaflet-marker-icon')].map((m) => m.style.transform).sort().join('|'),
  rings: [...document.querySelectorAll('#map path.leaflet-interactive, #map path')].filter((p) => ['#16a34a', '#9333ea'].includes(p.getAttribute('stroke'))).length,
  captionShown: !document.getElementById('world-caption').classList.contains('hidden'),
  caption: document.getElementById('world-caption').textContent.replace(/\s+/g, ' ').trim()
}));

let { page, errors } = await boot(browser, { time, fixture: { logs } });
await page.locator('#map').scrollIntoViewIfNeeded();
let s = await state(page);
c.check('the app opens on Our walks', s.pressed === 'walks' && !s.captionShown);
const walks = s;
c.check('with your walk pins on it', walks.pins > 100, walks.pins);

// --- over to the world ---
await page.click('.map-switch [data-view="world"]');
await page.waitForTimeout(300);
s = await state(page);
c.check('the switch goes over', s.pressed === 'world');
c.check('the walk pins step aside: just home and the two of you', s.pins === 3, s.pins);
c.check('a ring each, in your colours', s.rings >= 2, s.rings);
c.check('All time is the default', await page.getAttribute('.world-chips [data-scope="all"]', 'aria-pressed') === 'true');
c.check('the caption says how far, and what is next', /Ant · [\d,]+ km from home · next \S+/.test(s.caption) && /Amy · [\d,]+ km from home/.test(s.caption), s.caption.slice(0, 160));
await page.locator('#map-wrapper').screenshot({ path: OUT + 'world-alltime.png' });
// Both heading for Paphos: the two pins sit side by side, not on top of each other.
const pinBoxes = await page.$$eval('#map .world-pin', (n) => n.map((p) => { const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }));
const overlap = pinBoxes.length === 2 ? Math.max(0, pinBoxes[0].w - Math.abs(pinBoxes[0].x - pinBoxes[1].x)) : -1;
c.check('two of you heading the same way are both visible', overlap >= 0 && overlap < 6, `${overlap}px overlap`);
await page.locator('#world-caption').screenshot({ path: OUT + 'world-caption.png' });
const allTimeKm = Number(s.caption.match(/Ant · ([\d,]+) km/)[1].replace(/,/g, ''));
c.check('about 3,000 km after a year of walking', allTimeKm > 2500 && allTimeKm < 3500, allTimeKm);

// A reached stamp tells you who got there first.
const reached = page.locator('#map path[fill="#374151"]');
c.check('places you have reached are on it', (await reached.count()) > 30, await reached.count());
await reached.first().dispatchEvent('click');
await page.waitForTimeout(200);
const popup = (await page.textContent('.leaflet-popup-content').catch(() => '')) || '';
c.check('a stamp says who got there first, and when', /got there first · \d+ \w+ 20\d\d/.test(popup), popup.slice(0, 120));
await page.keyboard.press('Escape');

// --- this year ---
await page.click('.world-chips [data-scope="year"]');
await page.waitForTimeout(300);
s = await state(page);
const yearKm = Number(s.caption.match(/Ant · ([\d,]+) km/)[1].replace(/,/g, ''));
c.check('This year starts again from Wrexham', /This year, since 1 October/.test(s.caption) && yearKm < 200, yearKm);
await page.locator('#map-wrapper').screenshot({ path: OUT + 'world-thisyear.png' });
await page.click('.world-chips [data-scope="all"]');

// --- fullscreen comes along ---
await page.click('#map-fullscreen-btn');
await page.waitForTimeout(300);
c.check('fullscreen works in the world view, chips and all', await page.isVisible('#map-fs-overlay .world-chips'));
await page.screenshot({ path: OUT + 'world-fullscreen.png' });
await page.click('#map-fullscreen-btn');
await page.waitForTimeout(300);

// --- and back ---
await page.click('.map-switch [data-view="walks"]');
await page.waitForTimeout(300);
s = await state(page);
c.check('back to Our walks', s.pressed === 'walks' && !s.captionShown);
c.check('the pins come back', s.pins === walks.pins, `${walks.pins} → ${s.pins}`);
c.check('the camera is exactly where it was', s.pane === walks.pane && s.pinSpots === walks.pinSpots, `${walks.pane} → ${s.pane}`);
c.check('no rings left behind', s.rings === 0);
c.check('no world controls left behind', !await page.$('.world-chips') && !await page.$('.world-whole'));

// --- a reload always opens on your map ---
await page.click('.map-switch [data-view="world"]');
await page.reload();
await page.waitForTimeout(500);
c.check('a reload opens on Our walks again', (await state(page)).pressed === 'walks');
c.check('no page errors', errors.length === 0, errors.join(' | '));
await page.context().close();

// --- near the end of the journey: the ring closes round New Zealand ---
const far = [...logs, { id: 'big', userId: 'user1', steps: 15000000, date: new Date(2026, 9, 10, 21) }];
({ page, errors } = await boot(browser, { time, fixture: { logs: far } }));
await page.locator('#map').scrollIntoViewIfNeeded();
await page.click('.map-switch [data-view="world"]');
await page.waitForTimeout(400);
s = await state(page);
c.check('19 million steps: next stop in Australia', /Ant · 1[45],\d{3} km from home · next Perth/.test(s.caption), s.caption.slice(0, 120));
c.check('the ring is drawn in pieces, not streaked across the date line', s.rings >= 3, s.rings);
await page.locator('#map-wrapper').screenshot({ path: OUT + 'world-far.png' });
c.check('no page errors far from home', errors.length === 0, errors.join(' | '));

await browser.close();
c.done();
