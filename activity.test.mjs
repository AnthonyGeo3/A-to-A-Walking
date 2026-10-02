// Tests for exercise days.   node --test activity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES, activityFor, logActivities, describe, activityDays, activitySummary, monthActivities,
         periodStarts, anyExercise, exerciseFromPicker, otherLabelsOn } from './activity.js';

const D = (y, m, d, hh = 21) => new Date(y, m - 1, d, hh, 0);
const log = (userId, date, exercise, extra = {}) => ({ id: Math.random().toString(36), userId, steps: 9000, date, ...(exercise ? { exercise } : {}), ...extra });
// A Firestore-style Timestamp, which is what the app actually holds.
const ts = (d) => ({ toDate: () => d, toMillis: () => d.getTime() });

test('the activity list', () => {
    assert.deepEqual(ACTIVITIES.map((a) => a.id), ['running', 'badminton', 'cycling', 'pilates', 'dancing', 'walk', 'other']);
    assert.equal(activityFor('walk').label, 'Long walk');
    assert.equal(activityFor('running').emoji, '🏃');
    assert.equal(activityFor('swimming').id, 'other', 'an unknown id shows as Other');
});

test('a log without the field is no exercise at all', () => {
    assert.deepEqual(logActivities({ steps: 9000 }), []);
    assert.deepEqual(logActivities({ exercise: [] }), []);
    assert.deepEqual(logActivities({ exercise: ['running', 'running', 'badminton'] }), ['running', 'badminton']);
    assert.deepEqual(logActivities({ exercise: ['swimming', 'other'] }), ['other']);
});

test('two exercise logs on one day are one day', () => {
    const logs = [log('user1', D(2026, 10, 5, 21), ['other', 'badminton']), log('user1', D(2026, 10, 5, 9), ['running'])];
    const days = activityDays(logs, 'user1');
    assert.equal(days.size, 1);
    assert.deepEqual(days.get('2026-10-05'), ['running', 'badminton', 'other'], 'in the list order, whichever log came first');
});

test('it only counts the person asked about', () => {
    const logs = [log('user1', D(2026, 10, 5), ['running']), log('user2', D(2026, 10, 6), ['pilates'])];
    assert.deepEqual([...activityDays(logs, 'user2').keys()], ['2026-10-06']);
});

test('Firestore Timestamps work as well as Dates', () => {
    const logs = [log('user1', ts(D(2026, 10, 5)), ['running'])];
    assert.equal(activityDays(logs, 'user1').size, 1);
});

test('weeks start on Monday, like the head-to-head bar', () => {
    // Wednesday 14 October 2026.
    const { week, month } = periodStarts(D(2026, 10, 14, 12));
    assert.equal(week.getDay(), 1);
    assert.equal(week.getDate(), 12);
    assert.equal(month.getDate(), 1);
});

test('the summary counts exercises in the week, month and challenge year', () => {
    const now = D(2026, 10, 14, 22); // Wed
    const logs = [
        log('user1', D(2026, 9, 28), ['running']),   // last challenge year
        log('user1', D(2026, 10, 2), ['running']),   // this month, last week
        log('user1', D(2026, 10, 12), ['badminton']),// this week (Mon)
        log('user1', D(2026, 10, 14), ['badminton', 'running']), // today: two exercises
        log('user1', D(2026, 10, 14, 8), ['running']),           // a second run today is still one
        log('user1', D(2026, 10, 13)),               // a rest day
    ];
    const s = activitySummary(logs, 'user1', now);
    assert.equal(s.week, 3, 'Monday badminton, and badminton and a run today');
    assert.equal(s.month, 4);
    assert.equal(s.year, 4, 'September belongs to Year 1');
});

test('each activity counted for a month, most-done first', () => {
    const logs = [
        log('user1', D(2026, 9, 30), ['running']),   // September: not October
        log('user1', D(2026, 10, 2), ['running']),
        log('user1', D(2026, 10, 12), ['badminton']),
        log('user1', D(2026, 10, 14), ['badminton', 'walk']),
        log('user1', D(2026, 11, 1), ['running'])    // November: not October
    ];
    assert.deepEqual(monthActivities(logs, 'user1', 2026, 9).map((a) => [a.id, a.count]), [['badminton', 2], ['running', 1], ['walk', 1]]);
    assert.deepEqual(monthActivities(logs, 'user1', 2026, 8).map((a) => [a.id, a.count]), [['running', 1]]);
    assert.deepEqual(monthActivities(logs, 'user2', 2026, 9), []);
});

test('a week that started in the old year only counts from 1 October', () => {
    // Fri 2 Oct 2026; the week began Mon 28 Sep, in Year 1.
    const logs = [log('user1', D(2026, 9, 29), ['running']), log('user1', D(2026, 10, 1), ['running'])];
    const s = activitySummary(logs, 'user1', D(2026, 10, 2, 22));
    assert.equal(s.week, 1);
    assert.equal(s.year, 1);
});

test('future-dated logs are not counted yet', () => {
    const logs = [log('user1', D(2026, 10, 20), ['running'])];
    assert.equal(activitySummary(logs, 'user1', D(2026, 10, 14, 22)).year, 0);
});

test('the card only appears once someone has ticked exercise', () => {
    assert.equal(anyExercise([log('user1', D(2026, 10, 1))]), false);
    assert.equal(anyExercise([log('user1', D(2026, 10, 1), ['pilates'])]), true);
});

test('what the picker saves', () => {
    assert.equal(exerciseFromPicker(false, ['running']), null, 'pill off: no field at all');
    assert.deepEqual(exerciseFromPicker(true, []), { exercise: ['other'] }, 'pill on, nothing chosen: still counts');
    assert.deepEqual(exerciseFromPicker(true, ['running', 'badminton']), { exercise: ['running', 'badminton'] });
    assert.deepEqual(exerciseFromPicker(true, ['other'], '  Climbing '), { exercise: ['other'], exerciseOther: 'Climbing' });
    assert.deepEqual(exerciseFromPicker(true, ['running'], 'Climbing'), { exercise: ['running'] }, 'a name only goes with Other');
    assert.equal(exerciseFromPicker(true, ['other'], 'x'.repeat(80)).exerciseOther.length, 30);
});

test('describing a day', () => {
    assert.equal(describe(['running', 'badminton']), 'Running · Badminton');
    assert.equal(describe(['running', 'other'], 'Climbing'), 'Running · Climbing');
    const logs = [log('user2', D(2026, 10, 5), ['other'], { exerciseOther: 'Climbing' })];
    assert.deepEqual(otherLabelsOn(logs, 'user2', D(2026, 10, 5, 8)), ['Climbing']);
});
