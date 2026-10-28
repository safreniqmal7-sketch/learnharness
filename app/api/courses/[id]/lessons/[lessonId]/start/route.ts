import { startLesson } from "@/src/server";

/** Resume the lesson's session, or create it (first message = the goal). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const result = startLesson(id, lessonId);
	if (!result) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(result);
}
