import assert from "node:assert/strict";
import { test } from "node:test";
import { lessonCompletedAt } from "../src/core/courses.ts";
import { LESSON_COMPLETE_TOOL } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import {
	DAY_MS,
	practiceEvidence,
	reviewSchedule,
	type ReviewInput,
	type ReviewLessonInput,
} from "../src/core/review.ts";

type NodeIn = ReviewInput["nodes"][number];

let n = 0;
const uid = () => `c${n++}`;
const assistant = (timestamp: number, blocks: unknown[]): LhMessage =>
	({ id: `m${n++}`, role: "assistant", content: blocks, timestamp }) as unknown as LhMessage;
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
	type: "toolCall",
	id,
	name,
	arguments: args,
});
const result = (toolName: string, toolCallId: string, timestamp: number, isError = false): LhMessage =>
	({ id: `m${n++}`, role: "toolResult", toolCallId, toolName, content: [], isError, timestamp }) as unknown as LhMessage;

/** A posed problem (clean ack) followed by its conclude (clean ack) at `at`. */
function concluded(
	target: unknown,
	outcome: string,
	at: number,
	opts: { badProblem?: boolean; badConclude?: boolean } = {},
): LhMessage[] {
	const p = uid();
	const c = uid();
	return [
		assistant(at - 1000, [toolCall(p, "problem", { target })]),
		result("problem", p, at - 999, opts.badProblem),
		assistant(at, [toolCall(c, "conclude", { outcome })]),
		result("conclude", c, at + 1, opts.badConclude),
	];
}

const T0 = 1_000_000_000_000;
const lesson: ReviewLessonInput = { lessonId: "L1", title: "Lesson one", chatId: "chat1", completedAt: T0 };
const node = (id: string, chatIds: string[] = ["chat1"]): NodeIn =>
	({
		id,
		name: `Name ${id}`,
		statement: `Statement ${id}`,
		provenance: chatIds.map((chatId) => ({ chatId })),
	}) as unknown as NodeIn;
const run = (events: LhMessage[], now: number, extra: Partial<ReviewInput> = {}) =>
	reviewSchedule({ lessons: [lesson], nodes: [node("a")], practiceChats: [{ messages: events }], now, ...extra });
const itemA = (events: LhMessage[], now = T0) => run(events, now).items[0]!;

test("start: step 0, due one day after completion", () => {
	const it = itemA([]);
	assert.equal(it.step, 0);
	assert.equal(it.dueAt, T0 + DAY_MS);
	assert.equal(it.lessonId, "L1");
	assert.equal(it.lessonTitle, "Lesson one");
	assert.equal(it.daysOverdue, null);
	assert.equal(run([], T0).nextDueAt, T0 + DAY_MS);
});

test("on-time outcomes", () => {
	const at = T0 + DAY_MS;
	const solved = itemA(concluded(["a"], "solved", at));
	assert.equal(solved.step, 1);
	assert.equal(solved.dueAt, at + 3 * DAY_MS);
	const hinted = itemA(concluded(["a"], "solvedWithHints", at));
	assert.equal(hinted.step, 0);
	assert.equal(hinted.dueAt, at + DAY_MS);
	for (const outcome of ["movedOn", "surrendered"]) {
		// climb first, then miss on time
		const events = [...concluded(["a"], "solved", at), ...concluded(["a"], outcome, at + 3 * DAY_MS)];
		const it = itemA(events);
		assert.equal(it.step, 0);
		assert.equal(it.dueAt, at + 4 * DAY_MS);
	}
});

test("a hinted solve repeats the step it is on", () => {
	const at = T0 + DAY_MS;
	const events = [...concluded(["a"], "solved", at), ...concluded(["a"], "solvedWithHints", at + 3 * DAY_MS)];
	const it = itemA(events);
	assert.equal(it.step, 1);
	assert.equal(it.dueAt, at + 6 * DAY_MS);
});

test("early miss resets; early solve and hinted solve do nothing", () => {
	const at = T0 + DAY_MS;
	const base = concluded(["a"], "solved", at); // step 1, due at + 3d
	const early = at + DAY_MS;
	const solved = itemA([...base, ...concluded(["a"], "solved", early)]);
	assert.deepEqual([solved.step, solved.dueAt], [1, at + 3 * DAY_MS]);
	const hinted = itemA([...base, ...concluded(["a"], "solvedWithHints", early)]);
	assert.deepEqual([hinted.step, hinted.dueAt], [1, at + 3 * DAY_MS]);
	const miss = itemA([...base, ...concluded(["a"], "movedOn", early)]);
	assert.deepEqual([miss.step, miss.dueAt], [0, early + DAY_MS]);
});

test("a solve at the 120-day step stays there", () => {
	const events: LhMessage[] = [];
	let at = T0 + DAY_MS;
	for (const next of [3, 7, 14, 30, 60, 120]) {
		events.push(...concluded(["a"], "solved", at));
		at += next * DAY_MS;
	}
	let it = itemA(events);
	assert.equal(it.step, 6);
	assert.equal(it.dueAt, at);
	events.push(...concluded(["a"], "solved", at));
	it = itemA(events);
	assert.equal(it.step, 6);
	assert.equal(it.dueAt, at + 120 * DAY_MS);
});

test("evidence before completedAt is ignored", () => {
	const events = [...concluded(["a"], "movedOn", T0 - DAY_MS), ...concluded(["a"], "solved", T0 - 1)];
	const it = itemA(events);
	assert.deepEqual([it.step, it.dueAt], [0, T0 + DAY_MS]);
});

test("dismissed, unknown outcomes and untagged problems are ignored", () => {
	const at = T0 + DAY_MS;
	for (const events of [
		concluded(["a"], "dismissed", at),
		concluded(["a"], "bogus", at),
		concluded(undefined, "solved", at),
		concluded([], "solved", at),
		concluded("a", "solved", at),
	]) {
		assert.deepEqual(practiceEvidence(events), []);
		assert.equal(itemA(events).step, 0);
	}
});

test("errored problem or conclude calls are ignored", () => {
	const at = T0 + DAY_MS;
	assert.deepEqual(practiceEvidence(concluded(["a"], "solved", at, { badProblem: true })), []);
	assert.deepEqual(practiceEvidence(concluded(["a"], "solved", at, { badConclude: true })), []);
	// an errored newer problem does not shadow a clean older one
	const good = concluded(["a"], "solved", at);
	const p = uid();
	const msgs = [
		good[0]!,
		good[1]!,
		assistant(at - 500, [toolCall(p, "problem", { target: ["b"] })]),
		result("problem", p, at - 499, true),
		good[2]!,
		good[3]!,
	];
	assert.deepEqual(practiceEvidence(msgs), [{ targets: ["a"], outcome: "solved", at }]);
});

test("one problem is never paired with two concludes", () => {
	const at = T0 + DAY_MS;
	const first = concluded(["a"], "solved", at);
	const c2 = uid();
	const second = [
		assistant(at + 5000, [toolCall(c2, "conclude", { outcome: "movedOn" })]),
		result("conclude", c2, at + 5001),
	];
	const ev = practiceEvidence([...first, ...second]);
	assert.equal(ev.length, 1);
	assert.equal(ev[0]!.outcome, "solved");
});

test("problem and conclude in the same assistant message pair up", () => {
	const p = uid();
	const c = uid();
	const msgs = [
		assistant(T0, [toolCall(p, "problem", { target: ["a"] }), toolCall(c, "conclude", { outcome: "solved" })]),
		result("problem", p, T0 + 1),
		result("conclude", c, T0 + 2),
	];
	assert.deepEqual(practiceEvidence(msgs), [{ targets: ["a"], outcome: "solved", at: T0 }]);
});

test("a multi-target problem moves every target", () => {
	const at = T0 + DAY_MS;
	const s = run(concluded(["a", "b"], "solved", at), at, { nodes: [node("a"), node("b"), node("c")] });
	const by = Object.fromEntries(s.items.map((i) => [i.nodeId, i.step]));
	assert.deepEqual(by, { a: 1, b: 1, c: 0 });
});

test("evidence from any practice chat counts", () => {
	const at = T0 + DAY_MS;
	const s = reviewSchedule({
		lessons: [lesson],
		nodes: [node("a")],
		practiceChats: [{ messages: [] }, { messages: concluded(["a"], "solved", at) }],
		now: at,
	});
	assert.equal(s.items[0]!.step, 1);
});

test("only lessons passed in schedule their nodes; foreign-born nodes are skipped", () => {
	// "y" was born in another chat and only mentioned later in the lesson chat
	const s = run([], T0, { nodes: [node("a"), node("x", ["other"]), node("y", ["other", "chat1"])] });
	assert.deepEqual(
		s.items.map((i) => i.nodeId),
		["a"],
	);
	assert.deepEqual(run([], T0, { lessons: [] }).items, []);
	assert.deepEqual(run([], T0, { nodes: [node("z", [])] }).items, []);
});

test("due and nextDueAt ordering and daysOverdue", () => {
	const l2: ReviewLessonInput = { lessonId: "L2", title: "Two", chatId: "chat2", completedAt: T0 + 10 * DAY_MS };
	const now = T0 + 4.5 * DAY_MS;
	const s = reviewSchedule({
		lessons: [lesson, l2],
		nodes: [node("b"), node("a"), node("late", ["chat2"]), node("also")],
		practiceChats: [],
		now,
	});
	// a, also, b share a dueAt (tie by nodeId); late is due at T0 + 11d
	assert.deepEqual(
		s.items.map((i) => i.nodeId),
		["a", "also", "b", "late"],
	);
	assert.deepEqual(
		s.due.map((i) => i.nodeId),
		["a", "also", "b"],
	);
	assert.equal(s.due[0]!.daysOverdue, 3);
	assert.equal(s.nextDueAt, T0 + 11 * DAY_MS);
	assert.equal(s.items[3]!.daysOverdue, null);
	const exact = run([], T0 + DAY_MS);
	assert.equal(exact.due.length, 1);
	assert.equal(exact.due[0]!.daysOverdue, 0);
	assert.equal(exact.nextDueAt, null);
});

test("most overdue first among due items", () => {
	const at = T0 + DAY_MS;
	// b solved on time (due later), a untouched (due earlier)
	const s = run(concluded(["b"], "solved", at), at + 10 * DAY_MS, { nodes: [node("b"), node("a")] });
	assert.deepEqual(
		s.due.map((i) => i.nodeId),
		["a", "b"],
	);
});

test("lessonCompletedAt picks the first accepted result and ignores errors", () => {
	assert.equal(lessonCompletedAt([]), null);
	const e = result(LESSON_COMPLETE_TOOL, uid(), 100, true);
	assert.equal(lessonCompletedAt([e]), null);
	const a = result(LESSON_COMPLETE_TOOL, uid(), 200);
	const b = result(LESSON_COMPLETE_TOOL, uid(), 300);
	assert.equal(lessonCompletedAt([e, a, b]), 200);
});
