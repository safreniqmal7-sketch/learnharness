/**
 * Start or resume a lesson (POST .../start). Returns the route to push:
 * a resumed lesson reopens its session; a new one carries its first message
 * as ?prompt= (the same delivery new-session.tsx uses). Injected fetch so
 * tests can pin the contract. Throws on a failed start.
 */
export async function startLesson(courseId: string, lessonId: string, fetchLike: typeof fetch = fetch): Promise<string> {
	const res = await fetchLike(`/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/start`, {
		method: "POST",
	});
	if (!res.ok) throw new Error("Could not start the lesson.");
	const body = (await res.json()) as { chatId: string; resumed: boolean; prompt?: string };
	return body.resumed || !body.prompt
		? `/chat/${body.chatId}`
		: `/chat/${body.chatId}?prompt=${encodeURIComponent(body.prompt)}`;
}
