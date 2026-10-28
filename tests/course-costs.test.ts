/**
 * Cost per course (Part 2): lesson cost = session + extraction runs; draft
 * usage round-trips through create; list views carry no cost. Isolated
 * LH_DATA_DIR (set before any config-loading import).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-course-costs-"));
process.env.LH_DATA_DIR = TMP_DATA;

const list = await import("../app/api/courses/route.ts");
const one = await import("../app/api/courses/[id]/route.ts");
const draftRoute = await import("../app/api/courses/draft/route.ts");
const start = await import("../app/api/courses/[id]/lessons/[lessonId]/start/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { courseView, listCourseViews, parseDraftUsage } = await import("../src/server/courses.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

// anthropic:claude-haiku-4-5 = $1/M input, $5/M output (tests/usage.test.ts).
const MODEL = "anthropic:claude-haiku-4-5";
const step = (inputTokens: number, outputTokens: number) => ({
	inputTokens,
	outputTokens,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	cacheWrite1hTokens: 0,
	reasoningTokens: 0,
});
const M = 1_000_000;
const intake = { level: "beginner", purpose: "curiosity", depth: "intro" };
const req = (method: string, body?: unknown) =>
	new Request("http://test/api/courses", {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const startParams = (id: string, lessonId: string) => ({ params: Promise.resolve({ id, lessonId }) });
const lessons = [
	{ title: "Supply", goal: "g1" },
	{ title: "Demand", goal: "g2" },
];

async function create(extra: Record<string, unknown> = {}) {
	const res = await list.POST(req("POST", { topic: "economics", intake, title: "Econ", lessons, ...extra }));
	assert.equal(res.status, 201);
	return ((await res.json()) as { course: { id: string; draftUsage?: unknown } }).course;
}
async function startChat(courseId: string, lessonId: string) {
	writeSettings({ version: 1, models: { strong: { model: { provider: "anthropic", id: "claude-haiku-4-5" }, thinkingLevel: "low" } } });
	return ((await (await start.POST(req("POST"), startParams(courseId, lessonId))).json()) as { chatId: string }).chatId;
}
const turn = (id: string, model: string, steps: ReturnType<typeof step>[]) => ({ id, messageId: `m_${id}`, at: "x", model, steps });

describe("course costs", () => {
	it("lesson cost = session turns + extraction runs; total sums lessons; no-session lessons are 0", async () => {
		const course = await create();
		const chatId = await startChat(course.id, "supply");
		chatStore.appendTurnUsage(chatId, turn("t1", MODEL, [step(M, 100_000)])); // 1.5
		chatStore.appendExtractionUsage(chatId, {
			startedAt: 1,
			at: "2026-10-02T00:00:00.000Z",
			durationMs: 1,
			stages: { extractor: { model: MODEL, steps: [step(M, 0)] }, auditor: { model: MODEL, steps: [step(2 * M, 0)] } },
		}); // 1 + 2 = 3
		const v = courseView(course.id)!;
		assert.ok(Math.abs(v.lessons[0]!.costDollars! - 4.5) < 1e-9);
		assert.equal(v.lessons[1]!.costDollars, 0);
		assert.deepEqual(v.cost, { lessonsDollars: v.lessons[0]!.costDollars, draftDollars: 0, totalDollars: v.lessons[0]!.costDollars, unpriced: false });
	});

	it("non-lesson chats and other courses' chats are excluded", async () => {
		const course = await create();
		const other = await create();
		const plain = chatStore.createChat("plain");
		chatStore.appendTurnUsage(plain.id, turn("t1", MODEL, [step(M, 0)]));
		const otherChat = await startChat(other.id, "supply");
		chatStore.appendTurnUsage(otherChat, turn("t1", MODEL, [step(M, 0)]));
		const v = courseView(course.id)!;
		assert.equal(v.cost!.totalDollars, 0);
		assert.ok(v.lessons.every((l) => l.costDollars === 0));
	});

	it("draftUsage round-trips through create and is priced in the total", async () => {
		const draftUsage = { model: MODEL, steps: [step(M, 0), step(0, 200_000)] }; // 1 + 1
		const course = await create({ draftUsage });
		assert.deepEqual(course.draftUsage, draftUsage);
		const v = courseView(course.id)!;
		assert.ok(Math.abs(v.cost!.draftDollars - 2) < 1e-9);
		assert.ok(Math.abs(v.cost!.totalDollars - 2) < 1e-9);
		const res = await one.GET(req("GET"), idParams(course.id));
		assert.ok(Math.abs(((await res.json()) as { cost: { draftDollars: number } }).cost.draftDollars - 2) < 1e-9);
	});

	it("a course without draftUsage prices only its lessons", async () => {
		const course = await create();
		const chatId = await startChat(course.id, "demand");
		chatStore.appendTurnUsage(chatId, turn("t1", MODEL, [step(M, 0)]));
		const v = courseView(course.id)!;
		assert.equal(v.cost!.draftDollars, 0);
		assert.ok(Math.abs(v.cost!.totalDollars - 1) < 1e-9);
	});

	it("unpriced models count $0 and flag unpriced", async () => {
		const course = await create({ draftUsage: { model: "nope:unknown", steps: [step(M, M)] } });
		const v = courseView(course.id)!;
		assert.equal(v.cost!.draftDollars, 0);
		assert.equal(v.cost!.unpriced, true);
		const c2 = await create();
		const chatId = await startChat(c2.id, "supply");
		chatStore.appendTurnUsage(chatId, turn("t1", "nope:unknown", [step(M, M)]));
		assert.equal(courseView(c2.id)!.cost!.unpriced, true);
	});

	it("list views carry no cost", async () => {
		await create({ draftUsage: { model: MODEL, steps: [step(M, 0)] } });
		for (const s of listCourseViews()) {
			assert.equal("cost" in s, false);
			assert.equal("lessons" in s, false);
		}
		const { courses } = (await (await list.GET()).json()) as { courses: object[] };
		assert.ok(courses.every((c) => !("cost" in c)));
	});
});

describe("draftUsage validation", () => {
	it("accepts absent and well-formed usage", () => {
		assert.deepEqual(parseDraftUsage(undefined), { ok: true, value: undefined });
		const r = parseDraftUsage({ model: MODEL, steps: [{ inputTokens: 1, outputTokens: 2 }] });
		assert.equal(r.ok, true);
	});

	it("POST /api/courses rejects malformed draftUsage with 400", async () => {
		const bad: unknown[] = [
			"x",
			[],
			{ model: "", steps: [] },
			{ model: MODEL },
			{ model: MODEL, steps: [5] },
			{ model: MODEL, steps: [{ inputTokens: -1 }] },
			{ model: MODEL, steps: [{ outputTokens: "7" }] },
			{ model: MODEL, steps: [{ reasoningTokens: null }] },
		];
		for (const draftUsage of bad) {
			const res = await list.POST(req("POST", { topic: "t", intake, title: "T", lessons, draftUsage }));
			assert.equal(res.status, 400, JSON.stringify(draftUsage));
		}
	});

	it("POST /api/courses/draft still validates its body (no fake-engine path)", async () => {
		const res = await draftRoute.POST(req("POST", { topic: "", intake }));
		assert.equal(res.status, 400);
	});
});
