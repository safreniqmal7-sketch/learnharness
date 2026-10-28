import { courseView, deleteCourse, nonEmptyTrimmed, parseLessons, saveCourseEdits } from "@/src/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = courseView(id);
	if (!view) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(view);
}

/** Save the learner's syllabus edits (title + lessons in their new order). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!courseView(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	const title = nonEmptyTrimmed(body?.title);
	if (!title) return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	const lessons = parseLessons(body?.lessons);
	if (!lessons.ok) return Response.json({ error: lessons.error }, { status: 400 });
	try {
		const view = saveCourseEdits(id, { title, lessons: lessons.value });
		if (!view) return Response.json({ error: "Not found" }, { status: 404 });
		return Response.json(view);
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}

/** Delete the course; its sessions are kept as ordinary sessions. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!deleteCourse(id)) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ ok: true });
}
