import { draftCourseFor, nonEmptyTrimmed, parseIntake } from "@/src/server";

/** Intake -> draft syllabus. Nothing is saved. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	const topic = nonEmptyTrimmed(body?.topic);
	if (!topic) return Response.json({ error: "topic must be a non-empty string" }, { status: 400 });
	const intake = parseIntake(body?.intake);
	if (!intake.ok) return Response.json({ error: intake.error }, { status: 400 });
	const outcome = await draftCourseFor(topic, intake.value);
	if (!outcome.ok) return Response.json(outcome.body, { status: outcome.status });
	return Response.json({ draft: outcome.draft });
}
