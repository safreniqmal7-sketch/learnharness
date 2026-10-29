/**
 * Spaced review (owner, 2026-10-29; plan: docs/spaced-review.md): an
 * expanding ladder per proposition, DERIVED on read from the graph and the
 * practice transcripts — nothing stored, nothing written to the graph.
 *
 * Scheduled: graph propositions BORN in a completed lesson session of the
 * course (birthSessionOf). Clock: the lesson's first accepted
 * lesson_complete. Evidence: concluded problems from ANY practice session
 * whose target includes the proposition, timed at the conclude message.
 * Pure.
 */

import type { GraphNode } from "./contracts/graph.ts";
import {
	cleanToolCallIds,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	type LhMessage,
} from "./native-messages.ts";
import { birthSessionOf } from "./session-clusters.ts";

/** The ladder's steps in days (decision 6). A solve at the top stays there. */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120] as const;

/** How many propositions one Start review session takes (decision 9). */
export const REVIEW_BATCH_SIZE = 8;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The graded outcomes that move the ladder ("dismissed" never does). */
export type ReviewOutcome = "solved" | "solvedWithHints" | "movedOn" | "surrendered";

/** One concluded practice problem, as review evidence. */
export interface PracticeEvidence {
	/** The problem's target proposition ids (never empty). */
	targets: string[];
	outcome: ReviewOutcome;
	/** Epoch ms of the conclude call's assistant message. */
	at: number;
}

/** A completed lesson of the course (incomplete lessons are not passed in). */
export interface ReviewLessonInput {
	lessonId: string;
	title: string;
	/** The lesson session's chat id — propositions born here are scheduled. */
	chatId: string;
	/** Epoch ms of the first accepted lesson_complete result. */
	completedAt: number;
}

export interface ReviewInput {
	lessons: readonly ReviewLessonInput[];
	nodes: readonly Pick<GraphNode, "id" | "name" | "statement" | "provenance">[];
	/** The messages of every kind:"practice" chat. */
	practiceChats: readonly { messages: readonly LhMessage[] }[];
	/** Epoch ms. */
	now: number;
}

export interface ReviewItem {
	nodeId: string;
	name: string;
	statement: string;
	lessonId: string;
	lessonTitle: string;
	/** Index into REVIEW_INTERVAL_DAYS (0 = the 1-day step). */
	step: number;
	/** Epoch ms. */
	dueAt: number;
	/** Whole days past due (0 = due today); null when not yet due. */
	daysOverdue: number | null;
}

export interface ReviewSchedule {
	/** Every scheduled proposition, soonest due first. */
	items: ReviewItem[];
	/** Items with now >= dueAt, most overdue first. */
	due: ReviewItem[];
	/** Earliest dueAt among items NOT yet due; null when none. */
	nextDueAt: number | null;
}

/** Every concluded practice problem in one chat: each clean conclude call
 *  paired with the newest clean problem call before it (the same walk as
 *  problemInputForConclude). Untagged problems, dismissed outcomes, and
 *  errored or unpaired calls yield nothing. */
export function practiceEvidence(messages: readonly LhMessage[]): PracticeEvidence[] {
	const clean = cleanToolCallIds(messages);
	const consumed = new Set<string>();
	const out: PracticeEvidence[] = [];
	for (let mi = 0; mi < messages.length; mi++) {
		const m = messages[mi]!;
		if (m.role !== "assistant") continue;
		for (const block of m.content) {
			if (block.type !== "toolCall" || block.name !== PRACTICE_CONCLUDE_TOOL || !clean.has(block.id)) continue;
			const problem = newestCleanProblemBefore(messages, mi, block.id, clean);
			if (!problem || consumed.has(problem.id)) continue;
			consumed.add(problem.id);
			const target = (problem.arguments as { target?: unknown } | undefined)?.target;
			const targets = Array.isArray(target) && target.every((t) => typeof t === "string" && t !== "") ? (target as string[]) : [];
			if (targets.length === 0) continue;
			const outcome = (block.arguments as { outcome?: unknown } | undefined)?.outcome;
			if (!isReviewOutcome(outcome) || typeof m.timestamp !== "number") continue;
			out.push({ targets, outcome, at: m.timestamp });
		}
	}
	return out;
}

const OUTCOMES: readonly string[] = ["solved", "solvedWithHints", "movedOn", "surrendered"];
function isReviewOutcome(v: unknown): v is ReviewOutcome {
	return typeof v === "string" && OUTCOMES.includes(v);
}

/** The newest clean problem call before the given conclude call (earlier
 *  blocks of the same message count). */
function newestCleanProblemBefore(
	messages: readonly LhMessage[],
	messageIndex: number,
	concludeCallId: string,
	clean: ReadonlySet<string>,
): { id: string; arguments: unknown } | null {
	for (let mi = messageIndex; mi >= 0; mi--) {
		const m = messages[mi]!;
		if (m.role !== "assistant") continue;
		let bi = m.content.length - 1;
		if (mi === messageIndex) bi = m.content.findIndex((b) => b.type === "toolCall" && b.id === concludeCallId) - 1;
		for (; bi >= 0; bi--) {
			const b = m.content[bi]!;
			if (b.type === "toolCall" && b.name === PRACTICE_PROBLEM_TOOL && clean.has(b.id)) return b;
		}
	}
	return null;
}

/** The ladder over every scheduled proposition (rules: docs/spaced-review.md
 *  "The ladder"). */
export function reviewSchedule(input: ReviewInput): ReviewSchedule {
	const lessonByChat = new Map(input.lessons.map((l) => [l.chatId, l]));
	const events = input.practiceChats.flatMap((c) => practiceEvidence(c.messages)).sort((a, b) => a.at - b.at);
	const last = REVIEW_INTERVAL_DAYS.length - 1;
	const items: ReviewItem[] = [];
	for (const node of input.nodes) {
		const chat = birthSessionOf(node);
		const lesson = chat === null ? undefined : lessonByChat.get(chat);
		if (!lesson) continue;
		let step = 0;
		let dueAt = lesson.completedAt + DAY_MS;
		for (const e of events) {
			if (e.at < lesson.completedAt || !e.targets.includes(node.id)) continue;
			if (e.outcome === "movedOn" || e.outcome === "surrendered") {
				step = 0;
				dueAt = e.at + REVIEW_INTERVAL_DAYS[0] * DAY_MS;
			} else if (e.at >= dueAt) {
				if (e.outcome === "solved") step = Math.min(step + 1, last);
				dueAt = e.at + REVIEW_INTERVAL_DAYS[step]! * DAY_MS;
			}
		}
		items.push({
			nodeId: node.id,
			name: node.name,
			statement: node.statement,
			lessonId: lesson.lessonId,
			lessonTitle: lesson.title,
			step,
			dueAt,
			daysOverdue: input.now >= dueAt ? Math.floor((input.now - dueAt) / DAY_MS) : null,
		});
	}
	items.sort((a, b) => a.dueAt - b.dueAt || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
	const due = items.filter((i) => input.now >= i.dueAt);
	const upcoming = items.filter((i) => input.now < i.dueAt);
	return { items, due, nextDueAt: upcoming.length ? Math.min(...upcoming.map((i) => i.dueAt)) : null };
}
