/**
 * Course progress derivation (course mode, docs/course-mode.md) — DERIVED,
 * never stored. A lesson's status is a fold over its session's native
 * transcript, the same discipline as the plan tree and phases:
 *
 *   not-started — no session for the lesson yet
 *   in-progress — a session exists, no ACCEPTED `lesson_complete` result
 *   complete    — the transcript holds a `lesson_complete` toolResult that is
 *                 not an error (refusals are error results, so a refused
 *                 attempt leaves the lesson in progress)
 *
 * THE COMPLETION GATE (`lessonCompletionProblems`, owner decisions): the
 * teacher may only finish a lesson when EVERY goal node of the plan map —
 * its sinks, the nodes nothing depends on — has a passing final check, AND
 * the lesson holds one passing TRANSFER question (a check on a new case) on
 * a goal node. The evidence is the latest ANSWERED multiple-choice `quiz`
 * call of type "check" or "transfer" on that node (a transfer counts as its
 * node's check): correct, at >= LESSON_COMPLETE_MIN_CONFIDENCE, and not "I
 * don't know". The transfer rule reads the latest answered transfer on a
 * goal node. `explain` answers never count (they carry no app-graded
 * verdict), nor do predictions, untyped records, or dismissed questions. The
 * problems are written for the TEACHER (agent-facing) and say what to do.
 *
 * Pure: no fs, no network, no node builtins — safe on server, client, tests.
 */

import {
	LESSON_COMPLETE_MIN_CONFIDENCE,
	LESSON_COMPLETE_TOOL,
	type Course,
	type LessonStatus,
	type PlanTree,
} from "./contracts.ts";
import type { LhMessage } from "./native-messages.ts";
import type { QuestionAnswerData } from "./question-core.ts";

/** The plan map's goal nodes: SINKS — ids that never appear as an edge's
 *  `from` (nothing depends on them), in tree.nodes order. Edges are
 *  "requires" edges: from = prerequisite, to = dependent. */
export function lessonGoalNodeIds(tree: PlanTree): string[] {
	const prerequisites = new Set(tree.edges.map((e) => e.from));
	return tree.nodes.filter((n) => !prerequisites.has(n.id)).map((n) => n.id);
}

/** One answered check-or-transfer, as the gate reads it. */
type CheckVerdict = Pick<QuestionAnswerData, "correct" | "confidence" | "dontKnow"> & { kind: "check" | "transfer" };

/** pass = correct, not "I don't know", at >= LESSON_COMPLETE_MIN_CONFIDENCE. */
const passes = (v: CheckVerdict): boolean =>
	v.correct === true && !v.dontKnow && v.confidence !== undefined && v.confidence >= LESSON_COMPLETE_MIN_CONFIDENCE;

/** Fold the record into the gate's evidence: `byNode` = nodeId -> latest
 *  answered check-or-transfer (a transfer counts as its node's check), and
 *  `transfers` = every answered transfer in record order (the caller keeps
 *  the latest one on a goal node). A check/transfer is `quiz` +
 *  arguments.type "check" | "transfer" + a nodeId; "answered" = a later
 *  non-error, non-dismissed toolResult for that call id. Later answers win
 *  (record order), so an unanswered newer question falls back to the last
 *  answered one. Records with no `type` never count. */
function foldChecks(messages: readonly LhMessage[]): {
	byNode: Map<string, CheckVerdict>;
	transfers: Array<CheckVerdict & { nodeId: string }>;
} {
	const calls = new Map<string, { nodeId: string; kind: "check" | "transfer" }>(); // toolCallId
	const byNode = new Map<string, CheckVerdict>();
	const transfers: Array<CheckVerdict & { nodeId: string }> = [];
	for (const m of messages) {
		if (m.role === "assistant") {
			for (const block of m.content) {
				if (block.type !== "toolCall" || block.name !== "quiz") continue;
				const args = block.arguments as { nodeId?: unknown; type?: unknown } | undefined;
				if (
					(args?.type === "check" || args?.type === "transfer") &&
					typeof args.nodeId === "string" &&
					args.nodeId.length > 0
				) {
					calls.set(block.id, { nodeId: args.nodeId, kind: args.type });
				}
			}
		} else if (m.role === "toolResult") {
			if (m.toolName !== "quiz" || m.isError) continue;
			const call = calls.get(m.toolCallId);
			if (call === undefined) continue;
			const details = (m.details ?? {}) as Partial<QuestionAnswerData>;
			if (details.dismissed === true) continue;
			const verdict: CheckVerdict = {
				correct: details.correct,
				confidence: details.confidence,
				dontKnow: details.dontKnow === true,
				kind: call.kind,
			};
			byNode.set(call.nodeId, verdict);
			if (call.kind === "transfer") transfers.push({ ...verdict, nodeId: call.nodeId });
		}
	}
	return { byNode, transfers };
}

/** The completion gate. Empty = accepted; otherwise one agent-facing
 *  problem per failing goal node (or one for a missing plan map), plus one
 *  for the lesson's transfer question. */
export function lessonCompletionProblems(tree: PlanTree | undefined, messages: readonly LhMessage[]): string[] {
	if (!tree) {
		return [
			"No plan map yet — build one (plan_init) and check the learner on its goal nodes before completing the lesson.",
		];
	}
	const { byNode, transfers } = foldChecks(messages);
	const titles = new Map(tree.nodes.map((n) => [n.id, n.title]));
	const goals = lessonGoalNodeIds(tree);
	const problems: string[] = [];
	for (const id of goals) {
		const label = `Goal node "${id}" (${titles.get(id) ?? id})`;
		const ask = `pose a multiple-choice quiz check (type "check" or "transfer") on node "${id}"`;
		const check = byNode.get(id);
		if (!check) {
			problems.push(`${label} has no answered multiple-choice check (or transfer). Pose one (quiz, type "check" or "transfer", nodeId "${id}"), then call ${LESSON_COMPLETE_TOOL} again.`);
		} else if (check.dontKnow) {
			problems.push(`${label}: the learner answered "I don't know" on the latest check (or transfer). Re-teach it, then ${ask}.`);
		} else if (check.correct !== true) {
			problems.push(`${label}: the latest check (or transfer) was answered wrong. Re-teach it, then ${ask}.`);
		} else if (check.confidence === undefined || check.confidence < LESSON_COMPLETE_MIN_CONFIDENCE) {
			const shown = check.confidence === undefined ? "none stated" : `${check.confidence}%`;
			problems.push(
				`${label}: the latest check (or transfer) was correct but confidence was ${shown}, below ${LESSON_COMPLETE_MIN_CONFIDENCE}%. Consolidate, then ${ask} again.`,
			);
		}
	}
	const goalSet = new Set(goals);
	const latestTransfer = transfers.filter((t) => goalSet.has(t.nodeId)).at(-1);
	const ids = goals.map((g) => `"${g}"`).join(", ");
	const newCase =
		`pose a multiple-choice quiz with type "transfer" on one of the goal nodes (${ids}) that applies the idea to a case NOT used in this lesson ` +
		`but answerable by reasoning from what was taught; the learner must answer it correctly at ${LESSON_COMPLETE_MIN_CONFIDENCE}% confidence or more`;
	if (!latestTransfer) {
		problems.push(`No passing transfer question yet: ${newCase}; then call ${LESSON_COMPLETE_TOOL} again.`);
	} else if (!passes(latestTransfer)) {
		const why = latestTransfer.dontKnow
			? `the learner answered "I don't know"`
			: latestTransfer.correct !== true
				? "it was answered wrong"
				: `it was correct but confidence was ${latestTransfer.confidence === undefined ? "none stated" : `${latestTransfer.confidence}%`}, below ${LESSON_COMPLETE_MIN_CONFIDENCE}%`;
		problems.push(
			`The latest transfer question (node "${latestTransfer.nodeId}") did not pass: ${why}. Re-teach the underlying idea (not the case), then ${newCase}; then call ${LESSON_COMPLETE_TOOL} again.`,
		);
	}
	return problems;
}

/** True iff the transcript holds an ACCEPTED lesson_complete (a toolResult
 *  that is not an error — refusals are error results). */
export function lessonCompleted(messages: readonly LhMessage[]): boolean {
	return messages.some((m) => m.role === "toolResult" && m.toolName === LESSON_COMPLETE_TOOL && m.isError !== true);
}

/** Epoch ms of the FIRST accepted lesson_complete result (the course clock
 *  for spaced review); null when the lesson was never completed. */
export function lessonCompletedAt(messages: readonly LhMessage[]): number | null {
	const m = messages.find((x) => x.role === "toolResult" && x.toolName === LESSON_COMPLETE_TOOL && x.isError !== true);
	return m ? m.timestamp : null;
}

/** A lesson's status from its session's chat (null = no session yet). */
export function lessonStatus(chat: { messages: readonly LhMessage[] } | null): LessonStatus {
	if (!chat) return "not-started";
	return lessonCompleted(chat.messages) ? "complete" : "in-progress";
}

/** The first lesson in syllabus order that isn't complete (a missing status
 *  = not-started); null when every lesson is complete or there are none. */
export function continueLessonId(course: Course, statuses: Readonly<Record<string, LessonStatus>>): string | null {
	return course.lessons.find((l) => (statuses[l.id] ?? "not-started") !== "complete")?.id ?? null;
}

/** Completed / total lessons. */
export function courseProgress(
	course: Course,
	statuses: Readonly<Record<string, LessonStatus>>,
): { completed: number; total: number } {
	return {
		completed: course.lessons.filter((l) => statuses[l.id] === "complete").length,
		total: course.lessons.length,
	};
}

/** A new lesson's stable id: the title slugified, made unique against the
 *  course's existing ids with a numeric suffix. Shared by every writer that
 *  adds lessons (draft save, learner edits, the teacher's course_add_lesson)
 *  so ids look the same whoever chose them. */
export function lessonIdFor(title: string, existingIds: Iterable<string>): string {
	const taken = new Set(existingIds);
	const base = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "lesson";
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
