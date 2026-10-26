"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoursesFrame } from "./frame";
import { progressText, type CourseSummaryDto } from "./types";
import { startLesson } from "./start-lesson";

export function NewCourseButton() {
	return (
		<Button asChild size="sm">
			<Link href="/courses/new">
				<PlusIcon />
				New course
			</Link>
		</Button>
	);
}

/** Presentational: the list (or the empty state). */
export function CourseListView({
	courses,
	onContinue,
	busyId = null,
}: {
	courses: CourseSummaryDto[];
	onContinue: (course: CourseSummaryDto) => void;
	busyId?: string | null;
}) {
	if (courses.length === 0) {
		return (
			<div data-testid="courses-empty" className="flex flex-col items-start gap-3">
				<p className="text-sm text-muted-foreground">No courses yet. A course turns a field into an ordered set of lessons.</p>
				<NewCourseButton />
			</div>
		);
	}
	return (
		<ul data-testid="course-list" className="flex flex-col gap-2">
			{courses.map((c) => (
				<li key={c.id} data-testid="course-row" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
					<Link href={`/courses/${c.id}`} className="min-w-0 flex-1">
						<span className="block truncate font-prose text-(length:--lh-prose-size)">{c.title}</span>
						<span className="block truncate text-xs text-muted-foreground">
							{c.topic} · {progressText(c.progress)}
						</span>
					</Link>
					{c.continueLessonId && (
						<Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => onContinue(c)}>
							Continue
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}

export function CourseList() {
	const router = useRouter();
	const [courses, setCourses] = useState<CourseSummaryDto[] | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		void fetch("/api/courses", { cache: "no-store" })
			.then((r) => r.json() as Promise<{ courses: CourseSummaryDto[] }>)
			.then((b) => live && setCourses(b.courses))
			.catch(() => live && setError("Could not load your courses."));
		return () => {
			live = false;
		};
	}, []);

	const onContinue = useCallback(
		(c: CourseSummaryDto) => {
			if (!c.continueLessonId) return;
			setBusyId(c.id);
			setError(null);
			void startLesson(c.id, c.continueLessonId)
				.then((target) => router.push(target))
				.catch((e: unknown) => {
					setBusyId(null);
					setError(e instanceof Error ? e.message : "Could not start the lesson.");
				});
		},
		[router],
	);

	return (
		<CoursesFrame title="Courses" actions={courses && courses.length > 0 ? <NewCourseButton /> : undefined}>
			{error && <p className="mb-3 text-sm text-destructive">{error}</p>}
			{courses && <CourseListView courses={courses} onContinue={onContinue} busyId={busyId} />}
		</CoursesFrame>
	);
}
