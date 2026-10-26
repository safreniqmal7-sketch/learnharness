/**
 * Course mode, step 4 — lesson-session wiring (docs/course-mode.md "Agent
 * side"): the course prompt fragment + lesson block, the two teacher tools,
 * and quiz-in-explain-mode, all lesson-sessions-only. Ordinary sessions are
 * pinned byte-for-byte. Isolated LH_DATA_DIR (set BEFORE any config-loading
 * import, so every app import is dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Course, PlanTree } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { PiEngine } from "../src/agent/models.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-course-lesson-"));
process.env.LH_DATA_DIR = TMP_DATA;
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";

const { chatStore } = await import("../src/store/chats.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { createTeacherAgent, composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { createTeacherTools } = await import("../src/agent/tools.ts");
const { lessonContextBlock, allSegmentPaths, effectivePromptSegments } = await import("../src/agent/prompt-segments.ts");
const { lessonCompleted, lessonIdFor } = await import("../src/core/courses.ts");
const { persistTurn } = await import("../src/server/turn-service.ts");
const { handleChatRequest } = await import("../src/server/chat-handler.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const LESSON_HEADING = "## This session is a course lesson";

function newCourse(): Course {
	return courseStore.createCourse({
		title: "Microeconomics",
		topic: "microeconomics",
		intake: { level: "beginner", purpose: "curiosity", depth: "intro" },
		lessons: [
			{ id: "scarcity", title: "Scarcity", goal: "Explain scarcity.", origin: "syllabus" },
			{ id: "demand", title: "Demand", goal: "Explain demand curves.", origin: "syllabus" },
			{ id: "supply", title: "Supply", goal: "Explain supply curves.", origin: "syllabus" },
		],
	});
}

function toolsFor(course: Course, lessonId: string, chatId: string, enabled?: Record<string, boolean>) {
	return createTeacherTools(
		{
			chatId,
			chatStore,
			jobStore: {} as never,
			spawn: () => {},
			lesson: { link: { courseId: course.id, lessonId }, courseStore },
		},
		enabled,
	);
}

const TREE = {
	nodes: [{ id: "b", title: "Title b" }, { id: "a", title: "Title a" }],
	edges: [{ from: "a", to: "b" }],
	version: 1,
} as unknown as PlanTree;

/** A quiz check on node b, answered with the given verdict (the record shape
 *  the gate folds: assistant toolCall + non-error toolResult with details). */
function answeredCheck(id: string, correct: boolean, confidence: number): LhMessage[] {
	return [
		{ id: `c-${id}`, role: "assistant", content: [{ type: "toolCall", id, name: "quiz", arguments: { type: "check", nodeId: "b" } }] },
		{ id: `r-${id}`, role: "toolResult", toolCallId: id, toolName: "quiz", content: [], details: { kind: "quiz", correct, confidence, dontKnow: false }, isError: false },
	] as unknown as LhMessage[];
}

let callCounter = 0;

/** Drive the REAL teacher agent through one lesson_complete call, persist the
 *  turn through persistTurn into the real chat store, and return the record. */
async function completeThroughAgent(chatId: string, course: Course): Promise<LhMessage[]> {
	const faux = createFauxCore({});
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("lesson_complete", {}, { id: `lc-${callCounter++}` })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };
	const base = chatStore.getChat(chatId)!.messages;
	const agent = createTeacherAgent(
		{ chatId, chatStore, jobStore: {} as never, spawn: () => {}, lesson: { link: { courseId: course.id, lessonId: "scarcity" }, courseStore } },
		{ engine, messages: base as never, lessonBlock: "x" },
	);
	await agent.prompt("I think I'm done.");
	persistTurn(chatStore, chatId, base.length, agent.state.messages, false);
	return chatStore.getChat(chatId)!.messages;
}

describe("prompt", () => {
	it("course fragments are a listed, validated, overridable segment set; the teacher list is unchanged", () => {
		assert.equal(isValidSegmentPath("course/10-lesson.md"), true);
		assert.equal(allSegmentPaths().includes("course/10-lesson.md"), true);
		assert.deepEqual(effectivePromptSegments("course", {}).map((s) => s.path), ["course/10-lesson.md"]);
		assert.equal(effectivePromptSegments("teacher", {}).some((s) => s.path.startsWith("course/")), false);
	});

	it("ordinary prompt is byte-identical; lesson prompt adds the fragment before the shared appendix and the block last", () => {
		const course = newCourse();
		const block = lessonContextBlock(course, course.lessons[1]!);
		const ordinary = composeInstructions("teacher", {});
		assert.equal(ordinary.includes(LESSON_HEADING), false);
		assert.equal(composeInstructions("teacher", {}, undefined), ordinary);
		const lesson = composeInstructions("teacher", {}, block);
		assert.equal(lesson.includes(LESSON_HEADING), true);
		const sharedFirst = effectivePromptSegments("teacher", {}).find((s) => s.path.startsWith("shared/"))!.sourceText.trim();
		assert.ok(lesson.indexOf(LESSON_HEADING) < lesson.indexOf(sharedFirst), "course fragment precedes the shared appendix");
		const lastTeacher = effectivePromptSegments("teacher", {}).filter((s) => s.path.startsWith("teacher/")).at(-1)!.sourceText.trim();
		assert.ok(lesson.indexOf(lastTeacher) < lesson.indexOf(LESSON_HEADING), "course fragment follows the teacher's own");
		assert.ok(lesson.endsWith(block), "the lesson block closes the prompt");
		// removing the fragment and the block gives back exactly the ordinary prompt
		const fragment = effectivePromptSegments("course", {})[0]!.sourceText.trim();
		const stripped = lesson.replace(`${fragment}\n\n---\n\n`, "").replace(`\n\n---\n\n${block}`, "");
		assert.equal(stripped, ordinary);
		// the prober never composes it
		assert.equal(composeInstructions("prober", {}, block).includes(LESSON_HEADING), false);
	});

	it("an enabled override of the course fragment composes in its place", () => {
		const course = newCourse();
		const block = lessonContextBlock(course, course.lessons[0]!);
		const file = path.join(TMP_DATA, "prompts", "course", "10-lesson.md");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "MY COURSE DOCTRINE");
		try {
			const on = composeInstructions("teacher", { "course/10-lesson.md": true }, block);
			assert.ok(on.includes("MY COURSE DOCTRINE") && !on.includes(LESSON_HEADING));
			assert.ok(composeInstructions("teacher", {}, block).includes(LESSON_HEADING));
		} finally {
			fs.rmSync(path.dirname(file), { recursive: true, force: true });
		}
	});

	it("lesson block text: title, this lesson, ordered syllabus with a marker; reflects a mid-session addition", async () => {
		const course = newCourse();
		const chat = chatStore.createChat("lesson", undefined, { courseId: course.id, lessonId: "demand" });
		assert.equal(
			lessonContextBlock(course, course.lessons[1]!),
			[
				"## Lesson context",
				"",
				"Course: Microeconomics",
				"This lesson (2 of 3): demand — Demand",
				"Goal: Explain demand curves.",
				"",
				'Syllabus, in order ("->" marks this lesson):',
				"   scarcity — Scarcity: Explain scarcity.",
				"-> demand — Demand: Explain demand curves.",
				"   supply — Supply: Explain supply curves.",
			].join("\n"),
		);
		// the teacher adds a lesson mid-session; the next turn's block is rebuilt from the course
		const add = toolsFor(course, "demand", chat.id).course_add_lesson!;
		await add.execute("t", { title: "Opportunity cost", goal: "Define it.", reason: "needed", beforeLessonId: "demand" } as never, undefined as never, undefined as never);
		const fresh = courseStore.getCourse(course.id)!;
		const rebuilt = lessonContextBlock(fresh, fresh.lessons.find((l) => l.id === "demand")!);
		assert.ok(rebuilt.includes("This lesson (3 of 4): demand"));
		assert.ok(rebuilt.includes("   opportunity-cost — Opportunity cost: Define it."));
	});
});

describe("tools", () => {
	const names = (t: Record<string, AgentTool<any>>) => Object.keys(t).sort();

	it("ordinary toolset unchanged; lesson adds exactly lesson_complete + course_add_lesson", () => {
		const course = newCourse();
		const base = createTeacherTools({ chatId: "c", chatStore, jobStore: {} as never, spawn: () => {} });
		const lesson = toolsFor(course, "scarcity", "c");
		assert.deepEqual(names(lesson).filter((n) => !names(base).includes(n)), ["course_add_lesson", "lesson_complete"]);
		assert.deepEqual(names(base).filter((n) => !names(lesson).includes(n)), []);
		assert.equal("lesson_complete" in base, false);
	});

	it("explain mechanic: ordinary has explain only; lesson has explain AND quiz", () => {
		const course = newCourse();
		const base = createTeacherTools({ chatId: "c", chatStore, jobStore: {} as never, spawn: () => {} }, { explain: true });
		assert.equal("quiz" in base, false);
		assert.equal("explain" in base, true);
		const lesson = toolsFor(course, "scarcity", "c", { explain: true });
		assert.equal("quiz" in lesson && "explain" in lesson, true);
		// choice mechanic: quiz, no explain, in both
		assert.equal("explain" in toolsFor(course, "scarcity", "c"), false);
	});

	it("course_add_lesson: insertion order, origin/addedReason, unique ids, end/unknown placement", async () => {
		const course = newCourse();
		const t = toolsFor(course, "demand", "c").course_add_lesson!;
		const run = (input: Record<string, unknown>) => t.execute("id", input as never, undefined as never, undefined as never) as Promise<any>;
		const r1 = await run({ title: "Opportunity cost", goal: "g1", reason: "because", beforeLessonId: "demand" });
		assert.equal(r1.isError, undefined);
		assert.deepEqual(courseStore.getCourse(course.id)!.lessons.map((l) => l.id), ["scarcity", "opportunity-cost", "demand", "supply"]);
		const added = courseStore.getCourse(course.id)!.lessons[1]!;
		assert.equal(added.origin, "teacher");
		assert.equal(added.addedReason, "because");
		assert.equal(added.goal, "g1");
		assert.equal(r1.details.lessonId, "opportunity-cost");
		const r2 = await run({ title: "Opportunity cost", goal: "g2", reason: "again", beforeLessonId: "nope" });
		assert.equal(r2.details.lessonId, "opportunity-cost-2");
		assert.equal(courseStore.getCourse(course.id)!.lessons.at(-1)!.id, "opportunity-cost-2", "unknown beforeLessonId appends");
		await run({ title: "Last", goal: "g3", reason: "r" });
		assert.equal(courseStore.getCourse(course.id)!.lessons.at(-1)!.id, "last");
		assert.equal(lessonIdFor("Last", ["last"]), "last-2");
	});

	it("course_add_lesson failures are error results, never throws", async () => {
		const course = newCourse();
		const t = toolsFor(course, "demand", "c").course_add_lesson!;
		const blank = (await t.execute("id", { title: "  ", goal: "g", reason: "r" } as never, undefined as never, undefined as never)) as any;
		assert.equal(blank.isError, true);
		courseStore.deleteCourse(course.id);
		const gone = (await t.execute("id", { title: "T", goal: "g", reason: "r" } as never, undefined as never, undefined as never)) as any;
		assert.equal(gone.isError, true);
	});

	it("lesson_complete refused -> persisted isError, lessonCompleted false; accepted -> true", async () => {
		const course = newCourse();
		const chat = chatStore.createChat("lesson", undefined, { courseId: course.id, lessonId: "scarcity" });
		chatStore.saveTree(chat.id, TREE);
		// no evidence yet: refused
		let messages = await completeThroughAgent(chat.id, course);
		const result = messages.find((m) => (m as any).role === "toolResult" && (m as any).toolName === "lesson_complete") as any;
		assert.equal(result.isError, true, "refusal persists as an error result");
		assert.match(result.content[0].text, /Goal node "b"/);
		assert.equal(lessonCompleted(messages), false);
		// a wrong answer is still refused
		chatStore.saveMessages(chat.id, [...messages, ...answeredCheck("q1", false, 90)]);
		messages = await completeThroughAgent(chat.id, course);
		assert.equal(lessonCompleted(messages), false);
		// a correct, confident answer: accepted
		chatStore.saveMessages(chat.id, [...chatStore.getChat(chat.id)!.messages, ...answeredCheck("q2", true, 90)]);
		messages = await completeThroughAgent(chat.id, course);
		const accepted = messages.filter((m) => (m as any).role === "toolResult" && (m as any).toolName === "lesson_complete").at(-1) as any;
		assert.equal(accepted.isError, false);
		assert.equal(lessonCompleted(messages), true);
	});
});

describe("handler: which sessions are lesson sessions", () => {
	const PROBE_DONE = [
		{ id: "pd", role: "assistant", content: [{ type: "toolCall", id: "pd1", name: "probe_done", arguments: {} }] },
		{ id: "pdr", role: "toolResult", toolCallId: "pd1", toolName: "probe_done", content: [{ type: "text", text: "ok" }], isError: false },
	] as unknown as LhMessage[];

	async function lessonBlockSeen(setup: (courseId: string) => ReturnType<typeof chatStore.createChat>): Promise<string | undefined> {
		const course = newCourse();
		const chat = setup(course.id);
		chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
		chatStore.saveMessages(chat.id, PROBE_DONE);
		const faux = createFauxCore({});
		faux.setResponses([fauxAssistantMessage([fauxText("hello")])]);
		const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };
		let seen: string | undefined;
		const res = await handleChatRequest(
			new Request("http://test/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chatId: chat.id, input: { type: "text", text: "go on" } }),
			}),
			(opts) => {
				seen = opts.lessonBlock;
				return createTeacherAgent(undefined, { engine, messages: opts.messages });
			},
		);
		assert.equal(res.status, 200);
		await new Promise((r) => setTimeout(r, 100));
		return seen;
	}

	it("a teaching session linked to an existing lesson gets the block", async () => {
		const seen = await lessonBlockSeen((cid) => chatStore.createChat("l", undefined, { courseId: cid, lessonId: "supply" }));
		assert.ok(seen?.includes("This lesson (3 of 3): supply"));
	});

	it("ordinary, deleted-course, removed-lesson and practice sessions are ordinary", async () => {
		assert.equal(await lessonBlockSeen(() => chatStore.createChat("plain")), undefined);
		assert.equal(await lessonBlockSeen(() => chatStore.createChat("gone", undefined, { courseId: "course_missing", lessonId: "x" })), undefined);
		assert.equal(await lessonBlockSeen((cid) => chatStore.createChat("nolesson", undefined, { courseId: cid, lessonId: "removed" })), undefined);
		assert.equal(await lessonBlockSeen((cid) => chatStore.createChat("p", "practice", { courseId: cid, lessonId: "supply" })), undefined);
	});
});
