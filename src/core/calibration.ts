/**
 * Calibration feedback (Feature B, owner decisions 2026-10-29) — the pure
 * fold behind the course page's "How well you know what you know" panel.
 * DERIVED on read from the lesson chats' native records; nothing is stored
 * (understanding is inferred, never encoded).
 *
 * What counts: `quiz` and `probe` calls joined to a later non-error result
 * that is not dismissed, not "I don't know", and carries a boolean `correct`
 * and a numeric `confidence` (snapped to the nearest CONFIDENCE_STOPS value).
 *
 * Findings (only when ready, at most 3). Order: over/under findings by gap
 * size descending (over before under on a tie), then the overconfident-misses
 * finding LAST (it has no comparable gap), then the list is cut to 3 — so the
 * misses finding only drops out when three gap findings already exist.
 *
 * Client-safe: pure types + math, exposed via the core barrel; wording lives
 * here so components render strings only.
 */

import type { PlanTree } from "./contracts.ts";
import type { LhMessage } from "./native-messages.ts";
import { CONFIDENCE_STOPS, type QuestionAnswerData } from "./question-core.ts";

export const CALIBRATION_MIN_ANSWERS = 10;
export const CALIBRATION_LEVEL_MIN = 5;
export const CALIBRATION_GAP_POINTS = 20;
export const CALIBRATION_NOT_READY_TEXT = "Answer a few more questions to see your calibration.";

/** Wrong answers at or above this confidence are "overconfident misses". */
const OVERCONFIDENT_FROM = 90;
const MAX_FINDINGS = 3;
const MAX_MISS_TOPICS = 3;
const EPS = 1e-9;

export interface CalibrationChatInput {
	lessonTitle: string;
	tree?: PlanTree;
	messages: readonly LhMessage[];
}

export interface CalibrationRow {
	confidence: number;
	answers: number;
	correct: number;
	/** 0-100, rounded. */
	accuracy: number;
}

export interface CalibrationFinding {
	kind: "over" | "under" | "misses";
	sentence: string;
}

export interface CalibrationSummary {
	total: number;
	ready: boolean;
	rows: CalibrationRow[];
	findings: CalibrationFinding[];
}

interface Rated {
	confidence: number;
	correct: boolean;
	topic: string;
}

const snap = (c: number): number =>
	CONFIDENCE_STOPS.reduce((best, s) => (Math.abs(s - c) < Math.abs(best - c) ? s : best), CONFIDENCE_STOPS[0]!);

/** Fold one chat's record into its rated answers (record order). */
function ratedAnswers(chat: CalibrationChatInput): Rated[] {
	const titles = new Map((chat.tree?.nodes ?? []).map((n) => [n.id, n.title]));
	const calls = new Map<string, string>(); // toolCallId -> topic
	const out: Rated[] = [];
	for (const m of chat.messages) {
		if (m.role === "assistant") {
			for (const block of m.content) {
				if (block.type !== "toolCall" || (block.name !== "quiz" && block.name !== "probe")) continue;
				const nodeId = (block.arguments as { nodeId?: unknown } | undefined)?.nodeId;
				const topic = typeof nodeId === "string" && nodeId.length > 0 ? (titles.get(nodeId) ?? nodeId) : chat.lessonTitle;
				calls.set(block.id, topic);
			}
		} else if (m.role === "toolResult") {
			if ((m.toolName !== "quiz" && m.toolName !== "probe") || m.isError) continue;
			const topic = calls.get(m.toolCallId);
			if (topic === undefined) continue;
			const d = (m.details ?? {}) as Partial<QuestionAnswerData>;
			if (d.dismissed === true || d.dontKnow === true) continue;
			if (typeof d.correct !== "boolean" || typeof d.confidence !== "number" || !Number.isFinite(d.confidence)) continue;
			out.push({ confidence: snap(d.confidence), correct: d.correct, topic });
		}
	}
	return out;
}

export function calibrationSummary(input: { chats: readonly CalibrationChatInput[] }): CalibrationSummary {
	const rated = input.chats.flatMap(ratedAnswers);
	const total = rated.length;
	const ready = total >= CALIBRATION_MIN_ANSWERS;

	const byLevel = new Map<number, { answers: number; correct: number }>();
	for (const r of rated) {
		const cur = byLevel.get(r.confidence) ?? { answers: 0, correct: 0 };
		cur.answers++;
		if (r.correct) cur.correct++;
		byLevel.set(r.confidence, cur);
	}
	const rows: CalibrationRow[] = [...byLevel]
		.sort((a, b) => a[0] - b[0])
		.map(([confidence, v]) => ({
			confidence,
			answers: v.answers,
			correct: v.correct,
			accuracy: Math.round((100 * v.correct) / v.answers),
		}));

	const findings: CalibrationFinding[] = [];
	if (ready) {
		const gaps: Array<CalibrationFinding & { gap: number }> = [];
		const over = (stated: number, answers: number, correct: number, label: string) => {
			const gap = stated - (100 * correct) / answers;
			if (answers >= CALIBRATION_LEVEL_MIN && gap >= CALIBRATION_GAP_POINTS - EPS) {
				gaps.push({ kind: "over", gap, sentence: `When you felt ${label} sure you were right ${correct} of ${answers} times.` });
			}
		};
		const hi = rows.filter((r) => r.confidence >= OVERCONFIDENT_FROM);
		if (hi.length > 0) {
			const answers = hi.reduce((s, r) => s + r.answers, 0);
			const correct = hi.reduce((s, r) => s + r.correct, 0);
			const stated = hi.reduce((s, r) => s + r.confidence * r.answers, 0) / answers;
			over(stated, answers, correct, "90%+");
		}
		for (const r of rows) {
			if (r.confidence >= OVERCONFIDENT_FROM) continue;
			over(r.confidence, r.answers, r.correct, `${r.confidence}%`);
		}
		for (const r of rows) {
			const gap = (100 * r.correct) / r.answers - r.confidence;
			if (r.answers >= CALIBRATION_LEVEL_MIN && gap >= CALIBRATION_GAP_POINTS - EPS) {
				gaps.push({
					kind: "under",
					gap,
					sentence: `You undersell yourself at ${r.confidence}%: right ${r.correct} of ${r.answers}.`,
				});
			}
		}
		gaps.sort((a, b) => b.gap - a.gap); // stable: over before under on ties
		findings.push(...gaps.map(({ kind, sentence }) => ({ kind, sentence })));

		const misses = new Map<string, number>();
		for (const r of rated) {
			if (!r.correct && r.confidence >= OVERCONFIDENT_FROM) misses.set(r.topic, (misses.get(r.topic) ?? 0) + 1);
		}
		if (misses.size > 0) {
			const top = [...misses]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.slice(0, MAX_MISS_TOPICS)
				.map(([t, n]) => `${t} (${n})`);
			findings.push({ kind: "misses", sentence: `Overconfident misses: ${top.join(", ")}.` });
		}
	}
	return { total, ready, rows, findings: findings.slice(0, MAX_FINDINGS) };
}

/** The strings the panel renders: the not-ready line, or the findings'
 *  sentences (possibly none when ready with nothing notable). */
export function calibrationSentences(summary: CalibrationSummary): string[] {
	return summary.ready ? summary.findings.map((f) => f.sentence) : [CALIBRATION_NOT_READY_TEXT];
}
