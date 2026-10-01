// Tests for the world view.   node --test journey.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAMP_COORDS, NOT_A_PLACE, bearing, destinationPoint, ringSegments, placeStamps, positionFor, stampError } from './journey.js';
import { HOME, haversineKm } from './wrapped.js';

// The app's real milestone list, read out of index.html.
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const block = html.slice(html.indexOf('const MASTER_MILESTONES'), html.indexOf('const ALL_MILESTONES'));
const MILESTONES = [...block.matchAll(/\{ steps: (\d+), label: "([^"]+)"/g)].map((m) => ({ steps: Number(m[1]), label: m[2] }));

test('the milestone list was found', () => {
    assert.ok(MILESTONES.length > 150, MILESTONES.length);
    assert.ok(MILESTONES.some((m) => m.label === 'Queenstown 🏔️'));
});

test('every stamp is either a place or explicitly not one — never both, never neither', () => {
    const missing = MILESTONES.filter((m) => !STAMP_COORDS[m.label] && !NOT_A_PLACE.includes(m.label)).map((m) => m.label);
    assert.deepEqual(missing, [], 'a stamp nobody placed would silently vanish from the map');
    const both = MILESTONES.filter((m) => STAMP_COORDS[m.label] && NOT_A_PLACE.includes(m.label)).map((m) => m.label);
    assert.deepEqual(both, []);
    const labels = new Set(MILESTONES.map((m) => m.label));
    const stray = [...Object.keys(STAMP_COORDS), ...NOT_A_PLACE].filter((l) => !labels.has(l));
    assert.deepEqual(stray, [], 'coordinates for a stamp that no longer exists');
});

test('every coordinate sits where its steps say: within 3% or 10 km', () => {
    // A wrong Tripoli, a Victoria in the wrong country, a typo in a longitude:
    // they all land at the wrong distance from Wrexham, and this catches it.
    const wrong = placeStamps(MILESTONES)
        .map((s) => ({ s, e: stampError(s) }))
        .filter(({ e }) => e.frac > 0.03 && e.km > 10)
        .map(({ s, e }) => `${s.label}: wants ${Math.round(e.want)} km, is ${Math.round(e.got)} km`);
    assert.deepEqual(wrong, []);
});

test('the family homes are kept out of the code', () => {
    assert.ok(NOT_A_PLACE.includes("Amy's Parents 🏡"));
    assert.ok(NOT_A_PLACE.includes("Ant's Parents 🏠"));
});

test('bearing and destination agree with known distances', () => {
    const paris = { lat: 48.8584, lng: 2.2945 };
    const b = bearing(HOME, paris);
    assert.ok(b > 120 && b < 150, `Paris is south-east: ${b}`);
    const p = destinationPoint(HOME, b, haversineKm(HOME, paris));
    assert.ok(haversineKm(p, paris) < 1, 'heading to Paris for the distance to Paris arrives in Paris');
    const north = destinationPoint(HOME, 0, 1000);
    assert.ok(Math.abs(north.lng - HOME.lng) < 1e-6 && north.lat > HOME.lat);
});

test('a ring is everywhere the same distance from home', () => {
    for (const km of [300, 3438, 12000, 18900]) {
        const pts = ringSegments(km).flat();
        assert.ok(pts.length >= 180);
        const worst = Math.max(...pts.map(([lat, lng]) => Math.abs(haversineKm(HOME, { lat, lng }) - km)));
        assert.ok(worst < 1, `${km} km ring is off by ${worst.toFixed(2)} km somewhere`);
    }
});

test('a ring near the far side of the world closes round New Zealand', () => {
    // Wrexham's antipode is just off New Zealand, so the end of the journey is
    // a small ring there. Queenstown is inside it; Sydney is well outside.
    // Out here "inside the ring" means further from home than the ring is.
    const km = 18900;
    assert.ok(haversineKm(HOME, { lat: -45.0312, lng: 168.6626 }) > km, 'Queenstown is inside the 18,900 km ring');
    const ring = ringSegments(km).flat();
    const lats = ring.map(([lat]) => lat), lngs = ring.map(([, lng]) => lng);
    assert.ok(Math.min(...lats) < -45 && Math.max(...lats) < -20, 'the ring stays in the far south');
    assert.ok(lngs.every((l) => l > 120 || l < -150), 'and in the South Pacific');
    assert.ok(haversineKm(HOME, { lat: -33.8688, lng: 151.2093 }) < km, 'Sydney is nearer home than the ring');
});

test('rings split at the date line rather than streaking across the map', () => {
    const segs = ringSegments(15000);
    assert.ok(segs.length >= 2);
    segs.forEach((s) => s.forEach((p, i) => { if (i) assert.ok(Math.abs(p[1] - s[i - 1][1]) < 180); }));
});

test('where you are: on your ring, facing your next stamp', () => {
    const steps = 1700000; // between Monaco and Barcelona
    const pos = positionFor(steps, MILESTONES);
    assert.equal(pos.next.label, 'Barcelona ☀️');
    assert.equal(pos.last.label, 'Monaco 🎰');
    assert.equal(pos.toGo, 1761643 - steps);
    assert.ok(Math.abs(haversineKm(HOME, pos.point) - pos.km) / pos.km < 0.005, 'the marker sits on the ring');
    // And it faces Barcelona.
    assert.ok(Math.abs(bearing(HOME, pos.point) - bearing(HOME, { lat: 41.3874, lng: 2.1686 })) < 0.5);
});

test('equivalence stamps are skipped when finding the next place', () => {
    // Just past Paphos the next real place is Alexandria, not "5 Million!".
    assert.equal(positionFor(4500000, MILESTONES).next.label, 'Alexandria 🏛️');
    // Just past Monaco, "£100M Line" isn't a place either.
    assert.equal(positionFor(1700000, MILESTONES).next.label, 'Barcelona ☀️');
});

test('at home, and past the end', () => {
    const home = positionFor(0, MILESTONES);
    assert.equal(home.km, 0);
    assert.deepEqual(home.point, { lat: HOME.lat, lng: HOME.lng });
    assert.equal(home.next.label, 'Birmingham 🏙️');
    const done = positionFor(30000000, MILESTONES);
    assert.equal(done.next, null);
    assert.equal(done.last.label, 'Queenstown 🏔️');
});

