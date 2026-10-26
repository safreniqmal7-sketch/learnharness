"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LessonLink } from "@/src/core";
import type { CourseViewDto } from "./types";

export interface LessonBannerData {
	courseId: string;
	courseTitle: string;
	/** 1-based position in the syllabus. */
	number: number;
	total: number;
	complete: boolean;
}

/** Pure: the banner's numbers from a course view; null when the lesson is no
 *  longer in the course (removed by an edit) — render nothing. */
export function bannerData(view: CourseViewDto, lessonId: string): LessonBannerData | null {
	const index = view.lessons.findIndex((l) => l.id === lessonId);
	if (index < 0) return null;
	return {
		courseId: view.course.id,
		courseTitle: view.course.title,
		number: index + 1,
		total: view.lessons.length,
		complete: view.lessons[index]!.status === "complete",
	};
}

/** Presentational: the slim line under the session header. */
export function LessonBannerView({ data }: { data: LessonBannerData | null }) {
	if (!data) return null;
	return (
		<div data-testid="lesson-banner" className="border-b border-border px-6 py-1.5 text-xs text-muted-foreground">
			<Link href={`/courses/${data.courseId}`} className="transition-colors hover:text-foreground">
				{data.courseTitle} · Lesson {data.number} of {data.total}
			</Link>
			{data.complete && <span data-testid="lesson-banner-complete"> · Complete</span>}
		</div>
	);
}

/**
 * The session's lesson banner. The chat record (GET /api/chats/[id])
 * carries `lesson`; the course view (GET /api/courses/[id]) gives the
 * numbers and the lesson's derived status. A course that 404s (deleted)
 * renders nothing. `busy` re-reads the course when a turn ends, so
 * "Complete" appears as soon as the teacher's lesson_complete is accepted.
 */
export function LessonBanner({ chatId, busy = false }: { chatId: string; busy?: boolean }) {
	const [link, setLink] = useState<LessonLink | null>(null);
	const [data, setData] = useState<LessonBannerData | null>(null);

	useEffect(() => {
		let live = true;
		void fetch(`/api/chats/${encodeURIComponent(chatId)}`, { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<{ lesson?: LessonLink }>) : null))
			.then((chat) => live && setLink(chat?.lesson ?? null))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [chatId]);

	useEffect(() => {
		if (!link || busy) return;
		let live = true;
		void fetch(`/api/courses/${encodeURIComponent(link.courseId)}`, { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<CourseViewDto>) : null))
			.then((view) => live && setData(view ? bannerData(view, link.lessonId) : null))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [link, busy]);

	return <LessonBannerView data={data} />;
}
