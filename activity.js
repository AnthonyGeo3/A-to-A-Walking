// Exercise — the runs, badminton, pilates, dancing and long walks alongside the
// steps.
//
// Pure: no DOM, no Firebase. A log carries an optional `exercise` list of
// activity ids (and `exerciseOther` when one of them is 'other'). Nothing here
// adds steps or scores anything. It counts exercises: a run and a game of
// badminton on the same day are two. The same activity logged twice in a day
// is still one.

import { challengeYearStart, challengeYearAt } from './wrapped.js';

// The one place to add an activity. Ids are stored on logs, so never rename one.
export const ACTIVITIES = [
    { id: 'running',   emoji: '🏃', label: 'Running' },
    { id: 'badminton', emoji: '🏸', label: 'Badminton' },
    { id: 'cycling',   emoji: '🚴', label: 'Cycling' },
    { id: 'pilates',   emoji: '🧘', label: 'Pilates' },
    { id: 'dancing',   emoji: '💃', label: 'Dancing' },
    // An hour or more out walking, on purpose, rather than the steps of a day.
    { id: 'walk',      emoji: '🥾', label: 'Long walk' },
    { id: 'other',     emoji: '✨', label: 'Other' }
];
const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));
const OTHER = BY_ID.get('other');

/**
 * The activity for an id. An id this copy of the app doesn't know — one added
 * later and read by an older cached app — shows as Other rather than breaking.
 */
export const activityFor = (id) => BY_ID.get(id) || OTHER;

// Firestore hands back Timestamps; tests and the Wrapped engine hand over Dates.
const toDate = (d) => (d && typeof d.toDate === 'function' ? d.toDate() : d);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The activity ids on one log, de-duplicated, unknown ones folded into 'other'. */
export function logActivities(log) {
    if (!log || !Array.isArray(log.exercise)) return [];
    const out = [];
    log.exercise.forEach((id) => {
        const a = activityFor(id).id;
        if (!out.includes(a)) out.push(a);
    });
    return out;
}

/** A short label for one log's exercise, e.g. "Running · Climbing". */
export function describe(ids, otherLabel) {
    return ids.map((id) => {
        const a = activityFor(id);
        return a.id === 'other' && otherLabel ? String(otherLabel) : a.label;
    }).join(' · ');
}

/**
 * Day key → list of activity ids, for one person, between `from` (inclusive)
 * and `to` (exclusive). Two logs on the same day are one day.
 */
export function activityDays(logs, uid, from = null, to = null) {
    const days = new Map();
    (logs || []).forEach((l) => {
        if (l.userId !== uid) return;
        const ids = logActivities(l);
        if (!ids.length) return;
        const d = toDate(l.date);
        if (!d) return;
        if (from && d < from) return;
        if (to && d >= to) return;
        const k = dayKey(d);
        const list = days.get(k) || [];
        ids.forEach((id) => { if (!list.includes(id)) list.push(id); });
        // Always in the list's order, whichever log of the day came first.
        list.sort((x, y) => ACTIVITIES.indexOf(BY_ID.get(x)) - ACTIVITIES.indexOf(BY_ID.get(y)));
        days.set(k, list);
    });
    return days;
}

/** The "other" names someone typed for a given day, if any. */
export function otherLabelsOn(logs, uid, date) {
    const k = dayKey(date);
    return (logs || [])
        .filter((l) => l.userId === uid && l.exerciseOther && toDate(l.date) && dayKey(toDate(l.date)) === k)
        .map((l) => String(l.exerciseOther));
}

/** Where this week, this month and this challenge year started, as of `now`. */
export function periodStarts(now = new Date()) {
    const today = startOfDay(now);
    // Monday-start weeks, matching the weekly head-to-head bar.
    const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    const year = challengeYearStart(challengeYearAt(today));
    return { week, month, year };
}

// Counts of each activity over a set of days, most-done first. Ties keep the
// order of ACTIVITIES, so the list doesn't shuffle on re-render.
function tally(days) {
    const t = new Map();
    days.forEach((ids) => ids.forEach((id) => t.set(id, (t.get(id) || 0) + 1)));
    return [...t.entries()]
        .map(([id, count]) => ({ ...activityFor(id), count }))
        .sort((a, b) => b.count - a.count || ACTIVITIES.indexOf(BY_ID.get(a.id)) - ACTIVITIES.indexOf(BY_ID.get(b.id)));
}
const exercises = (days) => [...days.values()].reduce((n, ids) => n + ids.length, 0);

/**
 * The Active days card for one person: how many exercises this week, this
 * month and this challenge year so far.
 */
export function activitySummary(logs, uid, now = new Date()) {
    const { week, month, year } = periodStarts(now);
    const end = new Date(startOfDay(now).getTime() + 86400000);
    const since = (from) => activityDays(logs, uid, from < year ? year : from, end);
    return { week: exercises(since(week)), month: exercises(since(month)), year: exercises(since(year)) };
}

/** Each activity's count in one calendar month (month 0–11), most-done first. */
export function monthActivities(logs, uid, y, m) {
    return tally(activityDays(logs, uid, new Date(y, m, 1), new Date(y, m + 1, 1)));
}

/** Has anyone ever ticked exercise? The card stays out of the way until then. */
export const anyExercise = (logs) => (logs || []).some((l) => logActivities(l).length > 0);

/**
 * What to save from a picker: the pill on with nothing chosen still counts, as
 * Other. Returns null when the pill is off, so the log gets no field at all.
 */
export function exerciseFromPicker(on, chosen, otherText) {
    if (!on) return null;
    const ids = (chosen || []).filter((id) => BY_ID.has(id));
    const list = ids.length ? ids : ['other'];
    const label = String(otherText || '').trim().slice(0, 30);
    return list.includes('other') && label ? { exercise: list, exerciseOther: label } : { exercise: list };
}
