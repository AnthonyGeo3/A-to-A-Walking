# Year Wrapped — plan

A Spotify-Wrapped-style recap of a challenge year, built into the app. Written for
whoever implements it: everything here is grounded in the code as it stands on `main`
(the file is `index.html`; line references are approximate and will drift).

---

## 0. Decisions made up front

**The date.** Year 1 runs 1 Oct 2025 → 30 Sep 2026. Year 2 starts **1 Oct 2026**, two
weeks from the day this was written (17 Sep 2026). The request said "October 1st 2027"
— that's a typo. Everything below targets **1 Oct 2026**, and that changes the shape of
the work: the first play *is* the surprise, so what ships by then has to be good, and
anything that isn't ready can land afterwards in the recap area.

**Not a video. A story.** Spotify Wrapped isn't a video either — it's full-screen cards
that auto-advance with a progress bar, and you tap to skip. That's what this is: a
full-screen overlay of slides with CSS animation. No video rendering, no ffmpeg, no
build step, nothing new to host. Photos load straight from the Firebase Storage URLs
already on the logs.

**Always both of you.** The app doesn't know who's holding the phone, so the Wrapped is
"Ant & Amy · Year One" throughout — every slide shows both, in the app's existing green
(`#22c55e`) and purple (`#9333ea`). There is no per-person mode.

**Built for year N, not year 1.** Everything is `computeWrapped(logs, N)`. The recap
area lists each completed year. Next September it's free.

**Keeping the surprise.** The code ships early but is **date-gated**: nothing renders
until `new Date() >= challengeYearEnd(N)`. Amy will not read the source. A URL flag
(`?wrapped=preview`) lets Ant preview before the day. On 1 Oct it appears on its own —
no deploy needed on the day, which matters because the service worker serves
`index.html` cache-first (see §7).

**Everything derives from the logs.** Same rule as the rest of the app now: `logData`
is the record. The Wrapped is recomputed live every time it opens, so a 30 Sep walk
logged on 2 Oct just shows up.

---

## 1. Where it lives in the app

Three touch points, all new:

1. **A banner** at the very top of `.main-container`, above the "Log Steps" card, shown
   only when a completed year's Wrapped exists and this device hasn't played it yet:
   *🎁 Your Year 1 Wrapped is ready — Play*. On the first visit after the gate opens it
   **auto-opens** the overlay (which starts on a cover slide that waits for a tap, so
   nothing plays before she's looking). Per-device flag: `localStorage['a2a-wrapped-seen-y1']`.
   Both phones get their own first-time moment.
2. **The overlay** — the Wrapped itself. `position: fixed; inset: 0; z-index: 10000`
   (above the map's fullscreen at 9998 and the modals at `z-50`). Locks body scroll the
   way `body.map-fs-lock` does. Uses `100dvh` and `env(safe-area-inset-*)` — the PWA
   runs standalone with a translucent status bar, so the top progress bar must clear the
   notch.
3. **The recap section** — a new section on the main page, `📖 Year 1 Recap`, placed
   between **Passport** and **Stretch Goals**. Persistent, collapsible like the passport,
   with a big *▶ Play Year 1 Wrapped* button at the top and the static highlights below
   (§5). This is where you go back to it in the future.

---

## 2. Code shape

Keep `index.html` from growing another 60 KB. Add two files next to it:

- **`wrapped.js`** — an ES module, no Firebase, no DOM globals at import time. Exports:
  - `computeWrapped(logs, yearN, opts) → stats` — **pure**. Takes normalised logs
    (`date` as a JS `Date`, not a Firestore Timestamp), returns a plain object with
    every number and pick the slides need. Testable in node with a synthetic year
    (see §8).
  - `openWrapped(stats, { onClose })` — mounts the overlay, runs the show.
  - `recapHtml(stats) → string` — the static section markup.
- **`wrapped.css`** — the overlay and polaroid styles. (Or a `<style>` block in
  `index.html`; a file keeps the diff readable.)

`index.html` imports `{ computeWrapped, openWrapped, recapHtml } from './wrapped.js'`
inside its existing inline module, normalises logs
(`{ id, userId, steps, date: l.date.toDate(), note, photoUrl, locationName, lat, lng }`)
and passes `MASTER_MILESTONES`, the milestone-date replay and the two names in `opts`.
Relative module imports work as-is on GitHub Pages under `/A-to-A-Walking/`.

Both new files go into `CORE_ASSETS` in `sw.js`, and `CACHE_NAME` gets bumped (§7).

Things already in `index.html` to reuse rather than rewrite:

| Need | Reuse |
|---|---|
| Year boundaries | `challengeYearStart(n)`, `challengeYearEnd(n)` (exclusive), `getChallengeYear(date)` |
| Steps → distance | the app's constants: miles = steps/2100, km = steps/1300 |
| Milestones crossed in year N, per person, with dates | `getMilestoneAchievementDates().annual[m.steps][uid]` → `[{ year, date }]`, filter `year === N`; earlier date of the two = first-to crown |
| "What place is that many steps?" | `MASTER_MILESTONES` (sorted by steps) — the last entry ≤ a total gives a destination label |
| Escaping notes / place names | `esc()` |
| Rivalry bar | `rivalryBarHtml(label, ant, amy)` — the year-total bar in the recap |
| Heatmap cells | `.heatmap-cell` CSS; the intensity formula in `renderHeatmap` |
| Polaroid-style photo pin | `.photo-pin` / `.photo-pin.amy` CSS (round photo in a coloured ring) — for the map slide |
| Confetti | `confetti()` is already loaded globally |
| Map | Leaflet is already loaded; `initializeMap` shows the tile layer setup |
| Modal for anything small | `showModal(title, html, onConfirm, confirmText)` |

---

## 3. The stats engine — `computeWrapped(logs, N, opts)`

This is half the work and the half worth testing properly. Every slide reads from this
object; no slide does its own arithmetic over logs.

**Inputs.** `logs` (normalised, both users, all years — filter inside),
`N`, `opts = { names: { user1, user2 }, milestones, milestoneDates, home }`.
`home = { lat: 53.043, lng: -2.993 }` — Wrexham, the origin of every journey in the app.

**Scope.** `inYear = logs.filter(l => l.date >= start && l.date < end)` with the year
helpers. Logs with no date are ignored here (they can't be placed in a year).

**Per-day buckets first**, everything else from them: `days[uid][YYYY-MM-DD] = steps`
(a person can log twice in a day; sum them). Also a `dayList` of all 365/366 dates in
the year so streaks and "days logged" are honest about gaps.

Then, per person (`user1`, `user2`) and, where it makes sense, `both`:

| Stat | How | Notes |
|---|---|---|
| `total`, `km`, `miles` | sum; /1300; /2100 | |
| `daysLogged`, `daysOver10k` | count of day buckets > 0 / ≥ 10 000 | |
| `avgPerLoggedDay`, `avgPerCalendarDay` | | show the calendar one — it's the honest one |
| `bestDays[3]` | top 3 day buckets, `{ date, steps, log }` where `log` is the largest single log that day (for its photo/note) | matches the "Best Days" section |
| `bestWeek` | max Mon–Sun window fully inside the year | |
| `bestMonth`, `quietestMonth` | by month total | |
| `longest10kStreak` | consecutive calendar days ≥ 10 000, `{ from, to, days }` | the calendar list makes gaps break it |
| `longestLoggedStreak` | consecutive days with any log | secondary |
| `bestWeekday` | mean steps per weekday over days logged | feeds Awards |
| `photos` | logs with `photoUrl`, chronological | `first`, `last`, `count` |
| `places` | distinct places: key = `locationName.split(',')[0]` + lat/lng rounded to 2dp; each `{ name, lat, lng, km from home, country, logs[] }` | `country` = last comma segment of `locationName` (Nominatim ends with it) |
| `furthest` | place with max `kmFromHome` | |
| `trips` | places > 40 km from home, sorted by distance | "was a trip" threshold; tune by eye |
| `countries` | distinct `country` | |
| `milestones` | from `milestoneDates`, year N: `[{ label, steps, date, first: bool }]` | `first` = earlier than the other person's date for that milestone |
| `notes` | logs with a note, `{ date, note, steps, photoUrl }` | |
| `stretch` | the goal on the user doc, hit or not, and the date the cumulative total crossed it if it did | |

**Month chapters** — `months[12]`, Oct → Sep, each:
`{ label: 'October 2025', totals: { user1, user2 }, winner, bestDay: { uid, date, steps, log },
photos: [...up to 3], milestones: [...], trips: [...], quote: note|null }`.

Photo selection per month (deterministic — no shuffling on replay):

1. Candidates = that month's logs with a photo.
2. Score = steps (bigger day first) + 5 000 if the log has a location > 40 km from home.
3. Take the top by score, **alternating people** where both have candidates, up to 3.
4. `quote` = the longest note that month from a log without a chosen photo (so the
   caption and the quote aren't the same text), or null.

**The race** — `race`: one entry per calendar day of the year,
`{ date, cum: { user1, user2 }, day: { user1, user2 } }`. From it:

- `leadChanges[]` — `{ date, to: uid }` every time `sign(cum.user1 − cum.user2)` flips
  (ties don't count).
- `daysInLead: { user1, user2 }` — count of days each was strictly ahead.
- `biggestSwing` — the day with the largest `|day.user1 − day.user2|`, who, by how much.
- `finalGap` and `winner`.

**Awards** — deterministic superlatives, 2–3 per person, chosen from a fixed list so
both always get some. Compute each award's holder, then ensure neither ends up empty:

| Award | Goes to |
|---|---|
| 🏆 Year Winner | higher `total` |
| 🦵 Iron Legs | longer `longest10kStreak` |
| 📸 Photographer of the Year | more `photos.count` |
| 🧭 Explorer | more distinct `places` |
| 🚀 Biggest Day | higher single `bestDays[0]` |
| 📅 Weekend Warrior / ⚙️ Weekday Grinder | whose `bestWeekday` is Sat/Sun vs Mon–Fri (each can hold one) |
| 🏁 The Closer | higher total in September |
| ✍️ Storyteller | more notes |
| 👑 First to Arrive | more `first: true` milestones |

**Combined** — `both.total`, `both.km`, and `both.destination` = the label of the last
`MASTER_MILESTONE` ≤ `both.total` ("Together, that's Wrexham to ___"). Also
`both.everests` — use the app's own ratio, not a fresh one: the "Everest × 300" stamp
sits at 3,496,110 steps, so one Everest ≈ 11,654 steps — and `both.marathons`
(km / 42.195).

**Edge cases the function must handle** (and the tests should cover): a month with no
logs for one person; no photos at all; no `lat/lng` at all (→ `places` empty, map slide
skipped); a tie at year end; a person with zero logs (pathological, but don't throw);
logs dated 30 Sep 23:59 vs 1 Oct 00:00 landing on the right side; the Y1 leap-day-free
365 days vs. a future leap year.

---

## 4. The show — slide by slide

Full-screen, portrait. Dark backgrounds (near-black navy `#0b0f1a` as the base) with
each slide's own gradient wash in the two brand colours — a deliberate contrast to the
app's pastel daytime look, so it feels like an event. Big type: load Inter 800/900 by
adding `;800;900` to the Google Fonts URL (also in `CORE_ASSETS`). Optional: `Caveat`
for hand-written polaroid captions.

**Controls** (Instagram/Spotify conventions — don't reinvent):

- Progress segments across the top, one per slide, the current one filling over its
  duration. Sits below the safe-area inset.
- Tap right two-thirds → next; tap left third → back. Press-and-hold → pause. `×` top
  right → close. Keyboard on desktop: ←/→, space = pause, Esc = close. Swipe optional.
- Auto-advance per slide's `duration`. `prefers-reduced-motion` → no count-ups or
  drop-ins, crossfades only, and auto-advance off (tap to advance).
- Preload images for the next two slides (`new Image().src = url`) when a slide mounts.

**Slide model:** `{ id, duration, skip(stats) → bool, render(stats) → HTMLElement,
images(stats) → url[] }`. A slide with `skip` true is removed before the progress bar is
built, so the segment count is honest.

**Polaroid component** (used on months, best days, places, wall): white frame,
`padding: 10px 10px 34px`, the photo `object-fit: cover` at 4:5, a caption in the
bottom band (date · person · short place or steps), rotation −6°…6° from a seed on the
log id, `box-shadow: 0 12px 30px rgba(0,0,0,.45)`. Enters by dropping in from slightly
above and rotating into place (`transform`, ~450 ms, staggered 150 ms per card). Cap at
3 on a slide, ~30 on the wall.

The sequence — durations are a starting point, tune by watching it:

| # | Slide | What's on it | Data | Dur |
|---|---|---|---|---|
| 1 | **Cover** | "A to A" small · "Year One" huge · "1 Oct 2025 – 30 Sep 2026" · both names in their colours · *tap to begin*. **Does not auto-advance** — it's the "are you ready" moment. | — | ∞ |
| 2 | **The big number** | Combined steps counting up from 0 (rAF, ~2.5 s, ease-out), then km fades in under it, then "Together, that's Wrexham to **{destination}**". | `both` | 8 |
| 3 | **Each of you** | Two columns, Ant left / Amy right: total, km, `everests`, days logged. Numbers count up. Crown on the winner — small, this isn't the reveal yet. | per-user totals | 7 |
| 4–15 | **Month chapters** ×12 | Month name big, top left. A mini rivalry bar (both totals, crown). "Best day: Amy · 24,310 · Sat 14th". Up to 3 polaroids scattered on the right/below. If a milestone was crossed: a stamp-style badge "🏛️ Barcelona · 3 Mar". If a trip: "✈️ Lisbon · 1,650 km from home". If a quote: it in italics at the bottom. | `months[i]` | 5 base, +2 if photos, +1 if milestone/trip, cap 9 |
| 16 | **The race** | Title "Neck and neck?" or "A runaway" depending on `leadChanges.length`. An SVG of both cumulative lines drawing left→right (stroke-dashoffset, ~3 s) — big days show as visible jumps. Vertical ticks where the lead changed. Below: "Lead changed hands **7** times" · "Ant led for 201 days, Amy 164" · "Biggest single-day swing: 31 Jan, Amy +18,204". The year rivalry bar last. | `race` | 10 |
| 17 | **Best days** | Both top-3s, medal styling like the Best Days section, each with its polaroid if that day had a photo. | `bestDays` | 7 |
| 18 | **Habits** | "Ant's longest run over 10k: 23 days (12 Feb – 6 Mar)" for each. Best weekday each. "Amy logged 341 of 365 days." | streaks, weekday, daysLogged | 7 |
| 19 | **Places** | A Leaflet map filling the slide, `fitBounds` over all `places` with padding, pins dropping in chronological order (photo pins where a photo exists — reuse `.photo-pin`). Overlay caption bottom: "**18** places · **3** countries". Skipped if no `places`. | `places` | 8 |
| 20 | **Furthest from home** | One big polaroid (or place name if no photo): "{name} · {km} km from Wrexham · {date} · {who}". Then the next two trips smaller. | `trips` | 6 |
| 21 | **Passport** | Stamps earned this year as small circles (reuse `.stamp` at ~64px), with 👑 on first-to. "Ant got there first 9 times, Amy 6." | `milestones` | 7 |
| 22 | **In your words** | 3–5 notes as pull-quotes, seeded pick favouring longer ones and big days, alternating people. Skipped if fewer than 2 notes. | `notes` | 8 |
| 23 | **Awards** | Two columns of badges, 2–3 each, staggered pop-in. | `awards` | 8 |
| 24 | **Photo wall** | Every photo (or a seeded 30) cascading in as polaroids over ~4 s, ending as a dense collage. Skipped if < 4 photos. | `photos` | 8 |
| 25 | **Stretch goals** | Each person's goal: "Smashed it — 14 Jul" or "Not this year — 87% there". | `stretch` | 6 |
| 26 | **Finale** | Confetti (already loaded). "Year Two starts now." "Next stop on the annual journey: {first MASTER_MILESTONE}." "From tomorrow, these days start showing up in *A year ago today*." Two buttons: **↻ Replay** and **See the recap** (closes and scrolls to §5). | — | ∞ |

Roughly 26 slides at ~3 minutes if left to run; tapping through takes a minute. The
twelve month chapters are the spine — if they're rich (photos, a milestone, a trip)
the whole thing feels like *their* year and not a stats dump. Quiet months go by fast
by design (5 s, no extras).

**Copy rules.** Names, never "user1". Numbers with `toLocaleString()`. Dates as the app
does elsewhere: `en-GB`, `day: 'numeric', month: 'short'`. A winner is always crowned,
never called a loser. Don't put the year winner on the big-number slide — the race slide
(#16) is the reveal, and the awards (#23) the recap of it.

---

## 5. The recap section (persistent)

`📖 Year {N} Recap`, between Passport and Stretch Goals. Collapsed by default to a
header row with the Play button and three stat tiles; *Show more ▼* expands the rest.
Built from the same `stats` object, so it can never disagree with the show.

1. **▶ Play Year 1 Wrapped** — big, full-width.
2. **Tiles:** combined total · each person's total with crown · combined km.
3. **The year, day by day** — both calendar heatmaps for the full year. Portrait phones
   can't fit GitHub's 53-column layout, so use **12 rows (Oct→Sep) × 31 columns**, a
   month label down the left, no numbers in the cells, Ant's grid stacked above Amy's.
   New CSS: `.heatmap-year-grid { display:grid; grid-template-columns: 28px repeat(31, 1fr); gap: 2px }`,
   cells `aspect-ratio: 1; border-radius: 2px`. Intensity as in `renderHeatmap` but cap
   the scale at the **95th percentile** of daily totals rather than the max — over 365
   days one 40k day otherwise washes everything else out. Tap a cell → the same
   one-line readout the month heatmap uses (`#heatmap-tap-info` pattern).
4. **The race** — the same SVG as slide #16, static, with the lead-change ticks.
5. **Best days · Streaks · Places (with furthest) · Stamps this year · Awards** — compact
   versions of the slides, in that order.
6. Footer line: *Figures are live — a late-logged walk updates them.*

Future years: the section renders once per completed year, newest first, each
collapsed; or a year selector if that gets long. Don't build the selector now.

---

## 6. Gating, the surprise, and the first play

- `wrappedYears()` → every `n` from 1 to `currentChallengeYear() − 1`, i.e. only
  **completed** years. Before 1 Oct 2026 that's empty and nothing renders.
- `?wrapped=preview` in the URL treats the *current* year as complete too (so
  `wrappedYears()` includes it). Also honour `?wrapped=1` to force-open on load. Neither
  sets the seen flag.
- First-time behaviour on each device: if `wrappedYears()` includes a year whose
  `a2a-wrapped-seen-y{n}` flag isn't set → render the banner **and** auto-open the
  overlay on the cover slide after the first `updateUI()` that has both users and the
  logs (don't open on an empty `logData`). Set the flag when the show reaches the finale
  or is closed past slide 3 — a mis-tap on the cover shouldn't burn the surprise.
- The banner disappears once the flag is set; the recap section stays.
- Late logs: the stats are recomputed on every open. No caching of `stats`.

---

## 7. Deployment reality

`sw.js` is **cache-first for everything that isn't Firebase**, including `index.html`.
A new build only reaches a phone when the browser refetches `sw.js`, sees a new
`CACHE_NAME`, installs, and the *next* launch uses it. So:

- Bump `CACHE_NAME` (`a2a-walking-v11` → `v12`) in the same commit as the feature and
  add `wrapped.js`, `wrapped.css` and the updated fonts URL to `CORE_ASSETS`.
- Merge to `main` by **~26 Sep** so both phones have picked it up (they open the app
  daily to log). Nothing has to happen on 1 Oct — the date gate does it.
- Map tiles and Storage photos need the network; the show degrades (map slide skipped,
  photos show a grey frame) rather than breaking.

---

## 8. Testing

- **`wrapped.test.mjs`**, run with `node --test`. A fixture generator that builds a
  synthetic year for two people with known answers: a planted 23-day 10k streak, a
  planted lead change on a known date, a photo-heavy month, an empty month for one
  person, a 30 Sep 23:59 log and a 1 Oct 00:00 log. Assert every field in §3.
  `computeWrapped` must import cleanly in node — that's the point of keeping Firebase
  and the DOM out of it.
- **Visual pass** with `?wrapped=preview` on a phone (the real target) and desktop,
  in the installed PWA specifically — the safe-area inset and `100dvh` behave
  differently there than in a browser tab.
- Watch it all the way through once without touching it (timing), and once tapping
  fast (no stuck animations, images from the skipped slides don't flash in later).
- `prefers-reduced-motion` on, once.
- Syntax check the extracted module (`node --check`) — the repo has no build step to
  catch a stray comma.

---

## 9. Build order

Half of this is the stats engine; the show is thin on top of it. In this order, so that
at every step something demonstrable exists:

1. **`computeWrapped` + tests.** Month buckets, race, streaks, places, awards.
2. **Overlay shell.** Progress bar, tap zones, hold-to-pause, close, preloading,
   reduced-motion. Three slides: cover, big number, finale. Wire the banner, the gate,
   the `?wrapped=preview` flag, the seen flag. Bump the SW. *This is shippable dark.*
3. **Month chapters** + the polaroid component + photo selection.
4. **The race** slide, best days, habits.
5. **Places** (Leaflet in a slide: create on mount, `invalidateSize()` after the
   transition, `remove()` on unmount), furthest, passport, awards.
6. **Recap section** with the year heatmaps and the static race.
7. Quotes, photo wall, stretch goals, timing pass, copy pass.

If the clock runs out, the cut that still works as a surprise is **1–4 + 6**. Places,
quotes and the wall can arrive in the recap after the day — she'll rewatch.

---

## 10. Things that were considered and left out

- **Rendering a real video / share-as-image.** Photos come from Firebase Storage
  without CORS headers, so a canvas that draws them is tainted and can't be exported.
  Not worth fighting for a first version; a "share" button is a v2 idea.
- **Per-person mode.** The app can't tell who's looking; a "who are you?" prompt
  would spoil the moment. Both, always.
- **Time-of-day insights** ("early bird"). Logs have a date, not a time — nothing to
  compute.
- **A year selector** in the recap. One year exists. Add it when there are three.
- **Sound.** Autoplay audio is blocked on iOS anyway.
