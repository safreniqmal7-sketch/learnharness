/**
 * CourseStore (fs adapter) + the chat record's lesson link — course mode,
 * 2026-10-26. Isolated LH_DATA_DIR set before any config-loading import.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-courses-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { courseStore } = await import("../src/store/courses.ts");
const { chatStore } = await import("../src/store/chats.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const intake = { level: "beginner", purpose: "curiosity", depth: "intro" };
const lesson = (id: string) => ({ id, title: id, goal: `understand ${id}`, origin: "syllabus" as const });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("courseStore", () => {
	it("create → get round-trips with id and timestamps", () => {
		const c = courseStore.createCourse({ title: "Econ", topic: "economics", intake, lessons: [lesson("a")] });
		assert.match(c.id, /^course_/);
		assert.equal(c.createdAt, c.updatedAt);
		assert.deepEqual(courseStore.getCourse(c.id), c);
		assert.equal(courseStore.getCourse("nope"), null);
	});

	it("list is most recently updated first; save replaces title+lessons and bumps updatedAt", async () => {
		const a = courseStore.createCourse({ title: "A", topic: "a", intake, lessons: [] });
		await sleep(5);
		const b = courseStore.createCourse({ title: "B", topic: "b", intake, lessons: [] });
		const ids = () => courseStore.listCourses().map((c) => c.id);
		assert.ok(ids().indexOf(b.id) < ids().indexOf(a.id));
		await sleep(5);
		const saved = courseStore.saveCourse(a.id, { title: "A2", lessons: [lesson("x"), lesson("y")] });
		assert.equal(saved.title, "A2");
		assert.deepEqual(saved.lessons.map((l) => l.id), ["x", "y"]);
		assert.equal(saved.topic, "a");
		assert.ok(saved.updatedAt > a.updatedAt);
		assert.ok(ids().indexOf(a.id) < ids().indexOf(b.id));
		assert.throws(() => courseStore.saveCourse("missing", { title: "t", lessons: [] }), /not found/);
	});

	it("delete removes the file; unknown id is false", () => {
		const c = courseStore.createCourse({ title: "D", topic: "d", intake, lessons: [] });
		assert.equal(courseStore.deleteCourse(c.id), true);
		assert.equal(courseStore.getCourse(c.id), null);
		assert.equal(courseStore.deleteCourse(c.id), false);
	});

	it("a corrupt file reads as null and is skipped by list", () => {
		const c = courseStore.createCourse({ title: "C", topic: "c", intake, lessons: [] });
		fs.writeFileSync(path.join(TMP_DATA, "courses", `${c.id}.json`), "{not json", "utf-8");
		assert.equal(courseStore.getCourse(c.id), null);
		assert.ok(!courseStore.listCourses().some((x) => x.id === c.id));
	});

	it("rejects duplicate or empty lesson ids on create and save", () => {
		assert.throws(
			() => courseStore.createCourse({ title: "T", topic: "t", intake, lessons: [lesson("a"), lesson("a")] }),
			/Duplicate lesson id/,
		);
		assert.throws(
			() => courseStore.createCourse({ title: "T", topic: "t", intake, lessons: [lesson("")] }),
			/non-empty/,
		);
		const c = courseStore.createCourse({ title: "T", topic: "t", intake, lessons: [lesson("a")] });
		assert.throws(() => courseStore.saveCourse(c.id, { title: "T", lessons: [lesson("b"), lesson("b")] }), /Duplicate/);
	});
});

describe("chat lesson link", () => {
	it("round-trips through getChat and listChats; absent otherwise", () => {
		const link = { courseId: "course_x", lessonId: "price-elasticity" };
		const chat = chatStore.createChat("Lesson 1", undefined, link);
		assert.deepEqual(chat.lesson, link);
		assert.deepEqual(chatStore.getChat(chat.id)?.lesson, link);
		assert.deepEqual(chatStore.listChats().find((s) => s.id === chat.id)?.lesson, link);
		const plain = chatStore.createChat("plain");
		assert.equal("lesson" in plain, false);
		assert.equal("lesson" in (chatStore.listChats().find((s) => s.id === plain.id) ?? {}), false);
	});
});
