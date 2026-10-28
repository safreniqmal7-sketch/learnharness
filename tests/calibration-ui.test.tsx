import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseBody } from "../components/courses/course-view.tsx";
import type { CourseViewDto } from "../components/courses/types.ts";
import { CALIBRATION_NOT_READY_TEXT, calibrationSummary } from "../src/core/calibration.ts";

const base = (chatId: string | null, calibration: CourseViewDto["calibration"]): CourseViewDto => ({
	course: { id: "c", title: "Econ", topic: "economics" },
	lessons: [{ id: "a", title: "Supply", goal: "g", origin: "syllabus", status: "in-progress", chatId }],
	continueLessonId: "a",
	progress: { completed: 0, total: 1 },
	calibration,
});
const msgs = (count: number, right: number) => {
	const out: unknown[] = [];
	for (let i = 0; i < count; i++) {
		out.push({ role: "assistant", content: [{ type: "toolCall", id: `i${i}`, name: "quiz", arguments: {} }] });
		out.push({ role: "toolResult", toolCallId: `i${i}`, toolName: "quiz", isError: false, content: [], details: { correct: i < right, confidence: 100, dontKnow: false } });
	}
	return out as never;
};
const render = (v: CourseViewDto) => renderToStaticMarkup(<CourseBody view={v} onStart={() => {}} />);
const summaryOf = (count: number, right: number) => calibrationSummary({ chats: [{ lessonTitle: "L", messages: msgs(count, right) }] });

describe("calibration panel", () => {
	it("hidden when no lesson sessions", () => {
		assert.doesNotMatch(render(base(null, calibrationSummary({ chats: [] }))), /calibration-panel/);
	});
	it("hidden when the DTO has no calibration", () => {
		assert.doesNotMatch(render(base("x", undefined)), /calibration-panel/);
	});
	it("not-ready shows the line and no table", () => {
		const html = render(base("x", summaryOf(3, 3)));
		assert.match(html, /How well you know what you know/);
		assert.match(html, new RegExp(CALIBRATION_NOT_READY_TEXT));
		assert.doesNotMatch(html, /calibration-table/);
	});
	it("ready shows sentences and the table", () => {
		const html = render(base("x", summaryOf(10, 5)));
		assert.match(html, /When you felt 90%\+ sure you were right 5 of 10 times\./);
		assert.match(html, /Overconfident misses: L \(5\)\./);
		assert.match(html, /Confidence/);
		assert.match(html, /% right/);
		assert.match(html, /<td class="py-0.5">100%<\/td><td class="py-0.5">10<\/td><td class="py-0.5">50%<\/td>/);
	});
});
