# Year 2 Features Plan — build from 2 October 2026

Four additions. None of them takes anything away, changes how steps are
counted, or touches Year 1's data.

| | Feature | What it is | Size |
|---|---|---|---|
| A | **Exercise days** | A tick when you log, a stamp on the day, a small count of active days | Medium |
| B | **Seasons** | The app's look shifts gently through the year. No sound | Small |
| C | **Trip scrapbooks** | Every trip away becomes its own page automatically | Medium |
| D | **The world view** | A zoomed-out second view of the map, showing how far from home you've each walked | Large |

**Not doing** (decided): monthly mini-Wrappeds (it's the saving-up that makes
Wrapped work), reactions on each other's logs, weekly forfeits, sound
effects, push notifications, more badges.

---

## 0. Ground rules

1. **Nothing ships before 1 October.** The Year One Wrapped surprise comes
   first. Start building on the 2nd.
2. **One feature per PR, merged to `main`.** Every PR bumps `CACHE_NAME` in
   `sw.js`: `index.html` is served cache-first, so without a bump the phones
   keep the old app.
3. **No data migration.** Only new, optional fields are added to logs. A log
   without them behaves exactly as it does today. Year 1 stays untouched.
4. **Pure logic lives in modules with node tests**, following the pattern of
   `wrapped.js` and `wrapped.test.mjs`: no DOM or Firebase inside the logic, so
   it can be tested outside the browser.
5. **Commit the browser tests this time.** The Playwright scripts that tested
   Wrapped (about 15 scripts, ~350 checks) lived in a session scratchpad and
   were lost when the container was reset. Before feature A, rebuild the core
   of them under `tests/` in the repo:
   - `tests/fb-live.mjs`: the Firebase stub that actually stores logs, so a
     log added through the form fires the snapshot again.
   - `tests/boot.mjs`: a shared helper that boots `index.html` with the
     Firebase stub, a fake clock, and stubbed Tailwind, Leaflet and confetti.
   - `tests/README.md`: how to run them (`python3 -m http.server 8899` in the
     repo root, then `node tests/<name>.mjs`). The helper finds Chromium via
     `PLAYWRIGHT_BROWSERS_PATH`, falling back to `/opt/pw-browsers`.
   - Each feature below adds its own driver there.

   `sw.js` only caches an explicit file list, so a `tests/` folder costs
   nothing on the phones.
6. **Screenshot everything at 390px wide before calling it done.** Year 1
   had three layout bugs that looked fine in the DOM and broken on screen, and
   all three were caught only by screenshots.

---

## A. Exercise days

### What you see

**When logging.** Under the step input sits a small pill, **💪 Exercised**, off
by default. Tapping it opens a row of chips underneath:

`🏃 Running` `🏸 Badminton` `🚴 Cycling` `🧘 Pilates` `💃 Dancing` `✨ Other`

- You can pick more than one (badminton and a run on the same day).
- **Other** shows a small optional text box ("Climbing"). If you leave it
  blank it saves as plain "Other".
- If the pill is on and no chip is picked, it saves as "Other", so the tick
  still counts.
- After **Add**, the pill resets to off along with the rest of the form.
- The exercise belongs to the date in the date stepper, like the steps do.

**On the log entry.** The chosen emoji appear on the entry next to the date,
for example `12,403  30 Sep  🏃🏸`. For entries that already exist, a new 💪
button joins the photo, location, note and delete buttons and opens the same
chips in a modal. That is how you backfill Chester Zoo and the Couch to 5K
weeks.
- The action buttons are a 2×2 grid today. Five buttons fit as a 3×2 grid.
  Check at 390px that the entry text doesn't get squeezed; if it does, stack
  the buttons in a single column.

**On the heatmap calendar** (Stats section and Recap): a day where you
exercised gets a small dot in the bottom-right corner of its cell, in your
colour. If the view shows both of you and you both exercised, show two dots.
The cell's shading still means steps, and nothing else changes.
- Tapping a day adds a line to the existing readout, e.g. "🏃 Running ·
  🏸 Badminton".

**A small "Active days" card** in the Stats section, one row per person:

```
Ant   3 this week · 11 this month · 64 this year      🏸 30  🏃 22  🚴 12
Amy   2 this week ·  9 this month · 58 this year      🧘 26  🏃 22  💃 10
```

- These are plain counts of days. Write "3 this week", never "3/7": seven is
  not a target, and rest days are meant to happen.
- **No streaks, no red, no "you missed a day", no step bonus.** A day without
  exercise looks exactly like it does today.
- The breakdown shows each person's top three activities for the year.
- It follows the Stats filter (month / year / all) like the rest of the
  section does.

### Data

On the log document, both fields optional:

```js
exercise: ['running', 'badminton'],   // activity ids, in the order picked
exerciseOther: 'Climbing'             // only when 'other' is in the list
```

- Activity ids come from one constant, the single place to add a new one:
  ```js
  export const ACTIVITIES = [
    { id: 'running',   emoji: '🏃', label: 'Running' },
    { id: 'badminton', emoji: '🏸', label: 'Badminton' },
    { id: 'cycling',   emoji: '🚴', label: 'Cycling' },
    { id: 'pilates',   emoji: '🧘', label: 'Pilates' },
    { id: 'dancing',   emoji: '💃', label: 'Dancing' },
    { id: 'other',     emoji: '✨', label: 'Other' }
  ];
  ```
  An unknown id (say, one added later and read by an older cached app) shows
  as ✨ rather than breaking anything.
- **A day counts as active for a person if any of their logs that day has a
  non-empty `exercise`.** Two logs on the same day with exercise still count
  as one day.
- The write happens in the existing `runTransaction` in `handleStepSubmit`;
  the fields are simply added to the `t.set(...)` object. The edit modal uses
  `updateDoc` on the log, like the note and location edits already do.
- `stepAudit` / `auditStepTotals` compare steps only and need no change.

### Code

- **New `activity.js`**, pure: `ACTIVITIES`, `activeDays(logs, uid, from, to)`
  (returns a set of day keys), `activitySummary(logs, uid, from, to)` (returns
  `{ days, byActivity }`), and `dayActivities(logs, uid, dayKey)`.
- **`activity.test.mjs`**:
  - Two exercise logs on one day count as one day.
  - A log without the field counts as nothing.
  - Unknown ids fall back to Other.
  - Week boundaries match whatever the weekly rivalry bar already uses
    (check which day it starts on; don't assume).
  - Year boundaries follow the challenge year (1 Oct), not the calendar year.
- `index.html` gets the pill and chips in the form, the emoji on log entries,
  the 💪 edit button, the heatmap dots, and the Active days card.
- `wrapped.js` `yearHeatmapHtml` gets the same corner dots, so the Recap
  calendar and the Wrapped calendar slide show them.

### Tests (`tests/exercise.mjs`)

- Logging with the pill off saves no `exercise` field at all (not an empty
  array), so the new logs look like the old ones.
- Picking Running and Badminton saves both, and both emoji appear on the
  entry.
- The pill with no chip picked saves `['other']`.
- The pill resets after Add.
- Backfilling through the 💪 button on an old log updates the counts
  straight away.
- The heatmap dot is in the right person's colour, and there are two dots
  when both exercised.
- Counts: "this week" resets on the same day the weekly rivalry bar does; "this year" resets on 1 October.
- Screenshot the form with the chips open at 390px. It must not push the
  **Add** button off-screen on a small phone.

### Next year's Wrapped (note only, don't build yet)

The engine can already see these fields. Year Two Wrapped gets an "Active
days" slide (both calendars with the dots, and each person's top activity)
and awards like "Most badminton". List that in the Year 2 Wrapped plan when
it's written.

### Optional extra: race medals

You did the Chester Zoo 5K. When 🏃 Running is picked, a small **🏅 It was a
race** tick could take a race name and show a medal on the entry, with a
"Medals" line on the Active days card. Only build this if you want it after
using the basic version for a while. For now a note on the log covers it.

---

## B. Seasons

### What you see

The app shifts gently with the UK meteorological seasons. The Ant-green and
Amy-purple colours, the step numbers, the bars and the charts **never
change**. Only the backdrop does.

| Season | Months | Header wash | Motif |
|---|---|---|---|
| Autumn | Sep–Nov | warm amber → soft green | a few falling leaves 🍂 |
| Winter | Dec–Feb | cool blue-grey → lilac | snowflakes ❄️ |
| Spring | Mar–May | pale green → blossom pink | blossom 🌸 |
| Summer | Jun–Aug | warm cream → sky | a small sun ☀️ |

- **The header** (where "A to A Walking!" and "Est. Oct 25" sit) takes the
  season's gradient in place of today's fixed green-purple one, and gets a
  small inline-SVG motif in its corners: two or three leaves, not a pattern.
- **The page background** behind the white card takes a very faint tint of
  the season.
- **Once a day**, on the first open, a few motif pieces (6–10) drift down
  across the header only, over about four seconds, then stop. Not on every
  open, and never with `prefers-reduced-motion`.
- **Optional moments** as variants of the season: Christmas (1–26 Dec: a
  little warmer, with a sprig of holly) and your anniversary, if you give me
  the date. Keep the list short, or it starts to feel like a supermarket.
- **No sound.**

### Code

- New `season.js` exporting `seasonFor(date)`, which returns `'autumn'`,
  `'winter'`, `'spring'` or `'summer'`, plus `momentFor(date)`, which returns
  `null`, `'christmas'` or `'anniversary'`. Include tests on the boundary days
  (30 Nov / 1 Dec, 28 Feb / 1 Mar, leap years).
- Set it as early as possible, in a tiny inline script in `<head>`, so the
  page never flashes the wrong season:
  `document.documentElement.dataset.season = ...`
- Move the header's inline `style="background: linear-gradient(...)"` into a
  class (`.app-header`), then drive it from CSS variables per season:
  ```css
  :root[data-season="autumn"] { --season-a: #fef3c7; --season-b: #ecfdf5; --season-page: #fffbeb; }
  ```
- The motif is absolutely positioned with `pointer-events: none`. **The long
  press on "Est. Oct 25" that opens the Wrapped preview must keep working.**
- The drift animation plays once per day: store the date in `localStorage`
  (wrapped in try/catch, like the Wrapped "seen" flag).
- Add a preview flag, `?season=winter`, so every season can be checked without
  changing the clock.

### Tests (`tests/seasons.mjs`)

- Each of the 4 seasons and Christmas renders its colours (check the computed
  styles, not just the attribute).
- Header text contrast is at least 4.5:1 in every season.
- The long press still opens the preview in every season.
- The drift plays on the first open of a day and not on a second open that
  day, and never with reduced motion.
- Screenshot all five variants at 390px. Show them to Ant before merging,
  because this one is purely taste.

---

## C. Trip scrapbooks

### What you see

A new **✈️ Trips** section above **Log & Map**. It only appears if there has
been at least one trip.

- A horizontal row of cards, newest first. Each card has a cover photo, a
  title, dates, and one line, e.g. **Las Vegas** · 3–9 Apr 2026 ·
  6 days · 98,400 steps.
- Tapping a card opens a full-screen **trip page**:
  - Title, dates, the countries' flags.
  - Steps each, and together, over the trip.
  - **A Polaroid wall** of every photo either of you took on the trip, using
    the Polaroid style from Wrapped, with captions giving the place and the
    day. Tapping a photo opens the existing lightbox.
  - **Day by day**: each day's steps for both of you, plus any notes, and the
    exercise emoji once feature A exists.
  - **A small map** of just that trip: pins where you logged, fitted to the
    trip. It is created when the page opens and destroyed when it closes, so
    it never touches the main map.
  - **Furthest point**: "8,142 km from Wrexham".
  - A ✏️ on the title to rename it ("Vegas wedding").
- Paris, when you go, becomes a card on its own. No setup.

### How a trip is found

Automatic, from logs that have a location (`lat`/`lng`):

1. A day is an **away day** if either of you has a located log that day more
   than `TRIP_KM` (40 km, already in `wrapped.js`) from `HOME`.
2. Consecutive away days join into one trip. **A single unlocated day between
   away days is bridged** (travel days often have no location logged), unless
   that day has a located log *near home*, which proves you were back.
3. Keep a trip if it has **2+ days**, or it is **1 day more than 150 km** away
   (a far day trip counts; a day out in Liverpool doesn't).
4. **Title**: the most common town among the trip's located logs. The town is
   taken from `locationName`: the second-to-last comma part when there are 3+
   parts ("The Bellagio, **Las Vegas**, United States"), otherwise the first
   part. Ties go to the furthest place. A rename overrides it.
5. **Cover photo**: the photo from the trip's biggest day, the same rule as
   Wrapped's furthest-photo pick.

**The thresholds are guesses, and must be checked against the real logs
before building the UI.** Step one of this feature is to run `findTrips` on
the real data and list what it finds, then have Ant confirm the list looks
like your actual trips (Vegas, Tenerife, Edinburgh, and whatever else). Tune
the two numbers until it does.

### Data

- Nothing new on logs.
- Renames live in one new Firestore document next to the user docs:
  `challengeData/trips` → `{ names: { '2026-04-03': 'Vegas wedding' } }`,
  keyed by the trip's first day. Listen to it with `onSnapshot` like
  `user1`/`user2`, so a rename on one phone shows on the other.
  - Known edge: if a backdated log moves a trip's first day earlier, the rename
    no longer matches. When a name has no exact key, fall back to any stored
    key that falls within the trip's dates.

### Code

- New `trips.js`, pure: `findTrips(logs, { home, tripKm, minFarKm })` returns
  a list of `{ start, end, days, title, placeNames, countries, maxKm,
  steps: { user1, user2 }, photos, notes, points, coverPhoto }`. It reuses
  `haversineKm`, `HOME` and `TRIP_KM` from `wrapped.js`.
- **`trips.test.mjs`**:
  - Bridging a one-day gap.
  - *Not* bridging when the gap day is at home.
  - A single 45 km day is dropped; a single 400 km day is kept.
  - Two trips a week apart stay separate.
  - The title rule on real-looking `locationName` strings.
  - Steps count every log on the trip's days, located or not.
  - Photos from both of you are included.
- `index.html`: the section, the cards, the trip page, and the rename.

### Tests (`tests/trips.mjs`)

- The section is hidden with no trips and shown with one.
- A Vegas-style fixture produces one card with the right title and dates.
- Opening the page shows every photo, both people's totals, and the map.
- Closing it leaves the main map exactly as it was: same centre, same zoom,
  still working.
- A rename survives a reload and shows on the "other phone" (a second page
  sharing the stub).
- Screenshot a card and the trip page at 390px.

### Next year's Wrapped (note only)

The Places slide can use trips ("3 trips: Vegas, Tenerife, Paris") instead of
loose places. Write that into the Year 2 Wrapped plan.

---

## D. The world view

### First, how the stamps actually work

Every stamp sits at its **straight-line distance from Wrexham**, not at a
point along a route. Checked against the milestone list:

| Stamp | Steps ÷ 1,300 | Straight line from Wrexham |
|---|---|---|
| Eiffel Tower | 603 km | 594 km |
| Barcelona | 1,355 km | 1,353 km |
| Reykjavik | 1,660 km | 1,639 km |
| Paphos | 3,438 km | 3,434 km |
| Las Vegas | 8,141 km | 8,142 km |
| Queenstown | 18,937 km | 18,938 km |

That is why the list jumps around the map (Warsaw, then Reykjavik, then
Lisbon): it's sorted by how far each place is from home. So there is no path
to draw, and the view shouldn't pretend there is one. The honest picture,
which is also the nicer one, is **how far from home each of you has
walked**.

### What you see

**The existing map doesn't change.** Above it goes a two-way switch:

`📍 Our walks` · `🌍 How far we've come`

- **Our walks** is today's map and view, and the default every time the app
  opens.
- **How far we've come** switches the same map to the world view. Switching
  back restores exactly the zoom and position you had.

In the world view:

- **Wrexham** is marked with a small 🏠.
- **Your two rings**: a thin circle around Wrexham in each of your colours,
  at the distance you've each walked. Everything inside a ring is somewhere
  you could have walked to.
- **Stamps as dots.** Places either of you has reached are filled; the next
  few you haven't reached yet are hollow. Tapping one shows the stamp's name,
  its description, and who got there first and when (reusing the passport's
  milestone dates).
- **You on your ring.** Each of you gets a small "A" marker (green / purple,
  like the passport) on your own ring, on the side facing your **next stamp**:
  "Next: Barcelona · 212,000 steps to go". The marker hops to a new side of the
  ring when you pass a stamp, because the next stamp is somewhere else. That
  is true to how the stamps work, and it gives each new stamp a little moment.
- **This year / All time** chips inside the view:
  - **This year** uses the annual totals (resets 1 Oct). The ring grows from
    Wrexham across Europe towards Paphos. On 1 October both of you are back
    home, and that's fine: it's a fresh year.
  - **All time** uses the cumulative totals, past Paphos and eventually round
    the planet. **Default to All time**, since that's the one with the "look
    where we are in the world" feeling.
- **Camera**: it opens fitted to both rings, i.e. as zoomed out as the bigger
  ring needs, plus a **Whole world** button.

**The ring near the end of the journey.** Wrexham's antipode, the exact
opposite side of the Earth, is just off New Zealand. As the all-time ring
passes about 10,000 km it stops growing on the map and starts closing in on
the far side of the world, and it ends as a small circle around Queenstown.
"About as far from North Wales as it is possible to walk" becomes something
you can see.

### Data: coordinates for every place stamp

- New `journey.js` with `STAMP_COORDS`: a map from the milestone's `steps`
  value to `{ lat, lng }`, for every stamp that is a real place (most of the ~200;
  the list below is the exceptions).
- Stamps that aren't places go in an explicit `NOT_A_PLACE` list and aren't
  drawn: Marathon, 24h Walk, Long Trek, Long Walk, Week Walk, UK Length,
  Chunnel, ISS, £100M Line, Everest × N, Route 66 ×, M25 ×, Mordor, the Nile,
  Britain's coastline, the every-million markers.
- **Amy's Parents and Ant's Parents go in `NOT_A_PLACE`.** The repo and the
  site are public, so family home coordinates shouldn't be in the source. At
  world zoom they would sit on top of Wrexham anyway.
- **The coordinates check themselves.** Since every stamp's steps equal its
  distance from Wrexham × 1,300, a test can confirm each coordinate:
  `haversineKm(HOME, coord) × 1300` must be within 3% of the stamp's `steps`.
  A wrong "Victoria" or a swapped Tripoli (Libya vs Lebanon) fails loudly. A
  second test checks that every milestone is in exactly one of `STAMP_COORDS`
  or `NOT_A_PLACE`, so a stamp added later can't silently go missing from the
  map.

### Drawing the rings

- Don't use Leaflet's `L.circle`: past a few thousand km it draws a wrong
  shape on this kind of map. Compute the ring yourself: 180 points at bearings
  0–358° using the standard "destination point" formula from `HOME` at
  distance *d*.
- Draw it as a **line (`L.polyline`), not a filled shape**. Past ~10,000 km the
  ring encloses the far side of the world, and a fill would shade the wrong
  side.
- Split the line wherever it crosses the 180° longitude line (the date line),
  so it doesn't streak across the whole map.
- Put the "A" marker at the destination point for the bearing from HOME
  towards the next stamp, at the person's distance. It then sits exactly on
  their ring.
- All-time totals come from the existing user-doc `steps`, and annual totals
  from `annualSteps`: the same numbers the progress bars use, so the view can
  never disagree with the bars.

### Code

- `journey.js`, pure: `STAMP_COORDS`, `NOT_A_PLACE`, `ringPoints(home, km)`,
  `destinationPoint(from, bearingDeg, km)`, `bearing(from, to)`,
  `positionFor(steps, milestones)` returning `{ km, next, bearingToNext,
  point }`.
- **`journey.test.mjs`**:
  - The 3% self-check on every coordinate, and the coverage check.
  - `destinationPoint` against known distances.
  - A ring at 18,900 km contains Queenstown and not Sydney.
  - The ring splits at the date line.
  - `positionFor` lands on the ring (distance within 0.5%).
- `index.html`: the switch, the world layers (built lazily on first switch,
  kept in their own `L.layerGroup`), view save/restore, the chips, the popups.

### Tests (`tests/journey.mjs`)

- The app opens on **Our walks** every time, including after using the world
  view and reloading.
- Switching over and back restores the exact centre and zoom.
- Both rings are drawn, and each marker sits on its own ring.
- The popup on a reached stamp shows who got there first.
- Fullscreen still works in both views.
- Screenshot This year and All time at 390px, and a fixture total near 19M to
  see the ring closing round New Zealand.

### How it's built

Build this last, as the biggest item. Split it in two:

1. **Coordinates**: fill `STAMP_COORDS`, then get the self-check green.
2. **The view** itself.

The coordinates are the slow part, and the self-check makes them reliable.

---

## Build order

1. **Test harness into the repo** (`tests/`), from section 0. Small, and every
   later step leans on it.
2. **A — Exercise days.** You're running now, so this is the one you'll use
   every night.
3. **B — Seasons.** Small, and autumn is already here, so you'll see it
   straight away.
4. **C — Trip scrapbooks.** Start by checking `findTrips` against the real
   logs.
5. **D — The world view.** Coordinates first, then the view.

Each step is its own PR, gets its own `sw.js` bump, and is merged once its
node tests, its driver and the 390px screenshots are good.

## Open questions (with the default used if unanswered)

- **Activity list.** Anything to add besides running, badminton, cycling,
  pilates, dancing and other, e.g. swimming or the gym? *Default: the six
  above; add more to `ACTIVITIES` any time.*
- **Anniversary date** for the seasonal moment? *Default: skip it.*
- **Trip rules.** Are 2+ days, or a single day more than 150 km, right?
  *Default: yes, confirmed against the real trip list before building the UI.*
- **World view default.** All time or This year? *Default: All time.*
