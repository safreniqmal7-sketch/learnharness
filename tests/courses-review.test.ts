import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-courses-rev-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { courseView, createCourseFromDraft, listCourseViews } = await import("../src/server/courses.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { graphStore } = await import("../src/store/graph.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const node = (id: string, chatId: string) => ({
	id,
	name: `Name ${id}`,
	statement: `Statement ${id}`,
	aliases: [],
	createdAt: "2026-09-23T00:04:00.000Z",
	provenance: [{ chatId, messageId: "" }],
});
const completed = (at: number, ok = true) =>
	[
		{ role: "assistant", content: [{ type: "toolCall", id: "lc", name: "lesson_complete", arguments: {} }], timestamp: at - 1 },
		{ role: "toolResult", toolCallId: "lc", toolName: "lesson_complete", isError: !ok, content: [], timestamp: at },
	] as never;
const concluded = (target: string[], outcome: string, at: number) =>
	[
		{ role: "assistant", content: [{ type: "toolCall", id: "p1", name: "problem", arguments: { target } }], timestamp: at - 2 },
		{ role: "toolResult", toolCallId: "p1", toolName: "problem", isError: false, content: [], timestamp: at - 1 },
		{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "conclude", arguments: { outcome } }], timestamp: at },
		{ role: "toolResult", toolCallId: "c1", toolName: "conclude", isError: false, content: [], timestamp: at + 1 },
	] as never;

describe("course view review", () => {
	it("schedules propositions of completed lessons and folds practice evidence", () => {
		const course = createCourseFromDraft({
			topic: "t",
			intake: { level: "a", purpose: "b", depth: "c" },
			title: "Econ",
			lessons: [
				{ title: "Supply", goal: "g" },
				{ title: "Demand", goal: "g" },
			],
		});
		assert.deepEqual(courseView(course.id)!.review!.items, []);

		const done = Date.now() - 10 * DAY;
		const a = chatStore.createChat("Supply", undefined, { courseId: course.id, lessonId: "supply" });
		chatStore.saveMessages(a.id, completed(done));
		const b = chatStore.createChat("Demand", undefined, { courseId: course.id, lessonId: "demand" });
		chatStore.saveMessages(b.id, completed(done, false));
		graphStore.appendNode(node("n_rev_supply", a.id));
		graphStore.appendNode(node("n_rev_demand", b.id));

		let review = courseView(course.id)!.review!;
		assert.deepEqual(review.items.map((i) => i.nodeId), ["n_rev_supply"]);
		assert.equal(review.items[0]!.step, 0);
		assert.equal(review.items[0]!.lessonTitle, "Supply");
		assert.equal(review.due.length, 1);

		// A practice session solves it after it was due: up one step (3 days).
		const practice = chatStore.createChat("Practice", "practice");
		chatStore.saveMessages(practice.id, concluded(["n_rev_supply"], "solved", Date.now() - DAY));
		review = courseView(course.id)!.review!;
		assert.equal(review.items[0]!.step, 1);
		assert.equal(review.due.length, 0);
		assert.ok(review.nextDueAt !== null && review.nextDueAt > Date.now());

		const listed = listCourseViews().find((c) => c.id === course.id)!;
		assert.equal("review" in listed, false);
	});
});
