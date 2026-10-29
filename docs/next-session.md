# Next session — handoff and plan

Written 2026-10-29 at the end of the course-mode / calibration / costs session. Read this first.

## Where things stand

- **Fork:** `safreniqmal7-sketch/learnharness`. `origin` is the fork; `upstream` is `amosblomqvist/learnharness`.
- **`main`** is upstream **0.3.9** plus all our work (merge `77e245c`), pushed. The checkout is on `main`.
- **Our features**, all live:
  - **Course mode:** a syllabus from a topic plus a short intake; one session per lesson; the teacher can add lessons.
  - **Completion gate:** a lesson completes only on app-checked evidence. Every goal node needs a correct multiple-choice check at 70%+ confidence, plus one passing **"New case"** transfer question.
  - **Calibration panel** on each course page.
  - **Spend** per course and per lesson, including syllabus drafting.
  - **Currency/LaTeX rendering fix**: prices as `\$90`, plus repair of over-escaped dollars.
- **Models:** DeepSeek V4.1 Flash (`deepseek-flash`) in all three slots. The strong slot (teacher) and vision slot run at **high** reasoning. The cheap slot (extraction, auditing, research) runs at **low**, set 2026-10-29 to cut cost.
- **Measured cost:** about **$0.11** for one long lesson. ~80% is conversation, mostly hidden reasoning; caching already covers ~89% of input.
- **Data:** the courses "Microeconomics for Everyday Life" (17 lessons) and "Microeconomics for Policy Debates" (9 lessons); graph with 25 propositions and 20 chains.
- **Dev server:** run `npm run dev` in a Terminal tab, not the browser-pane preview (it gets stopped when a turn ends). Before starting, make sure no old `next dev` process holds port 3000.

## Loose ends (quick)

1. **Smoke-test session.** "Smoke test: what is a price ceiling?" is in the sidebar, created by the merge check. Delete it if you don't want it.
2. **Backup.** The pre-cleanup data backup is in the Claude scratchpad (`data-backup-202610290201`). It also holds the two sessions that disappeared on 2026-10-29 ("i want to learn about microeconomics", "Scarcity, Choice, and Opportunity Cost"). The scratchpad is temporary, so restore them now if you want them.
3. **Settings prompt editor gap.** It doesn't list `course/10-lesson.md`; the API already accepts it. Small fix: add `course` to `app/api/settings/prompts/route.ts` and the editor list.
4. **Upstream test leak.** Some upstream tests write chats into the real `data/`. Always run tests with a temporary `LH_DATA_DIR` (command below). Optionally report this upstream.

## Not yet verified live (do these by using the app)

- [ ] Finish a lesson. The teacher should be refused without a **"New case"** question, pose one, and the lesson should then show **Complete** on the course page.
- [ ] Draft and save a new course. The course page should show a **syllabus drafting** cost.
- [ ] After the next lesson's extraction, compare reasoning tokens per extraction run with ~4,600 (at high). Low should be much smaller.
- [ ] Graph: clicking a node should open its detail panel. My one try missed.
- [ ] The teacher adding a lesson (`course_add_lesson`) in a real session.

## Roadmap (pick one per session)

Process for each item, from the repo's AGENTS.md: investigate → ask design questions one at a time → write a plan → owner approves → then code. Coding is delegated to Sonnet/Haiku subagents; the orchestrator does the contracts, prompt wording, review and browser checks.

### 1. Spaced review (biggest learning impact)

- **Goal:** short reviews of earlier lessons at growing intervals, on the course page.
- **Facts found:**
  - Practice sessions (`kind: "practice"`) already pose retrieval problems tagged with graph proposition ids (`problem.target`), graded by `conclude` (outcome, rung, missClass).
  - Upstream's parked design `docs/vision-assessment.md` (recover with `git show e6f52d3:docs/vision-assessment.md`) specifies a per-proposition Beta belief with recency decay, using **practice evidence only** and no new storage.
  - A "start review" can reuse `POST /api/chats` with `kind: "practice"` and `graphContext`.
- **Open questions:**
  - Which date counts as "taught": the lesson's `lesson_complete` time, the proposition's first-message time, or the chat's creation?
  - Should review sessions be distinguishable from ordinary practice?
  - What interval schedule?
  - Due-items UI: on the course page or the home page?

### 2. Humanities prompt fragment

- **First:** take one **history** and one **philosophy** lesson, then review the transcripts for interpretations taught as fact, single-cause stories, or recall-only questions.
- **Likely shape:** a fragment like `course/` that loads only for humanities topics. It would cover positions held by named schools, steelmanning plus objection and reply, weighing sources and evidence, and causal maps for history.
- **Open questions:** how a topic counts as "humanities" (teacher judgment or a per-course subject), and the exact wording.

### 3. Misconception tracking

- **Goal:** record repeated wrong ideas as items with evidence and a status (active or resolved), and have reviews and lessons target them. The model is DeepTutor's misconception inventory.
- **Constraint:** the repo stores no learner ratings, so this must be evidence, derived where possible.
- **When:** after spaced review exists.

### 4. Textbook upload

- **Today:** you give a file path, and the PDF-reader job (vision slot) reads it.
- **Plan:** an upload button or drag-and-drop; process each book once into a table of contents and chapters; a textbook as a **course source**, so the syllabus comes from the table of contents.
- **Study first:** Bloom (`Li-Evan/Bloom`), OpenTutor (`zijinz456/OpenTutor`) and DeepTutor (`HKUDS/DeepTutor`); all three do PDF → course.

### 5. Mobile PWA

- **Order:** a **login** first (web mode's API has no auth), then a mobile layout for the lesson and course screens, then a manifest and icons.
- **Hosting:** your PC plus Tailscale (private), or a small server.

### Optional

- **Contribute upstream:** offer course mode as a PR to `amosblomqvist/learnharness`. It's public, and the author decides.
- **Spending cap or warnings:** declined for now. Revisit if costs grow.

## Commands

```bash
# tests — ALWAYS with a temp data dir (upstream tests leak into data/ otherwise)
T=$(mktemp -d); LH_DATA_DIR="$T" NODE_ENV=test npx tsx --test tests/*.test.ts tests/*.test.tsx; rm -rf "$T"
# expect 13 Windows-only failures (auth file modes, LH_DATA_DIR child process, release CLI, subscriptions, main loader)

npx tsc --noEmit
npx eslint .

# sync with upstream later
git fetch upstream && git checkout -b integrate/upstream-X main && git merge upstream/main
```

Never commit `package-lock.json` (npm reorders one key on Windows) or `.claude/`.
