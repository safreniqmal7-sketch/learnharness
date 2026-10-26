import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { COURSE_ADD_LESSON_TOOL, LESSON_COMPLETE_TOOL, type Lesson, type LessonLink } from "../../core/contracts.ts";
import { lessonCompletionProblems, lessonIdFor } from "../../core/courses.ts";
import type { ChatStore, CourseStore } from "../../core/ports.ts";

/**
 * The two course-mode teacher tools (docs/course-mode.md "Agent side"),
 * registered in LESSON SESSIONS only (tools.ts createTeacherTools, when the
 * handler injects a `lesson` context). Server-side, instant, and — like
 * every tool — never throwing into the agent loop: every failure is
 * RETURNED as an `isError: true` result (pi's convention, see
 * tool-execute.ts invalidInputResult) that the model can read and adapt to.
 *
 * isError IS THE CONTRACT. pi copies `result.isError` onto the persisted
 * toolResult message, and core/courses.ts lessonCompleted() reads exactly
 * that: a refused lesson_complete leaves the lesson in progress, an accepted
 * one completes it. (serverExecute can't carry isError — its string/object
 * mapping never sets it — so these tools build their results directly.)
 */

export interface CourseToolContext {
	chatId: string;
	/** The CURRENT record is read on every call (tree + messages evolve mid-session). */
	chatStore: Pick<ChatStore, "getChat">;
	/** Injected port — the agent layer never imports the store adapter. */
	courseStore: CourseStore;
	/** The session's lesson link (stamped at creation). */
	link: LessonLink;
}

function refusal(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], isError: true, details };
}

function success(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

const lessonCompleteInput = Type.Object({});

const courseAddLessonInput = Type.Object({
	title: Type.String({ minLength: 1, description: "Short label for the new lesson, shown on the course page." }),
	goal: Type.String({ minLength: 1, description: "One sentence: the understanding this lesson ends at." }),
	reason: Type.String({
		minLength: 1,
		description: "Why the learner needs it, in words he will read (shown as the 'Added by the teacher' notice).",
	}),
	beforeLessonId: Type.Optional(
		Type.String({
			description:
				"Id of the syllabus lesson that needs the new one first (usually this lesson). Absent or unknown: the lesson is added at the end.",
		}),
	),
});

export function courseTools(ctx: CourseToolContext): Record<string, AgentTool<any>> {
	const lessonComplete: AgentTool<typeof lessonCompleteInput> = {
		name: LESSON_COMPLETE_TOOL,
		label: LESSON_COMPLETE_TOOL,
		description:
			"Declare this course lesson complete. The app checks the evidence first: every goal node of your plan map " +
			"needs a passing multiple-choice quiz check. Refused calls say which node failed (an error result); an accepted call ends the lesson.",
		parameters: lessonCompleteInput,
		execute: async () => {
			try {
				const record = ctx.chatStore.getChat(ctx.chatId);
				if (!record) return refusal(`Chat not found: ${ctx.chatId}`, { ok: false });
				const problems = lessonCompletionProblems(record.tree, record.messages);
				if (problems.length > 0) {
					return refusal(
						`Lesson not complete yet:\n${problems.map((p) => `- ${p}`).join("\n")}`,
						{ ok: false, problems },
					);
				}
				return success("Lesson accepted as complete.", { ok: true });
			} catch (err) {
				return refusal(`${LESSON_COMPLETE_TOOL} failed: ${err instanceof Error ? err.message : String(err)}`, { ok: false });
			}
		},
	};

	const courseAddLesson: AgentTool<typeof courseAddLessonInput> = {
		name: COURSE_ADD_LESSON_TOOL,
		label: COURSE_ADD_LESSON_TOOL,
		description:
			"Add a lesson to the learner's course when teaching reveals a missing foundation too big to repair in this lesson. " +
			"It is inserted before `beforeLessonId` (or at the end) and marked as added by you; returns the new lesson's id.",
		parameters: courseAddLessonInput,
		execute: async (_toolCallId, input) => {
			try {
				const title = input.title.trim();
				const goal = input.goal.trim();
				const reason = input.reason.trim();
				const problems: string[] = [];
				if (!title) problems.push("`title` must not be empty.");
				if (!goal) problems.push("`goal` must not be empty.");
				if (!reason) problems.push("`reason` must not be empty.");
				if (problems.length > 0) {
					return refusal(`Invalid input for ${COURSE_ADD_LESSON_TOOL}:\n${problems.map((p) => `- ${p}`).join("\n")}`, { ok: false, problems });
				}
				const course = ctx.courseStore.getCourse(ctx.link.courseId);
				if (!course) return refusal("This session's course no longer exists, so no lesson can be added.", { ok: false });
				const lesson: Lesson = {
					id: lessonIdFor(title, course.lessons.map((l) => l.id)),
					title,
					goal,
					origin: "teacher",
					addedReason: reason,
				};
				const at = input.beforeLessonId ? course.lessons.findIndex((l) => l.id === input.beforeLessonId) : -1;
				const lessons = [...course.lessons];
				lessons.splice(at === -1 ? lessons.length : at, 0, lesson);
				ctx.courseStore.saveCourse(course.id, { title: course.title, lessons });
				const where = at === -1 ? "at the end of the syllabus" : `before "${lessons[at + 1]!.id}"`;
				return success(`Added lesson "${lesson.id}" ${where}.`, { ok: true, lessonId: lesson.id });
			} catch (err) {
				return refusal(`${COURSE_ADD_LESSON_TOOL} failed: ${err instanceof Error ? err.message : String(err)}`, { ok: false });
			}
		},
	};

	return { [LESSON_COMPLETE_TOOL]: lessonComplete, [COURSE_ADD_LESSON_TOOL]: courseAddLesson };
}
