import type { CalibrationSummary, Lesson, LessonStatus } from "@/src/core";

/** Client-side shapes of the /api/courses payloads (mirrors src/server/courses.ts;
 *  components may not import the server layer, so the wire shapes live here). */
export interface CourseSummaryDto {
	id: string;
	title: string;
	topic: string;
	updatedAt: string;
	progress: { completed: number; total: number };
	continueLessonId: string | null;
}

export type LessonViewDto = Lesson & { status: LessonStatus; chatId: string | null };

export interface CourseViewDto {
	course: { id: string; title: string; topic: string };
	lessons: LessonViewDto[];
	continueLessonId: string | null;
	progress: { completed: number; total: number };
	calibration?: CalibrationSummary;
}

export const STATUS_LABEL: Record<LessonStatus, string> = {
	"not-started": "Not started",
	"in-progress": "In progress",
	complete: "Complete",
};

/** "4 / 12" */
export function progressText(p: { completed: number; total: number }): string {
	return `${p.completed} / ${p.total}`;
}
