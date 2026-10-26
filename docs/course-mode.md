# Course mode — plan

Status: **draft for owner approval** (2026-10-26). Nothing here is built yet. Branch: `feature/course-mode`.

A course turns a field ("microeconomics") into an ordered syllabus of lessons. Each lesson is an ordinary teaching session with a fixed goal. The app works out when a lesson is understood, the teacher can add lessons for missing foundations, and the learner can edit everything.

## Decisions (owner, 2026-10-26)

| # | Question | Decision |
|---|---|---|
| 1 | When is a lesson done? | The teacher calls `lesson_complete`; the app **accepts it only with evidence**: the latest check on the goal is correct at **≥ 70% confidence** |
| 2 | Explain (own-words) mode | A **final multiple-choice check** on the goal is required before completing, so rule 1 applies everywhere |
| 3 | Editing | The learner can reorder, add, remove and rename lessons |
| 4 | Missing foundations | The teacher **adds the lesson immediately**, marked "Added by the teacher" with its reason |
| 5 | Where in the UI | A **top-level Courses section** |
| 6 | Source | **Topic first**; a textbook source plugs in later without reshaping anything |
| 7 | Course setup | **Short intake** (level, purpose, depth) → drafted syllabus → learner edits → save |
| 8 | Order | **Any order**; the next unfinished lesson is highlighted as "Continue" |
| 9 | Resuming | **One lesson = one session**; reopening resumes it |
| 10 | Model | The **strong slot** drafts syllabi |

## Scope

**In v1:** create a course from a topic, edit its syllabus, start/resume lessons, gated completion, teacher-added lessons, course progress, the Courses section.

**Out of v1** (later, each its own plan): textbook as a course source (needs upload first), practice sessions inside courses, re-drafting a whole syllabus mid-course, mobile layout.

## Design

It follows the existing architecture (`docs/architecture.md`): structure is stored, progress is **derived from transcripts**, every store has one writer.

### Data — what's stored

New contracts file `src/core/contracts/course.ts`:

- `Course` — `id`, `title`, `topic`, `intake` (`level`, `purpose`, `depth`), `lessons: Lesson[]` (array order = syllabus order), `createdAt`, `updatedAt`.
- `Lesson` — `id` (stable slug), `title`, `goal` (one sentence: what understanding the lesson ends at), `origin` (`"syllabus" | "teacher" | "learner"`), `addedReason?` (teacher-added only).

The chat record gains one optional field, `lesson?: { courseId, lessonId }`, stamped when a lesson session is created. That link lives **only** on the chat (no `chatId` copy on the lesson), so it can't drift.

New store `src/store/courses.ts` → `data/courses/<id>.json` (whole-file JSON like chats/jobs), behind a `CourseStore` port in `src/core/ports.ts`, instantiated in `src/server/stores.ts`. The **Course system** is its only writer; the teacher's add-lesson tool writes through the injected port.

### Progress — what's derived

Pure functions in `src/core/courses.ts`, never stored:

- **Lesson status:** `not started` (no linked chat) · `in progress` (linked chat, no accepted `lesson_complete`) · `complete` (an accepted `lesson_complete` result in its transcript).
- **Continue:** the first lesson in syllabus order that isn't complete.
- **Completion gate** (`lessonCompletionProblems`): the goal is the plan map's **sink nodes** (nodes nothing depends on). Every sink needs its latest quiz `check` answered **correctly with confidence ≥ 70** (the slider's 70 stop). A refusal returns the reason to the teacher as a tool error, and teaching continues.

### Agent side

- **Syllabus drafter** (`src/agent/course-drafter.ts`): one strong-slot call, structured output (lessons with title + goal), validated with the existing typebox/zod style; a bad draft is refused honestly, not guessed at.
- **Lesson sessions** get a lesson context block (course title, this lesson's goal, the syllabus around it) and a new prompt fragment `src/agent/prompts/teacher/60-course-lesson.md`. It's added **only** in lesson sessions, so ordinary sessions are unchanged.
- **New teacher tools** (lesson sessions only):
  - `lesson_complete` → runs the completion gate.
  - `course_add_lesson` (`title`, `goal`, `reason`, `beforeLessonId?`) → inserts with `origin: "teacher"`.
- **Explain mode:** lesson sessions also expose the `quiz` tool for the final check (decision 2).

### Server and routes

- `GET/POST /api/courses` — list; create from an approved draft.
- `POST /api/courses/draft` — intake → draft (nothing saved).
- `GET/PUT/DELETE /api/courses/[id]` — read; save syllabus edits; delete the course. Its sessions are kept and become ordinary sessions.
- `POST /api/courses/[id]/lessons/[lessonId]/start` — resumes the linked chat, or creates one (stamped from the strong slot like any new session) whose first message is the lesson goal.

### UI

- **Sidebar:** a top-level **Courses** entry next to the existing New session / Practice entries.
- `app/courses/page.tsx` — your courses with progress ("4 / 12").
- `app/courses/new` — topic + intake → draft → editable lesson list → Save.
- `app/courses/[id]` — lessons with status, **Continue** button, inline edit (reorder, add, remove, rename), "Added by the teacher" badge with reason.
- **Lesson session header:** "Microeconomics · Lesson 3 of 12", linking back; a completion notice when the gate accepts.

## Build order

1. Contracts + pure core (status, continue, gate) + tests.
2. Store + port + composition wiring + tests.
3. Drafter + routes + tests (fake engine; no network in tests).
4. Lesson session wiring: link stamping, context block, prompt fragment, the two tools + tests.
5. UI: sidebar entry, the three course pages, session header.
6. Docs: architecture row for the Course system.
7. Verify: tests, typecheck, lint; then a real course in the browser with DeepSeek.

Each step leaves the suite green. One commit per step, nothing pushed without your OK.

## Open points to confirm with approval

- **Intake as a fixed form** (level · purpose · depth, plus optional free text), not AI-generated questions. That saves a model call, and the drafter reads the answers.
- **Goal = sink nodes**, which is the plan map's own definition ("his goal at the sink"). With several sinks, all must pass.
- **Deleting a course keeps its sessions** (they lose the lesson link and appear as normal sessions).
