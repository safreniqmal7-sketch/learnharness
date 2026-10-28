import { randomUUID } from "node:crypto";
import type { AssistantMessage, Message, Usage } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CourseDraft, CourseIntake } from "../core/contracts/course.ts";
import { piEngineFor, type PiEngine } from "./models.ts";

/**
 * The syllabus drafter (course mode, docs/course-mode.md): ONE strong-slot
 * model call — no agent loop, no tools — that turns a topic + the learner's
 * intake into an ordered list of lessons. Nothing is saved here; the route
 * returns the draft for the learner to edit.
 *
 * Engine: ROLE_SLOT maps "teacher" to the strong slot, and the production
 * route injects the settings-resolved strong-slot engine (exactly what
 * chat-handler does for the teacher). Absent an injected engine this falls
 * back to piEngineFor("teacher"), the honest thrower for a wiring miss.
 *
 * A bad draft is refused, never guessed at: one retry with the validation
 * error appended, then a clear Error.
 */

/** Hard cap on lessons kept from a draft (a longer draft is truncated). */
export const MAX_DRAFT_LESSONS = 30;

export const COURSE_DRAFTER_SYSTEM_PROMPT = `You design syllabi for a one-to-one tutoring app. Given a topic and a description of the learner, you produce a course: a title and an ordered list of lessons.

Each lesson is taught in its own focused session by a teacher who first probes what the learner already knows, then plans and teaches toward the lesson's goal. So each lesson has:
- "title": a short label (a few words).
- "goal": ONE sentence stating the understanding the learner should have at the end of the lesson ("Can explain why ... and apply it to ..."). It is handed to the teacher as the lesson's target, so make it specific and checkable, not a list of topics.

Rules:
- Order the lessons so foundations come before whatever depends on them.
- Size each lesson for one focused session: one coherent idea or skill, not a whole chapter and not a trivial fact.
- Choose a sensible number of lessons for the stated depth (typically 6 to 20): fewer for an overview, more for a thorough course. Do not pad.
- Fit the learner: start from their stated level, serve their stated purpose, and respect their notes. Include no lesson on things outside that purpose.
- Write any money or prices in words (for example "5 dollars"), never with a dollar sign: a bare "$" is read as math markup. Never use LaTeX for them.

Respond with JSON ONLY: no prose before or after, no code fences. Exactly this shape:
{"title": "<course title>", "lessons": [{"title": "<lesson title>", "goal": "<one-sentence goal>"}]}`;

const DraftSchema = Type.Object({
	title: Type.String(),
	lessons: Type.Array(Type.Object({ title: Type.String(), goal: Type.String() })),
});

export interface DraftCourseDeps {
	/** The strong-slot engine (test seam and production injection). */
	engine?: PiEngine;
	/** Abort mid-model-call. */
	abortSignal?: AbortSignal;
	/** Money channel: one call per model request (the retry is a second). */
	onUsage?: (usage: Usage) => void;
}

/** The user message: the topic and EVERY intake field, verbatim. */
export function buildDraftPrompt(input: { topic: string; intake: CourseIntake }): string {
	const { topic, intake } = input;
	const lines = [
		`Topic: ${topic}`,
		`Learner's level: ${intake.level}`,
		`Learner's purpose: ${intake.purpose}`,
		`Desired depth: ${intake.depth}`,
	];
	if (intake.notes?.trim()) lines.push(`Other notes from the learner: ${intake.notes.trim()}`);
	return `${lines.join("\n")}\n\nDraft the course syllabus as JSON.`;
}

/** Strip a code fence and isolate the outermost JSON object. */
function extractJson(text: string): string {
	let s = text.trim();
	const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
	if (fence) s = fence[1]!.trim();
	const start = s.indexOf("{");
	const end = s.lastIndexOf("}");
	return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

/** Parse + validate model text into a draft; returns the problem on failure. */
function parseDraft(text: string): { draft: CourseDraft } | { problem: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(extractJson(text));
	} catch (err) {
		return { problem: `the reply was not valid JSON (${err instanceof Error ? err.message : String(err)})` };
	}
	if (!Value.Check(DraftSchema, raw)) {
		const first = [...Value.Errors(DraftSchema, raw)][0];
		return { problem: `the JSON did not match the required shape (${first ? `${first.instancePath || "/"}: ${first.message}` : "unknown"})` };
	}
	const title = raw.title.trim();
	if (!title) return { problem: "the course title was empty" };
	if (raw.lessons.length === 0) return { problem: "the course had no lessons" };
	const lessons = raw.lessons.slice(0, MAX_DRAFT_LESSONS).map((l) => ({ title: l.title.trim(), goal: l.goal.trim() }));
	const bad = lessons.findIndex((l) => !l.title || !l.goal);
	if (bad >= 0) return { problem: `lesson ${bad + 1} had an empty title or goal` };
	return { draft: { title, lessons } };
}

/** One raw model call (no agent loop): same pattern as the visual-maker /
 *  pdf-reader streamOnce. */
async function completeOnce(engine: PiEngine, systemPrompt: string, messages: Message[], deps: DraftCourseDeps): Promise<AssistantMessage> {
	const stream = engine.streamFn(engine.model, normalizeContext({ systemPrompt, messages, tools: [] }), {
		sessionId: randomUUID(),
		reasoning: engine.level && engine.level !== "off" ? engine.level : undefined,
		signal: deps.abortSignal,
	} as never);
	for await (const event of stream) {
		if (event.type === "done") {
			deps.onUsage?.(event.message.usage);
			return event.message;
		}
		if (event.type === "error") {
			if (event.reason === "aborted") {
				const err = new Error("aborted");
				err.name = "AbortError";
				throw err;
			}
			throw new Error(event.error.errorMessage ?? "the model call failed");
		}
	}
	throw new Error("the model stream ended without a result");
}

const textOf = (m: AssistantMessage): string =>
	m.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");

export async function draftCourse(
	input: { topic: string; intake: CourseIntake },
	deps: DraftCourseDeps = {},
): Promise<CourseDraft> {
	const engine = deps.engine ?? piEngineFor("teacher");
	const messages: Message[] = [{ role: "user", content: buildDraftPrompt(input), timestamp: Date.now() }];
	let problem = "";
	for (let attempt = 0; attempt < 2; attempt++) {
		const reply = await completeOnce(engine, COURSE_DRAFTER_SYSTEM_PROMPT, messages, deps);
		const parsed = parseDraft(textOf(reply));
		if ("draft" in parsed) return parsed.draft;
		problem = parsed.problem;
		messages.push(reply, {
			role: "user",
			content: `That reply was rejected: ${problem}. Reply again with ONLY the JSON object in the required shape.`,
			timestamp: Date.now(),
		});
	}
	throw new Error(`The syllabus drafter returned an invalid draft twice (${problem}). Try again.`);
}
