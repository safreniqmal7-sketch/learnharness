/**
 * Course contracts — a field turned into an ordered syllabus of lessons
 * (course mode, owner 2026-10-26; plan: docs/course-mode.md).
 *
 * Part of the domain-split contracts (src/core/contracts/). Pure types +
 * tiny constants. The course carries STRUCTURE only — the plan tree's own
 * discipline: lesson progress is derived from each lesson session's
 * transcript (core/courses.ts), never stored. The lesson↔session link lives
 * on the chat record alone (ChatRecord.lesson), so it can never drift.
 */

/** Who put a lesson in the syllabus: the drafter, the teacher mid-lesson
 *  (a missing foundation, owner decision 4), or the learner's own edit. */
export type LessonOrigin = "syllabus" | "teacher" | "learner";

export interface Lesson {
	/** Stable slug, unique within its course: "price-elasticity". Chosen once. */
	id: string;
	/** Short label for the course page. */
	title: string;
	/** One sentence: the understanding this lesson ends at. Becomes the
	 *  lesson session's first message. */
	goal: string;
	origin: LessonOrigin;
	/** Teacher-added lessons only: why the teacher added it (shown as the
	 *  "Added by the teacher" notice). */
	addedReason?: string;
}

/** The fixed intake form (owner, open point 1): no AI-generated questions. */
export interface CourseIntake {
	/** Where the learner is starting from, in their words ("complete beginner"). */
	level: string;
	/** Why they're learning it ("understand policy debates"). */
	purpose: string;
	/** How deep to go ("intro overview" … "undergraduate course"). */
	depth: string;
	/** Optional free text: anything else the drafter should know. */
	notes?: string;
}

export interface Course {
	id: string;
	title: string;
	/** The topic as the learner typed it ("microeconomics"). */
	topic: string;
	intake: CourseIntake;
	/** Array order IS syllabus order. */
	lessons: Lesson[];
	createdAt: string;
	updatedAt: string;
}

/** The chat record's link to its lesson (one lesson = one session, owner
 *  decision 9). Stamped once at lesson-session creation. */
export interface LessonLink {
	courseId: string;
	lessonId: string;
}

/** A drafted lesson before it's saved: the drafter proposes, the learner
 *  edits, saving assigns origins ("syllabus", or "learner" for ones they added). */
export interface DraftLesson {
	title: string;
	goal: string;
}

export interface CourseDraft {
	title: string;
	lessons: DraftLesson[];
}

/** Derived, never stored (core/courses.ts). */
export type LessonStatus = "not-started" | "in-progress" | "complete";

/** The completion gate's confidence floor (owner decision 1): the latest
 *  quiz check on every goal node must be correct at ≥ this raw 0-100
 *  confidence — the slider's 70 stop (question-core CONFIDENCE_STOPS). */
export const LESSON_COMPLETE_MIN_CONFIDENCE = 70;

/** The tool names course mode adds to lesson sessions — shared so the
 *  derivation (core) and the tool surface (agent) can't disagree. */
export const LESSON_COMPLETE_TOOL = "lesson_complete";
export const COURSE_ADD_LESSON_TOOL = "course_add_lesson";
