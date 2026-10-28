import { draftCourse } from "../agent/course-drafter.ts";
import { piEngineForSpec } from "../agent/models.ts";
import type { CallUsage } from "../core/contracts.ts";
import type { Course, CourseDraft, CourseIntake, Lesson, LessonStatus } from "../core/contracts/course.ts";
import { calibrationSummary, type CalibrationChatInput, type CalibrationSummary } from "../core/calibration.ts";
import { continueLessonId, courseProgress, lessonIdFor, lessonStatus } from "../core/courses.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { modelsNotConfigured, providerKeyMissing } from "../core/settings.ts";
import type { ModelsNotConfigured, ProviderKeyMissing } from "../core/settings.ts";
import { graphCostSummary } from "../core/cost-summary.ts";
import { isSubscriptionModel, turnCost } from "../core/prices.ts";
import { providerKeyPresent } from "./keys.ts";
import { callCost, sessionCost } from "./pricing.ts";
import { effectiveSettings, stores } from "./stores.ts";

/**
 * The course server seam (course mode, docs/course-mode.md "Server and
 * routes"): orchestration only. Structure lives in the CourseStore, the
 * lesson<->session link on the chat record, status is derived from the
 * linked chat's transcript (core/courses.ts) — nothing here is stored twice.
 */

export type LessonView = Lesson & {
	status: LessonStatus;
	chatId: string | null;
	/** Detail views only: the lesson session's cost + its extraction runs
	 *  (0 without a session). */
	costDollars?: number;
};

/** Detail views only. Unpriced models count $0 and set `unpriced`. */
export interface CourseCost {
	lessonsDollars: number;
	draftDollars: number;
	totalDollars: number;
	unpriced: boolean;
}

export interface CourseView {
	course: Course;
	lessons: LessonView[];
	continueLessonId: string | null;
	progress: { completed: number; total: number };
	/** Present only on courseView / saveCourseEdits (not the list). */
	calibration?: CalibrationSummary;
	/** Present only on courseView / saveCourseEdits (not the list). */
	cost?: CourseCost;
}

export interface CourseSummary {
	id: string;
	title: string;
	topic: string;
	updatedAt: string;
	progress: { completed: number; total: number };
	continueLessonId: string | null;
}

/** lessonId -> the OLDEST chat linked to that lesson of this course
 *  (one lesson = one session). */
function lessonChatIds(courseId: string): Map<string, string> {
	const oldest = new Map<string, { id: string; createdAt: string }>();
	for (const c of stores.chatStore.listChats()) {
		if (c.lesson?.courseId !== courseId) continue;
		const cur = oldest.get(c.lesson.lessonId);
		if (!cur || c.createdAt < cur.createdAt) oldest.set(c.lesson.lessonId, { id: c.id, createdAt: c.createdAt });
	}
	return new Map([...oldest].map(([lessonId, v]) => [lessonId, v.id]));
}

function viewOf(course: Course, opts: { withCalibration?: boolean; withCost?: boolean } = {}): CourseView {
	const chatIds = lessonChatIds(course.id);
	const statuses: Record<string, LessonStatus> = {};
	const calChats: CalibrationChatInput[] = [];
	let lessonsDollars = 0;
	let unpriced = false;
	const lessons = course.lessons.map((l): LessonView => {
		const chatId = chatIds.get(l.id) ?? null;
		const chat = chatId ? stores.chatStore.getChat(chatId) : null;
		const status = lessonStatus(chat);
		if (chat) calChats.push({ lessonTitle: l.title, tree: chat.tree, messages: chat.messages });
		statuses[l.id] = status;
		if (!opts.withCost) return { ...l, status, chatId };
		let costDollars = 0;
		if (chat) {
			const session = sessionCost(chat);
			const extraction = graphCostSummary(
				{ chats: [{ title: chat.title ?? chat.id, extractions: chat.extractions ?? [] }], sources: [] },
				callCost,
			);
			costDollars = session.cost + extraction.totalDollars;
			if (session.unpriced > 0 || extraction.unpricedRuns > 0) unpriced = true;
		}
		lessonsDollars += costDollars;
		return { ...l, status, chatId, costDollars };
	});
	let cost: CourseCost | undefined;
	if (opts.withCost) {
		let draftDollars = 0;
		const du = course.draftUsage;
		if (du) {
			const d = turnCost(du, callCost);
			if (d !== null) draftDollars = d;
			else if (!isSubscriptionModel(du.model) && du.steps.length > 0) unpriced = true;
		}
		cost = { lessonsDollars, draftDollars, totalDollars: lessonsDollars + draftDollars, unpriced };
	}
	return {
		course,
		lessons,
		continueLessonId: continueLessonId(course, statuses),
		progress: courseProgress(course, statuses),
		...(opts.withCalibration ? { calibration: calibrationSummary({ chats: calChats }) } : {}),
		...(cost ? { cost } : {}),
	};
}

export function courseView(id: string): CourseView | null {
	const course = stores.courseStore.getCourse(id);
	return course ? viewOf(course, { withCalibration: true, withCost: true }) : null;
}

export function listCourseViews(): CourseSummary[] {
	return stores.courseStore.listCourses().map((course) => {
		const v = viewOf(course);
		return {
			id: course.id,
			title: course.title,
			topic: course.topic,
			updatedAt: course.updatedAt,
			progress: v.progress,
			continueLessonId: v.continueLessonId,
		};
	});
}

export type DraftUsage = { model: string; steps: CallUsage[] };

export type DraftOutcome =
	| { ok: true; draft: CourseDraft; usage: DraftUsage }
	| { ok: false; status: 503; body: ModelsNotConfigured | ProviderKeyMissing }
	| { ok: false; status: 502; body: { error: string } };

/** One strong-slot model call; nothing saved. The engine resolves exactly
 *  like the teacher's (chat-handler): strong slot, key-presence gated. */
export async function draftCourseFor(topic: string, intake: CourseIntake): Promise<DraftOutcome> {
	const spec = resolveConversationSpec(undefined, effectiveSettings().models.strong);
	if (!spec) return { ok: false, status: 503, body: modelsNotConfigured(["strong"]) };
	if (!providerKeyPresent(spec.provider)) {
		return { ok: false, status: 503, body: providerKeyMissing(spec.provider, ["strong"]) };
	}
	try {
		// Money channel: one step per model call (a retry is a second step),
		// mapped exactly like chat-handler's collectUsage.
		const steps: CallUsage[] = [];
		const draft = await draftCourse(
			{ topic, intake },
			{
				engine: piEngineForSpec(spec, false),
				onUsage: (usage) =>
					steps.push({
						inputTokens: usage.input,
						outputTokens: usage.output,
						cacheReadTokens: usage.cacheRead,
						cacheWriteTokens: usage.cacheWrite,
						cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
						reasoningTokens: usage.reasoning ?? 0,
					}),
			},
		);
		return { ok: true, draft, usage: { model: `${spec.provider}:${spec.id}`, steps } };
	} catch (err) {
		return { ok: false, status: 502, body: { error: err instanceof Error ? err.message : String(err) } };
	}
}

export function createCourseFromDraft(input: {
	topic: string;
	intake: CourseIntake;
	title: string;
	lessons: Array<{ title: string; goal: string; learnerAdded?: boolean }>;
	draftUsage?: DraftUsage;
}): Course {
	const ids: string[] = [];
	const lessons = input.lessons.map((l): Lesson => {
		const id = lessonIdFor(l.title, ids);
		ids.push(id);
		return { id, title: l.title, goal: l.goal, origin: l.learnerAdded ? "learner" : "syllabus" };
	});
	return stores.courseStore.createCourse({
		title: input.title,
		topic: input.topic,
		intake: input.intake,
		lessons,
		...(input.draftUsage ? { draftUsage: input.draftUsage } : {}),
	});
}

/** Save the learner's syllabus edits. Known ids keep origin + addedReason;
 *  id-less entries are new learner lessons; omitted lessons just vanish
 *  (their sessions stay ordinary sessions). Throws on unknown course or an
 *  id that isn't in the course / is repeated (the route maps to 400/404). */
export function saveCourseEdits(
	id: string,
	input: { title: string; lessons: Array<{ id?: string; title: string; goal: string }> },
): CourseView | null {
	const course = stores.courseStore.getCourse(id);
	if (!course) return null;
	const existing = new Map(course.lessons.map((l) => [l.id, l]));
	const used = new Set<string>();
	for (const l of input.lessons) {
		if (l.id === undefined) continue;
		if (!existing.has(l.id)) throw new Error(`Unknown lesson id: ${l.id}`);
		if (used.has(l.id)) throw new Error(`Duplicate lesson id: ${l.id}`);
		used.add(l.id);
	}
	const taken = new Set([...existing.keys()]);
	const lessons = input.lessons.map((l): Lesson => {
		if (l.id !== undefined) {
			const prev = existing.get(l.id)!;
			return { ...prev, title: l.title, goal: l.goal };
		}
		const newId = lessonIdFor(l.title, taken);
		taken.add(newId);
		return { id: newId, title: l.title, goal: l.goal, origin: "learner" };
	});
	return viewOf(stores.courseStore.saveCourse(id, { title: input.title, lessons }), { withCalibration: true, withCost: true });
}

/** Delete the course; its sessions remain (their link just dangles). */
export function deleteCourse(id: string): boolean {
	return stores.courseStore.deleteCourse(id);
}

export type StartLessonResult =
	| { chatId: string; resumed: true }
	| { chatId: string; resumed: false; prompt: string };

/** Resume the lesson's session, or birth one (stamped from the strong slot
 *  like POST /api/chats). null = unknown course or lesson. */
export function startLesson(courseId: string, lessonId: string): StartLessonResult | null {
	const course = stores.courseStore.getCourse(courseId);
	const lesson = course?.lessons.find((l) => l.id === lessonId);
	if (!course || !lesson) return null;
	const linked = lessonChatIds(courseId).get(lessonId);
	if (linked) return { chatId: linked, resumed: true };
	const chat = stores.chatStore.createChat(lesson.title, undefined, { courseId, lessonId });
	// Same birth stamp as POST /api/chats: the strong slot, verbatim; absent
	// slot -> no stamp (the turn gate's 503 refuses honestly downstream).
	const strong = stores.settingsStore.readSettings()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	return { chatId: chat.id, resumed: false, prompt: lesson.goal };
}

// ─── Request-body parsing (hand validation, like the other routes) ──────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseIntake(raw: unknown): Parsed<CourseIntake> {
	const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	const level = str(o.level);
	const purpose = str(o.purpose);
	const depth = str(o.depth);
	if (!level) return { ok: false, error: "intake.level must be a non-empty string" };
	if (!purpose) return { ok: false, error: "intake.purpose must be a non-empty string" };
	if (!depth) return { ok: false, error: "intake.depth must be a non-empty string" };
	if (o.notes !== undefined && typeof o.notes !== "string") return { ok: false, error: "intake.notes must be a string" };
	const notes = str(o.notes);
	return { ok: true, value: { level, purpose, depth, ...(notes ? { notes } : {}) } };
}

/** A non-empty array of lessons with trimmed title/goal; `id` / `learnerAdded`
 *  pass through when well-typed. */
export function parseLessons(raw: unknown): Parsed<Array<{ id?: string; title: string; goal: string; learnerAdded?: boolean }>> {
	if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "lessons must be a non-empty array" };
	const out: Array<{ id?: string; title: string; goal: string; learnerAdded?: boolean }> = [];
	for (const [i, item] of raw.entries()) {
		const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
		const title = str(o.title);
		const goal = str(o.goal);
		if (!title) return { ok: false, error: `lessons[${i}].title must be a non-empty string` };
		if (!goal) return { ok: false, error: `lessons[${i}].goal must be a non-empty string` };
		if (o.id !== undefined && str(o.id) === null) return { ok: false, error: `lessons[${i}].id must be a non-empty string` };
		if (o.learnerAdded !== undefined && typeof o.learnerAdded !== "boolean") {
			return { ok: false, error: `lessons[${i}].learnerAdded must be a boolean` };
		}
		out.push({
			...(o.id !== undefined ? { id: str(o.id)! } : {}),
			title,
			goal,
			...(o.learnerAdded !== undefined ? { learnerAdded: o.learnerAdded as boolean } : {}),
		});
	}
	return { ok: true, value: out };
}

const STEP_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "cacheWrite1hTokens", "reasoningTokens"] as const;

/** Optional `draftUsage`: { model: string, steps: [{ token counts }] }.
 *  Absent/null -> ok with no value; present token fields must be finite,
 *  non-negative numbers. Unknown step fields are dropped. */
export function parseDraftUsage(raw: unknown): Parsed<DraftUsage | undefined> {
	if (raw === undefined || raw === null) return { ok: true, value: undefined };
	if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "draftUsage must be an object" };
	const o = raw as Record<string, unknown>;
	const model = str(o.model);
	if (!model) return { ok: false, error: "draftUsage.model must be a non-empty string" };
	if (!Array.isArray(o.steps)) return { ok: false, error: "draftUsage.steps must be an array" };
	const steps: CallUsage[] = [];
	for (const [i, item] of o.steps.entries()) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			return { ok: false, error: `draftUsage.steps[${i}] must be an object` };
		}
		const s = item as Record<string, unknown>;
		const n: Record<string, number | undefined> = {};
		for (const f of STEP_FIELDS) {
			const v = s[f];
			if (v === undefined) continue;
			if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
				return { ok: false, error: `draftUsage.steps[${i}].${f} must be a finite non-negative number` };
			}
			n[f] = v;
		}
		steps.push({
			inputTokens: n.inputTokens,
			outputTokens: n.outputTokens,
			cacheReadTokens: n.cacheReadTokens,
			cacheWriteTokens: n.cacheWriteTokens,
			reasoningTokens: n.reasoningTokens,
			...(n.cacheWrite1hTokens !== undefined ? { cacheWrite1hTokens: n.cacheWrite1hTokens } : {}),
		});
	}
	return { ok: true, value: { model, steps } };
}

export { str as nonEmptyTrimmed };
