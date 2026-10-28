import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-courses-cal-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { courseView, createCourseFromDraft, listCourseViews, saveCourseEdits } = await import("../src/server/courses.ts");
const { chatStore } = await import("../src/store/chats.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const answered = (prefix: string, count: number) => {
	const out: unknown[] = [];
	for (let i = 0; i < count; i++) {
		const id = `${prefix}${i}`;
		out.push({ role: "assistant", content: [{ type: "toolCall", id, name: "quiz", arguments: {} }] });
		out.push({ role: "toolResult", toolCallId: id, toolName: "quiz", isError: false, content: [], details: { correct: true, confidence: 70, dontKnow: false } });
	}
	return out as never;
};

describe("course view calibration", () => {
	it("counts only lesson chats of this course", () => {
		const course = createCourseFromDraft({
			topic: "t",
			intake: { level: "a", purpose: "b", depth: "c" },
			title: "Econ",
			lessons: [
				{ title: "Supply", goal: "g" },
				{ title: "Demand", goal: "g" },
			],
		});
		assert.equal(courseView(course.id)!.calibration!.total, 0);
		const a = chatStore.createChat("Supply", undefined, { courseId: course.id, lessonId: "supply" });
		chatStore.saveMessages(a.id, answered("a", 4));
		const b = chatStore.createChat("Demand", undefined, { courseId: course.id, lessonId: "demand" });
		chatStore.saveMessages(b.id, answered("b", 3));
		const other = chatStore.createChat("Other", undefined, { courseId: "someone-else", lessonId: "supply" });
		chatStore.saveMessages(other.id, answered("o", 5));
		const plain = chatStore.createChat("Plain");
		chatStore.saveMessages(plain.id, answered("p", 5));

		const v = courseView(course.id)!;
		assert.equal(v.calibration!.total, 7);
		assert.equal(v.calibration!.ready, false);
		const saved = saveCourseEdits(course.id, { title: "Econ", lessons: [{ id: "supply", title: "Supply", goal: "g" }] })!;
		assert.equal(saved.calibration!.total, 4);
		const listed = listCourseViews().find((c) => c.id === course.id)!;
		assert.equal("calibration" in listed, false);
	});
});
