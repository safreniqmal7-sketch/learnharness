import { createCourseFromDraft, listCourseViews, nonEmptyTrimmed, parseIntake, parseLessons } from "@/src/server";

export async function GET() {
	return Response.json({ courses: listCourseViews() });
}

/** Create a course from an approved (possibly edited) draft. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	const topic = nonEmptyTrimmed(body?.topic);
	const title = nonEmptyTrimmed(body?.title);
	if (!topic) return Response.json({ error: "topic must be a non-empty string" }, { status: 400 });
	if (!title) return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	const intake = parseIntake(body?.intake);
	if (!intake.ok) return Response.json({ error: intake.error }, { status: 400 });
	const lessons = parseLessons(body?.lessons);
	if (!lessons.ok) return Response.json({ error: lessons.error }, { status: 400 });
	try {
		const course = createCourseFromDraft({ topic, intake: intake.value, title, lessons: lessons.value });
		return Response.json({ course }, { status: 201 });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
