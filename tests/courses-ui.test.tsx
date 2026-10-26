/**
 * Course-mode UI render tests (presentational parts only — no fetch).
 * Same classic-JSX shim as render-sidebar.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseListView } from "../components/courses/course-list.tsx";
import { CourseBody } from "../components/courses/course-view.tsx";
import { DraftReview, FailureNotice, IntakeForm, EMPTY_INTAKE } from "../components/courses/new-course.tsx";
import { LessonBannerView, bannerData } from "../components/courses/lesson-banner.tsx";
import { startLesson } from "../components/courses/start-lesson.ts";
import { moveLesson, removeLesson, addLesson, editorValid } from "../components/courses/lesson-edit.ts";
import type { CourseViewDto, CourseSummaryDto } from "../components/courses/types.ts";

const summary = (o: Partial<CourseSummaryDto> = {}): CourseSummaryDto => ({
	id: "c1",
	title: "Microeconomics",
	topic: "economics",
	updatedAt: "2026-01-01T00:00:00.000Z",
	progress: { completed: 4, total: 12 },
	continueLessonId: "l5",
	...o,
});

const view = (o: Partial<CourseViewDto> = {}): CourseViewDto => ({
	course: { id: "c1", title: "Microeconomics", topic: "economics" },
	lessons: [
		{ id: "a", title: "Supply", goal: "Explain supply", origin: "syllabus", status: "complete", chatId: "x" },
		{ id: "b", title: "Demand", goal: "Explain demand", origin: "syllabus", status: "in-progress", chatId: "y" },
		{ id: "c", title: "Margins", goal: "Explain margins", origin: "teacher", addedReason: "needed for demand", status: "not-started", chatId: null },
	],
	continueLessonId: "b",
	progress: { completed: 1, total: 3 },
	...o,
});

describe("course list", () => {
	it("empty state shows copy and New course", () => {
		const html = renderToStaticMarkup(<CourseListView courses={[]} onContinue={() => {}} />);
		assert.match(html, /courses-empty/);
		assert.match(html, /No courses yet/);
		assert.match(html, /New course/);
		assert.match(html, /href="\/courses\/new"/);
	});
	it("populated rows show title, topic, progress and Continue", () => {
		const html = renderToStaticMarkup(<CourseListView courses={[summary(), summary({ id: "c2", title: "Done", continueLessonId: null })]} onContinue={() => {}} />);
		assert.match(html, /Microeconomics/);
		assert.match(html, /4 \/ 12/);
		assert.equal((html.match(/Continue/g) ?? []).length, 1);
		assert.match(html, /href="\/courses\/c1"/);
	});
});

describe("course view", () => {
	it("renders statuses, teacher badge with reason, and Continue", () => {
		const html = renderToStaticMarkup(<CourseBody view={view()} onStart={() => {}} />);
		assert.match(html, /Complete/);
		assert.match(html, /In progress/);
		assert.match(html, /Not started/);
		assert.match(html, /Added by the teacher/);
		assert.match(html, /needed for demand/);
		assert.match(html, /1 \/ 3/);
		assert.match(html, />Continue</);
	});
	it("hides Continue when everything is complete", () => {
		const html = renderToStaticMarkup(<CourseBody view={view({ continueLessonId: null })} onStart={() => {}} />);
		assert.doesNotMatch(html, />Continue</);
	});
});

describe("new course", () => {
	it("intake form has the fields and Draft syllabus", () => {
		const html = renderToStaticMarkup(
			<IntakeForm values={EMPTY_INTAKE} onChange={() => {}} onSubmit={() => {}} busy={false} failure={null} />,
		);
		for (const t of ["Topic", "Level", "Purpose", "Depth", "Notes", "Draft syllabus"]) assert.match(html, new RegExp(t));
		assert.doesNotMatch(html, /drafting-busy/);
	});
	it("shows a busy state while drafting", () => {
		const html = renderToStaticMarkup(
			<IntakeForm values={EMPTY_INTAKE} onChange={() => {}} onSubmit={() => {}} busy failure={null} />,
		);
		assert.match(html, /drafting-busy/);
	});
	it("draft editor renders one editable row per lesson", () => {
		const html = renderToStaticMarkup(
			<DraftReview
				title="T"
				onTitleChange={() => {}}
				lessons={[
					{ key: "1", title: "One", goal: "g1" },
					{ key: "2", title: "Two", goal: "g2" },
				]}
				onLessonsChange={() => {}}
				onBack={() => {}}
				onSave={() => {}}
				saving={false}
				failure={null}
			/>,
		);
		assert.equal((html.match(/lesson-edit-row/g) ?? []).length, 2);
		assert.match(html, /value="One"/);
		assert.match(html, /Add lesson/);
		assert.match(html, /Save course/);
		assert.match(html, /Back/);
	});
	it("setup failures point at Settings; model failures offer Retry", () => {
		const setup = renderToStaticMarkup(
			<FailureNotice failure={{ kind: "setup", code: "models_not_configured", message: "x" }} />,
		);
		assert.match(setup, /Open Settings/);
		const failed = renderToStaticMarkup(<FailureNotice failure={{ kind: "failed", message: "boom" }} onRetry={() => {}} />);
		assert.match(failed, /boom/);
		assert.match(failed, /Retry/);
	});
	it("list edits: move, remove, add, validity", () => {
		const l = [
			{ key: "a", title: "A", goal: "ga" },
			{ key: "b", title: "B", goal: "gb" },
		];
		assert.deepEqual(moveLesson(l, 0, 1).map((x) => x.key), ["b", "a"]);
		assert.deepEqual(moveLesson(l, 0, -1).map((x) => x.key), ["a", "b"]);
		assert.deepEqual(removeLesson(l, 0).map((x) => x.key), ["b"]);
		const added = addLesson(l);
		assert.equal(added[2]?.learnerAdded, true);
		assert.equal(editorValid("T", added), false);
		assert.equal(editorValid("T", l), true);
	});
});

describe("lesson banner", () => {
	it("renders course title and position, linking to the course", () => {
		const html = renderToStaticMarkup(<LessonBannerView data={bannerData(view(), "b")} />);
		assert.match(html, /Microeconomics · Lesson 2 of 3/);
		assert.match(html, /href="\/courses\/c1"/);
		assert.doesNotMatch(html, /Complete/);
	});
	it("adds Complete for a complete lesson", () => {
		const html = renderToStaticMarkup(<LessonBannerView data={bannerData(view(), "a")} />);
		assert.match(html, /Lesson 1 of 3/);
		assert.match(html, /· Complete/);
	});
	it("renders nothing without data (deleted course or removed lesson)", () => {
		assert.equal(renderToStaticMarkup(<LessonBannerView data={null} />), "");
		assert.equal(bannerData(view(), "gone"), null);
	});
});

describe("startLesson", () => {
	const fake = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
	it("new lesson carries the prompt; resumed does not", async () => {
		assert.equal(await startLesson("c", "l", fake({ chatId: "z", resumed: false, prompt: "a b" })), "/chat/z?prompt=a%20b");
		assert.equal(await startLesson("c", "l", fake({ chatId: "z", resumed: true })), "/chat/z");
		await assert.rejects(startLesson("c", "l", fake({}, false)));
	});
});
