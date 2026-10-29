"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DAY_MS, type ReviewSchedule } from "@/src/core";
import { startReview } from "./start-review";

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** The header line: due count and the next due date, or the empty state. */
export function reviewSummaryText(review: ReviewSchedule, now = Date.now()): string {
	const n = review.due.length;
	const next =
		review.nextDueAt === null ? null : `next due in ${plural(Math.max(1, Math.ceil((review.nextDueAt - now) / DAY_MS)), "day")}`;
	if (n > 0) return next ? `${n} due now · ${next}` : `${n} due now`;
	return next ? `Nothing due · ${next}` : "No reviews scheduled yet";
}

/** The spaced-review panel (docs/spaced-review.md): the summary line, the
 *  due list (most overdue first), and Start review. */
export function ReviewPanel({ review, courseTitle }: { review: ReviewSchedule; courseTitle: string }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);

	const start = () => {
		setBusy(true);
		setError(false);
		void startReview(courseTitle, review.due)
			.then((route) => router.push(route))
			.catch(() => {
				setBusy(false);
				setError(true);
			});
	};

	return (
		<section data-testid="review-panel" className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3">
			<h2 className="text-sm font-medium">Review</h2>
			<p data-testid="review-summary" className="font-prose text-(length:--lh-prose-size)">
				{reviewSummaryText(review)}
			</p>
			{review.due.length > 0 && (
				<ul className="flex flex-col gap-1">
					{review.due.map((i) => (
						<li key={i.nodeId} data-testid="review-item" className="text-sm">
							{i.name}
							<span className="block text-xs text-muted-foreground">
								{i.lessonTitle} · {!i.daysOverdue ? "due today" : `${plural(i.daysOverdue, "day")} overdue`}
							</span>
						</li>
					))}
				</ul>
			)}
			<div className="flex items-center gap-3">
				<Button data-testid="review-start" size="sm" disabled={review.due.length === 0 || busy} onClick={start}>
					Start review
				</Button>
				{error && <span className="text-xs text-muted-foreground">Could not start the review.</span>}
			</div>
		</section>
	);
}
