import assert from "node:assert/strict";
import { test } from "node:test";
import {
	continueLessonId,
	courseProgress,
	lessonCompleted,
	lessonCompletionProblems,
	lessonGoalNodeIds,
	lessonIdFor,
	lessonStatus,
} from "../src/core/courses.ts";
import { LESSON_COMPLETE_TOOL, type Course, type LessonStatus, type PlanTree } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const node = (id: string) => ({ id, title: `Title ${id}` });
// a -> b -> c, a -> d : sinks are c and d
const branching: PlanTree = {
	nodes: ["a", "b", "c", "d"].map(node),
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
		{ from: "a", to: "d" },
	],
	version: 1,
};
const single: PlanTree = { nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }], version: 1 };

const first = (a: readonly string[]): string => a[0] ?? "";
let n = 0;
const call = (name: string, id: string, args: Record<string, unknown>): LhMessage =>
	({
		id: `m${n++}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: args }],
	}) as unknown as LhMessage;
const result = (toolName: string, toolCallId: string, details: unknown, isError = false): LhMessage =>
	({ id: `m${n++}`, role: "toolResult", toolCallId, toolName, content: [], details, isError }) as unknown as LhMessage;
const ans = (correct: boolean, confidence: number | undefined, extra: Record<string, unknown> = {}) => ({
	kind: "quiz",
	correct,
	confidence,
	dontKnow: false,
	...extra,
});
/** A call on `nodeId` answered with `details`. */
const checked = (id: string, nodeId: string, details: unknown, type = "check", tool = "quiz"): LhMessage[] => [
	call(tool, id, { nodeId, type }),
	result(tool, id, details),
];

test("goal nodes are the sinks, in node order", () => {
	assert.deepEqual(lessonGoalNodeIds(branching), ["c", "d"]);
	assert.deepEqual(lessonGoalNodeIds(single), ["b"]);
	assert.deepEqual(lessonGoalNodeIds({ nodes: [], edges: [], version: 1 }), []);
});

test("no plan map is one problem", () => {
	const p = lessonCompletionProblems(undefined, []);
	assert.equal(p.length, 1);
	assert.match(first(p), /No plan map yet/);
});

test("accepted when every sink has a correct, confident check", () => {
	const msgs = [...checked("1", "c", ans(true, 90)), ...checked("2", "d", ans(true, 70))];
	assert.deepEqual(lessonCompletionProblems(branching, msgs), []);
});

test("all sinks are required", () => {
	const p = lessonCompletionProblems(branching, checked("1", "c", ans(true, 90)));
	assert.equal(p.length, 1);
	assert.match(first(p), /"d" \(Title d\)/);
	assert.match(first(p), /no answered multiple-choice check/);
	assert.match(first(p), /type "check"/);
});

test("a non-sink check does not satisfy a sink", () => {
	const p = lessonCompletionProblems(single, checked("1", "a", ans(true, 100)));
	assert.equal(p.length, 1);
	assert.match(first(p), /"b"/);
});

test("wrong latest check fails even after an earlier right one", () => {
	const msgs = [...checked("1", "b", ans(true, 90)), ...checked("2", "b", ans(false, 90))];
	const p = lessonCompletionProblems(single, msgs);
	assert.equal(p.length, 1);
	assert.match(first(p), /answered wrong/);
});

test("a later right check recovers an earlier wrong one", () => {
	const msgs = [...checked("1", "b", ans(false, 90)), ...checked("2", "b", ans(true, 80))];
	assert.deepEqual(lessonCompletionProblems(single, msgs), []);
});

test("confidence 69 fails, 70 passes", () => {
	const low = lessonCompletionProblems(single, checked("1", "b", ans(true, 69)));
	assert.equal(low.length, 1);
	assert.match(first(low), /69%.*70%/);
	assert.deepEqual(lessonCompletionProblems(single, checked("1", "b", ans(true, 70))), []);
});

test("missing confidence on a correct check fails", () => {
	const p = lessonCompletionProblems(single, checked("1", "b", ans(true, undefined)));
	assert.equal(p.length, 1);
	assert.match(first(p), /none stated/);
});

test("I don't know fails", () => {
	const p = lessonCompletionProblems(single, checked("1", "b", { kind: "quiz", dontKnow: true }));
	assert.equal(p.length, 1);
	assert.match(first(p), /I don't know/);
});

test("dismissed answers do not count and fall back to the earlier answer", () => {
	const only = checked("1", "b", { kind: "quiz", dismissed: true, dontKnow: false });
	assert.match(first(lessonCompletionProblems(single, only)), /no answered/);
	const fallback = [
		...checked("1", "b", ans(true, 95)),
		...checked("2", "b", { kind: "quiz", dismissed: true, dontKnow: false }),
	];
	assert.deepEqual(lessonCompletionProblems(single, fallback), []);
});

test("error results do not count", () => {
	const msgs = [call("quiz", "1", { nodeId: "b", type: "check" }), result("quiz", "1", ans(true, 99), true)];
	assert.match(first(lessonCompletionProblems(single, msgs)), /no answered/);
});

test("explain does not count, even if shaped like a verdict", () => {
	const msgs = checked("1", "b", ans(true, 100), "check", "explain");
	assert.match(first(lessonCompletionProblems(single, msgs)), /no answered/);
});

test("predict does not count", () => {
	const msgs = checked("1", "b", ans(true, 100), "predict");
	assert.match(first(lessonCompletionProblems(single, msgs)), /no answered/);
});

test("an unanswered newer check falls back to the latest answered one", () => {
	const msgs = [...checked("1", "b", ans(true, 90)), call("quiz", "2", { nodeId: "b", type: "check" })];
	assert.deepEqual(lessonCompletionProblems(single, msgs), []);
});

test("lessonCompleted: accepted vs refused", () => {
	assert.equal(lessonCompleted([]), false);
	const refused = [call(LESSON_COMPLETE_TOOL, "x", {}), result(LESSON_COMPLETE_TOOL, "x", undefined, true)];
	assert.equal(lessonCompleted(refused), false);
	const accepted = [...refused, call(LESSON_COMPLETE_TOOL, "y", {}), result(LESSON_COMPLETE_TOOL, "y", undefined, false)];
	assert.equal(lessonCompleted(accepted), true);
});

test("lessonStatus", () => {
	assert.equal(lessonStatus(null), "not-started");
	assert.equal(lessonStatus({ messages: [] }), "in-progress");
	assert.equal(lessonStatus({ messages: [result(LESSON_COMPLETE_TOOL, "y", undefined)] }), "complete");
});

const course = {
	id: "c",
	lessons: ["l1", "l2", "l3"].map((id) => ({ id, title: id, goal: id, origin: "syllabus" })),
} as unknown as Course;

test("continueLessonId and courseProgress", () => {
	const s = (o: Record<string, LessonStatus>) => o;
	assert.equal(continueLessonId(course, {}), "l1");
	assert.equal(continueLessonId(course, s({ l1: "complete", l2: "in-progress" })), "l2");
	assert.equal(continueLessonId(course, s({ l1: "complete", l3: "complete" })), "l2");
	assert.equal(continueLessonId(course, s({ l1: "complete", l2: "complete", l3: "complete" })), null);
	assert.equal(continueLessonId({ ...course, lessons: [] }, {}), null);
	assert.deepEqual(courseProgress(course, s({ l1: "complete", l2: "in-progress" })), { completed: 1, total: 3 });
	assert.deepEqual(courseProgress({ ...course, lessons: [] }, {}), { completed: 0, total: 0 });
});

test("lessonIdFor slugifies and stays unique within the course", () => {
	assert.equal(lessonIdFor("Price Elasticity of Demand", []), "price-elasticity-of-demand");
	assert.equal(lessonIdFor("Supply & demand", ["supply-demand"]), "supply-demand-2");
	assert.equal(lessonIdFor("Supply & demand", ["supply-demand", "supply-demand-2"]), "supply-demand-3");
	assert.equal(lessonIdFor("Économie", []), "economie");
	assert.equal(lessonIdFor("¿?", []), "lesson");
});
