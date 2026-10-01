// Tests for trip scrapbooks.   node --test trips.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTrips, dayStates, townFrom, flagEmoji, storedName, tripDates, TOGETHER_KM } from './trips.js';

const D = (y, m, d, hh = 20) => new Date(y, m - 1, d, hh);
let n = 0;
const log = (userId, date, place, extra = {}) => ({ id: `l${++n}`, userId, steps: 10000, date, ...(place ? { lat: place[0], lng: place[1], locationName: place[2] } : {}), ...extra });

const WREXHAM = [53.046, -2.99, 'Wrexham'];
const VEGAS = [36.116, -115.174, 'Caesars Palace'];
const VEGAS2 = [36.113, -115.176, 'The Bellagio, Las Vegas, United States'];
const VEGAS_AIRPORT = [36.084, -115.152, 'Harry Reid International Airport'];
const LONDON = [51.507, -0.128, 'London'];
const EDINBURGH = [55.953, -3.188, 'Edinburgh'];
const GLASGOW = [55.864, -4.252, 'Glasgow'];   // ~70 km from Edinburgh
const MANCHESTER_AIRPORT = [53.365, -2.273, 'Manchester Airport'];  // ~60 km
const CHESTER_ZOO = [53.227, -2.884, 'Chester Zoo'];  // ~21 km: not away
const LIVERPOOL = [53.408, -2.991, 'Liverpool'];      // ~40 km: just about
const YORK = [53.959, -1.082, 'York'];                // ~160 km
const MANCHESTER = [53.48, -2.244, 'Manchester'];     // ~70 km

// Both of you somewhere each day.
const both = (date, a, b = a) => [log('user1', date, a), log('user2', date, b)];

test('a week in Vegas together is one trip', () => {
    const logs = [];
    for (let d = 3; d <= 9; d++) logs.push(...both(D(2026, 4, d), d % 2 ? VEGAS : VEGAS2, VEGAS));
    logs.push(...both(D(2026, 4, 10), WREXHAM));
    const trips = findTrips(logs);
    assert.equal(trips.length, 1);
    assert.equal(trips[0].key, '2026-04-03');
    assert.equal(trips[0].days, 7);
    assert.ok(trips[0].maxKm > 8000);
    assert.equal(trips[0].steps.both, 7 * 20000);
});

test('a solo trip is never a trip', () => {
    // Ant in London for three days. Amy at home…
    const atHome = [];
    for (let d = 5; d <= 7; d++) atHome.push(log('user1', D(2026, 5, d), LONDON), log('user2', D(2026, 5, d), WREXHAM));
    assert.equal(findTrips(atHome).length, 0);
    // …or Amy not tagging anywhere.
    const untagged = [];
    for (let d = 5; d <= 7; d++) untagged.push(log('user1', D(2026, 5, d), LONDON), log('user2', D(2026, 5, d)));
    assert.equal(findTrips(untagged).length, 0);
});

test('both away but far apart is not a together day', () => {
    const logs = [];
    for (let d = 5; d <= 7; d++) logs.push(log('user1', D(2026, 5, d), LONDON), log('user2', D(2026, 5, d), EDINBURGH));
    assert.equal(findTrips(logs).length, 0);
    assert.equal(dayStates(logs).get('2026-05-05').kind, 'apart');
    // Edinburgh and Glasgow are further apart than TOGETHER_KM too.
    assert.ok(TOGETHER_KM < 70);
});

test('one of you forgetting to tag a day mid-trip keeps it one trip', () => {
    const logs = [...both(D(2026, 6, 1), EDINBURGH), log('user1', D(2026, 6, 2), EDINBURGH), log('user2', D(2026, 6, 2)), ...both(D(2026, 6, 3), EDINBURGH)];
    const trips = findTrips(logs);
    assert.equal(trips.length, 1);
    assert.equal(trips[0].days, 3);
});

test('a day nobody tagged is bridged — but a day at home is not', () => {
    const bridged = [...both(D(2026, 6, 1), EDINBURGH), log('user1', D(2026, 6, 2)), log('user2', D(2026, 6, 2)), ...both(D(2026, 6, 3), EDINBURGH)];
    assert.equal(findTrips(bridged)[0].days, 3);
    const home = [...both(D(2026, 6, 1), EDINBURGH), log('user1', D(2026, 6, 2), WREXHAM), log('user2', D(2026, 6, 2)), ...both(D(2026, 6, 3), EDINBURGH)];
    const trips = findTrips(home);
    // Two one-day trips to Edinburgh (over 100 km), not one three-day one.
    assert.equal(trips.length, 2);
    assert.ok(trips.every((t) => t.days === 1));
});

test('two untagged days in a row end a trip', () => {
    const logs = [...both(D(2026, 6, 1), EDINBURGH), ...both(D(2026, 6, 2), EDINBURGH),
        log('user1', D(2026, 6, 3)), log('user1', D(2026, 6, 4)), ...both(D(2026, 6, 5), EDINBURGH), ...both(D(2026, 6, 6), EDINBURGH)];
    assert.equal(findTrips(logs).length, 2);
});

test('single days: over 100 km counts, under does not', () => {
    assert.equal(findTrips(both(D(2026, 7, 4), YORK)).length, 1, 'York, ~160 km');
    assert.equal(findTrips(both(D(2026, 7, 4), MANCHESTER)).length, 0, 'Manchester, ~70 km');
    assert.equal(findTrips(both(D(2026, 7, 4), CHESTER_ZOO)).length, 0, 'Chester Zoo is not away at all');
    // Two days in Manchester together is a trip, however near.
    assert.equal(findTrips([...both(D(2026, 7, 4), MANCHESTER), ...both(D(2026, 7, 5), MANCHESTER)]).length, 1);
});

test('the way out joins the trip only if it is near it', () => {
    // Day before: only Ant tagged the Vegas airport → part of the trip.
    const near = [log('user1', D(2026, 4, 2), VEGAS_AIRPORT), log('user2', D(2026, 4, 2)), ...both(D(2026, 4, 3), VEGAS), ...both(D(2026, 4, 4), VEGAS)];
    assert.equal(findTrips(near)[0].key, '2026-04-02');
    // Day before: only Ant tagged Manchester Airport → not part of a Vegas trip.
    const far = [log('user1', D(2026, 4, 2), MANCHESTER_AIRPORT), log('user2', D(2026, 4, 2)), ...both(D(2026, 4, 3), VEGAS), ...both(D(2026, 4, 4), VEGAS)];
    assert.equal(findTrips(far)[0].key, '2026-04-03');
});

test('a trip cannot trail off into a solo one', () => {
    // Together in Edinburgh two days, then Ant on alone (Amy untagged) for three.
    const logs = [...both(D(2026, 8, 1), EDINBURGH), ...both(D(2026, 8, 2), EDINBURGH)];
    for (let d = 3; d <= 5; d++) logs.push(log('user1', D(2026, 8, d), EDINBURGH), log('user2', D(2026, 8, d)));
    const t = findTrips(logs)[0];
    assert.equal(t.days, 3, 'one edge day at most');
});

test('steps count every log on the trip days, tagged or not', () => {
    const logs = [...both(D(2026, 6, 1), EDINBURGH), log('user1', D(2026, 6, 1, 9), null, { steps: 2500 }), ...both(D(2026, 6, 2), EDINBURGH)];
    const t = findTrips(logs)[0];
    assert.equal(t.steps.user1, 22500);
    assert.equal(t.steps.user2, 20000);
});

test('photos from both of you, and the cover from the biggest day', () => {
    const logs = [
        log('user1', D(2026, 4, 3), VEGAS, { photoUrl: 'a.jpg', steps: 9000 }),
        log('user2', D(2026, 4, 3), VEGAS),
        log('user1', D(2026, 4, 4), VEGAS),
        log('user2', D(2026, 4, 4), VEGAS2, { photoUrl: 'b.jpg', steps: 25000 })
    ];
    const t = findTrips(logs)[0];
    assert.deepEqual(t.photos.map((p) => p.photoUrl), ['a.jpg', 'b.jpg']);
    assert.equal(t.coverPhoto.photoUrl, 'b.jpg');
});

test('a guess at the name: the most common town', () => {
    const logs = [...both(D(2026, 4, 3), VEGAS2), ...both(D(2026, 4, 4), VEGAS2), ...both(D(2026, 4, 5), VEGAS)];
    assert.equal(findTrips(logs)[0].guessTitle, 'Las Vegas');
    assert.equal(townFrom('The Bellagio, Las Vegas, United States'), 'Las Vegas');
    assert.equal(townFrom('Lisbon, Portugal'), 'Lisbon');
    assert.equal(townFrom('Caesars Palace'), 'Caesars Palace');
    assert.equal(townFrom(''), '');
});

test('Firestore Timestamps work as well as Dates', () => {
    const ts = (d) => ({ toDate: () => d });
    const logs = both(D(2026, 7, 4), YORK).map((l) => ({ ...l, date: ts(l.date) }));
    assert.equal(findTrips(logs).length, 1);
});

test('newest first', () => {
    const logs = [...both(D(2026, 4, 3), VEGAS), ...both(D(2026, 4, 4), VEGAS), ...both(D(2026, 7, 4), YORK)];
    assert.deepEqual(findTrips(logs).map((t) => t.key), ['2026-07-04', '2026-04-03']);
});

test('names are kept by first day, and survive the first day moving', () => {
    const t = findTrips([...both(D(2026, 4, 3), VEGAS), ...both(D(2026, 4, 4), VEGAS)])[0];
    assert.equal(storedName(t, { '2026-04-03': 'Vegas wedding' }), 'Vegas wedding');
    assert.equal(storedName(t, { '2026-04-04': 'Vegas wedding' }), 'Vegas wedding', 'a key inside the trip still counts');
    assert.equal(storedName(t, { '2026-05-01': 'Other' }), null);
    assert.equal(storedName(t, null), null);
});

test('dates read naturally', () => {
    const t = (s, e) => ({ start: s, end: e, days: Math.round((e - s) / 864e5) + 1 });
    assert.equal(tripDates(t(D(2026, 4, 3), D(2026, 4, 9))), '3–9 Apr 2026');
    assert.equal(tripDates(t(D(2026, 3, 28), D(2026, 4, 2))), '28 Mar – 2 Apr 2026');
    assert.equal(tripDates(t(D(2026, 12, 30), D(2027, 1, 2))), '30 Dec 2026 – 2 Jan 2027');
    assert.equal(tripDates(t(D(2026, 7, 4), D(2026, 7, 4))), '4 Jul 2026');
});

test('flags', () => {
    assert.equal(flagEmoji('gb'), '🇬🇧');
    assert.equal(flagEmoji('US'), '🇺🇸');
    assert.equal(flagEmoji(''), '');
    assert.equal(flagEmoji('xyz'), '');
});

test('Liverpool is right on the edge, and a single day there is no trip', () => {
    assert.equal(findTrips(both(D(2026, 7, 4), LIVERPOOL)).length, 0);
});
