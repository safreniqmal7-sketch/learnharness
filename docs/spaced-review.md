# Spaced review — plan

Status: **draft for owner approval** (2026-10-29). Nothing here is built yet. Branch: `feature/spaced-review`.

After a lesson is complete, its propositions come back for short practice at growing intervals. The schedule is **derived from transcripts** like lesson status: no new storage, no ratings in the graph.

## Decisions (owner, 2026-10-29)

| # | Question | Decision |
|---|---|---|
| 1 | Scheduler | **Expanding ladder** (not the parked Beta forecast) |
| 2 | Which propositions | Graph propositions **born in the course's lesson sessions** (first provenance point is the lesson chat), so each belongs to one course |
| 3 | Clock start | The lesson's **accepted `lesson_complete`** time. Unfinished lessons aren't scheduled |
| 4 | Evidence | **Any practice session's** concluded problems targeting the proposition. Review sessions are ordinary practice sessions |
| 5 | Outcomes | `solved` → up one step · `solvedWithHints` → same step again · `movedOn`/`surrendered` → step 1 · `dismissed` ignored. A multi-target problem moves every target the same way |
| 6 | Intervals | **1, 3, 7, 14, 30, 60, 120 days**; a solve at 120 stays at 120 |
| 7 | Early practice | An early **miss** resets to step 1; an early solve or hinted solve changes nothing |
| 8 | Where | A **Review panel on the course page** only |
| 9 | Start review | A practice session with the **8 most overdue** propositions |
| 10 | Panel content | "N due now · next due in X days", the **due list** (name, lesson, days overdue), and a Start review button |
| 11 | Session naming | Title **"Review: \<course title\>"**; opening message "Review these propositions from my course. They're due for spaced review." |

## The ladder (exact rules)

Steps: `INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120]`, step index 0–6.

For each scheduled proposition:

1. **Start:** step 0, due at `completedAt + 1 day`.
2. Walk its evidence in time order, ignoring anything **before `completedAt`**. One event = one concluded practice problem whose `target` includes the proposition, timed at the `conclude` message's timestamp:
   - **Miss** (`movedOn`, `surrendered`), early or not → step 0, due at `event + 1 day`.
   - **On time** (event ≥ due):
     - `solved` → step + 1 (capped at 6), due at `event + INTERVAL_DAYS[step]`.
     - `solvedWithHints` → same step, due at `event + INTERVAL_DAYS[step]`.
   - **Early** (event < due) solve or hinted solve → no change.
   - `dismissed`, untagged problems, and `conclude` calls without a valid preceding `problem` are ignored.
3. **Due** when `now ≥ due`. Days overdue = whole days past due.

A proposition deleted from the graph drops out. A lesson completed twice uses the first accepted `lesson_complete`.

## Design

It follows the calibration panel's five-step pattern.

### Pure fold — `src/core/review.ts` (new)

- `reviewSchedule({ lessons, nodes, practiceChats, now })` → `{ items, due, nextDueAt }`.
  - `lessons`: `{ lessonId, title, chatId, completedAt }` for **completed** lessons only.
  - `nodes`: graph nodes (id, name, provenance); scheduled = `birthSessionOf(node)` is one of the lesson chat ids.
  - `practiceChats`: messages of every `kind: "practice"` chat.
  - `items`: per proposition `{ nodeId, name, statement, lessonId, lessonTitle, step, dueAt }`.
  - `due`: items with `now ≥ dueAt`, most overdue first.
- `practiceEvidence(messages)` → `{ targets, outcome, at }[]`: pairs each clean `conclude` with the latest clean `problem` before it in the same chat (reusing the tool-name constants and exporting the private `cleanToolCallIds` helper in `native-messages.ts`).
- `lessonCompletedAt(messages)` in `src/core/courses.ts`: timestamp of the first accepted `lesson_complete` result.
- `REVIEW_INTERVAL_DAYS` and `REVIEW_BATCH_SIZE = 8` as constants in one place.

### Server — `src/server/courses.ts`

- `viewOf(..., { withReview })` adds `review?: ReviewSchedule` on the **detail view** only (same as calibration). It reads the graph nodes and every practice chat.

### UI

- `components/courses/types.ts`: `review?` on `CourseViewDto`.
- `components/courses/review-panel.tsx` (new), mounted in `course-view.tsx` when the course has a completed lesson:
  - Header line: "N due now · next due in X days" (or "Nothing due · next due in X days"; or "No reviews scheduled yet").
  - Due list: name, lesson title, "N days overdue" / "due today".
  - **Start review** (disabled when nothing is due): starts a practice session through the existing `SessionStarter` with `kind: "practice"`, `graphContext.propositions` = the first 8 of `due` (`{id, name, statement}`), the title and opening message from decision 11, then routes to the chat like any session.
- No prompt changes: the practice agent already poses problems from picked propositions and tags them with their ids.

### Tests (`tests/review.test.ts`, `tests/render-review-panel.test.tsx`)

- Ladder: start date, each outcome on time, early miss vs early solve, cap at 120, evidence before completion ignored, dismissed/untagged ignored, multi-target, unfinished lesson not scheduled, node born outside the course not scheduled.
- Evidence pairing: conclude paired with the right problem; errored calls ignored.
- Panel: counts line, due list order, button disabled when nothing is due, Start review sends the 8 most overdue with the right title and message.
- Run with a temp `LH_DATA_DIR` (see next-session.md).

## Build order

1. Pure fold + tests (`src/core/review.ts`, `lessonCompletedAt`) — Sonnet.
2. Server wiring in `viewOf` + DTO — Sonnet.
3. Review panel + mount + render test — Sonnet.
4. Orchestrator: review diffs, tsc/eslint/tests, check in the browser with a real course (a completed lesson, then a practice session from Start review).

## Out of scope

- The Beta forecast / mastery numbers (upstream's parked design).
- Home-page due counts, notifications, misconception tracking.
- Changing the practice prompt to prefer due propositions mid-session.
