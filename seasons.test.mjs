// Tests for the seasons.   node --test seasons.test.mjs
//
// The season logic lives in a <script> in index.html's <head>, so it can run
// before anything paints. These tests run that exact script, pulled out of the
// page, so there is no second copy to drift out of step with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const src = html.match(/<script id="season-script">([\s\S]*?)<\/script>/)[1];

function run(now, search = '') {
    const root = { dataset: {} };
    const RealDate = Date;
    const FakeDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now.getTime()])); } };
    const window = {};
    vm.runInNewContext(src, {
        window, document: { documentElement: root }, location: { search },
        URLSearchParams, Date: FakeDate
    });
    return { root, api: window.A2A_SEASON };
}
const D = (y, m, d) => new Date(y, m - 1, d, 12);

test('the four seasons, by UK meteorological months', () => {
    const { api } = run(D(2026, 10, 2));
    const expect = { 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring', 6: 'summer', 7: 'summer', 8: 'summer',
                     9: 'autumn', 10: 'autumn', 11: 'autumn', 12: 'winter' };
    for (let m = 1; m <= 12; m++) assert.equal(api.seasonFor(D(2026, m, 15)), expect[m], `month ${m}`);
});

test('the boundary days', () => {
    const { api } = run(D(2026, 10, 2));
    assert.equal(api.seasonFor(D(2026, 11, 30)), 'autumn');
    assert.equal(api.seasonFor(D(2026, 12, 1)), 'winter');
    assert.equal(api.seasonFor(D(2027, 2, 28)), 'winter');
    assert.equal(api.seasonFor(D(2027, 3, 1)), 'spring');
    assert.equal(api.seasonFor(D(2028, 2, 29)), 'winter', 'leap day');
    assert.equal(api.seasonFor(new Date(2026, 8, 1, 0, 0)), 'autumn', 'first minute of September');
});

test('the anniversary is 26 October, that day only', () => {
    const { api } = run(D(2026, 10, 2));
    assert.equal(api.momentFor(D(2026, 10, 25)), null);
    assert.equal(api.momentFor(D(2026, 10, 26)), 'anniversary');
    assert.equal(api.momentFor(D(2026, 10, 27)), null);
    assert.equal(api.momentFor(D(2031, 10, 26)), 'anniversary', 'every year');
});

test('Christmas runs 1–26 December', () => {
    const { api } = run(D(2026, 10, 2));
    assert.equal(api.momentFor(D(2026, 11, 30)), null);
    assert.equal(api.momentFor(D(2026, 12, 1)), 'christmas');
    assert.equal(api.momentFor(D(2026, 12, 25)), 'christmas');
    assert.equal(api.momentFor(D(2026, 12, 26)), 'christmas');
    assert.equal(api.momentFor(D(2026, 12, 27)), null);
});

test('only two moments for now', () => {
    const { api } = run(D(2026, 10, 2));
    assert.equal(JSON.stringify(api.MOMENTS.map((m) => m.id)), '["anniversary","christmas"]');
    let days = 0;
    for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) if (api.momentFor(d)) days++;
    assert.equal(days, 27, '26 days of Christmas and one anniversary');
});

test('it marks the page on load', () => {
    assert.deepEqual(run(D(2026, 10, 2)).root.dataset, { season: 'autumn' });
    assert.deepEqual(run(D(2026, 10, 26)).root.dataset, { season: 'autumn', moment: 'anniversary' });
    assert.deepEqual(run(D(2026, 12, 20)).root.dataset, { season: 'winter', moment: 'christmas' });
});

test('the preview flags override the date', () => {
    assert.equal(run(D(2026, 10, 2), '?season=spring').root.dataset.season, 'spring');
    assert.equal(run(D(2026, 10, 2), '?moment=christmas').root.dataset.moment, 'christmas');
    assert.equal(run(D(2026, 10, 26), '?moment=').root.dataset.moment, undefined, 'an empty flag switches the moment off');
});
