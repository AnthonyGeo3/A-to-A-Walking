// Trip scrapbooks — every trip away together, found from the logs.
//
// Pure: no DOM, no Firebase, no network. Logs are plain objects whose `date`
// may be a Date or a Firestore Timestamp.
//
// A trip only counts if you were both there. A day is "together-away" when
// both of you logged a location more than TRIP_KM from home and those places
// are near each other: within TOGETHER_KM close to home, or within 5% of the
// distance once you're far away (a day trip to the Grand Canyon from the Vegas
// Strip is 200 km, and still the same trip). A solo work trip never becomes a
// card.

import { HOME, TRIP_KM, haversineKm } from './wrapped.js';

export const TOGETHER_KM = 50;
export const TOGETHER_FRACTION = 0.05;
/** How far apart two places can be and still count as together, this far from home. */
export const togetherLimit = (kmA, kmB) => Math.max(TOGETHER_KM, TOGETHER_FRACTION * Math.min(kmA, kmB));
// A one-day trip has to be properly far: a day out in Liverpool isn't a trip.
export const MIN_FAR_KM = 100;
// A day where only one of you tagged a place can join the edge of a trip (the
// airport on the way out), but only if it's near where the trip was.
export const EDGE_KM = 300;

const UIDS = ['user1', 'user2'];
const toDate = (d) => (d && typeof d.toDate === 'function' ? d.toDate() : d);
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const nextKey = (k) => { const d = fromKey(k); d.setDate(d.getDate() + 1); return dayKey(d); };
const located = (l) => typeof l.lat === 'number' && typeof l.lng === 'number' && isFinite(l.lat) && isFinite(l.lng);

/**
 * The place part of a stored location name. The app saves the first part of a
 * geocoder result ("Caesars Palace"), but older logs carry the full string
 * ("The Bellagio, Las Vegas, United States"), where the town is second-to-last.
 */
export function townFrom(name) {
    const parts = String(name || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    return parts.length >= 3 ? parts[parts.length - 2] : parts[0];
}

/** 'gb' → 🇬🇧 */
export function flagEmoji(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return '';
    return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** How each of you stood on each day: where you were furthest from home. */
export function dayStates(logs, { home = HOME, tripKm = TRIP_KM } = {}) {
    const days = new Map();
    const slot = (k) => {
        if (!days.has(k)) days.set(k, { key: k, user1: { state: 'none', point: null, km: 0 }, user2: { state: 'none', point: null, km: 0 }, logs: [] });
        return days.get(k);
    };
    (logs || []).forEach((raw) => {
        const date = toDate(raw.date);
        if (!date || !UIDS.includes(raw.userId)) return;
        const l = { ...raw, date };
        const day = slot(dayKey(date));
        day.logs.push(l);
        if (!located(l)) return;
        const km = haversineKm(home, { lat: l.lat, lng: l.lng }) || 0;
        const me = day[l.userId];
        if (km > tripKm) {
            // A day with a log at home and one away is a travel day: it counts as away.
            if (me.state !== 'away' || km > me.km) Object.assign(me, { state: 'away', point: { lat: l.lat, lng: l.lng }, km });
        } else if (me.state === 'none') {
            me.state = 'home';
        }
    });
    days.forEach((d) => {
        const a = d.user1, b = d.user2;
        if (a.state === 'away' && b.state === 'away') {
            d.kind = haversineKm(a.point, b.point) <= togetherLimit(a.km, b.km) ? 'together' : 'apart';
        } else if ((a.state === 'away' && b.state === 'home') || (b.state === 'away' && a.state === 'home')) {
            d.kind = 'solo';
        } else if (a.state === 'away' || b.state === 'away') {
            d.kind = 'half';   // one away, the other tagged nowhere
            // ('apart' days — both away, far from each other — are travel days at
            // the ends of a trip: one of you at Heathrow, the other already at
            // the other end. They can join a trip, never start one.)
        } else if (a.state === 'home' || b.state === 'home') {
            d.kind = 'home';
        } else {
            d.kind = 'blank';
        }
    });
    return days;
}

/**
 * Every trip, newest first.
 *   { key, start, end, days, dayKeys, steps: { user1, user2, both }, maxKm,
 *     furthest, points, photos, notes, placeNames, guessTitle, centre, coverPhoto }
 */
export function findTrips(logs, { home = HOME, tripKm = TRIP_KM, minFarKm = MIN_FAR_KM } = {}) {
    const days = dayStates(logs, { home, tripKm });
    const keys = [...days.keys()].sort();
    const kind = (k) => (days.has(k) ? days.get(k).kind : 'blank');
    const runs = [];

    // A day only one of you tagged, or a day you were both away but apart (the
    // airports at either end), joins a trip only if it's near where the trip
    // was: one of its places within EDGE_KM of a together day so far.
    const nearTrip = (k, run) => {
        const d = days.get(k);
        if (!d) return false;
        const here = [d.user1, d.user2].filter((u) => u.state === 'away').map((u) => u.point);
        const trip = run.filter((x) => kind(x) === 'together').flatMap((x) => [days.get(x).user1.point, days.get(x).user2.point]);
        return here.some((p) => trip.some((q) => haversineKm(p, q) <= EDGE_KM));
    };
    const joins = (k, run) => kind(k) === 'together' || ((kind(k) === 'half' || kind(k) === 'apart') && nearTrip(k, run));

    let i = 0;
    while (i < keys.length) {
        if (kind(keys[i]) !== 'together') { i++; continue; }
        // Walk forward through the calendar: together days, days that join, and
        // single days nobody tagged all carry a trip on. A day that shows either
        // of you at home, or one that doesn't join, ends it.
        const run = [keys[i]];
        let cur = keys[i];
        for (;;) {
            const n1 = nextKey(cur);
            if (joins(n1, run)) { run.push(n1); cur = n1; continue; }
            if (kind(n1) === 'blank' && joins(nextKey(n1), run)) { run.push(n1, nextKey(n1)); cur = nextKey(n1); continue; }
            break;
        }
        // Whatever follows the last together day is only kept if it's one day
        // that joins — a trip can't trail off into a solo one.
        let last = run.length - 1;
        while (kind(run[last]) !== 'together') last--;
        const tail = run.splice(last + 1);
        if (tail.length && kind(tail[0]) !== 'blank') run.push(tail[0]);
        // And one such day before it: the way out.
        const before = (() => { const d = fromKey(run[0]); d.setDate(d.getDate() - 1); return dayKey(d); })();
        if ((kind(before) === 'half' || kind(before) === 'apart') && nearTrip(before, run)) run.unshift(before);

        runs.push(run);
        const end = run[run.length - 1];
        while (i < keys.length && keys[i] <= end) i++;
    }

    const trips = runs.map((run) => build(run, days, home)).filter((t) => t.days >= 2 || t.maxKm > minFarKm);
    return trips.sort((a, b) => b.start - a.start);
}

function build(run, days, home) {
    const dayKeys = run.slice();
    const logs = dayKeys.flatMap((k) => (days.get(k) ? days.get(k).logs : [])).sort((a, b) => a.date - b.date);
    const steps = { user1: 0, user2: 0 };
    logs.forEach((l) => { steps[l.userId] += l.steps || 0; });
    const away = logs.filter((l) => located(l) && (haversineKm(home, l) || 0) > TRIP_KM);
    let furthest = null;
    away.forEach((l) => {
        const km = haversineKm(home, l);
        if (!furthest || km > furthest.km) furthest = { km, name: l.locationName || '', lat: l.lat, lng: l.lng };
    });

    // A name to show until a better one is known: the most common town among
    // the places you tagged, ties to the furthest.
    const counts = new Map();
    away.forEach((l) => {
        const t = townFrom(l.locationName);
        if (!t) return;
        const c = counts.get(t) || { n: 0, km: 0 };
        c.n += 1; c.km = Math.max(c.km, haversineKm(home, l));
        counts.set(t, c);
    });
    const guessTitle = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].km - a[1].km).map(([t]) => t)[0] || 'Away';

    const centre = away.length
        ? { lat: away.reduce((a, l) => a + l.lat, 0) / away.length, lng: away.reduce((a, l) => a + l.lng, 0) / away.length }
        : null;

    // Biggest day of the trip (both of you together) gives the cover, as on the
    // Wrapped furthest slide: more likely a day out than a day of travel.
    const photos = logs.filter((l) => l.photoUrl);
    const dayTotal = (k) => (days.get(k) ? days.get(k).logs.reduce((a, l) => a + (l.steps || 0), 0) : 0);
    const byBusy = dayKeys.slice().sort((a, b) => dayTotal(b) - dayTotal(a));
    let coverPhoto = null;
    for (const k of byBusy) {
        const p = photos.filter((l) => dayKey(l.date) === k).sort((a, b) => (b.steps || 0) - (a.steps || 0))[0];
        if (p) { coverPhoto = p; break; }
    }

    return {
        key: dayKeys[0],
        start: fromKey(dayKeys[0]),
        end: fromKey(dayKeys[dayKeys.length - 1]),
        days: dayKeys.length,
        dayKeys,
        steps: { ...steps, both: steps.user1 + steps.user2 },
        maxKm: furthest ? furthest.km : 0,
        furthest,
        points: away.map((l) => ({ lat: l.lat, lng: l.lng, name: l.locationName || '', uid: l.userId, date: l.date })),
        photos,
        notes: logs.filter((l) => l.note && String(l.note).trim()),
        logs,
        placeNames: [...counts.keys()],
        guessTitle,
        centre,
        coverPhoto
    };
}

/**
 * A trip covering exactly the dates given — for when the automatic dates are
 * wrong and you've set them yourself. Every log in the range counts, tagged or
 * not.
 */
export function tripFromRange(logs, startKey, endKey, { home = HOME, tripKm = TRIP_KM } = {}) {
    const days = dayStates(logs, { home, tripKm });
    const run = [];
    for (let k = startKey; k <= endKey && run.length < 366; k = nextKey(k)) run.push(k);
    return { ...build(run, days, home), manual: true };
}

/**
 * Apply the edits you've made: trips you've set the dates for yourself replace
 * any automatic trip they overlap, and trips you've said aren't trips go.
 *   edits = { custom: [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }], hidden: ['YYYY-MM-DD'] }
 * A hidden key matches any day of an automatic trip, so it holds even if a
 * backdated log moves the trip's first day.
 */
export function applyTripEdits(autoTrips, logs, edits = {}, opts = {}) {
    const custom = (edits.custom || []).filter((r) => r && r.start && r.end && r.start <= r.end);
    const hidden = new Set(edits.hidden || []);
    const manual = custom.map((r) => tripFromRange(logs, r.start, r.end, opts));
    const overlaps = (t) => custom.some((r) => t.dayKeys[0] <= r.end && t.dayKeys[t.dayKeys.length - 1] >= r.start);
    const auto = autoTrips.filter((t) => !overlaps(t) && !t.dayKeys.some((k) => hidden.has(k)));
    return [...manual, ...auto].sort((a, b) => b.start - a.start);
}

/**
 * Find the stored name for a trip. Names are keyed by the trip's first day; if a
 * backdated log has since moved that day, any stored key inside the trip still
 * counts.
 */
export function storedName(trip, names) {
    if (!names) return null;
    if (names[trip.key]) return names[trip.key];
    const k = trip.dayKeys.find((d) => names[d]);
    return k ? names[k] : null;
}

/** "3–9 Apr 2026", "28 Mar – 2 Apr 2026", "30 Dec 2026 – 2 Jan 2027" */
export function tripDates(trip) {
    const s = trip.start, e = trip.end;
    const day = (d) => d.getDate();
    const mon = (d) => d.toLocaleDateString('en-GB', { month: 'short' });
    if (trip.days === 1) return `${day(s)} ${mon(s)} ${s.getFullYear()}`;
    if (s.getFullYear() !== e.getFullYear()) return `${day(s)} ${mon(s)} ${s.getFullYear()} – ${day(e)} ${mon(e)} ${e.getFullYear()}`;
    if (s.getMonth() !== e.getMonth()) return `${day(s)} ${mon(s)} – ${day(e)} ${mon(e)} ${e.getFullYear()}`;
    return `${day(s)}–${day(e)} ${mon(e)} ${e.getFullYear()}`;
}
