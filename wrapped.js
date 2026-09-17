// ---------------------------------------------------------------------------
// Year Wrapped — the stats engine
// ---------------------------------------------------------------------------
// Pure by design: no DOM, no Firebase, no module-level state, nothing that
// needs a browser. Every number the Wrapped show and the recap section display
// comes out of computeWrapped(), so the two can never drift apart — the same
// one-source-of-truth rule that settled the all-time vs. annual split.
//
// Logs arrive normalised, with a real Date rather than a Firestore Timestamp:
//   { id, userId, steps, date, note, photoUrl, locationName, lat, lng }
//
// Everything is local-time, matching how the rest of the app buckets days.

const MS_PER_DAY = 86400000;
const UIDS = ['user1', 'user2'];

// The app's own conversions, so a figure here can never contradict one on the
// main page.
export const STEPS_PER_MILE = 2100;
export const STEPS_PER_KM = 1300;
// Taken from the app's own milestone list rather than invented: the
// "Everest × 300" stamp sits at 3,496,110 steps.
export const STEPS_PER_EVEREST = 3496110 / 300;
export const KM_PER_MARATHON = 42.195;

// A place further than this from home was a trip out, not a walk round the block.
export const TRIP_KM = 40;
// What counts as a "good day" for streaks.
export const STREAK_THRESHOLD = 10000;

// Wrexham — where every journey in this app starts.
export const HOME = { lat: 53.043, lng: -2.993 };

// NOTE: these three mirror index.html. When index.html starts importing this
// module it should drop its own copies and use these, so there is only ever one
// definition of where a challenge year begins and ends.
export const CHALLENGE_START_YEAR = 2025;
export function challengeYearStart(n) { return new Date(CHALLENGE_START_YEAR + n - 1, 9, 1); }
export function challengeYearEnd(n) { return new Date(CHALLENGE_START_YEAR + n, 9, 1); } // exclusive

// --- small helpers ---------------------------------------------------------

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Mon=0 … Sun=6, matching the heatmap and the weekly rivalry bar.
const weekdayIndex = (d) => (d.getDay() + 6) % 7;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Challenge months run October (0) through September (11).
const monthIndex = (d) => (d.getMonth() - 9 + 12) % 12;

function eachDay(start, end) {
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cur < end) {
        out.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

export function haversineKm(a, b) {
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Every sort in here breaks ties on the log id, so a replay puts the same
// photos on the same slides in the same order.
const byIdAsc = (a, b) => String(a.id).localeCompare(String(b.id));

// Head-to-head comparison: who is higher, or null if they're level.
const cmp = (a, b) => (a > b ? 'user1' : b > a ? 'user2' : null);

// --- the engine ------------------------------------------------------------

/**
 * @param {Array} logs   every log, all users, all years — the year is filtered inside
 * @param {number} yearN challenge year (1 = Oct 25–Sep 26)
 * @param {object} opts  { names, milestones, milestoneDates, stretch, home, now }
 */
export function computeWrapped(logs, yearN, opts = {}) {
    const names = opts.names || { user1: 'Ant', user2: 'Amy' };
    const milestones = opts.milestones || [];
    const milestoneDates = opts.milestoneDates || {};
    const stretchGoals = opts.stretch || {};
    const home = opts.home || HOME;
    const now = opts.now instanceof Date ? opts.now : new Date();

    const start = challengeYearStart(yearN);
    const end = challengeYearEnd(yearN);

    // Only logs that are dated, belong to a known person, and carry a sane step
    // count can be placed on a journey.
    const clean = (logs || []).filter(
        (l) => l && UIDS.includes(l.userId) && l.date instanceof Date && Number.isFinite(Number(l.steps))
    ).map((l) => ({ ...l, steps: Number(l.steps) }));

    const inYear = clean
        .filter((l) => l.date >= start && l.date < end)
        .sort((a, b) => a.date - b.date || byIdAsc(a, b));

    const dayList = eachDay(start, end);
    const daysInYear = dayList.length;
    const daysElapsed = now >= end
        ? daysInYear
        : Math.max(1, Math.min(daysInYear, Math.floor((startOfDay(now) - start) / MS_PER_DAY) + 1));

    // --- per-day buckets, which everything else is built from ---------------
    // Someone can log twice in a day (a morning and an evening walk), so the day
    // is the unit, not the log.
    const days = { user1: {}, user2: {} };
    const dayLogs = { user1: {}, user2: {} };
    inYear.forEach((l) => {
        const k = dayKey(l.date);
        days[l.userId][k] = (days[l.userId][k] || 0) + l.steps;
        (dayLogs[l.userId][k] = dayLogs[l.userId][k] || []).push(l);
    });

    const per = {};
    UIDS.forEach((uid) => { per[uid] = perUser(uid); });

    // --- combined -----------------------------------------------------------
    const bothTotal = per.user1.total + per.user2.total;
    const allPlaces = collectPlaces(inYear, home);
    const both = {
        total: bothTotal,
        km: bothTotal / STEPS_PER_KM,
        miles: bothTotal / STEPS_PER_MILE,
        destination: lastMilestoneAtOrBelow(bothTotal, milestones),
        everests: bothTotal / STEPS_PER_EVEREST,
        marathons: bothTotal / STEPS_PER_KM / KM_PER_MARATHON,
        photoCount: per.user1.photos.count + per.user2.photos.count,
        places: allPlaces,
        countries: [...new Set(allPlaces.map((p) => p.country).filter(Boolean))].sort(),
        daysLogged: dayList.filter((d) => {
            const k = dayKey(d);
            return (days.user1[k] || 0) > 0 || (days.user2[k] || 0) > 0;
        }).length
    };

    const race = buildRace();
    const months = buildMonths();
    const awards = buildAwards();

    return {
        year: yearN,
        start,
        end,
        daysInYear,
        daysElapsed,
        names,
        user1: per.user1,
        user2: per.user2,
        both,
        months,
        race,
        awards,
        // Where next year's annual journey restarts from — the finale hands over
        // to it.
        firstMilestone: milestones[0] || null,
        // Convenience flags so a slide can skip itself without re-deriving this.
        hasPhotos: both.photoCount > 0,
        hasPlaces: allPlaces.length > 0,
        hasNotes: per.user1.notes.length + per.user2.notes.length > 0
    };

    // --- per person ---------------------------------------------------------

    function perUser(uid) {
        const buckets = days[uid];
        const keys = Object.keys(buckets);
        const total = keys.reduce((t, k) => t + buckets[k], 0);
        const daysLogged = keys.filter((k) => buckets[k] > 0).length;
        const daysOver10k = keys.filter((k) => buckets[k] >= STREAK_THRESHOLD).length;
        const userLogs = inYear.filter((l) => l.userId === uid);

        // Top three days, each carrying its biggest single log so a slide can
        // show that day's photo or note.
        const bestDays = keys
            .map((k) => {
                const logsThatDay = (dayLogs[uid][k] || []).slice().sort((a, b) => b.steps - a.steps || byIdAsc(a, b));
                return { key: k, date: startOfDay(logsThatDay[0].date), steps: buckets[k], log: logsThatDay[0] };
            })
            .sort((a, b) => b.steps - a.steps || byIdAsc(a.log, b.log))
            .slice(0, 3);

        // Streaks walk the full calendar, so a missed day genuinely breaks the run.
        const longest10kStreak = longestRun((k) => (buckets[k] || 0) >= STREAK_THRESHOLD);
        const longestLoggedStreak = longestRun((k) => (buckets[k] || 0) > 0);

        // Mean steps on the days this person actually logged, by weekday.
        const wdSum = new Array(7).fill(0);
        const wdCount = new Array(7).fill(0);
        dayList.forEach((d) => {
            const v = buckets[dayKey(d)] || 0;
            if (v <= 0) return;
            const i = weekdayIndex(d);
            wdSum[i] += v;
            wdCount[i] += 1;
        });
        const weekdayMeans = wdSum.map((s, i) => (wdCount[i] ? s / wdCount[i] : 0));
        let bestWeekday = null;
        if (daysLogged > 0) {
            let bi = 0;
            weekdayMeans.forEach((m, i) => { if (m > weekdayMeans[bi]) bi = i; });
            bestWeekday = { index: bi, name: WEEKDAY_NAMES[bi], mean: weekdayMeans[bi] };
        }

        // Month totals, and the best/quietest from them.
        const monthTotals = new Array(12).fill(0);
        dayList.forEach((d) => { monthTotals[monthIndex(d)] += buckets[dayKey(d)] || 0; });
        const monthLabel = (i) => monthLabelFor(i);
        let bestMonth = null;
        let quietestMonth = null;
        if (total > 0) {
            let bi = 0;
            let qi = 0;
            monthTotals.forEach((t, i) => {
                if (t > monthTotals[bi]) bi = i;
                if (t < monthTotals[qi]) qi = i;
            });
            bestMonth = { index: bi, label: monthLabel(bi), steps: monthTotals[bi] };
            quietestMonth = { index: qi, label: monthLabel(qi), steps: monthTotals[qi] };
        }

        const photoLogs = userLogs.filter((l) => l.photoUrl);
        const noteLogs = userLogs.filter((l) => l.note && String(l.note).trim());

        return {
            uid,
            name: names[uid],
            total,
            km: total / STEPS_PER_KM,
            miles: total / STEPS_PER_MILE,
            daysLogged,
            daysOver10k,
            avgPerLoggedDay: daysLogged ? total / daysLogged : 0,
            avgPerCalendarDay: total / daysElapsed,
            bestDays,
            bestWeek: bestWeekFor(buckets),
            bestMonth,
            quietestMonth,
            monthTotals,
            longest10kStreak,
            longestLoggedStreak,
            bestWeekday,
            weekdayMeans,
            photos: {
                list: photoLogs,
                count: photoLogs.length,
                first: photoLogs[0] || null,
                last: photoLogs[photoLogs.length - 1] || null
            },
            places: collectPlaces(userLogs, home),
            notes: noteLogs.map((l) => ({
                id: l.id, userId: uid, date: l.date, note: String(l.note).trim(), steps: l.steps, photoUrl: l.photoUrl || null
            })),
            milestones: milestonesFor(uid, total),
            stretch: stretchFor(uid)
        };

        function longestRun(pass) {
            let best = null;
            let runStart = null;
            let len = 0;
            dayList.forEach((d) => {
                if (pass(dayKey(d))) {
                    if (len === 0) runStart = d;
                    len += 1;
                    if (!best || len > best.days) best = { from: runStart, to: d, days: len };
                } else {
                    len = 0;
                }
            });
            return best || { from: null, to: null, days: 0 };
        }
    }

    // Best Mon–Sun week that sits entirely inside the challenge year.
    function bestWeekFor(buckets) {
        const first = new Date(start);
        const dow = weekdayIndex(first);
        if (dow !== 0) first.setDate(first.getDate() + (7 - dow));
        let best = null;
        for (const w = new Date(first); ; w.setDate(w.getDate() + 7)) {
            const wEnd = new Date(w);
            wEnd.setDate(wEnd.getDate() + 7);
            if (wEnd > end) break;
            let sum = 0;
            for (const d of eachDay(w, wEnd)) sum += buckets[dayKey(d)] || 0;
            const last = new Date(wEnd);
            last.setDate(last.getDate() - 1);
            if (!best || sum > best.steps) best = { from: new Date(w), to: last, steps: sum };
        }
        return best || { from: null, to: null, steps: 0 };
    }

    // Distinct places, keyed on the short name plus coordinates rounded to ~1km,
    // so the same park logged twenty times is one place.
    function collectPlaces(source, origin) {
        const byKey = new Map();
        source.forEach((l) => {
            if (l.lat == null || l.lng == null) return;
            const shortName = l.locationName
                ? String(l.locationName).split(',')[0].trim()
                : `${l.lat.toFixed(3)}, ${l.lng.toFixed(3)}`;
            const key = `${shortName}|${l.lat.toFixed(2)},${l.lng.toFixed(2)}`;
            // Nominatim puts the country last, so that's where it is.
            const parts = l.locationName ? String(l.locationName).split(',').map((s) => s.trim()) : [];
            const country = parts.length > 1 ? parts[parts.length - 1] : null;
            if (!byKey.has(key)) {
                byKey.set(key, {
                    key,
                    name: shortName,
                    country,
                    lat: l.lat,
                    lng: l.lng,
                    km: haversineKm(origin, { lat: l.lat, lng: l.lng }),
                    firstDate: l.date,
                    lastDate: l.date,
                    logs: []
                });
            }
            const p = byKey.get(key);
            p.logs.push(l);
            if (l.date < p.firstDate) p.firstDate = l.date;
            if (l.date > p.lastDate) p.lastDate = l.date;
        });
        const list = [...byKey.values()];
        list.forEach((p) => { p.isTrip = p.km != null && p.km > TRIP_KM; });
        return list.sort((a, b) => (b.km || 0) - (a.km || 0) || a.name.localeCompare(b.name));
    }

    // From the app's own milestone replay — this engine does not re-derive
    // milestone dates, it reads the ones the passport already computed. It does
    // check them against the year's own total though: the annual journey restarts
    // from zero each year, so a milestone reported for this year that the year's
    // steps never reach is a disagreement between the two, and the logs win.
    function milestonesFor(uid, yearTotal) {
        const other = uid === 'user1' ? 'user2' : 'user1';
        const out = [];
        milestones.forEach((m) => {
            if (m.steps > yearTotal) return;
            const entry = milestoneDates[m.steps];
            if (!entry) return;
            const mine = (entry[uid] || []).find((r) => r.year === yearN);
            if (!mine) return;
            const theirs = (entry[other] || []).find((r) => r.year === yearN);
            out.push({
                label: m.label,
                steps: m.steps,
                description: m.description,
                date: mine.date,
                first: !theirs || mine.date <= theirs.date
            });
        });
        return out.sort((a, b) => a.date - b.date || a.steps - b.steps);
    }

    // The stretch goal sits on the all-time total, not the year's, so the
    // crossing date is found by replaying every log this person has ever added.
    function stretchFor(uid) {
        const goal = stretchGoals[uid];
        if (!goal || !Number.isFinite(Number(goal.steps))) return null;
        const target = Number(goal.steps);
        const history = clean.filter((l) => l.userId === uid).sort((a, b) => a.date - b.date || byIdAsc(a, b));
        let cum = 0;
        let crossed = null;
        for (const l of history) {
            cum += l.steps;
            if (cum >= target) { crossed = l.date; break; }
        }
        return {
            label: goal.label,
            steps: target,
            reward: goal.reward || '🎯',
            targetDate: goal.targetDate || null,
            total: cum >= target ? cum : history.reduce((t, l) => t + l.steps, 0),
            done: crossed != null,
            crossedOn: crossed,
            // Only meaningful when it hasn't been reached yet.
            pct: Math.min(100, (history.reduce((t, l) => t + l.steps, 0) / target) * 100)
        };
    }

    function monthLabelFor(i) {
        const y = CHALLENGE_START_YEAR + yearN - 1 + (i <= 2 ? 0 : 1);
        const m = (9 + i) % 12;
        return new Date(y, m, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    }

    // --- the race -----------------------------------------------------------

    function buildRace() {
        const daysOut = [];
        const cum = { user1: 0, user2: 0 };
        const leadChanges = [];
        const daysInLead = { user1: 0, user2: 0 };
        let biggestSwing = null;
        // 0 while they're level; only a flip between two non-zero signs counts as
        // the lead changing hands, so first blood isn't reported as a change.
        let lastSign = 0;

        dayList.forEach((d) => {
            const k = dayKey(d);
            const day = { user1: days.user1[k] || 0, user2: days.user2[k] || 0 };
            cum.user1 += day.user1;
            cum.user2 += day.user2;

            const diff = cum.user1 - cum.user2;
            const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
            if (sign !== 0) {
                daysInLead[sign > 0 ? 'user1' : 'user2'] += 1;
                if (lastSign !== 0 && sign !== lastSign) {
                    leadChanges.push({ date: new Date(d), to: sign > 0 ? 'user1' : 'user2' });
                }
                lastSign = sign;
            }

            const swing = Math.abs(day.user1 - day.user2);
            if (swing > 0 && (!biggestSwing || swing > biggestSwing.by)) {
                biggestSwing = { date: new Date(d), by: swing, uid: day.user1 > day.user2 ? 'user1' : 'user2' };
            }

            daysOut.push({ date: new Date(d), cum: { ...cum }, day });
        });

        return {
            days: daysOut,
            leadChanges,
            daysInLead,
            biggestSwing,
            finalGap: Math.abs(cum.user1 - cum.user2),
            winner: cmp(cum.user1, cum.user2)
        };
    }

    // --- month chapters -----------------------------------------------------

    function buildMonths() {
        return Array.from({ length: 12 }, (_, i) => {
            const monthLogs = inYear.filter((l) => monthIndex(l.date) === i);
            const totals = { user1: 0, user2: 0 };
            monthLogs.forEach((l) => { totals[l.userId] += l.steps; });

            // Best single day that month, across both of them.
            const dayTotals = {};
            monthLogs.forEach((l) => {
                const k = `${l.userId}|${dayKey(l.date)}`;
                dayTotals[k] = (dayTotals[k] || 0) + l.steps;
            });
            let bestDay = null;
            Object.entries(dayTotals).forEach(([k, steps]) => {
                if (bestDay && steps <= bestDay.steps) return;
                const [uid, key] = k.split('|');
                const logsThatDay = (dayLogs[uid][key] || []).slice().sort((a, b) => b.steps - a.steps || byIdAsc(a, b));
                bestDay = { uid, date: startOfDay(logsThatDay[0].date), steps, log: logsThatDay[0] };
            });

            const photos = pickMonthPhotos(monthLogs);
            const chosenIds = new Set(photos.map((p) => p.id));

            // The quote deliberately comes from a log we didn't already put on
            // screen as a polaroid, so the caption and the pull-quote aren't the
            // same sentence.
            const quoteLog = monthLogs
                .filter((l) => l.note && String(l.note).trim() && !chosenIds.has(l.id))
                .sort((a, b) => String(b.note).trim().length - String(a.note).trim().length || byIdAsc(a, b))[0];

            const monthMilestones = [];
            UIDS.forEach((uid) => {
                per[uid].milestones.forEach((m) => {
                    if (monthIndex(m.date) === i) monthMilestones.push({ ...m, uid });
                });
            });

            const trips = allPlaces
                .filter((p) => p.isTrip && p.logs.some((l) => monthIndex(l.date) === i))
                .map((p) => {
                    const firstHere = p.logs.filter((l) => monthIndex(l.date) === i).sort((a, b) => a.date - b.date)[0];
                    return { name: p.name, km: p.km, country: p.country, date: firstHere.date, uid: firstHere.userId };
                })
                .sort((a, b) => b.km - a.km);

            return {
                index: i,
                label: monthLabelFor(i),
                totals,
                winner: cmp(totals.user1, totals.user2),
                bestDay,
                photos,
                milestones: monthMilestones.sort((a, b) => a.date - b.date),
                trips,
                quote: quoteLog
                    ? { id: quoteLog.id, uid: quoteLog.userId, date: quoteLog.date, text: String(quoteLog.note).trim(), steps: quoteLog.steps }
                    : null,
                isEmpty: totals.user1 === 0 && totals.user2 === 0
            };
        });
    }

    // Up to three photos a month, alternating between the two of you where both
    // have something, biggest days first, with a nudge for anywhere far from home.
    function pickMonthPhotos(monthLogs) {
        const score = (l) => {
            const place = allPlaces.find((p) => p.logs.includes(l));
            return l.steps + (place && place.isTrip ? 5000 : 0);
        };
        const queues = {};
        UIDS.forEach((uid) => {
            queues[uid] = monthLogs
                .filter((l) => l.userId === uid && l.photoUrl)
                .map((l) => ({ log: l, score: score(l) }))
                .sort((a, b) => b.score - a.score || byIdAsc(a.log, b.log));
        });

        const out = [];
        // Start with whoever has the single strongest photo that month.
        let turn = (queues.user1[0]?.score || -1) >= (queues.user2[0]?.score || -1) ? 'user1' : 'user2';
        while (out.length < 3 && (queues.user1.length || queues.user2.length)) {
            const other = turn === 'user1' ? 'user2' : 'user1';
            const from = queues[turn].length ? turn : other;
            out.push(queues[from].shift().log);
            turn = from === 'user1' ? 'user2' : 'user1';
        }
        return out;
    }

    // --- awards -------------------------------------------------------------

    function buildAwards() {
        const s = per;
        const halfAt = Math.floor(daysInYear / 2);
        const halves = {};
        UIDS.forEach((uid) => {
            let first = 0;
            let second = 0;
            dayList.forEach((d, i) => {
                const v = days[uid][dayKey(d)] || 0;
                if (i < halfAt) first += v; else second += v;
            });
            halves[uid] = { first, second, ratio: first > 0 ? second / first : (second > 0 ? Infinity : 0) };
        });

        // Coefficient of variation across logged days — lower is steadier.
        const consistency = {};
        UIDS.forEach((uid) => {
            const vals = Object.values(days[uid]).filter((v) => v > 0);
            if (vals.length < 2) { consistency[uid] = null; return; }
            const mean = vals.reduce((t, v) => t + v, 0) / vals.length;
            const variance = vals.reduce((t, v) => t + (v - mean) ** 2, 0) / vals.length;
            consistency[uid] = mean > 0 ? Math.sqrt(variance) / mean : null;
        });

        const septemberTotal = (uid) => s[uid].monthTotals[11];
        const firstCount = (uid) => s[uid].milestones.filter((m) => m.first).length;

        const defs = [
            {
                id: 'winner', emoji: '🏆', label: 'Year Winner',
                pick: () => cmp(s.user1.total, s.user2.total),
                detail: (uid) => `${Math.round(s[uid].total).toLocaleString()} steps`
            },
            {
                id: 'ironLegs', emoji: '🦵', label: 'Iron Legs',
                pick: () => cmp(s.user1.longest10kStreak.days, s.user2.longest10kStreak.days),
                detail: (uid) => `${s[uid].longest10kStreak.days} days straight over 10k`
            },
            {
                id: 'photographer', emoji: '📸', label: 'Photographer of the Year',
                pick: () => cmp(s.user1.photos.count, s.user2.photos.count),
                detail: (uid) => `${s[uid].photos.count} photos`
            },
            {
                id: 'explorer', emoji: '🧭', label: 'Explorer',
                pick: () => cmp(s.user1.places.length, s.user2.places.length),
                detail: (uid) => `${s[uid].places.length} different places`
            },
            {
                id: 'biggestDay', emoji: '🚀', label: 'Biggest Day',
                pick: () => cmp(s.user1.bestDays[0]?.steps || 0, s.user2.bestDays[0]?.steps || 0),
                detail: (uid) => `${(s[uid].bestDays[0]?.steps || 0).toLocaleString()} in one day`
            },
            {
                id: 'weekendWarrior', emoji: '📅', label: 'Weekend Warrior',
                each: (uid) => !!s[uid].bestWeekday && s[uid].bestWeekday.index >= 5,
                detail: (uid) => `${s[uid].bestWeekday.name}s are your big day`
            },
            {
                id: 'weekdayGrinder', emoji: '⚙️', label: 'Weekday Grinder',
                each: (uid) => !!s[uid].bestWeekday && s[uid].bestWeekday.index <= 4,
                detail: (uid) => `${s[uid].bestWeekday.name}s are your big day`
            },
            {
                id: 'closer', emoji: '🏁', label: 'The Closer',
                pick: () => cmp(septemberTotal('user1'), septemberTotal('user2')),
                detail: (uid) => `${septemberTotal(uid).toLocaleString()} steps in September`
            },
            {
                id: 'storyteller', emoji: '✍️', label: 'Storyteller',
                pick: () => cmp(s.user1.notes.length, s.user2.notes.length),
                detail: (uid) => `${s[uid].notes.length} notes written`
            },
            {
                id: 'firstToArrive', emoji: '👑', label: 'First to Arrive',
                pick: () => cmp(firstCount('user1'), firstCount('user2')),
                detail: (uid) => `First to ${firstCount(uid)} milestones`
            },
            {
                id: 'comeback', emoji: '🌙', label: 'Strong Finish',
                pick: () => cmp(halves.user1.ratio, halves.user2.ratio),
                detail: (uid) => `${Math.round((halves[uid].ratio - 1) * 100)}% busier in the second half`
            },
            {
                id: 'consistent', emoji: '🎯', label: 'Most Consistent',
                pick: () => {
                    if (consistency.user1 == null || consistency.user2 == null) return null;
                    return cmp(-consistency.user1, -consistency.user2); // lower spread wins
                },
                detail: (uid) => `${Math.round(s[uid].avgPerLoggedDay).toLocaleString()} a day, give or take`
            }
        ];

        const out = { user1: [], user2: [] };
        defs.forEach((def) => {
            const give = (uid) => {
                if (out[uid].length >= 3) return;
                out[uid].push({ id: def.id, emoji: def.emoji, label: def.label, detail: def.detail(uid) });
            };
            if (def.each) {
                UIDS.forEach((uid) => { if (def.each(uid)) give(uid); });
            } else {
                const winner = def.pick();
                if (winner) give(winner);
            }
        });

        // Nobody leaves empty-handed — but rather than hand someone a contest they
        // lost, fall back to a plain statement of their own year.
        UIDS.forEach((uid) => {
            if (out[uid].length === 0) {
                out[uid].push({
                    id: 'longHaul', emoji: '👟', label: 'The Long Haul',
                    detail: `${Math.round(s[uid].total).toLocaleString()} steps this year`
                });
            }
        });

        return out;
    }
}

// The furthest place along the app's own journey that a step count reaches.
export function lastMilestoneAtOrBelow(steps, milestones) {
    let best = null;
    (milestones || []).forEach((m) => {
        if (m.steps <= steps && (!best || m.steps > best.steps)) best = m;
    });
    return best;
}

// Which completed challenge years have a Wrapped to show. A year only qualifies
// once it is over, which is what keeps the surprise until 1 October.
export function wrappedYears(now = new Date(), { preview = false } = {}) {
    const currentYear = Math.max(1, (() => {
        const startYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
        return startYear - CHALLENGE_START_YEAR + 1;
    })());
    const lastComplete = preview ? currentYear : currentYear - 1;
    const out = [];
    for (let n = 1; n <= lastComplete; n++) out.push(n);
    return out;
}

// ---------------------------------------------------------------------------
// The show
// ---------------------------------------------------------------------------
// Everything below touches the DOM, but only when called — the module itself
// stays importable in node, which is what keeps the engine above testable.

const YEAR_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const yearWord = (n) => (YEAR_WORDS[n] ? `Year ${YEAR_WORDS[n]}` : `Year ${n}`);

const fmt = (n) => Math.round(n || 0).toLocaleString('en-GB');
const fmtDate = (d) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDayShort = (d) => (d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : '');
// Inside a month chapter the month is the headline, so the short form is enough.
// Anywhere that spans the whole year, the month has to come with it.
const fmtDayMonth = (d) => (d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

// Names, notes and place names are all things the two of them typed, and they
// end up in innerHTML, so they get escaped on the way — same helper the main
// page uses.
const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A fixed tilt per photo, hashed from the log id the same way the map scatters
// its pins — so a replay lays the polaroids out exactly as it did the first time.
function seedRotation(id, spread = 6) {
    let h = 0;
    const str = String(id);
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return (((Math.abs(h) % 1000) / 1000) * spread * 2 - spread).toFixed(2);
}

function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
}

// Rolls a number up from zero. Returns its own canceller, because a slide can
// be tapped away long before the count finishes.
function countUp(node, to, ms, reduced) {
    if (reduced || !(ms > 0)) { node.textContent = fmt(to); return () => {}; }
    let raf = 0;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        node.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
}

const delay = (node, ms) => { node.style.animationDelay = `${ms}ms`; return node; };

// --- slides ----------------------------------------------------------------
// { id, duration, wash, skip?, images?, render } — a slide whose skip() is true
// is dropped before the progress bar is built, so the segment count is honest.

const COVER_SLIDE = {
        id: 'cover',
        duration: Infinity, // waits for a tap: nothing plays before she's looking
        wash: ['#22c55e', '#9333ea'],
        render(stats, ctx) {
            const lastDay = new Date(stats.end.getTime() - 86400000);
            const wrap = el('div');
            wrap.append(
                el('div', 'wrapped-eyebrow wrapped-rise', 'A to A Walking'),
                delay(el('div', 'wrapped-huge wrapped-rise', yearWord(stats.year)), 150),
                delay(el('div', 'wrapped-sub wrapped-rise', `${fmtDate(stats.start)} — ${fmtDate(lastDay)}`), 350),
                delay(el('div', 'wrapped-mid wrapped-rise',
                    `<span class="wrapped-ant">${esc(stats.names.user1)}</span> <span style="opacity:.5">&amp;</span> <span class="wrapped-amy">${esc(stats.names.user2)}</span>`), 500),
                delay(el('div', 'wrapped-hint wrapped-rise', ctx.reduced ? 'Tap to begin' : 'Tap to begin'), 900)
            );
            return wrap;
        }
};

const BIG_NUMBER_SLIDE = {
        id: 'bigNumber',
        duration: 8000,
        wash: ['#22c55e', '#0ea5e9'],
        render(stats, ctx) {
            const wrap = el('div');
            const number = el('div', 'wrapped-huge');
            number.textContent = '0';
            const km = delay(el('div', 'wrapped-big wrapped-rise', `${fmt(stats.both.km)} km`), 2400);
            const dest = stats.both.destination
                ? delay(el('div', 'wrapped-mid wrapped-rise',
                    `Together, that's Wrexham to<br><strong>${stats.both.destination.label}</strong>`), 3400)
                : delay(el('div', 'wrapped-mid wrapped-rise',
                    `That's ${fmt(stats.both.marathons)} marathons between you`), 3400);

            wrap.append(
                el('div', 'wrapped-eyebrow wrapped-rise', 'Between you, this year'),
                number,
                el('div', 'wrapped-sub', 'steps'),
                km,
                dest
            );
            wrap._cleanup = countUp(number, stats.both.total, 2500, ctx.reduced);
            return wrap;
        }
};

const FINALE_SLIDE = {
        id: 'finale',
        duration: Infinity,
        isLast: true,
        wash: ['#9333ea', '#22c55e'],
        render(stats, ctx) {
            const wrap = el('div');
            const next = stats.firstMilestone
                ? `Next stop on the annual journey: <strong>${stats.firstMilestone.label}</strong>`
                : 'The annual journey begins again from zero.';

            wrap.append(
                el('div', 'wrapped-eyebrow wrapped-rise', `That was ${yearWord(stats.year).toLowerCase()}`),
                delay(el('div', 'wrapped-big wrapped-rise', `${yearWord(stats.year + 1)} starts now.`), 200),
                delay(el('div', 'wrapped-mid wrapped-rise', next), 500),
                delay(el('div', 'wrapped-sub wrapped-rise',
                    'From tomorrow, these days start turning up in <em>A year ago today</em>.'), 800)
            );

            const actions = delay(el('div', 'wrapped-actions wrapped-rise'), 1100);
            const replay = el('button', 'wrapped-btn', '↻ Replay');
            replay.addEventListener('click', ctx.replay);
            actions.append(replay);
            const recap = el('button', 'wrapped-btn wrapped-btn-primary', 'See the recap');
            recap.addEventListener('click', ctx.recap);
            actions.append(recap);
            wrap.append(actions);

            if (!ctx.reduced && typeof globalThis.confetti === 'function') {
                const colours = ['#4ade80', '#22c55e', '#a855f7', '#9333ea'];
                globalThis.confetti({ particleCount: 200, spread: 120, origin: { y: 0.6 }, colors: colours });
                setTimeout(() => globalThis.confetti({ particleCount: 80, spread: 60, origin: { y: 0.7, x: 0.25 } }), 300);
                setTimeout(() => globalThis.confetti({ particleCount: 80, spread: 60, origin: { y: 0.7, x: 0.75 } }), 600);
            }
            return wrap;
        }
};

// The race chart's series colours. Deliberately not the brighter green and
// purple used elsewhere in the show: those sit outside the OKLCH lightness band
// for a dark surface. These are darker steps of the same two hues and pass the
// lightness, chroma, colour-vision separation and contrast checks against
// #0b0f1a. Both lines are also labelled at their end and named with a swatch
// underneath, so identity never rests on colour.
const RACE_ANT = '#16a34a';
const RACE_AMY = '#a855f7';

let raceClipSeq = 0;

// The gap between them, drawn once and used by both the show and the recap, so
// the two can't end up telling different stories.
//
// Plotting both cumulative totals as two climbing lines looks impressive and
// says almost nothing: over a year they sit on top of each other, and a
// 30,000-step day is about one per cent of the height, so the big days the
// chart exists to show simply don't register. What "who's winning, and what did
// the big days do" actually asks for is the gap — one series, diverging either
// side of a neutral zero line. Lead changes are the crossings and a big day is
// a visible kink.
export function raceSvg(stats, { height = 190 } = {}) {
    const days = stats.race.days;
    if (!days.length) return '';
    const gaps = days.map((d) => d.cum.user1 - d.cum.user2);
    const maxAbs = Math.max(1, ...gaps.map(Math.abs));

    const W = 340, H = height, padL = 4, padR = 4, padT = 16, padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const zeroY = padT + plotH / 2;
    const xAt = (i) => padL + (i / Math.max(1, days.length - 1)) * plotW;
    const yAt = (gap) => zeroY - (gap / maxAbs) * (plotH / 2);

    const line = gaps.map((g, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(g).toFixed(1)}`).join('');
    const area = `M${xAt(0).toFixed(1)},${zeroY.toFixed(1)}${line.slice(1)}L${xAt(days.length - 1).toFixed(1)},${zeroY.toFixed(1)}Z`;

    // Unique per call, so a replay can't collide with a definition left in the
    // document by the last one.
    const uid = `wr${++raceClipSeq}`;

    const crossings = stats.race.leadChanges.map((c) => {
        const i = days.findIndex((d) => d.date.getTime() === c.date.getTime());
        return i < 0 ? '' :
            `<line class="wrapped-race-tick" x1="${xAt(i).toFixed(1)}" y1="${padT}" x2="${xAt(i).toFixed(1)}" y2="${padT + plotH}"/>
             <circle class="wrapped-race-tick-dot" cx="${xAt(i).toFixed(1)}" cy="${zeroY.toFixed(1)}" r="3"/>`;
    }).join('');

    const axisLabels = days.map((d, i) => ({ d, i }))
        .filter(({ d }) => d.date.getDate() === 1 && [9, 0, 3, 6].includes(d.date.getMonth()))
        .map(({ d, i }) => `<text class="wrapped-race-axis-label" x="${xAt(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${d.date.toLocaleDateString('en-GB', { month: 'short' })}</text>`)
        .join('');

    return `<svg class="wrapped-race" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="How far ahead ${esc(stats.names.user1)} or ${esc(stats.names.user2)} was, through the year">
        <defs>
            <clipPath id="${uid}-up"><rect x="0" y="0" width="${W}" height="${zeroY.toFixed(1)}"/></clipPath>
            <clipPath id="${uid}-down"><rect x="0" y="${zeroY.toFixed(1)}" width="${W}" height="${(H - zeroY).toFixed(1)}"/></clipPath>
        </defs>
        <g class="wrapped-race-reveal">
            <path d="${area}" fill="${RACE_ANT}" fill-opacity="0.45" clip-path="url(#${uid}-up)"/>
            <path d="${area}" fill="${RACE_AMY}" fill-opacity="0.45" clip-path="url(#${uid}-down)"/>
            <path class="wrapped-race-edge" d="${line}"/>
            ${crossings}
        </g>
        <line class="wrapped-race-axis" x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${padL + plotW}" y2="${zeroY.toFixed(1)}"/>
        <text class="wrapped-race-pole" x="${padL + 2}" y="${padT + 8}" fill="${RACE_ANT}">${esc(stats.names.user1)} ahead</text>
        <text class="wrapped-race-pole" x="${padL + 2}" y="${(padT + plotH - 2).toFixed(1)}" fill="${RACE_AMY}">${esc(stats.names.user2)} ahead</text>
        ${axisLabels}
    </svg>`;
}

// The sentences that go with the chart, in both places.
export function raceSummary(stats) {
    const days = stats.race.days;
    const maxAbs = days.length
        ? Math.max(0, ...days.map((d) => Math.abs(d.cum.user1 - d.cum.user2)))
        : 0;
    const changeCount = stats.race.leadChanges.length;
    const out = [changeCount === 0
        ? 'The lead never changed hands.'
        : `Lead changed hands <strong>${changeCount}</strong> ${changeCount === 1 ? 'time' : 'times'}.`];
    out.push(`${esc(stats.names.user1)} led for ${fmt(stats.race.daysInLead.user1)} days, ${esc(stats.names.user2)} for ${fmt(stats.race.daysInLead.user2)}.`);
    if (stats.race.biggestSwing) {
        const sw = stats.race.biggestSwing;
        out.push(`Biggest day's swing: ${fmtDate(sw.date)}, ${esc(stats.names[sw.uid])} by ${fmt(sw.by)}.`);
    }
    out.push(`Furthest apart: ${fmt(maxAbs)} steps.`);
    return out;
}

export function raceTitle(stats) {
    const n = stats.race.leadChanges.length;
    return n === 0 ? 'A runaway' : n < 3 ? 'It changed hands' : 'Neck and neck';
}

const RACE_SLIDE = {
    id: 'race',
    duration: 10000,
    wash: ['#0ea5e9', '#9333ea'],
    skip: (stats) => stats.both.total === 0,
    render(stats) {
        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'The race'));
        wrap.append(delay(el('div', 'wrapped-big wrapped-rise', raceTitle(stats)), 150));
        wrap.append(el('div', 'wrapped-rise', raceSvg(stats)));
        wrap.append(delay(el('div', 'wrapped-sub wrapped-rise', raceSummary(stats).join('<br>')), 2700));
        return wrap;
    }
};

const BEST_DAYS_SLIDE = {
    id: 'bestDays',
    duration: 7000,
    wash: ['#f59e0b', '#9333ea'],
    skip: (stats) => !stats.user1.bestDays.length && !stats.user2.bestDays.length,
    images: (stats) => ['user1', 'user2']
        .map((uid) => stats[uid].bestDays[0] && stats[uid].bestDays[0].log.photoUrl)
        .filter(Boolean),
    render(stats) {
        const medals = ['🥇', '🥈', '🥉'];
        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'Best days'));

        const cols = delay(el('div', 'wrapped-cols wrapped-rise'), 200);
        ['user1', 'user2'].forEach((uid) => {
            const colour = uid === 'user1' ? 'wrapped-ant' : 'wrapped-amy';
            const col = el('div');
            col.append(el('div', `wrapped-col-head ${colour}`, esc(stats.names[uid])));

            // Only the gold day gets a photo, so two phones' worth of polaroids
            // don't crowd out the numbers.
            const top = stats[uid].bestDays[0];
            if (top && top.log.photoUrl) {
                const row = el('div', 'wrapped-polaroids');
                const card = el('div', 'wrapped-polaroid');
                card.style.setProperty('--rot', `${seedRotation(top.log.id)}deg`);
                card.style.width = '104px';
                card.style.animationDelay = '400ms';
                const img = el('img');
                img.src = top.log.photoUrl;
                img.alt = '';
                card.append(img, el('div', 'wrapped-cap', fmtDayMonth(top.date)));
                row.append(card);
                col.append(row);
            }

            if (!stats[uid].bestDays.length) {
                col.append(el('div', 'wrapped-rank', '<span class="wrapped-rank-when">Nothing logged</span>'));
            }
            stats[uid].bestDays.forEach((b, i) => {
                col.append(el('div', 'wrapped-rank',
                    `<span>${medals[i]}</span>
                     <span class="wrapped-rank-steps">${fmt(b.steps)}</span>
                     <span class="wrapped-rank-when">${fmtDayMonth(b.date)}</span>`));
            });
            cols.append(col);
        });
        wrap.append(cols);
        return wrap;
    }
};

const HABITS_SLIDE = {
    id: 'habits',
    duration: 7000,
    wash: ['#22c55e', '#6366f1'],
    skip: (stats) => !stats.user1.daysLogged && !stats.user2.daysLogged,
    render(stats) {
        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'The habit'));
        const cols = delay(el('div', 'wrapped-cols wrapped-rise'), 200);

        ['user1', 'user2'].forEach((uid) => {
            const u = stats[uid];
            const colour = uid === 'user1' ? 'wrapped-ant' : 'wrapped-amy';
            const col = el('div');
            col.append(el('div', `wrapped-col-head ${colour}`, esc(stats.names[uid])));

            const streak = u.longest10kStreak;
            col.append(el('div', 'wrapped-fact',
                streak.days > 0
                    ? `<strong>${streak.days} ${streak.days === 1 ? 'day' : 'days'}</strong>
                       in a row over 10k<br><em>${fmtDate(streak.from)} — ${fmtDate(streak.to)}</em>`
                    : '<strong>—</strong> no run over 10k this year'));

            col.append(el('div', 'wrapped-fact',
                `<strong>${fmt(u.daysLogged)} of ${stats.daysInYear}</strong> days logged`));

            if (u.bestWeekday) {
                col.append(el('div', 'wrapped-fact',
                    `<strong>${u.bestWeekday.name}s</strong> are the big day<br><em>${fmt(u.bestWeekday.mean)} on average</em>`));
            }
            cols.append(col);
        });

        wrap.append(cols);
        return wrap;
    }
};

const PLACES_SLIDE = {
    id: 'places',
    duration: 8000,
    wash: ['#0ea5e9', '#22c55e'],
    // Leaflet is loaded by the page, not by this module, so the slide checks for
    // it rather than assuming it.
    skip: (stats) => !stats.hasPlaces || typeof globalThis.L === 'undefined',
    images: (stats) => stats.both.places
        .map((p) => (p.logs.find((l) => l.photoUrl) || {}).photoUrl)
        .filter(Boolean).slice(0, 6),
    render(stats) {
        const places = stats.both.places.slice().sort((a, b) => a.firstDate - b.firstDate);
        const countries = stats.both.countries.length;

        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'Everywhere you went'));
        const host = el('div', 'wrapped-map');
        wrap.append(host);
        wrap.append(delay(el('div', 'wrapped-mid wrapped-rise',
            `<strong>${places.length}</strong> ${places.length === 1 ? 'place' : 'places'}` +
            (countries > 1 ? ` &middot; <strong>${countries}</strong> countries` : '')), 300));

        let map = null;
        const timers = [];
        // The node has to be in the document with a size before Leaflet can lay
        // itself out, and it is appended straight after render returns.
        const raf = requestAnimationFrame(() => {
            const L = globalThis.L;
            map = L.map(host, {
                zoomControl: false, attributionControl: false,
                dragging: false, touchZoom: false, scrollWheelZoom: false,
                doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
            });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
            // The slide fades in over the same beat, so make sure the map sized
            // itself against the final box.
            map.invalidateSize();

            places.forEach((place, i) => {
                timers.push(setTimeout(() => {
                    if (!map) return;
                    const first = place.logs.slice().sort((a, b) => a.date - b.date)[0];
                    const mine = first.userId === 'user1' ? 'ant' : 'amy';
                    L.marker([place.lat, place.lng], {
                        interactive: false,
                        icon: L.divIcon({
                            className: '',
                            html: `<div class="wrapped-pin wrapped-pin-${mine}"></div>`,
                            iconSize: [14, 14],
                            iconAnchor: [7, 7]
                        })
                    }).addTo(map);
                }, 400 + i * 160));
            });
        });

        wrap._cleanup = () => {
            cancelAnimationFrame(raf);
            timers.forEach(clearTimeout);
            if (map) { map.remove(); map = null; }
        };
        return wrap;
    }
};

const FURTHEST_SLIDE = {
    id: 'furthest',
    duration: 6000,
    wash: ['#f59e0b', '#0ea5e9'],
    skip: (stats) => !stats.both.places.some((p) => p.isTrip),
    images: (stats) => {
        const trip = stats.both.places.find((p) => p.isTrip);
        const withPhoto = trip && trip.logs.find((l) => l.photoUrl);
        return withPhoto ? [withPhoto.photoUrl] : [];
    },
    render(stats) {
        const trips = stats.both.places.filter((p) => p.isTrip); // already furthest-first
        const top = trips[0];
        const first = top.logs.slice().sort((a, b) => a.date - b.date)[0];
        const photo = top.logs.find((l) => l.photoUrl);

        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'Furthest from home'));

        if (photo) {
            const row = el('div', 'wrapped-polaroids');
            const card = el('div', 'wrapped-polaroid');
            card.style.setProperty('--rot', `${seedRotation(photo.id)}deg`);
            card.style.width = '190px';
            card.style.animationDelay = '300ms';
            const img = el('img');
            img.src = photo.photoUrl;
            img.alt = '';
            card.append(img, el('div', 'wrapped-cap', `${esc(top.name)} &middot; ${fmtDayMonth(photo.date)}`));
            row.append(card);
            wrap.append(row);
        }

        wrap.append(delay(el('div', 'wrapped-big wrapped-rise', esc(top.name)), 200));
        wrap.append(delay(el('div', 'wrapped-mid wrapped-rise',
            `<strong>${fmt(top.km)} km</strong> from Wrexham`), 350));
        wrap.append(delay(el('div', 'wrapped-sub wrapped-rise',
            `${esc(stats.names[first.userId])} &middot; ${fmtDate(first.date)}`), 500));

        if (trips.length > 1) {
            const rest = trips.slice(1, 3)
                .map((t) => `${esc(t.name)} <span style="opacity:.55">${fmt(t.km)} km</span>`)
                .join(' &middot; ');
            wrap.append(delay(el('div', 'wrapped-sub wrapped-rise', `Also: ${rest}`), 700));
        }
        return wrap;
    }
};

const PASSPORT_SLIDE = {
    id: 'passport',
    duration: 7000,
    wash: ['#9333ea', '#f59e0b'],
    skip: (stats) => !stats.user1.milestones.length && !stats.user2.milestones.length,
    render(stats) {
        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'Stamps this year'));

        // One stamp per place reached, whoever got there. The crown goes to
        // whoever arrived first.
        const byPlace = new Map();
        ['user1', 'user2'].forEach((uid) => {
            stats[uid].milestones.forEach((m) => {
                const entry = byPlace.get(m.steps) || { label: m.label, steps: m.steps, who: [] };
                entry.who.push({ uid, date: m.date, first: m.first });
                byPlace.set(m.steps, entry);
            });
        });
        const stamps = [...byPlace.values()].sort((a, b) => a.steps - b.steps);

        const grid = el('div', 'wrapped-stamps');
        stamps.slice(0, 12).forEach((stamp, i) => {
            const node = el('div', 'wrapped-stamp');
            node.style.animationDelay = `${250 + i * 70}ms`;
            const earliest = stamp.who.slice().sort((a, b) => a.date - b.date)[0];
            // An emoji ignores `color`, so the crown alone can't say who got here
            // first. The dot beside it carries that, in the same green and purple
            // the rest of the show uses, and the line underneath names them both.
            const dotClass = earliest.uid === 'user1' ? 'wrapped-pin-ant' : 'wrapped-pin-amy';
            node.innerHTML = `<div class="wrapped-stamp-crown">👑<i class="wrapped-stamp-dot ${dotClass}"
                title="${esc(stats.names[earliest.uid])} got here first"></i></div>
                <div>${esc(stamp.label)}</div>
                <div class="wrapped-stamp-when">${fmtDate(earliest.date)}</div>`;
            grid.append(node);
        });
        wrap.append(grid);
        if (stamps.length > 12) {
            wrap.append(el('div', 'wrapped-hint', `and ${stamps.length - 12} more`));
        }

        const firsts = {
            user1: stats.user1.milestones.filter((m) => m.first).length,
            user2: stats.user2.milestones.filter((m) => m.first).length
        };
        wrap.append(delay(el('div', 'wrapped-sub wrapped-rise',
            `<span class="wrapped-ant">${esc(stats.names.user1)}</span> got there first ${firsts.user1} ${firsts.user1 === 1 ? 'time' : 'times'},
             <span class="wrapped-amy">${esc(stats.names.user2)}</span> ${firsts.user2}.`), 900));
        return wrap;
    }
};

const AWARDS_SLIDE = {
    id: 'awards',
    duration: 8000,
    wash: ['#f59e0b', '#9333ea'],
    skip: (stats) => stats.both.total === 0,
    render(stats) {
        const wrap = el('div');
        wrap.append(el('div', 'wrapped-eyebrow wrapped-rise', 'Awards'));
        const cols = el('div', 'wrapped-cols');
        ['user1', 'user2'].forEach((uid) => {
            const colour = uid === 'user1' ? 'wrapped-ant' : 'wrapped-amy';
            const col = el('div');
            col.append(el('div', `wrapped-col-head ${colour}`, esc(stats.names[uid])));
            stats.awards[uid].forEach((award, i) => {
                const node = el('div', 'wrapped-award',
                    `<span class="wrapped-award-emoji">${award.emoji}</span>
                     <span><span class="wrapped-award-label">${esc(award.label)}</span>
                     <span class="wrapped-award-detail">${esc(award.detail)}</span></span>`);
                node.style.animationDelay = `${250 + i * 180}ms`;
                col.append(node);
            });
            cols.append(col);
        });
        wrap.append(cols);
        return wrap;
    }
};

// Each month gets its own colour pair, so twelve chapters don't blur into one.
const MONTH_WASHES = [
    ['#f59e0b', '#9333ea'], ['#6366f1', '#22c55e'], ['#0ea5e9', '#a855f7'],
    ['#22c55e', '#0ea5e9'], ['#ec4899', '#6366f1'], ['#22c55e', '#f59e0b'],
    ['#a855f7', '#22c55e'], ['#0ea5e9', '#22c55e'], ['#f59e0b', '#ec4899'],
    ['#22c55e', '#9333ea'], ['#0ea5e9', '#f59e0b'], ['#9333ea', '#22c55e']
];

// A month chapter. Quiet months go past quickly by design; a month with photos,
// a milestone or a trip in it earns a little longer on screen.
export function monthSlide(month) {
    let duration = 5000;
    if (month.photos.length) duration += 2000;
    if (month.milestones.length || month.trips.length) duration += 1000;

    return {
        id: `month-${month.index}`,
        duration: Math.min(duration, 9000),
        wash: MONTH_WASHES[month.index % MONTH_WASHES.length],
        // A month neither of them walked in is a dead slide, so it doesn't get one.
        skip: () => month.isEmpty,
        images: () => month.photos.map((p) => p.photoUrl).filter(Boolean),
        render(stats) {
            const colourOf = (uid) => (uid === 'user1' ? 'wrapped-ant' : 'wrapped-amy');
            const space = month.label.lastIndexOf(' ');
            const monthName = month.label.slice(0, space);
            const yearName = month.label.slice(space + 1);

            const wrap = el('div');
            wrap.append(el('div', 'wrapped-month-name wrapped-rise',
                `${esc(monthName)}<span class="wrapped-month-year">${esc(yearName)}</span>`));

            const t = month.totals;
            const sum = t.user1 + t.user2;
            const pct1 = sum ? (t.user1 / sum) * 100 : 50;
            wrap.append(delay(el('div', 'wrapped-rise', `
                <div class="wrapped-bar">
                    <span class="wrapped-bar-ant" style="width:${pct1}%"></span>
                    <span class="wrapped-bar-amy" style="width:${100 - pct1}%"></span>
                </div>
                <div class="wrapped-bar-labels">
                    <span class="wrapped-ant">${esc(stats.names.user1)} ${fmt(t.user1)}${month.winner === 'user1' ? ' 👑' : ''}</span>
                    <span class="wrapped-amy">${month.winner === 'user2' ? '👑 ' : ''}${esc(stats.names.user2)} ${fmt(t.user2)}</span>
                </div>`), 150));

            if (month.bestDay) {
                wrap.append(delay(el('div', 'wrapped-sub wrapped-rise',
                    `Best day &middot; <strong class="${colourOf(month.bestDay.uid)}">${esc(stats.names[month.bestDay.uid])}</strong>
                     &middot; ${fmt(month.bestDay.steps)} &middot; ${fmtDayShort(month.bestDay.date)}`), 300));
            }

            if (month.photos.length) {
                const row = el('div', 'wrapped-polaroids');
                const width = month.photos.length === 1 ? 190 : month.photos.length === 2 ? 152 : 118;
                month.photos.forEach((log, i) => {
                    const card = el('div', 'wrapped-polaroid');
                    card.style.setProperty('--rot', `${seedRotation(log.id)}deg`);
                    card.style.width = `${width}px`;
                    card.style.zIndex = String(10 + i);
                    card.style.animationDelay = `${500 + i * 150}ms`;
                    const img = el('img');
                    img.src = log.photoUrl;
                    img.alt = '';
                    const place = log.locationName ? String(log.locationName).split(',')[0].trim() : '';
                    card.append(img, el('div', 'wrapped-cap',
                        `${fmtDayShort(log.date)} &middot; ${esc(stats.names[log.userId])}${place ? ` &middot; ${esc(place)}` : ''}`));
                    row.append(card);
                });
                wrap.append(row);
            }

            const callouts = delay(el('div', 'wrapped-callouts wrapped-rise'), 650);
            month.milestones.forEach((m) => {
                callouts.append(el('div', 'wrapped-note',
                    `<span>${esc(m.label)}</span><em>${esc(stats.names[m.uid])} &middot; ${fmtDate(m.date)}</em>`));
            });
            month.trips.slice(0, 2).forEach((trip) => {
                callouts.append(el('div', 'wrapped-note',
                    `<span>✈️ ${esc(trip.name)}</span><em>${fmt(trip.km)} km from home</em>`));
            });
            if (callouts.childElementCount) wrap.append(callouts);

            if (month.quote) {
                wrap.append(delay(el('div', 'wrapped-quote wrapped-rise',
                    `&ldquo;${esc(month.quote.text)}&rdquo;
                     <span class="wrapped-quote-who">${esc(stats.names[month.quote.uid])}, ${fmtDayShort(month.quote.date)}</span>`), 800));
            }

            return wrap;
        }
    };
}

// The running order. Twelve month chapters are the spine of it.
export function buildSlides(stats) {
    return [
        COVER_SLIDE,
        BIG_NUMBER_SLIDE,
        ...stats.months.map((m) => monthSlide(m)),
        RACE_SLIDE,
        BEST_DAYS_SLIDE,
        HABITS_SLIDE,
        PLACES_SLIDE,
        FURTHEST_SLIDE,
        PASSPORT_SLIDE,
        AWARDS_SLIDE,
        FINALE_SLIDE
    ];
}

/**
 * Mount and run the show.
 * @param {object} stats  from computeWrapped()
 * @param {object} opts   { onClose({ index, finished }), onRecap(), slides, reducedMotion }
 * @returns {function} a close handle, in case the caller needs to dismiss it
 */
export function openWrapped(stats, opts = {}) {
    const reduced = opts.reducedMotion != null
        ? opts.reducedMotion
        : (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const list = (opts.slides || buildSlides(stats)).filter((s) => !s.skip || !s.skip(stats));
    if (!list.length) return () => {};

    const overlay = el('div', 'wrapped-overlay');
    // The stylesheet can see the media query but not an explicit reducedMotion
    // option, so tell it which decision was actually made.
    if (reduced) overlay.classList.add('wrapped-reduced');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${yearWord(stats.year)} Wrapped`);

    const progress = el('div', 'wrapped-progress');
    const segs = list.map(() => {
        const seg = el('div', 'wrapped-seg');
        seg.append(el('i'));
        progress.append(seg);
        return seg;
    });

    const closeBtn = el('button', 'wrapped-close', '&times;');
    closeBtn.setAttribute('aria-label', 'Close');
    const stage = el('div', 'wrapped-stage');
    overlay.append(progress, closeBtn, stage);

    let index = -1;
    let finished = false;
    let paused = false;
    let current = null;
    let generation = 0;
    let holdTimer = null;
    let heldOpen = false;

    function clearSlide() {
        if (!current) return;
        if (typeof current._cleanup === 'function') current._cleanup();
        current.remove();
        current = null;
    }

    function preloadFrom(i) {
        for (let k = i; k < Math.min(i + 3, list.length); k++) {
            const urls = list[k].images ? list[k].images(stats) || [] : [];
            urls.forEach((u) => { if (u) { const img = new Image(); img.src = u; } });
        }
    }

    function show(i) {
        if (i < 0 || i >= list.length) return;
        const gen = ++generation;
        index = i;
        const def = list[i];
        if (def.isLast) finished = true;

        clearSlide();
        const node = el('div', 'wrapped-slide');
        if (def.wash) {
            node.style.setProperty('--wash-a', def.wash[0]);
            node.style.setProperty('--wash-b', def.wash[1]);
        }
        const ctx = { reduced, next, back, close: () => close(), replay, recap };
        const body = def.render(stats, ctx);
        if (typeof body._cleanup === 'function') node._cleanup = body._cleanup;
        node.append(body);
        stage.append(node);
        // One frame before the class lands, so the fade actually runs.
        requestAnimationFrame(() => node.classList.add('is-active'));
        current = node;

        // Reduced motion means no auto-advance at all: the show waits to be tapped.
        const autoAdvance = !reduced && Number.isFinite(def.duration) && def.duration > 0;

        segs.forEach((seg, k) => {
            const bar = seg.firstElementChild;
            seg.classList.remove('is-done', 'is-running');
            bar.style.animation = 'none';
            bar.style.animationPlayState = '';
            void bar.offsetHeight; // cancel the old animation before starting a new one
            if (k < i || (k === i && !autoAdvance)) seg.classList.add('is-done');
        });

        if (autoAdvance) {
            const bar = segs[i].firstElementChild;
            bar.style.animation = '';
            bar.style.animationDuration = `${def.duration}ms`;
            segs[i].classList.add('is-running');
            bar.addEventListener('animationend', () => {
                // A stale timer from a slide already tapped past must not advance.
                if (gen === generation && !paused) next();
            }, { once: true });
        }

        preloadFrom(i + 1);
    }

    function next() { if (index < list.length - 1) show(index + 1); }
    function back() { if (index > 0) show(index - 1); }
    function replay() { finished = false; show(0); }
    function recap() { close(); if (typeof opts.onRecap === 'function') opts.onRecap(); }

    function setPaused(on) {
        paused = on;
        segs.forEach((seg) => {
            seg.firstElementChild.style.animationPlayState = on ? 'paused' : '';
        });
    }

    function close() {
        clearSlide();
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        document.body.classList.remove('wrapped-lock');
        if (typeof opts.onClose === 'function') opts.onClose({ index, finished });
    }

    // Press and hold pauses; a quick tap navigates. Left third goes back, the
    // rest goes on — the convention everyone already has in their thumbs.
    overlay.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        heldOpen = false;
        holdTimer = setTimeout(() => { heldOpen = true; setPaused(true); }, 220);
    });
    const endPress = (e) => {
        if (e.target.closest('button')) return;
        clearTimeout(holdTimer);
        if (heldOpen) { heldOpen = false; setPaused(false); return; }
        const x = e.clientX != null ? e.clientX : 0;
        if (x < overlay.clientWidth / 3) back(); else next();
    };
    overlay.addEventListener('pointerup', endPress);
    overlay.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (heldOpen) { heldOpen = false; setPaused(false); } });

    closeBtn.addEventListener('click', close);

    function onKey(e) {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowRight') { next(); return; }
        if (e.key === 'ArrowLeft') { back(); return; }
        if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setPaused(!paused); }
    }
    document.addEventListener('keydown', onKey);

    document.body.classList.add('wrapped-lock');
    document.body.append(overlay);
    show(0);

    return close;
}

// ---------------------------------------------------------------------------
// The recap — the part of the year that stays on the page
// ---------------------------------------------------------------------------
// Built from the same stats object the show is, so the two can't disagree.

const HEAT_ANT = '34, 197, 94';
const HEAT_AMY = '168, 85, 247';

function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[i];
}

// A whole year at a glance: twelve rows, one per month, thirty-one columns.
// GitHub's 53-column layout does not fit a portrait phone, and this one does.
export function yearHeatmapHtml(stats) {
    const days = stats.race.days;
    if (!days.length) return '';

    // One 40,000-step day would otherwise wash out the whole year, so the scale
    // tops out at the 95th percentile rather than the maximum.
    const all = [];
    days.forEach((d) => {
        if (d.day.user1 > 0) all.push(d.day.user1);
        if (d.day.user2 > 0) all.push(d.day.user2);
    });
    const cap = Math.max(1, percentile(all, 95));

    const byMonth = new Map();
    days.forEach((d) => {
        const mi = (d.date.getMonth() - 9 + 12) % 12;
        if (!byMonth.has(mi)) byMonth.set(mi, []);
        byMonth.get(mi).push(d);
    });

    const grid = (uid, rgb) => {
        let html = '<div class="recap-heat">';
        stats.months.forEach((month, mi) => {
            const rows = byMonth.get(mi) || [];
            html += `<div class="recap-heat-label">${esc(month.label.slice(0, 3))}</div>`;
            for (let dayNum = 1; dayNum <= 31; dayNum++) {
                const entry = rows.find((r) => r.date.getDate() === dayNum);
                if (!entry) { html += '<div class="recap-heat-cell is-void"></div>'; continue; }
                const steps = entry.day[uid];
                const intensity = steps > 0 ? Math.max(0.16, Math.min(1, steps / cap)) : 0;
                const bg = steps > 0 ? `rgba(${rgb}, ${intensity.toFixed(2)})` : '';
                html += `<div class="recap-heat-cell" style="${bg ? `background:${bg}` : ''}"
                    data-steps="${steps}" data-who="${esc(stats.names[uid])}"
                    data-when="${esc(entry.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}"></div>`;
            }
        });
        return html + '</div>';
    };

    return `
        <div class="recap-heat-block">
            <p class="recap-heat-name" style="color:#15803d">${esc(stats.names.user1)}</p>
            ${grid('user1', HEAT_ANT)}
        </div>
        <div class="recap-heat-block">
            <p class="recap-heat-name" style="color:#7e22ce">${esc(stats.names.user2)}</p>
            ${grid('user2', HEAT_AMY)}
        </div>
        <p class="recap-heat-readout" data-readout>Tap a day</p>`;
}

/** The recap section's markup. Pure — no DOM, so it can be checked in node. */
export function recapHtml(stats) {
    const medals = ['🥇', '🥈', '🥉'];
    const crown = (uid) => (stats.race.winner === uid ? ' 👑' : '');

    const tiles = `
        <div class="recap-tiles">
            <div class="recap-tile">
                <span class="recap-tile-value">${fmt(stats.both.total)}</span>
                <span class="recap-tile-label">steps together</span>
            </div>
            <div class="recap-tile">
                <span class="recap-tile-value" style="color:#15803d">${fmt(stats.user1.total)}${crown('user1')}</span>
                <span class="recap-tile-label">${esc(stats.names.user1)}</span>
            </div>
            <div class="recap-tile">
                <span class="recap-tile-value" style="color:#7e22ce">${fmt(stats.user2.total)}${crown('user2')}</span>
                <span class="recap-tile-label">${esc(stats.names.user2)}</span>
            </div>
            <div class="recap-tile">
                <span class="recap-tile-value">${fmt(stats.both.km)}</span>
                <span class="recap-tile-label">km between you</span>
            </div>
        </div>`;

    const bestDays = ['user1', 'user2'].map((uid) => `
        <div>
            <p class="recap-sub-name" style="color:${uid === 'user1' ? '#15803d' : '#7e22ce'}">${esc(stats.names[uid])}</p>
            ${stats[uid].bestDays.length
                ? stats[uid].bestDays.map((b, i) =>
                    `<p class="recap-line">${medals[i]} <strong>${fmt(b.steps)}</strong>
                     <span class="recap-dim">${fmtDayMonth(b.date)}</span></p>`).join('')
                : '<p class="recap-line recap-dim">Nothing logged</p>'}
        </div>`).join('');

    const habits = ['user1', 'user2'].map((uid) => {
        const u = stats[uid];
        return `
        <div>
            <p class="recap-sub-name" style="color:${uid === 'user1' ? '#15803d' : '#7e22ce'}">${esc(stats.names[uid])}</p>
            <p class="recap-line">${u.longest10kStreak.days > 0
                ? `<strong>${u.longest10kStreak.days}</strong> days straight over 10k`
                : 'No run over 10k'}</p>
            <p class="recap-line"><strong>${fmt(u.daysLogged)}</strong> of ${stats.daysInYear} days logged</p>
            ${u.bestWeekday ? `<p class="recap-line"><strong>${esc(u.bestWeekday.name)}s</strong> are the big day</p>` : ''}
        </div>`;
    }).join('');

    const trips = stats.both.places.filter((p) => p.isTrip);
    const places = stats.both.places.length ? `
        <h4 class="recap-h">Places</h4>
        <p class="recap-line"><strong>${stats.both.places.length}</strong> places${stats.both.countries.length > 1 ? ` in <strong>${stats.both.countries.length}</strong> countries` : ''}</p>
        ${trips.length ? `<p class="recap-line">Furthest: <strong>${esc(trips[0].name)}</strong> <span class="recap-dim">${fmt(trips[0].km)} km from Wrexham</span></p>` : ''}
        ${trips.length > 1 ? `<p class="recap-line recap-dim">Also ${trips.slice(1, 4).map((t) => esc(t.name)).join(', ')}</p>` : ''}` : '';

    const stampCount = new Set([...stats.user1.milestones, ...stats.user2.milestones].map((m) => m.steps)).size;
    const stamps = stampCount ? `
        <h4 class="recap-h">Stamps this year</h4>
        <p class="recap-line"><strong>${stampCount}</strong> places reached ·
           ${esc(stats.names.user1)} first ${stats.user1.milestones.filter((m) => m.first).length}×,
           ${esc(stats.names.user2)} first ${stats.user2.milestones.filter((m) => m.first).length}×</p>` : '';

    const awards = `
        <h4 class="recap-h">Awards</h4>
        <div class="recap-two">
            ${['user1', 'user2'].map((uid) => `
                <div>
                    <p class="recap-sub-name" style="color:${uid === 'user1' ? '#15803d' : '#7e22ce'}">${esc(stats.names[uid])}</p>
                    ${stats.awards[uid].map((a) => `<p class="recap-line">${a.emoji} <strong>${esc(a.label)}</strong><br><span class="recap-dim">${esc(a.detail)}</span></p>`).join('')}
                </div>`).join('')}
        </div>`;

    return `
        <button type="button" class="recap-play">▶ Play ${esc(yearWord(stats.year))} Wrapped</button>
        ${tiles}
        <div class="recap-more" hidden>
            <h4 class="recap-h">The year, day by day</h4>
            ${yearHeatmapHtml(stats)}

            <h4 class="recap-h">The race · ${esc(raceTitle(stats))}</h4>
            <div class="recap-race">${raceSvg(stats, { height: 150 })}</div>
            <p class="recap-line">${raceSummary(stats).join('<br>')}</p>

            <h4 class="recap-h">Best days</h4>
            <div class="recap-two">${bestDays}</div>

            <h4 class="recap-h">The habit</h4>
            <div class="recap-two">${habits}</div>

            ${places}
            ${stamps}
            ${awards}
        </div>
        <button type="button" class="recap-toggle">Show more ▼</button>
        <p class="recap-foot">Figures are live — a walk logged late still lands in the year it belongs to.</p>`;
}

/** Render the recap into a host element and wire its three interactions. */
export function mountRecap(host, stats, { onPlay } = {}) {
    host.innerHTML = recapHtml(stats);
    host.classList.add('recap');

    const play = host.querySelector('.recap-play');
    if (play && typeof onPlay === 'function') play.addEventListener('click', () => onPlay(stats.year));

    const more = host.querySelector('.recap-more');
    const toggle = host.querySelector('.recap-toggle');
    if (more && toggle) {
        toggle.addEventListener('click', () => {
            const open = !more.hidden;
            more.hidden = open;
            toggle.textContent = open ? 'Show more ▼' : 'Show less ▲';
        });
    }

    // Same one-line readout the month heatmap on the main page uses — there is no
    // room for a number in a cell this small.
    const readout = host.querySelector('[data-readout]');
    if (readout) {
        host.addEventListener('click', (e) => {
            const cell = e.target.closest('.recap-heat-cell');
            if (!cell || !cell.dataset.when) return;
            const steps = Number(cell.dataset.steps) || 0;
            readout.textContent = `${cell.dataset.who} · ${cell.dataset.when} · ${steps > 0 ? `${fmt(steps)} steps` : 'no steps'}`;
        });
    }
    return host;
}
