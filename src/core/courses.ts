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
 * its sinks, the nodes nothing depends on — has a passing final check. The
 * evidence is the latest ANSWERED multiple-choice `quiz` call of type
 * "check" on that node: correct, at >= LESSON_COMPLETE_MIN_CONFIDENCE, and
 * not "I don't know". `explain` answers never count (they carry no
 * app-graded verdict), nor do predictions, nor dismissed questions. The
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

/** A node's latest answered check, as the gate reads it. */
type CheckVerdict = Pick<QuestionAnswerData, "correct" | "confidence" | "dontKnow">;

/** Fold the record into nodeId -> latest answered quiz check. A check is
 *  `quiz` + arguments.type "check" + a nodeId; "answered" = a later
 *  non-error, non-dismissed toolResult for that call id. Later answers win
 *  (record order), so an unanswered newer check falls back to the last
 *  answered one. */
function latestChecksByNode(messages: readonly LhMessage[]): Map<string, CheckVerdict> {
	const checkNode = new Map<string, string>(); // toolCallId -> nodeId
	const latest = new Map<string, CheckVerdict>();
	for (const m of messages) {
		if (m.role === "assistant") {
			for (const block of m.content) {
				if (block.type !== "toolCall" || block.name !== "quiz") continue;
				const args = block.arguments as { nodeId?: unknown; type?: unknown } | undefined;
				if (args?.type === "check" && typeof args.nodeId === "string" && args.nodeId.length > 0) {
					checkNode.set(block.id, args.nodeId);
				}
			}
		} else if (m.role === "toolResult") {
			if (m.toolName !== "quiz" || m.isError) continue;
			const nodeId = checkNode.get(m.toolCallId);
			if (nodeId === undefined) continue;
			const details = (m.details ?? {}) as Partial<QuestionAnswerData>;
			if (details.dismissed === true) continue;
			latest.set(nodeId, {
				correct: details.correct,
				confidence: details.confidence,
				dontKnow: details.dontKnow === true,
			});
		}
	}
	return latest;
}

/** The completion gate. Empty = accepted; otherwise one agent-facing
 *  problem per failing goal node (or one for a missing plan map). */
export function lessonCompletionProblems(tree: PlanTree | undefined, messages: readonly LhMessage[]): string[] {
	if (!tree) {
		return [
			"No plan map yet — build one (plan_init) and check the learner on its goal nodes before completing the lesson.",
		];
	}
	const checks = latestChecksByNode(messages);
	const titles = new Map(tree.nodes.map((n) => [n.id, n.title]));
	const problems: string[] = [];
	for (const id of lessonGoalNodeIds(tree)) {
		const label = `Goal node "${id}" (${titles.get(id) ?? id})`;
		const ask = `pose a multiple-choice quiz check (type "check") on node "${id}"`;
		const check = checks.get(id);
		if (!check) {
			problems.push(`${label} has no answered multiple-choice check. Pose one (quiz, type "check", nodeId "${id}"), then call ${LESSON_COMPLETE_TOOL} again.`);
		} else if (check.dontKnow) {
			problems.push(`${label}: the learner answered "I don't know" on the latest check. Re-teach it, then ${ask}.`);
		} else if (check.correct !== true) {
			problems.push(`${label}: the latest check was answered wrong. Re-teach it, then ${ask}.`);
		} else if (check.confidence === undefined || check.confidence < LESSON_COMPLETE_MIN_CONFIDENCE) {
			const shown = check.confidence === undefined ? "none stated" : `${check.confidence}%`;
			problems.push(
				`${label}: the latest check was correct but confidence was ${shown}, below ${LESSON_COMPLETE_MIN_CONFIDENCE}%. Consolidate, then ${ask} again.`,
			);
		}
	}
	return problems;
}

/** True iff the transcript holds an ACCEPTED lesson_complete (a toolResult
 *  that is not an error — refusals are error results). */
export function lessonCompleted(messages: readonly LhMessage[]): boolean {
	return messages.some((m) => m.role === "toolResult" && m.toolName === LESSON_COMPLETE_TOOL && m.isError !== true);
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
