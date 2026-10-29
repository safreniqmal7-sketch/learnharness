"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/components/usage-format";
import { Input } from "@/components/ui/input";
import type { LessonStatus } from "@/src/core";
import { CalibrationPanel } from "./calibration-panel";
import { CoursesFrame } from "./frame";
import { addLesson, editorValid, moveLesson, nextKey, patchLesson, removeLesson, type EditableLesson } from "./lesson-edit";
import { LessonEditor } from "./lesson-editor";
import { ReviewPanel } from "./review-panel";
import { startLesson } from "./start-lesson";
import { progressText, STATUS_LABEL, type CourseViewDto, type LessonViewDto } from "./types";

function StatusTag({ status }: { status: LessonStatus }) {
	return (
		<span
			data-testid="lesson-status"
			data-status={status}
			className="flex shrink-0 items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
		>
			{status === "complete" && <CheckIcon className="size-3 text-primary" aria-hidden />}
			{STATUS_LABEL[status]}
		</span>
	);
}

/** Dollars like the stats bar (formatUsd); an all-unpriced $0 reads "—", never a fake $0. */
function costText(dollars: number, unpriced: boolean): string {
	return unpriced && dollars === 0 ? "—" : formatUsd(dollars);
}

/** Read mode: the progress line, Continue, and the lessons in order. */
export function CourseBody({
	view,
	onStart,
	busyLessonId = null,
}: {
	view: CourseViewDto;
	onStart: (lessonId: string) => void;
	busyLessonId?: string | null;
}) {
	const { continueLessonId: next } = view;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<span data-testid="course-progress" className="text-xs text-muted-foreground">
					{view.course.topic} · {progressText(view.progress)}
				</span>
				{view.cost && (
					<span
						data-testid="course-cost"
						title={`Lessons ${costText(view.cost.lessonsDollars, view.cost.unpriced)} · Syllabus drafting ${costText(view.cost.draftDollars, view.cost.unpriced)}`}
						className="text-xs tabular-nums text-muted-foreground"
					>
						Spent {costText(view.cost.totalDollars, view.cost.unpriced)}
					</span>
				)}
				<div className="min-w-4 flex-1" aria-hidden="true" />
				{next && (
					<Button size="sm" disabled={busyLessonId !== null} onClick={() => onStart(next)}>
						Continue
					</Button>
				)}
			</div>
			<ol data-testid="lesson-list" className="flex flex-col gap-2">
				{view.lessons.map((l: LessonViewDto, i) => (
					<li key={l.id}>
						<button
							type="button"
							data-testid="lesson-row"
							data-next={l.id === next ? "true" : undefined}
							disabled={busyLessonId !== null}
							onClick={() => onStart(l.id)}
							className={`flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-60 ${
								l.id === next ? "border-primary/60" : "border-border"
							}`}
						>
							<span className="w-6 shrink-0 pt-0.5 text-xs text-muted-foreground">{i + 1}</span>
							<span className="min-w-0 flex-1">
								<span className="block font-prose text-(length:--lh-prose-size)">{l.title}</span>
								<span className="block text-xs text-muted-foreground">{l.goal}</span>
								{l.origin === "teacher" && (
									<span data-testid="teacher-badge" className="mt-1 block text-xs text-muted-foreground">
										<span className="uppercase tracking-wide text-primary">Added by the teacher</span>
										{l.addedReason ? ` · ${l.addedReason}` : ""}
									</span>
								)}
							</span>
							{l.chatId !== null && l.costDollars !== undefined && (
								<span data-testid="lesson-cost" className="shrink-0 text-xs tabular-nums text-muted-foreground">
									{formatUsd(l.costDollars)}
								</span>
							)}
							<StatusTag status={l.status} />
						</button>
					</li>
				))}
			</ol>
			{view.review && view.lessons.some((l) => l.status === "complete") && (
				<ReviewPanel review={view.review} courseTitle={view.course.title} />
			)}
			{view.calibration && view.lessons.some((l) => l.chatId !== null) && <CalibrationPanel summary={view.calibration} />}
		</div>
	);
}

function toEditable(view: CourseViewDto): EditableLesson[] {
	return view.lessons.map((l) => ({ key: nextKey(), id: l.id, title: l.title, goal: l.goal }));
}

export function CourseDetail({ courseId }: { courseId: string }) {
	const router = useRouter();
	const [view, setView] = useState<CourseViewDto | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busyLessonId, setBusyLessonId] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState("");
	const [lessons, setLessons] = useState<EditableLesson[]>([]);
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	useEffect(() => {
		let live = true;
		void fetch(`/api/courses/${encodeURIComponent(courseId)}`, { cache: "no-store" })
			.then(async (r) => {
				if (r.status === 404) return live && setMissing(true);
				const v = (await r.json()) as CourseViewDto;
				if (live) setView(v);
			})
			.catch(() => live && setError("Could not load the course."));
		return () => {
			live = false;
		};
	}, [courseId]);

	const start = useCallback(
		(lessonId: string) => {
			setBusyLessonId(lessonId);
			setError(null);
			void startLesson(courseId, lessonId)
				.then((target) => router.push(target))
				.catch((e: unknown) => {
					setBusyLessonId(null);
					setError(e instanceof Error ? e.message : "Could not start the lesson.");
				});
		},
		[courseId, router],
	);

	const beginEdit = () => {
		if (!view) return;
		setTitle(view.course.title);
		setLessons(toEditable(view));
		setError(null);
		setEditing(true);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: title.trim(),
					lessons: lessons.map((l) => ({ ...(l.id ? { id: l.id } : {}), title: l.title.trim(), goal: l.goal.trim() })),
				}),
			});
			if (!res.ok) {
				const b = (await res.json().catch(() => null)) as { error?: string } | null;
				setError(b?.error ?? "Could not save the course.");
				return;
			}
			setView((await res.json()) as CourseViewDto);
			setEditing(false);
		} catch {
			setError("Could not reach the server.");
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		setSaving(true);
		setError(null);
		try {
			const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
			if (!res.ok) {
				setError("Could not delete the course.");
				setSaving(false);
				return;
			}
			router.push("/courses");
		} catch {
			setError("Could not reach the server.");
			setSaving(false);
		}
	};

	if (missing) {
		return (
			<CoursesFrame title="Course not found">
				<p className="text-sm text-muted-foreground">This course no longer exists.</p>
			</CoursesFrame>
		);
	}

	const actions =
		view && !editing ? (
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" onClick={beginEdit}>
					Edit
				</Button>
				<Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
					Delete
				</Button>
			</div>
		) : undefined;

	return (
		<CoursesFrame title={view?.course.title ?? "Course"} actions={actions}>
			{error && <p className="mb-3 text-sm text-destructive">{error}</p>}
			{confirmDelete && (
				<div data-testid="delete-confirm" className="mb-4 flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3">
					<p className="text-sm">Delete this course? Its lesson sessions are kept and become ordinary sessions.</p>
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" disabled={saving} onClick={() => setConfirmDelete(false)}>
							Cancel
						</Button>
						<Button variant="destructive" size="sm" disabled={saving} onClick={() => void remove()}>
							Delete
						</Button>
					</div>
				</div>
			)}
			{view && editing && (
				<div data-testid="course-edit" className="flex flex-col gap-4">
					<Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Course title" disabled={saving} />
					<LessonEditor
						lessons={lessons}
						disabled={saving}
						onChange={(i, patch) => setLessons((l) => patchLesson(l, i, patch))}
						onMove={(i, d) => setLessons((l) => moveLesson(l, i, d))}
						onRemove={(i) => setLessons((l) => removeLesson(l, i))}
						onAdd={() => setLessons((l) => addLesson(l))}
					/>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
							Cancel
						</Button>
						<Button size="sm" disabled={saving || !editorValid(title, lessons)} onClick={() => void save()}>
							Save
						</Button>
					</div>
				</div>
			)}
			{view && !editing && <CourseBody view={view} onStart={start} busyLessonId={busyLessonId} />}
		</CoursesFrame>
	);
}
