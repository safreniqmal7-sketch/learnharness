import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup as renderBare } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CourseBody } from "../components/courses/course-view.tsx";
import { ReviewPanel } from "../components/courses/review-panel.tsx";
import { REVIEW_OPENING_MESSAGE, startReview } from "../components/courses/start-review.ts";
import type { CourseViewDto } from "../components/courses/types.ts";
import { DAY_MS, type ReviewItem, type ReviewSchedule } from "../src/core/review.ts";

/** Next’s useRouter needs a mounted app router; a stub context is enough for static markup. */
const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} } as never;
const renderToStaticMarkup = (el: React.ReactElement) =>
	renderBare(<AppRouterContext.Provider value={router}>{el}</AppRouterContext.Provider>);

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
beforeEach(() => {
	const data = new Map<string, string>();
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => {
				data.set(key, value);
			},
			removeItem: (key: string) => {
				data.delete(key);
			},
		},
	});
});
afterEach(() => {
	if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
	else Reflect.deleteProperty(globalThis, "sessionStorage");
});

const item = (i: number, daysOverdue: number | null = 0): ReviewItem => ({
	nodeId: `n${i}`,
	name: `Name ${i}`,
	statement: `Statement ${i}`,
	lessonId: "l1",
	lessonTitle: "Supply",
	step: 0,
	dueAt: 0,
	daysOverdue,
});
const schedule = (due: ReviewItem[], nextDueAt: number | null = null): ReviewSchedule => ({ items: due, due, nextDueAt });
const render = (r: ReviewSchedule) => renderToStaticMarkup(<ReviewPanel review={r} courseTitle="Econ" />);
const summary = (html: string) => /data-testid="review-summary"[^>]*>([^<]*)</.exec(html)?.[1];
const inDays = (d: number) => Date.now() + d * DAY_MS - 1000;

describe("review panel", () => {
	it("summary lines", () => {
		assert.equal(summary(render(schedule([item(1), item(2)], inDays(3)))), "2 due now · next due in 3 days");
		assert.equal(summary(render(schedule([item(1)], inDays(1)))), "1 due now · next due in 1 day");
		assert.equal(summary(render(schedule([item(1)]))), "1 due now");
		assert.equal(summary(render(schedule([], inDays(5)))), "Nothing due · next due in 5 days");
		assert.equal(summary(render(schedule([]))), "No reviews scheduled yet");
	});
	it("due list keeps order and wording", () => {
		const html = render(schedule([item(2, 3), item(1, 1), item(3, 0)]));
		assert.equal((html.match(/data-testid="review-item"/g) ?? []).length, 3);
		assert.ok(html.indexOf("Name 2") < html.indexOf("Name 1") && html.indexOf("Name 1") < html.indexOf("Name 3"));
		assert.match(html, /Supply · 3 days overdue/);
		assert.match(html, /Supply · 1 day overdue/);
		assert.match(html, /Supply · due today/);
	});
	it("no list and a disabled button when nothing is due", () => {
		const html = render(schedule([], inDays(2)));
		assert.doesNotMatch(html, /review-item/);
		assert.match(html, /<button[^>]*data-testid="review-start"[^>]*disabled/);
	});
	it("button enabled when something is due", () => {
		assert.doesNotMatch(render(schedule([item(1)])), /<button[^>]*data-testid="review-start"[^>]*disabled/);
	});
	it("mounts on the course page only with a completed lesson", () => {
		const base: CourseViewDto = {
			course: { id: "c", title: "Econ", topic: "economics" },
			lessons: [{ id: "a", title: "Supply", goal: "g", origin: "syllabus", status: "complete", chatId: "x" }],
			continueLessonId: null,
			progress: { completed: 1, total: 1 },
			review: schedule([item(1)]),
		};
		const show = (v: CourseViewDto) => renderToStaticMarkup(<CourseBody view={v} onStart={() => {}} />);
		assert.match(show(base), /review-panel/);
		assert.doesNotMatch(show({ ...base, review: undefined }), /review-panel/);
		assert.doesNotMatch(show({ ...base, lessons: [{ ...base.lessons[0]!, status: "in-progress" }] }), /review-panel/);
	});
});

function fakeFetch(renameOk: boolean) {
	const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
	const f = (async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : {} });
		if (method === "PUT") {
			if (!renameOk) throw new Error("network");
			return new Response("{}", { status: 200 });
		}
		return new Response(JSON.stringify({ id: "c_rev" }), { status: 200 });
	}) as typeof fetch;
	return { f, calls };
}

describe("startReview", () => {
	it("creates a practice session with at most 8 picks in due order, then renames it", async () => {
		const { f, calls } = fakeFetch(true);
		const due = Array.from({ length: 10 }, (_, i) => item(i + 1, 10 - i));
		const route = await startReview("Econ", due, f);
		assert.equal(route, "/chat/c_rev");
		assert.equal(calls.length, 2);
		assert.equal(calls[0]!.url, "/api/chats");
		assert.equal(calls[0]!.method, "POST");
		assert.equal(calls[0]!.body.kind, "practice");
		assert.equal(calls[0]!.body.title, REVIEW_OPENING_MESSAGE);
		assert.equal(REVIEW_OPENING_MESSAGE, "Review these propositions from my course. They're due for spaced review.");
		const props = (calls[0]!.body.graphContext as { propositions: { id: string; name: string; statement: string }[] }).propositions;
		assert.deepEqual(props.map((p) => p.id), ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"]);
		assert.deepEqual(props[0], { id: "n1", name: "Name 1", statement: "Statement 1" });
		assert.equal(calls[1]!.url, "/api/chats/c_rev");
		assert.equal(calls[1]!.method, "PUT");
		assert.deepEqual(calls[1]!.body, { title: "Review: Econ" });
	});
	it("a failed rename still returns the route", async () => {
		const { f } = fakeFetch(false);
		assert.equal(await startReview("Econ", [item(1)], f), "/chat/c_rev");
	});
});
