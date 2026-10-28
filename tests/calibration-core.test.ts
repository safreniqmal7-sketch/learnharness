import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CALIBRATION_MIN_ANSWERS,
	CALIBRATION_NOT_READY_TEXT,
	calibrationSentences,
	calibrationSummary,
	type CalibrationChatInput,
} from "../src/core/calibration.ts";

interface Ans {
	c: number | undefined;
	ok: boolean;
	tool?: string;
	node?: string;
	extra?: Record<string, unknown>;
	isError?: boolean;
	unanswered?: boolean;
}
let n = 0;
function chat(answers: Ans[], o: { title?: string; nodes?: Array<[string, string]> } = {}): CalibrationChatInput {
	const messages: unknown[] = [];
	for (const a of answers) {
		const id = `t${n++}`;
		const tool = a.tool ?? "quiz";
		messages.push({ role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: a.node ? { nodeId: a.node } : {} }] });
		if (a.unanswered) continue;
		messages.push({
			role: "toolResult",
			toolCallId: id,
			toolName: tool,
			isError: a.isError === true,
			content: [],
			details: { correct: a.ok, ...(a.c === undefined ? {} : { confidence: a.c }), dontKnow: false, ...a.extra },
		});
	}
	const tree = o.nodes ? { nodes: o.nodes.map(([id, title]) => ({ id, title })), edges: [], version: 1 } : undefined;
	return { lessonTitle: o.title ?? "Lesson", tree: tree as never, messages: messages as never };
}
const many = (count: number, c: number, right: number, extra: Partial<Ans> = {}): Ans[] =>
	Array.from({ length: count }, (_, i) => ({ c, ok: i < right, ...extra }));
const sum = (...chats: CalibrationChatInput[]) => calibrationSummary({ chats });
const kinds = (s: ReturnType<typeof sum>) => s.findings.map((f) => f.kind);

describe("calibration thresholds", () => {
	it("9 answers not ready, 10 ready", () => {
		const s9 = sum(chat(many(9, 70, 7)));
		assert.equal(s9.ready, false);
		assert.deepEqual(calibrationSentences(s9), [CALIBRATION_NOT_READY_TEXT]);
		assert.equal(s9.findings.length, 0);
		assert.equal(CALIBRATION_MIN_ANSWERS, 10);
		assert.equal(sum(chat(many(10, 70, 7))).ready, true);
	});
	it("empty input", () => {
		assert.deepEqual(calibrationSummary({ chats: [] }), { total: 0, ready: false, rows: [], findings: [] });
	});
	it("4 vs 5 answers at a level", () => {
		const pad = many(6, 70, 4); // 67% vs 70: no gap
		assert.equal(sum(chat([...many(4, 50, 0), ...pad])).findings.length, 0);
		const f = sum(chat([...many(5, 50, 0), ...pad])).findings;
		assert.deepEqual(f.map((x) => x.sentence), ["When you felt 50% sure you were right 0 of 5 times."]);
	});
	it("19 vs 20 point gap", () => {
		// 70% stated: 6 of 10 right = 60% -> gap 10 (none)
		assert.equal(sum(chat(many(10, 70, 6))).findings.length, 0);
		// 5 at 70%, 3 right = 60% -> gap 10; 5 at 50 padding fine
		// exactly 20: 70% stated, 5 answers... 50% not possible with 5, use 10 answers 5 right
		assert.deepEqual(kinds(sum(chat(many(10, 70, 5)))), ["over"]);
		// just under 20: 10 answers at 70, 5.1 impossible; use 90%+ band 6 answers 5 right = 83.3 -> gap 16.7
		assert.equal(sum(chat([...many(6, 100, 5), ...many(4, 50, 2)])).findings.filter((f) => f.kind === "over").length, 0);
		// exactly 20 at the band: 5 answers at 100, 4 right = 80%
		assert.deepEqual(kinds(sum(chat([...many(5, 100, 4), ...many(5, 50, 3)]))).filter((k) => k === "over"), ["over"]);
		// 19 on a single level: 100-stated impossible; 30 stated, 10 answers 1 right... gap 20; 2 right -> gap 10
		assert.equal(sum(chat(many(10, 30, 2))).findings.length, 0);
		assert.deepEqual(kinds(sum(chat(many(10, 30, 1)))), ["over"]);
	});
});

describe("calibration counting", () => {
	it("excludes dismissed, dontKnow, error, unanswered, missing confidence, other tools", () => {
		const s = sum(
			chat([
				...many(1, 70, 1),
				{ c: 70, ok: true, extra: { dismissed: true } },
				{ c: 70, ok: true, extra: { dontKnow: true } },
				{ c: 70, ok: true, isError: true },
				{ c: 70, ok: true, unanswered: true },
				{ c: undefined, ok: true },
				{ c: 70, ok: true, tool: "explain" },
			]),
		);
		assert.equal(s.total, 1);
	});
	it("counts probe and quiz; snaps confidence", () => {
		const s = sum(chat([{ c: 68, ok: true, tool: "probe" }, { c: 95, ok: false }, { c: 100, ok: true }]));
		assert.equal(s.total, 3);
		assert.deepEqual(
			s.rows.map((r) => [r.confidence, r.answers, r.correct, r.accuracy]),
			[[70, 1, 1, 100], [90, 1, 0, 0], [100, 1, 1, 100]],
		);
	});
	it("totals across chats", () => {
		assert.equal(sum(chat(many(5, 70, 5)), chat(many(5, 70, 5))).ready, true);
	});
});

describe("calibration findings", () => {
	it("merges 90 and 100 into a band with weighted stated confidence", () => {
		// 5x90 + 5x100 -> stated 95; 7 right = 70% -> gap 25
		const s = sum(chat([...many(5, 90, 3), ...many(5, 100, 4)]));
		assert.deepEqual(s.findings.map((f) => f.sentence), [
			"When you felt 90%+ sure you were right 7 of 10 times.",
			"Overconfident misses: Lesson (3).",
		]);
	});
	it("90 alone is not judged as its own level", () => {
		// band 8 of 10 = 80% vs 95 -> gap 15; neither 90 nor 100 alone fires
		const s = sum(chat([...many(5, 90, 4), ...many(5, 100, 4)]));
		assert.equal(s.findings.filter((f) => f.kind === "over").length, 0);
	});
	it("single level over and under sentences", () => {
		const over = sum(chat([...many(5, 70, 2), ...many(5, 30, 1)]));
		assert.equal(over.findings[0]!.sentence, "When you felt 70% sure you were right 2 of 5 times.");
		const under = sum(chat([...many(9, 50, 8), ...many(1, 70, 1)]));
		assert.deepEqual(under.findings.map((f) => f.sentence), ["You undersell yourself at 50%: right 8 of 9."]);
	});
	it("misses group by topic: node title, nodeId fallback, lesson title for probe; top 3 by count then name", () => {
		const c = chat(
			[
				...many(3, 90, 0, { node: "e" }),
				{ c: 100, ok: false, node: "t" },
				{ c: 100, ok: false, node: "unknown-node" },
				{ c: 90, ok: false, tool: "probe" },
				{ c: 90, ok: false, tool: "probe" },
				...many(5, 30, 5),
			],
			{ title: "Intro", nodes: [["e", "Elasticity"], ["t", "Tax incidence"]] },
		);
		const f = sum(c).findings.filter((x) => x.kind === "misses");
		assert.equal(f[0]!.sentence, "Overconfident misses: Elasticity (3), Intro (2), Tax incidence (1).");
		const fallback = sum(chat([...many(3, 100, 0, { node: "zz" }), ...many(7, 30, 7)])).findings.find((x) => x.kind === "misses");
		assert.equal(fallback!.sentence, "Overconfident misses: zz (3).");
	});
	it("caps at 3, largest gap first, misses last and cut when full", () => {
		const s = sum(
			chat([
				...many(5, 0, 5), // under gap 100
				...many(5, 30, 0), // over gap 30
				...many(5, 50, 5), // under gap 50
				...many(5, 100, 0), // band over gap 100, plus misses
			]),
		);
		assert.equal(s.findings.length, 3);
		assert.deepEqual(kinds(s), ["over", "under", "under"]);
		assert.equal(s.findings[0]!.sentence, "When you felt 90%+ sure you were right 0 of 5 times.");
	});
	it("misses finding appears when under the cap", () => {
		const s = sum(chat([...many(5, 100, 4), ...many(5, 50, 3)]));
		assert.equal(s.findings.at(-1)!.kind, "misses");
	});
});
