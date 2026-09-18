// Tests for the Year Wrapped stats engine.
//   node --test wrapped.test.mjs
//
// The main fixture is a synthetic year 1 built so that every answer can be
// worked out by hand, and the expected values below are those hand calculations
// rather than whatever the code happened to produce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeWrapped,
    funComparisons,
    FUN_COMPARISONS,
    EARTH_KM,
    buildMapTour,
    buildSlides,
    monthSlide,
    yearWord,
    wrappedYears,
    haversineKm,
    lastMilestoneAtOrBelow,
    challengeYearStart,
    challengeYearEnd,
    HOME
} from './wrapped.js';

// --- fixture ---------------------------------------------------------------
//
// user1: 9,000 every one of the 365 days, plus a second 3,500 log on each of
//        1–23 Feb 2026 (so those days total 12,500 and clear the 10k bar), plus
//        an extra 20,000 on 14 Mar 2026 (a single, unambiguous best day).
// user2: 9,500 every day except the whole of December 2025, plus 500,000 on
//        1 Sep 2026 (which snatches the year back at the last minute).
//
// Hand-computed totals:
//   user1 = 365×9,000 + 23×3,500 + 20,000 + 111 (the 23:59 boundary log)
//         = 3,285,000 + 80,500 + 20,000 + 111 = 3,385,611
//   user2 = 334×9,500 + 500,000 = 3,173,000 + 500,000 = 3,673,000

const D = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function buildFixture() {
    const logs = [];
    const start = challengeYearStart(1);
    const end = challengeYearEnd(1);

    for (const cur = new Date(start); cur < end; cur.setDate(cur.getDate() + 1)) {
        const d = new Date(cur);
        const k = key(d);
        logs.push({ id: `u1-${k}`, userId: 'user1', steps: 9000, date: new Date(d) });
        // user2 takes December off entirely.
        if (!(d.getFullYear() === 2025 && d.getMonth() === 11)) {
            logs.push({ id: `u2-${k}`, userId: 'user2', steps: 9500, date: new Date(d) });
        }
        // A planted 23-day run over 10k, logged as a second walk each day.
        if (d.getFullYear() === 2026 && d.getMonth() === 1 && d.getDate() <= 23) {
            logs.push({ id: `u1x-${k}`, userId: 'user1', steps: 3500, date: new Date(d) });
        }
    }

    logs.push({ id: 'u1-bigday', userId: 'user1', steps: 20000, date: D(2026, 3, 14) });
    logs.push({ id: 'u2-monster', userId: 'user2', steps: 500000, date: D(2026, 9, 1) });

    // Boundaries: the first belongs to year 1, the second to year 2, and the
    // third predates the challenge entirely.
    logs.push({ id: 'u1-lastgasp', userId: 'user1', steps: 111, date: D(2026, 9, 30, 23, 59) });
    logs.push({ id: 'u1-nextyear', userId: 'user1', steps: 222, date: D(2026, 10, 1, 0, 0) });
    logs.push({ id: 'u1-prehistory', userId: 'user1', steps: 333, date: D(2025, 9, 30, 12, 0) });

    const attach = (id, fields) => {
        const l = logs.find((x) => x.id === id);
        assert.ok(l, `fixture log ${id} should exist`);
        Object.assign(l, fields);
    };

    // A photo-heavy July, with one of them taken a long way from home.
    ['2026-07-03', '2026-07-17', '2026-07-24', '2026-07-28'].forEach((k) =>
        attach(`u1-${k}`, { photoUrl: `https://example.test/${k}.jpg` }));
    attach('u1-2026-07-10', {
        photoUrl: 'https://example.test/lisbon.jpg',
        locationName: 'Lisbon, Lisboa, Portugal',
        lat: 38.7223,
        lng: -9.1393,
        note: 'Absolutely roasting out here in Lisbon today, worth every single step'
    });
    ['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26'].forEach((k) =>
        attach(`u2-${k}`, { photoUrl: `https://example.test/${k}.jpg` }));

    attach('u2-2026-05-15', {
        locationName: 'Edinburgh, Scotland, United Kingdom',
        lat: 55.9533,
        lng: -3.1883
    });
    attach('u1-2025-11-05', {
        locationName: 'Erddig, Wrexham, Wales, United Kingdom',
        lat: 53.05,
        lng: -3.0
    });

    attach('u1-2025-10-20', { note: 'First proper walk of the year' });
    attach('u2-2025-10-20', { note: 'Freezing out there today but worth it for the sunset' });
    attach('u1-2026-07-22', { note: 'Back home and knackered' });

    return logs;
}

const MILESTONES = [
    { steps: 500000, label: 'Half a Million 🎉', description: 'Halfway to the first million.' },
    { steps: 1000000, label: 'One Million 🏅', description: 'Seven figures.' },
    { steps: 5000000, label: 'Five Million 🚀', description: 'Not this year.' }
];

// Shaped exactly like getMilestoneAchievementDates().annual in index.html.
const MILESTONE_DATES = {
    500000: {
        user1: [{ year: 1, date: D(2025, 12, 20) }],
        user2: [{ year: 1, date: D(2025, 12, 5) }]
    },
    1000000: {
        user1: [{ year: 1, date: D(2026, 1, 15) }],
        user2: [{ year: 1, date: D(2026, 2, 20) }]
    }
};

const OPTS = {
    names: { user1: 'Ant', user2: 'Amy' },
    milestones: MILESTONES,
    milestoneDates: MILESTONE_DATES,
    stretch: {
        user1: { label: 'Earn that watch', steps: 3000000, reward: '⌚' },
        user2: { label: 'New Jacket', steps: 9000000, reward: '🧥' }
    },
    // Pinned so nothing depends on the real clock.
    now: D(2026, 10, 2)
};

const wrapped = () => computeWrapped(buildFixture(), 1, OPTS);

// --- shape and scope -------------------------------------------------------

test('the challenge year is 365 days and covers Oct 2025 to Sep 2026', () => {
    const w = wrapped();
    assert.equal(w.daysInYear, 365);
    assert.equal(w.daysElapsed, 365, 'a finished year has fully elapsed');
    assert.deepEqual(w.start, D(2025, 10, 1));
    assert.deepEqual(w.end, D(2026, 10, 1));
});

test('year boundaries include 30 Sep 23:59 and exclude 1 Oct 00:00', () => {
    const w = wrapped();
    // 3,385,611 includes the 111-step log at 23:59 on the last day and excludes
    // both the 222 on 1 Oct and the 333 from before the challenge started.
    assert.equal(w.user1.total, 3385611);
    // September's total carries the 111 walked at 23:59 on the final day.
    assert.equal(w.user1.monthTotals[11], 30 * 9000 + 111);
    // ...and the 222 from midnight on 1 October belongs to year 2 instead.
    const y2 = computeWrapped(buildFixture(), 2, { ...OPTS, now: D(2027, 10, 2) });
    assert.equal(y2.user1.total, 222);
    assert.equal(y2.user1.monthTotals[0], 222);
});

// --- totals ----------------------------------------------------------------

test('totals, distances and day counts', () => {
    const w = wrapped();

    assert.equal(w.user1.total, 3385611);
    assert.equal(w.user2.total, 3673000);
    assert.equal(w.both.total, 7058611);

    assert.equal(w.user1.daysLogged, 365);
    assert.equal(w.user2.daysLogged, 334, '365 days less the 31 of December');
    assert.equal(w.both.daysLogged, 365);

    // user1 clears 10k on the 23 February days plus the single big day in March.
    assert.equal(w.user1.daysOver10k, 24);
    // user2 only ever clears it on the 500,000 day.
    assert.equal(w.user2.daysOver10k, 1);

    assert.equal(w.user1.km, 3385611 / 1300);
    assert.equal(w.user1.miles, 3385611 / 2100);
    assert.equal(w.user2.avgPerCalendarDay, 3673000 / 365);
    assert.equal(w.user2.avgPerLoggedDay, 3673000 / 334);
});

test('two logs on one day are summed into a single day', () => {
    const w = wrapped();
    // 9,000 + 3,500 on each February streak day.
    const feb = w.user1.bestDays.find((b) => b.date.getMonth() === 1);
    assert.equal(feb.steps, 12500);
});

// --- best days, weeks, months ---------------------------------------------

test('best days pick the right dates and carry their biggest log', () => {
    const w = wrapped();

    assert.equal(w.user1.bestDays[0].steps, 29000, '9,000 + the planted 20,000');
    assert.deepEqual(w.user1.bestDays[0].date, D(2026, 3, 14));
    assert.equal(w.user1.bestDays[0].log.id, 'u1-bigday', 'the larger of that day\'s two logs');

    assert.equal(w.user2.bestDays[0].steps, 509500);
    assert.deepEqual(w.user2.bestDays[0].date, D(2026, 9, 1));
    assert.equal(w.user2.bestDays.length, 3);
});

test('best week is a full Mon-Sun window inside the year', () => {
    const w = wrapped();
    // Mon 2 Feb to Sun 8 Feb 2026, entirely inside the 12,500-a-day streak.
    assert.equal(w.user1.bestWeek.steps, 7 * 12500);
    assert.equal(w.user1.bestWeek.from.getDay(), 1, 'starts on a Monday');
    assert.equal(w.user1.bestWeek.to.getDay(), 0, 'ends on a Sunday');
    assert.ok(w.user1.bestWeek.from >= w.start && w.user1.bestWeek.to < w.end);
});

test('best and quietest months', () => {
    const w = wrapped();

    // February: 28 × 9,000 + 23 × 3,500 = 332,500.
    assert.equal(w.user1.bestMonth.label, 'February 2026');
    assert.equal(w.user1.bestMonth.steps, 332500);
    // November is the first of the 30-day months at a flat 9,000.
    assert.equal(w.user1.quietestMonth.label, 'November 2025');
    assert.equal(w.user1.quietestMonth.steps, 270000);

    assert.equal(w.user2.bestMonth.label, 'September 2026');
    assert.equal(w.user2.bestMonth.steps, 785000);
    assert.equal(w.user2.quietestMonth.label, 'December 2025');
    assert.equal(w.user2.quietestMonth.steps, 0);
});

// --- streaks and habits ----------------------------------------------------

test('streaks break on missed days', () => {
    const w = wrapped();

    assert.equal(w.user1.longest10kStreak.days, 23);
    assert.deepEqual(w.user1.longest10kStreak.from, D(2026, 2, 1));
    assert.deepEqual(w.user1.longest10kStreak.to, D(2026, 2, 23));
    assert.equal(w.user1.longestLoggedStreak.days, 365);

    // The 500,000 day stands alone.
    assert.equal(w.user2.longest10kStreak.days, 1);
    // 1 Jan to 30 Sep 2026, after December's gap.
    assert.equal(w.user2.longestLoggedStreak.days, 273);
    assert.deepEqual(w.user2.longestLoggedStreak.from, D(2026, 1, 1));
});

test('best weekday', () => {
    const w = wrapped();
    // The 20,000 landed on Saturday 14 March, on top of three boosted Saturdays.
    assert.equal(w.user1.bestWeekday.name, 'Saturday');
    // The 500,000 landed on Tuesday 1 September.
    assert.equal(w.user2.bestWeekday.name, 'Tuesday');
    // The mean is over the days she actually logged, not every Tuesday in the
    // year: 52 Tuesdays, 5 of them inside the December she sat out.
    assert.equal(w.user2.bestWeekday.mean, (47 * 9500 + 500000) / 47);
    assert.equal(w.user2.weekdayMeans[0], 9500, 'a plain Monday is just her usual walk');
});

// --- the race --------------------------------------------------------------

test('the race tracks cumulative totals day by day', () => {
    const w = wrapped();
    assert.equal(w.race.days.length, 365);
    assert.deepEqual(w.race.days[0].cum, { user1: 9000, user2: 9500 });
    assert.equal(w.race.days[364].cum.user1, 3385611);
    assert.equal(w.race.days[364].cum.user2, 3673000);
});

test('lead changes are only counted when the lead actually changes hands', () => {
    const w = wrapped();
    // Amy leads from day one, Ant overtakes during December's gap, Amy takes it
    // back with the 500,000 day. Amy going ahead on day one is first blood, not
    // a change, so there are two.
    assert.equal(w.race.leadChanges.length, 2);
    assert.deepEqual(w.race.leadChanges[0].date, D(2025, 12, 4));
    assert.equal(w.race.leadChanges[0].to, 'user1');
    assert.deepEqual(w.race.leadChanges[1].date, D(2026, 9, 1));
    assert.equal(w.race.leadChanges[1].to, 'user2');
});

test('days in lead, biggest swing and the final result', () => {
    const w = wrapped();

    assert.equal(w.race.daysInLead.user1, 271);
    assert.equal(w.race.daysInLead.user2, 94);
    assert.equal(w.race.daysInLead.user1 + w.race.daysInLead.user2, 365, 'never level');

    assert.deepEqual(w.race.biggestSwing.date, D(2026, 9, 1));
    assert.equal(w.race.biggestSwing.uid, 'user2');
    assert.equal(w.race.biggestSwing.by, 500500, '509,500 against 9,000');

    assert.equal(w.race.winner, 'user2');
    assert.equal(w.race.finalGap, 3673000 - 3385611);
});

// --- months ----------------------------------------------------------------

test('twelve months, October first', () => {
    const w = wrapped();
    assert.equal(w.months.length, 12);
    assert.equal(w.months[0].label, 'October 2025');
    assert.equal(w.months[3].label, 'January 2026');
    assert.equal(w.months[11].label, 'September 2026');
});

test('a month one of them sat out', () => {
    const w = wrapped();
    const dec = w.months[2];
    assert.equal(dec.label, 'December 2025');
    assert.equal(dec.totals.user2, 0);
    assert.equal(dec.totals.user1, 31 * 9000);
    assert.equal(dec.winner, 'user1');
    assert.equal(dec.isEmpty, false, 'one of them still walked');
});

test('month photos alternate between them, best first, with a nudge for trips', () => {
    const w = wrapped();
    const july = w.months[9];
    assert.equal(july.label, 'July 2026');
    // Lisbon scores 9,000 + 5,000 for being a trip, beating Amy's flat 9,500, so
    // it leads; then it alternates.
    assert.deepEqual(july.photos.map((p) => p.id), [
        'u1-2026-07-10',
        'u2-2026-07-05',
        'u1-2026-07-03'
    ]);
    assert.equal(july.photos.length, 3, 'never more than three');
});

test('the month quote avoids a log already shown as a photo', () => {
    const w = wrapped();
    // The Lisbon note is the longest in July, but it sits on a photo already
    // chosen for the slide, so the quote falls to the next one down.
    assert.equal(w.months[9].quote.text, 'Back home and knackered');
    assert.equal(w.months[9].quote.uid, 'user1');
    // October has no photos, so the longest note simply wins.
    assert.equal(w.months[0].quote.text, 'Freezing out there today but worth it for the sunset');
    assert.equal(w.months[0].quote.uid, 'user2');
});

test('months carry their milestones and trips', () => {
    const w = wrapped();
    assert.deepEqual(w.months[2].milestones.map((m) => m.steps), [500000, 500000], 'both crossed it in December');
    assert.equal(w.months[9].trips.length, 1);
    assert.equal(w.months[9].trips[0].name, 'Lisbon');
    assert.equal(w.months[7].trips[0].name, 'Edinburgh');
});

// --- places ----------------------------------------------------------------

test('places are deduplicated and measured from home', () => {
    const w = wrapped();
    assert.equal(w.both.places.length, 3);

    const lisbon = w.both.places[0];
    assert.equal(lisbon.name, 'Lisbon');
    assert.equal(lisbon.country, 'Portugal');
    assert.ok(lisbon.km > 1500 && lisbon.km < 1900, `Lisbon should be ~1,700km, got ${Math.round(lisbon.km)}`);
    assert.equal(lisbon.isTrip, true);

    const edinburgh = w.both.places.find((p) => p.name === 'Edinburgh');
    assert.ok(edinburgh.km > 280 && edinburgh.km < 380, `Edinburgh should be ~325km, got ${Math.round(edinburgh.km)}`);
    assert.equal(edinburgh.isTrip, true);

    const local = w.both.places.find((p) => p.name === 'Erddig');
    assert.ok(local.km < 5, 'Erddig is on the doorstep');
    assert.equal(local.isTrip, false, 'not far enough to count as a trip');

    assert.deepEqual(w.both.countries, ['Portugal', 'United Kingdom']);
    assert.equal(w.user1.places.length, 2);
    assert.equal(w.user2.places.length, 1);
});

test('distance from home is measured, not guessed', () => {
    // London is about 250km from Wrexham.
    const km = haversineKm(HOME, { lat: 51.5072, lng: -0.1276 });
    assert.ok(km > 220 && km < 280, `got ${Math.round(km)}`);
    assert.equal(haversineKm(HOME, { lat: null, lng: null }), null);
});

// --- photos, notes, milestones, stretch ------------------------------------

test('photos and notes', () => {
    const w = wrapped();
    assert.equal(w.user1.photos.count, 5);
    assert.equal(w.user2.photos.count, 4);
    assert.equal(w.both.photoCount, 9);
    assert.equal(w.user1.photos.first.id, 'u1-2026-07-03', 'chronological');
    assert.equal(w.user1.photos.last.id, 'u1-2026-07-28');
    assert.equal(w.user1.notes.length, 3);
    assert.equal(w.user2.notes.length, 1);
    assert.equal(w.hasPhotos, true);
    assert.equal(w.hasPlaces, true);
    assert.equal(w.hasNotes, true);
});

test('milestones come from the app replay, with a first-there flag', () => {
    const w = wrapped();
    assert.deepEqual(w.user1.milestones.map((m) => m.steps), [500000, 1000000]);
    assert.equal(w.user1.milestones[0].first, false, 'Amy got to half a million first');
    assert.equal(w.user1.milestones[1].first, true, 'Ant got to the million first');
    assert.equal(w.user2.milestones[0].first, true);
    assert.equal(w.user2.milestones[1].first, false);
    // The five million stamp was never reached, so it isn't listed.
    assert.equal(w.user1.milestones.length, 2);
});

test('a milestone the year never reached is not reported for that year', () => {
    // The passport map says both crossed half a million in year 1. If the logs
    // for that year don't get anywhere near it, the logs are what count.
    const thin = [
        { id: 'a', userId: 'user1', steps: 1000, date: D(2025, 10, 5) },
        { id: 'b', userId: 'user2', steps: 1000, date: D(2025, 10, 5) }
    ];
    const w = computeWrapped(thin, 1, OPTS);
    assert.deepEqual(w.user1.milestones, []);
    assert.deepEqual(w.user2.milestones, []);

    // And the stamps slide stands down rather than showing places nobody reached.
    assert.equal(buildSlides(w).find((s) => s.id === 'passport').skip(w), true);
});

test('stretch goals read against the all-time total, not the year', () => {
    const w = wrapped();
    // 3,000,000 is passed during year 1 — and the all-time replay includes the
    // 333 steps logged before the challenge began.
    assert.equal(w.user1.stretch.done, true);
    assert.ok(w.user1.stretch.crossedOn instanceof Date);
    assert.ok(w.user1.stretch.crossedOn >= w.start && w.user1.stretch.crossedOn < w.end);
    assert.equal(w.user2.stretch.done, false);
    assert.ok(w.user2.stretch.pct > 40 && w.user2.stretch.pct < 41);
});

// --- combined --------------------------------------------------------------

test('the combined figure lands on a real milestone', () => {
    const w = wrapped();
    assert.equal(w.both.destination.steps, 5000000, 'the furthest stamp at or below 7,058,611');
    assert.equal(w.both.destination.label, 'Five Million 🚀');
    assert.ok(w.both.everests > 600 && w.both.everests < 610);
    assert.equal(w.both.marathons, 7058611 / 1300 / 42.195);
});

test('lastMilestoneAtOrBelow picks the furthest one reached', () => {
    assert.equal(lastMilestoneAtOrBelow(999999, MILESTONES).steps, 500000);
    assert.equal(lastMilestoneAtOrBelow(1000000, MILESTONES).steps, 1000000, 'exactly on it counts');
    assert.equal(lastMilestoneAtOrBelow(0, MILESTONES), null);
});

// --- awards ----------------------------------------------------------------

test('awards split between them and nobody is left out', () => {
    const w = wrapped();
    const ids = (uid) => w.awards[uid].map((a) => a.id);

    assert.deepEqual(ids('user1'), ['ironLegs', 'photographer', 'explorer']);
    assert.deepEqual(ids('user2'), ['winner', 'biggestDay', 'weekdayGrinder']);
    assert.ok(w.awards.user1.length > 0 && w.awards.user2.length > 0);
    assert.ok(w.awards.user1.length <= 3 && w.awards.user2.length <= 3);
    w.awards.user1.concat(w.awards.user2).forEach((a) => {
        assert.ok(a.emoji && a.label && a.detail, `award ${a.id} should be fully filled in`);
    });
});

test('the strong-finish award compares the two halves of the year', () => {
    // Same totals, same best day, mirrored across the year: the only thing
    // separating them is which half they did the work in.
    const logs = [
        { id: 'a1', userId: 'user1', steps: 10000, date: D(2025, 10, 1) },
        { id: 'a2', userId: 'user1', steps: 20000, date: D(2026, 9, 1) },
        { id: 'b1', userId: 'user2', steps: 20000, date: D(2025, 10, 1) },
        { id: 'b2', userId: 'user2', steps: 10000, date: D(2026, 9, 1) }
    ];
    const w = computeWrapped(logs, 1, OPTS);
    assert.equal(w.user1.total, w.user2.total, 'dead level overall');
    assert.equal(w.race.winner, null);

    const ids = (uid) => w.awards[uid].map((a) => a.id);
    assert.ok(ids('user1').includes('comeback'), 'Ant did more in the back half');
    assert.ok(!ids('user2').includes('comeback'));
    assert.equal(w.awards.user1.find((a) => a.id === 'comeback').detail, '100% busier in the second half');
});

test('a tied award goes to nobody', () => {
    const w = wrapped();
    // Both were first to exactly one milestone.
    const all = w.awards.user1.concat(w.awards.user2).map((a) => a.id);
    assert.ok(!all.includes('firstToArrive'));
});

// --- the running order -----------------------------------------------------

test('the running order runs cover, big number, months, race, finale', () => {
    const w = wrapped();
    const slides = buildSlides(w);
    assert.deepEqual(slides.map((s) => s.id), [
        'cover', 'bigNumber',
        ...Array.from({ length: 12 }, (_, i) => `month-${i}`),
        'race', 'bestDays', 'habits', 'places', 'furthest', 'passport',
        'quotes', 'awards', 'photoWall', 'stretch', 'finale'
    ]);
});

test('slides that have nothing to show drop out', () => {
    const empty = computeWrapped([], 1, OPTS);
    const kept = buildSlides(empty).filter((s) => !s.skip || !s.skip(empty));
    assert.deepEqual(kept.map((s) => s.id), ['cover', 'bigNumber', 'finale'],
        'nothing to chapter, race, rank, map, stamp, quote, award or photograph');
});

test('the map slide steps aside when there is no map library', () => {
    const w = wrapped();
    const places = buildSlides(w).find((s) => s.id === 'places');
    // Leaflet belongs to the page, not to this module.
    assert.equal(typeof globalThis.L, 'undefined');
    assert.equal(places.skip(w), true, 'no Leaflet, no map slide');

    globalThis.L = {};
    try {
        assert.equal(places.skip(w), false, 'with Leaflet present and places to show, it plays');
        const noPlaces = computeWrapped(
            buildFixture().map((l) => ({ ...l, lat: undefined, lng: undefined })), 1, OPTS);
        assert.equal(buildSlides(noPlaces).find((s) => s.id === 'places').skip(noPlaces), true);
    } finally {
        delete globalThis.L;
    }
});

test('furthest and passport stand down when there is nothing to report', () => {
    const w = wrapped();
    const find = (id, stats) => buildSlides(stats).find((s) => s.id === id);
    assert.equal(find('furthest', w).skip(w), false, 'Lisbon and Edinburgh are both trips');
    assert.equal(find('passport', w).skip(w), false);

    // Strip the locations and nothing is far from home any more.
    const homebody = computeWrapped(
        buildFixture().map((l) => ({ ...l, lat: undefined, lng: undefined, locationName: undefined })), 1, OPTS);
    assert.equal(find('furthest', homebody).skip(homebody), true);

    // No milestone dates means no stamps.
    const nostamps = computeWrapped(buildFixture(), 1, { ...OPTS, milestoneDates: {} });
    assert.equal(find('passport', nostamps).skip(nostamps), true);
});

test('furthest preloads the photo it will actually show', () => {
    const w = wrapped();
    // The furthest place is Lisbon, and that log has a photo.
    assert.deepEqual(buildSlides(w).find((s) => s.id === 'furthest').images(w),
        ['https://example.test/lisbon.jpg']);
});

test('best days preloads only the photos it will show', () => {
    const w = wrapped();
    const slide = buildSlides(w).find((s) => s.id === 'bestDays');
    // Ant's best day is the planted 20,000 in March, which has no photo; Amy's
    // is the 500,000 in September, likewise. So there is nothing to preload.
    assert.deepEqual(slide.images(w), []);
});

test('the cover and finale wait for a tap, everything else is timed', () => {
    const slides = buildSlides(wrapped());
    assert.equal(slides[0].duration, Infinity);
    assert.equal(slides[slides.length - 1].duration, Infinity);
    assert.ok(slides.slice(1, -1).every((s) => Number.isFinite(s.duration) && s.duration > 0));
});

test('the whole show is a few minutes if left alone', () => {
    const w = wrapped();
    const timed = buildSlides(w)
        .filter((s) => (!s.skip || !s.skip(w)) && Number.isFinite(s.duration))
        .reduce((t, s) => t + s.duration, 0);
    // Long enough to feel like a story, short enough to sit through.
    assert.ok(timed > 90000 && timed < 200000, `${Math.round(timed / 1000)}s`);
});

test('a month with more in it stays on screen longer, up to a cap', () => {
    const w = wrapped();
    const dur = (i) => monthSlide(w.months[i]).duration;
    // November: no photos, no milestones, no trips.
    assert.equal(dur(1), 5000);
    // December: both crossed half a million.
    assert.equal(dur(2), 6000);
    // July: three photos, a trip.
    assert.equal(dur(9), 8000);
    // No chapter runs past nine seconds however much happened in it.
    assert.ok(w.months.every((m) => monthSlide(m).duration <= 9000));
});

test('every month in the real fixture has something worth showing', () => {
    const w = wrapped();
    const months = buildSlides(w).filter((s) => s.id.startsWith('month-'));
    assert.equal(months.filter((s) => s.skip(w)).length, 0);
    // December is the month Amy sat out, but Ant still walked, so it stays.
    const dec = buildSlides(w).find((s) => s.id === 'month-2');
    assert.equal(dec.skip(w), false);
});

test('month slides declare the photos to preload', () => {
    const w = wrapped();
    const july = buildSlides(w).find((s) => s.id === 'month-9');
    assert.deepEqual(july.images(w), [
        'https://example.test/lisbon.jpg',
        'https://example.test/2026-07-05.jpg',
        'https://example.test/2026-07-03.jpg'
    ]);
    // A month with no photos asks for nothing.
    assert.deepEqual(buildSlides(w).find((s) => s.id === 'month-1').images(w), []);
});

test('quotes, the wall and goals stand down when there is too little', () => {
    const w = wrapped();
    const find = (id, stats) => buildSlides(stats).find((s) => s.id === id);

    // The fixture has four notes and nine photos, so all three play.
    assert.equal(find('quotes', w).skip(w), false);
    assert.equal(find('photoWall', w).skip(w), false);
    assert.equal(find('stretch', w).skip(w), false);

    // A single note is a stray caption, not a chapter.
    const oneNote = computeWrapped(
        buildFixture().map((l) => (l.id === 'u1-2025-10-20' ? l : { ...l, note: undefined })), 1, OPTS);
    assert.equal(find('quotes', oneNote).skip(oneNote), true);

    // Three photos is not a wall.
    const fewPhotos = computeWrapped(
        buildFixture().map((l, i) => (i % 200 === 0 ? l : { ...l, photoUrl: undefined })), 1, OPTS);
    assert.ok(fewPhotos.both.photoCount < 4);
    assert.equal(find('photoWall', fewPhotos).skip(fewPhotos), true);

    // No goals set, no goals slide.
    const noGoals = computeWrapped(buildFixture(), 1, { ...OPTS, stretch: {} });
    assert.equal(find('stretch', noGoals).skip(noGoals), true);

    // A goal that exists but has had no progress at all is nothing to report.
    const nothingWalked = computeWrapped([], 1, OPTS);
    assert.ok(nothingWalked.user1.stretch, 'the goal is still there');
    assert.equal(nothingWalked.user1.stretch.pct, 0);
    assert.equal(find('stretch', nothingWalked).skip(nothingWalked), true);
});

test('the photo wall is capped and spread across the year', () => {
    const many = buildFixture().map((l, i) =>
        (l.userId === 'user1' && i % 3 === 0 ? { ...l, photoUrl: `https://example.test/${l.id}.jpg` } : l));
    const w = computeWrapped(many, 1, OPTS);
    assert.ok(w.both.photoCount > 100, `${w.both.photoCount} photos in the year`);

    const wall = buildSlides(w).find((s) => s.id === 'photoWall').images(w);
    assert.equal(wall.length, 24, 'capped rather than all of them');
    assert.equal(new Set(wall).size, 24, 'no duplicates');

    // Taken evenly across the year rather than all from one month.
    const shown = w.user1.photos.list.filter((l) => wall.includes(l.photoUrl));
    const months = new Set(shown.map((l) => l.date.getMonth()));
    assert.ok(months.size >= 8, `spread over ${months.size} months`);
});

test('year names read as words', () => {
    assert.equal(yearWord(1), 'Year One');
    assert.equal(yearWord(2), 'Year Two');
    assert.equal(yearWord(10), 'Year Ten');
    assert.equal(yearWord(11), 'Year 11', 'past ten it just uses the number');
});

// --- what the steps add up to ----------------------------------------------

const withDistance = (km) => ({ both: { km, miles: km / 1.609, total: km * 1300 } });

test('a real year gets five things worth saying', () => {
    // Roughly where the two of them actually finished year one.
    const facts = funComparisons(withDistance(5140));
    assert.equal(facts.length, 5);
    assert.ok(facts.every((f) => f.text && f.emoji), JSON.stringify(facts));

    // Paris leads, because that is the one they are actually booking.
    assert.equal(facts[0].id, 'paris');
    assert.match(facts[0].text, /Wrexham to Paris and back, 4\.3 times/);
    assert.match(facts[1].text, /Land's End to John o' Groats/);
    assert.match(facts[2].text, /The length of Wales, 19 times/);
});

test('the planet always closes it, as a share until it is lapped', () => {
    const facts = funComparisons(withDistance(5140));
    const last = facts[facts.length - 1];
    assert.equal(last.id, 'world');
    assert.match(last.text, /12\.8% of the way round the world/);

    // Once round, it counts laps instead of percentages.
    const lapped = funComparisons(withDistance(EARTH_KM * 2.4));
    const far = lapped[lapped.length - 1];
    assert.equal(far.id, 'world');
    assert.match(far.text, /Right round the world, 2\.4 times/);
});

test('a comparison it has barely made is left out', () => {
    // 700km is more than half way to Paris and back, but not once round.
    const facts = funComparisons(withDistance(700));
    assert.ok(!facts.some((f) => f.id === 'paris'), JSON.stringify(facts.map((f) => f.id)));
    assert.ok(facts.every((f) => f.id === 'world' || f.n >= 1));
    // The planet line is still there, honest about how small the share is.
    assert.match(facts[facts.length - 1].text, /% of the way round the world/);
});

test('a tiny year still says something rather than nothing', () => {
    const facts = funComparisons(withDistance(60));
    assert.ok(facts.length >= 1);
    assert.equal(facts[facts.length - 1].id, 'world');
    assert.ok(facts.every((f) => !/NaN|Infinity|undefined/.test(f.text)), JSON.stringify(facts));
});

test('the numbers read as words, not decimals, where it matters', () => {
    const wales = (km) => funComparisons(withDistance(km)).find((f) => f.id === 'wales').text;
    // "1.0 times" and "2.0 times" read badly, so they get names.
    assert.equal(wales(274), 'The length of Wales, once');
    assert.equal(wales(548), 'The length of Wales, twice');
    // Big multiples round off rather than trailing a pointless decimal.
    assert.equal(wales(27400), 'The length of Wales, 100 times');
    assert.match(wales(1000), /The length of Wales, 3\.6 times/);
});

test('every comparison is a real distance, biggest-feeling first', () => {
    assert.ok(FUN_COMPARISONS.every((c) => (c.km > 0) !== (c.steps > 0)), 'each is km or steps, not both');
    assert.ok(FUN_COMPARISONS.every((c) => typeof c.phrase === 'function'));
    assert.equal(new Set(FUN_COMPARISONS.map((c) => c.id)).size, FUN_COMPARISONS.length);
    // The M25 is not in here. That was the boring one.
    assert.ok(!FUN_COMPARISONS.some((c) => /M25/i.test(c.id)));
});

test('the big number slide has time to read five lines', () => {
    const w = wrapped();
    const slide = buildSlides(w).find((s) => s.id === 'bigNumber');
    assert.equal(slide.duration, 12000);
});

// --- the map tour ----------------------------------------------------------

const place = (name, lat, lng, day, logs = 1) => ({
    key: name, name, lat, lng, country: 'x',
    firstDate: D(2026, 1, day), logs: Array.from({ length: logs }, (_, i) => ({ id: name + i }))
});

test('places near each other become one stop', () => {
    // Four laps round Wrexham and one trip to Chester: all within 200km.
    const tour = buildMapTour([
        place('Erddig', 53.02, -3.02, 1, 12),
        place('Bersham', 53.04, -3.03, 2),
        place('Alyn Waters', 53.08, -3.05, 3),
        place('Chester', 53.19, -2.89, 4)
    ]);
    assert.equal(tour.length, 1, 'one stop, not four pins on top of each other');
    assert.equal(tour[0].places.length, 4);
    // Named after wherever you went most.
    assert.equal(tour[0].label, 'Erddig');
});

test('a real trip gets a stop of its own', () => {
    const tour = buildMapTour([
        place('Erddig', 53.02, -3.02, 1, 30),
        place('Las Vegas', 36.17, -115.14, 5),
        place('Tenerife', 28.29, -16.63, 9)
    ]);
    assert.deepEqual(tour.map((t) => t.label), ['Erddig', 'Las Vegas', 'Tenerife']);
    assert.ok(tour[1].kmFromHome > 7000, `Vegas is ${Math.round(tour[1].kmFromHome)}km away`);
});

test('the tour runs in the order you went', () => {
    const tour = buildMapTour([
        place('Tenerife', 28.29, -16.63, 20),
        place('Erddig', 53.02, -3.02, 2),
        place('Las Vegas', 36.17, -115.14, 11)
    ]);
    assert.deepEqual(tour.map((t) => t.label), ['Erddig', 'Las Vegas', 'Tenerife']);
});

test('too many stops keeps home and the furthest-flung', () => {
    const tour = buildMapTour([
        place('Erddig', 53.02, -3.02, 1, 40),
        place('Edinburgh', 55.95, -3.19, 2),
        place('London', 51.51, -0.13, 3),
        place('Lisbon', 38.72, -9.14, 4),
        place('Tenerife', 28.29, -16.63, 5),
        place('Las Vegas', 36.17, -115.14, 6),
        place('Sydney', -33.87, 151.21, 7)
    ], { maxStops: 4 });

    assert.equal(tour.length, 4);
    const labels = tour.map((t) => t.label);
    assert.ok(labels.includes('Erddig'), 'home is always in it');
    assert.ok(labels.includes('Sydney'), 'so is the furthest');
    // And still in the order they happened.
    assert.deepEqual(tour.map((t) => t.firstDate).slice().sort((a, b) => a - b),
        tour.map((t) => t.firstDate));
});

test('one place is one stop, and the slide holds still for it', () => {
    const tour = buildMapTour([place('Erddig', 53.02, -3.02, 1)]);
    assert.equal(tour.length, 1);
    assert.deepEqual(buildMapTour([]), []);
});

test('the map slide gets twice as long to fly round', () => {
    const w = wrapped();
    const places = buildSlides(w).find((s) => s.id === 'places');
    assert.equal(places.duration, 16000);
    // And it is the longest thing in the show, by some way.
    const others = buildSlides(w).filter((s) => s.id !== 'places' && Number.isFinite(s.duration));
    assert.ok(others.every((s) => s.duration < places.duration),
        `longest other slide: ${Math.max(...others.map((s) => s.duration))}`);
});

// --- edge cases ------------------------------------------------------------

test('no logs at all', () => {
    const w = computeWrapped([], 1, OPTS);
    assert.equal(w.user1.total, 0);
    assert.equal(w.both.total, 0);
    assert.equal(w.user1.daysLogged, 0);
    assert.equal(w.user1.bestDays.length, 0);
    assert.equal(w.user1.bestWeekday, null);
    assert.equal(w.user1.bestMonth, null);
    assert.equal(w.user1.longest10kStreak.days, 0);
    assert.equal(w.race.winner, null);
    assert.equal(w.race.biggestSwing, null);
    assert.equal(w.both.destination, null);
    assert.equal(w.hasPhotos, false);
    assert.equal(w.hasPlaces, false);
    assert.equal(w.months.length, 12);
    assert.ok(w.months.every((m) => m.isEmpty));
    // Everyone still gets a badge, even if it is only a statement of fact.
    assert.equal(w.awards.user1[0].id, 'longHaul');
    assert.equal(w.awards.user2[0].id, 'longHaul');
});

test('one person with no logs at all does not throw', () => {
    const logs = buildFixture().filter((l) => l.userId !== 'user2');
    const w = computeWrapped(logs, 1, OPTS);
    assert.equal(w.user2.total, 0);
    assert.equal(w.race.winner, 'user1');
    assert.equal(w.race.leadChanges.length, 0);
    assert.ok(w.awards.user2.length > 0);
});

test('no photos and no locations', () => {
    const logs = buildFixture().map((l) => ({
        ...l, photoUrl: undefined, lat: undefined, lng: undefined, locationName: undefined
    }));
    const w = computeWrapped(logs, 1, OPTS);
    assert.equal(w.hasPhotos, false);
    assert.equal(w.hasPlaces, false);
    assert.deepEqual(w.both.places, []);
    assert.deepEqual(w.both.countries, []);
    assert.equal(w.user1.photos.first, null);
    assert.ok(w.months.every((m) => m.photos.length === 0));
    assert.ok(w.months.every((m) => m.trips.length === 0));
});

test('a dead heat has no winner', () => {
    const logs = [
        { id: 'a', userId: 'user1', steps: 10000, date: D(2025, 10, 5) },
        { id: 'b', userId: 'user2', steps: 10000, date: D(2025, 10, 5) }
    ];
    const w = computeWrapped(logs, 1, OPTS);
    assert.equal(w.race.winner, null);
    assert.equal(w.race.finalGap, 0);
    assert.equal(w.race.daysInLead.user1, 0);
    assert.equal(w.race.daysInLead.user2, 0);
    assert.equal(w.months[0].winner, null);
    // A head-to-head award with no winner is simply not given.
    assert.ok(!w.awards.user1.concat(w.awards.user2).map((a) => a.id).includes('winner'));
});

test('malformed logs are ignored rather than fatal', () => {
    const logs = [
        { id: 'ok', userId: 'user1', steps: 5000, date: D(2025, 10, 5) },
        { id: 'nodate', userId: 'user1', steps: 5000 },
        { id: 'nosteps', userId: 'user1', date: D(2025, 10, 6) },
        { id: 'stranger', userId: 'user9', steps: 5000, date: D(2025, 10, 7) },
        null,
        { id: 'timestamp', userId: 'user1', steps: 5000, date: { toDate: () => D(2025, 10, 8) } }
    ];
    const w = computeWrapped(logs, 1, OPTS);
    assert.equal(w.user1.total, 5000, 'only the one well-formed log counts');
    assert.equal(w.user1.daysLogged, 1);
});

test('a leap year has 366 days', () => {
    // Year 3 runs Oct 2027 to Sep 2028, and February 2028 has 29 days.
    const w = computeWrapped([], 3, { ...OPTS, now: D(2028, 10, 2) });
    assert.equal(w.daysInYear, 366);
    assert.equal(w.race.days.length, 366);
    assert.deepEqual(w.start, D(2027, 10, 1));
    assert.deepEqual(w.end, D(2028, 10, 1));
});

test('a year still running reports days elapsed, not the whole year', () => {
    const w = computeWrapped(buildFixture(), 1, { ...OPTS, now: D(2026, 1, 1) });
    // 1 Oct to 31 Dec is 92 days, so 1 Jan is day 93.
    assert.equal(w.daysElapsed, 93);
    assert.equal(w.daysInYear, 365);
    assert.equal(w.user1.avgPerCalendarDay, w.user1.total / 93);
});

// --- the gate --------------------------------------------------------------

test('only completed years have a Wrapped', () => {
    // Part-way through year 1 there is nothing to show.
    assert.deepEqual(wrappedYears(D(2026, 9, 17)), []);
    // The moment year 2 begins, year 1 is available.
    assert.deepEqual(wrappedYears(D(2026, 10, 1)), [1]);
    assert.deepEqual(wrappedYears(D(2027, 5, 1)), [1]);
    assert.deepEqual(wrappedYears(D(2027, 10, 1)), [1, 2]);
});

test('preview opens the current year early without moving the gate', () => {
    assert.deepEqual(wrappedYears(D(2026, 9, 17), { preview: true }), [1]);
    assert.deepEqual(wrappedYears(D(2026, 9, 17)), [], 'the real gate is untouched');
});
