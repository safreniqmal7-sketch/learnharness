/** Course cost UI: header total + per-lesson cost render; none without sessions. */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseBody } from "../components/courses/course-view.tsx";
import type { CourseViewDto } from "../components/courses/types.ts";

const view = (o: Partial<CourseViewDto> = {}): CourseViewDto => ({
	course: { id: "c1", title: "Micro", topic: "economics" },
	lessons: [
		{ id: "a", title: "Supply", goal: "g", origin: "syllabus", status: "complete", chatId: "x", costDollars: 0.11 },
		{ id: "b", title: "Demand", goal: "g", origin: "syllabus", status: "not-started", chatId: null, costDollars: 0 },
	],
	continueLessonId: "b",
	progress: { completed: 1, total: 2 },
	cost: { lessonsDollars: 0.11, draftDollars: 0.0123, totalDollars: 0.1223, unpriced: false },
	...o,
});

describe("course cost UI", () => {
	it("shows Spent total with a lessons/drafting tooltip, and a cost on session lessons only", () => {
		const html = renderToStaticMarkup(<CourseBody view={view()} onStart={() => {}} />);
		assert.match(html, /data-testid="course-cost"/);
		assert.match(html, /Spent \$0\.1223/);
		assert.match(html, /title="Lessons \$0\.1100 · Syllabus drafting \$0\.0123"/);
		assert.equal((html.match(/data-testid="lesson-cost"/g) ?? []).length, 1);
		assert.match(html, /\$0\.1100/);
	});

	it("older fixtures without cost fields render no cost", () => {
		const v = view({ cost: undefined, lessons: view().lessons.map(({ costDollars: _c, ...l }) => l) });
		const html = renderToStaticMarkup(<CourseBody view={v} onStart={() => {}} />);
		assert.doesNotMatch(html, /course-cost/);
		assert.doesNotMatch(html, /lesson-cost/);
	});

	it("an all-unpriced zero reads a dash, never a fake $0", () => {
		const v = view({ cost: { lessonsDollars: 0, draftDollars: 0, totalDollars: 0, unpriced: true } });
		const html = renderToStaticMarkup(<CourseBody view={v} onStart={() => {}} />);
		assert.match(html, /Spent —/);
	});
});
