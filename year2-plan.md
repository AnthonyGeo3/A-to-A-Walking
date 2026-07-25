# Year 2 Update Plan — target 1 Oct 2026

**Core concept:** two parallel journeys, no toggle. The annual journey (resets each 1 Oct, relives the existing milestones) is the hero; the all-time cumulative journey (onward past Paphos, one day Australia ~22M steps) is an always-visible slim companion. Everything annual is *derived from logs by date* — no data migration, year 1 untouched, fully reversible.

---

## 1. Year engine (foundation)

- Challenge year = 1 Oct → 30 Sep. `CHALLENGE_START = 1 Oct 2025`. Helper: `getChallengeYear(date)` → 1, 2, 3…
- **Annual steps** per user = sum of logs dated within the current challenge year (computed in the logs `onSnapshot`). Cumulative stays the Firestore `steps` field, unchanged.
- Backdated logs near the boundary land in the correct year automatically because it's log-date based.
- Before 1 Oct 2026, year 2 annual = 0-but-really-year-1, so everything ships early and rolls over seamlessly on the day.

**Pre-flight check (do first):** verify each user doc's `steps` exactly equals the sum of their logs. Passport dates and all annual maths silently inherit any discrepancy.

## 2. Progress bars (dual-layer, per person card)

- **Annual hero bar** — existing size/style, runs against `MASTER_MILESTONES` from zero each year.
- **Two markers on the annual bar:**
  - *Peer marker* (as now): the other person's annual position — each other, this year.
  - *Ghost marker* (new): your own position on this day-of-year last year — you vs. you. Same colour as owner but faded/outlined so it reads as a "ghost". (No data until year 2 starts.)
- **Slim all-time strip** (~8px) inside the same card below the caption: next cumulative destination label + `X.XXM / X.XXM`, **with its own peer marker** for each other's all-time position.
- **Celebrations fire on crossing, not on viewing** — log submit checks both annual and cumulative crossings, so nothing can be missed regardless of what's on screen.

## 3. Passport

- Stays unified (one passport, all stamps ever earned).
- Stamp modal gains per-year dates: "Y1: 12 Nov 25 · Y2: 3 Dec 26" per person, with first-crown per year.
- New beyond-Paphos stamps join the same passport as they're earned.

## 4. Stats

- Per-user card: **year avg** as the headline number; all-time avg + year prediction (year avg × 365) as a smaller second line; a **"vs year 1" pill** (↑/↓ %) comparing cumulative steps at the same day-of-year.
- Stats filter gains challenge-year groupings ("Year 1", "Year 2") alongside months.
- Fix: `renderStretch` hardcoded `end = '2026-10-01'` → dynamic end of current challenge year.
- Fix: heatmap click-listener stacking on every render.

## 5. Head to head

- Add a third rivalry bar: **This year (Year N)** alongside week and month.

## 6. Memories — "A year ago today"

- **Candidates:** logs from either person dated *exactly* one year ago today that have a note, photo, or location. No fuzzy window. No qualifying log → section doesn't render at all.
- **Smart content fallback per log:** note first → else location → else steps; camera icon shown if a photo exists.
- **Fair picking:** if both people have a memory that day, the strip shows one chosen by a deterministic random seed on the date (so it doesn't flip between renders, and doesn't always favour Ant). The tap-through modal shows **both** memories regardless.
- **Strip:** one thin sepia/amber line under Log Steps — truncated text + chevron. Must not compete with the bars.
- **Modal** (reuse `showModal`): full photo, note, location, steps, who, date. From year 3 onward, stack multiple years ("2026 · 2025").

## 7. Content & polish

- Draft beyond-Paphos milestone list (east from Cyprus; gaps free to exceed 70k since dense ones replay annually; keep postcard-description style). To be written for review.
- Stretch goals: proposed to become annual-basis (they're user-editable anyway) — **confirm before coding**.
- Header becomes year-aware: "Year 2 · Est. Oct 25".
- Bump service-worker `CACHE_NAME`.

## 8. Build order & working rules

1. Pre-flight data check
2. Year engine
3. Dual-layer bars + markers
4. Stats + head-to-head + fixes
5. Memories
6. Passport per-year dates
7. Beyond-Paphos content + polish

Small tested batches; edits in the local clone only; Anthony commits/pushes via GitHub Desktop. Everything can ship before 1 Oct — year-2 behaviour activates automatically on the date.
