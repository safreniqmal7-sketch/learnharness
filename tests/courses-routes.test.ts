/**
 * Course routes (course mode, 2026-10-26) — real handlers over an isolated
 * LH_DATA_DIR (set before any config-loading import).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-courses-routes-"));
process.env.LH_DATA_DIR = TMP_DATA;

const list = await import("../app/api/courses/route.ts");
const draft = await import("../app/api/courses/draft/route.ts");
const one = await import("../app/api/courses/[id]/route.ts");
const start = await import("../app/api/courses/[id]/lessons/[lessonId]/start/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { writeSettings } = await import("../src/store/settings.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const intake = { level: "beginner", purpose: "curiosity", depth: "intro" };
const req = (method: string, body?: unknown) =>
	new Request("http://test/api/courses", {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const startParams = (id: string, lessonId: string) => ({ params: Promise.resolve({ id, lessonId }) });

async function create() {
	const lessons = [
		{ title: "Supply", goal: "g1" },
		{ title: "Demand", goal: "g2" },
		{ title: "Elasticity", goal: "g3" },
	];
	const res = await list.POST(req("POST", { topic: "economics", intake, title: "Econ", lessons }));
	assert.equal(res.status, 201);
	return ((await res.json()) as { course: { id: string } }).course.id;
}
type View = {
	course: { title: string };
	lessons: Array<{ id: string; title: string; status: string; chatId: string | null; origin: string }>;
	continueLessonId: string | null;
	progress: { completed: number; total: number };
};
const getView = async (id: string) => (await (await one.GET(req("GET"), idParams(id))).json()) as View;

describe("course routes", () => {
	it("create -> GET view: all not-started, continue = first, listed", async () => {
		const id = await create();
		const v = await getView(id);
		assert.deepEqual(
			v.lessons.map((l) => [l.id, l.status, l.chatId, l.origin]),
			[
				["supply", "not-started", null, "syllabus"],
				["demand", "not-started", null, "syllabus"],
				["elasticity", "not-started", null, "syllabus"],
			],
		);
		assert.equal(v.continueLessonId, "supply");
		assert.deepEqual(v.progress, { completed: 0, total: 3 });
		const { courses } = (await (await list.GET()).json()) as { courses: Array<{ id: string }> };
		assert.ok(courses.some((c) => c.id === id));
	});

	it("PUT reorders, adds a learner lesson, removes one; kept lessons keep origin", async () => {
		const id = await create();
		const res = await one.PUT(
			req("PUT", {
				title: "Econ 2",
				lessons: [
					{ id: "elasticity", title: "Elasticity!", goal: "g3" },
					{ title: "Supply", goal: "mine" },
					{ id: "supply", title: "Supply", goal: "g1" },
				],
			}),
			idParams(id),
		);
		assert.equal(res.status, 200);
		const v = (await res.json()) as View;
		assert.equal(v.course.title, "Econ 2");
		assert.deepEqual(
			v.lessons.map((l) => [l.id, l.title, l.origin]),
			[
				["elasticity", "Elasticity!", "syllabus"],
				["supply-2", "Supply", "learner"],
				["supply", "Supply", "syllabus"],
			],
		);
		assert.equal(v.continueLessonId, "elasticity");
	});

	it("start creates a linked, stamped chat; again resumes; status flips on accepted lesson_complete", async () => {
		writeSettings({
			version: 1,
			models: { strong: { model: { provider: "openrouter", id: "x/y" }, thinkingLevel: "low" } },
		});
		const id = await create();
		const first = (await (await start.POST(req("POST"), startParams(id, "demand"))).json()) as {
			chatId: string;
			resumed: boolean;
			prompt?: string;
		};
		assert.equal(first.resumed, false);
		assert.equal(first.prompt, "g2");
		const rec = chatStore.getChat(first.chatId)!;
		assert.deepEqual(rec.lesson, { courseId: id, lessonId: "demand" });
		assert.equal(rec.title, "Demand");
		assert.deepEqual(rec.settings, { model: { provider: "openrouter", id: "x/y" }, thinkingLevel: "low" });

		const again = (await (await start.POST(req("POST"), startParams(id, "demand"))).json()) as unknown;
		assert.deepEqual(again, { chatId: first.chatId, resumed: true });

		let v = await getView(id);
		assert.equal(v.lessons[1]!.status, "in-progress");
		assert.equal(v.lessons[1]!.chatId, first.chatId);
		assert.equal(v.continueLessonId, "supply");

		const result = (isError: boolean) => ({
			role: "toolResult" as const,
			toolCallId: "t1",
			toolName: "lesson_complete",
			content: [{ type: "text" as const, text: "ok" }],
			isError,
			timestamp: Date.now(),
		});
		chatStore.saveMessages(first.chatId, [result(true)] as never);
		assert.equal((await getView(id)).lessons[1]!.status, "in-progress");
		chatStore.saveMessages(first.chatId, [result(false)] as never);
		v = await getView(id);
		assert.equal(v.lessons[1]!.status, "complete");
		assert.deepEqual(v.progress, { completed: 1, total: 3 });
	});

	it("oldest chat wins when several link the same lesson", async () => {
		const id = await create();
		const a = chatStore.createChat("a", undefined, { courseId: id, lessonId: "supply" });
		await new Promise((r) => setTimeout(r, 5));
		chatStore.createChat("b", undefined, { courseId: id, lessonId: "supply" });
		assert.equal((await getView(id)).lessons[0]!.chatId, a.id);
	});

	it("DELETE removes the course but keeps its sessions", async () => {
		const id = await create();
		const { chatId } = (await (await start.POST(req("POST"), startParams(id, "supply"))).json()) as { chatId: string };
		const res = await one.DELETE(req("DELETE"), idParams(id));
		assert.deepEqual(await res.json(), { ok: true });
		assert.equal((await one.GET(req("GET"), idParams(id))).status, 404);
		assert.ok(chatStore.getChat(chatId));
		assert.equal((await one.DELETE(req("DELETE"), idParams(id))).status, 404);
	});

	it("400 and 404 cases", async () => {
		const bad = async (body: unknown) => (await list.POST(req("POST", body))).status;
		const ok = { topic: "t", intake, title: "T", lessons: [{ title: "a", goal: "b" }] };
		assert.equal(await bad({ ...ok, topic: "  " }), 400);
		assert.equal(await bad({ ...ok, title: 3 }), 400);
		assert.equal(await bad({ ...ok, intake: { level: "x" } }), 400);
		assert.equal(await bad({ ...ok, lessons: [] }), 400);
		assert.equal(await bad({ ...ok, lessons: [{ title: "a" }] }), 400);
		assert.equal((await list.POST(new Request("http://test/x", { method: "POST", body: "nope" }))).status, 400);

		const id = await create();
		const put = async (body: unknown) => (await one.PUT(req("PUT", body), idParams(id))).status;
		assert.equal(await put({ title: "", lessons: [{ title: "a", goal: "b" }] }), 400);
		assert.equal(await put({ title: "T", lessons: [] }), 400);
		assert.equal(await put({ title: "T", lessons: [{ id: "ghost", title: "a", goal: "b" }] }), 400);
		const dup = { id: "supply", title: "a", goal: "b" };
		assert.equal(await put({ title: "T", lessons: [dup, dup] }), 400);
		const okLessons = [{ title: "a", goal: "b" }];
		assert.equal((await one.PUT(req("PUT", { title: "T", lessons: okLessons }), idParams("nope"))).status, 404);
		assert.equal((await one.GET(req("GET"), idParams("nope"))).status, 404);
		assert.equal((await start.POST(req("POST"), startParams("nope", "x"))).status, 404);
		assert.equal((await start.POST(req("POST"), startParams(id, "ghost"))).status, 404);
	});

	it("draft route validates its body (model call not exercised)", async () => {
		const post = async (body: unknown) => (await draft.POST(req("POST", body))).status;
		assert.equal(await post({ intake }), 400);
		assert.equal(await post({ topic: "t" }), 400);
		assert.equal(await post({ topic: "t", intake: { ...intake, depth: "" } }), 400);
	});
});
