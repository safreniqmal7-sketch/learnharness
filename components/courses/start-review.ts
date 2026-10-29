import { REVIEW_BATCH_SIZE, type ReviewItem } from "@/src/core";
import { SessionStarter } from "@/components/start-session";

/** The review session's first message (owner decision 11, docs/spaced-review.md). */
export const REVIEW_OPENING_MESSAGE = "Review these propositions from my course. They're due for spaced review.";

/**
 * Start a review: a practice session seeded with the most overdue due
 * propositions (first REVIEW_BATCH_SIZE of `due`, already most-overdue
 * first), then renamed "Review: <course>" (SessionStarter titles a session
 * from its opening text). A failed rename never blocks the review — the
 * session exists. Returns the route to push; throws if creation fails.
 */
export async function startReview(
	courseTitle: string,
	due: readonly ReviewItem[],
	fetchLike: typeof fetch = fetch,
	starter = new SessionStarter(),
): Promise<string> {
	const picks = due.slice(0, REVIEW_BATCH_SIZE).map((i) => ({ id: i.nodeId, name: i.name, statement: i.statement }));
	const route = await starter.start(
		{ title: REVIEW_OPENING_MESSAGE, kind: "practice", graphContext: { propositions: picks } },
		fetchLike,
	);
	const id = route.slice("/chat/".length);
	try {
		await fetchLike(`/api/chats/${encodeURIComponent(id)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: `Review: ${courseTitle}` }),
		});
	} catch {
		// The session exists; a wrong title is not worth blocking the review.
	}
	return route;
}
