"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import type { CourseDraft, CourseIntake } from "@/src/core";
import { CoursesFrame } from "./frame";
import { addLesson, editorValid, moveLesson, nextKey, patchLesson, removeLesson, type EditableLesson } from "./lesson-edit";
import { LessonEditor } from "./lesson-editor";

export interface IntakeValues {
	topic: string;
	level: string;
	purpose: string;
	depth: string;
	notes: string;
}

export const EMPTY_INTAKE: IntakeValues = { topic: "", level: "", purpose: "", depth: "", notes: "" };

export function intakeComplete(v: IntakeValues): boolean {
	return [v.topic, v.level, v.purpose, v.depth].every((s) => s.trim() !== "");
}

export function intakeOf(v: IntakeValues): CourseIntake {
	const notes = v.notes.trim();
	return { level: v.level.trim(), purpose: v.purpose.trim(), depth: v.depth.trim(), ...(notes ? { notes } : {}) };
}

/** A failed draft/save: "setup" = models or provider key missing (points to
 *  Settings); "failed" = the model or server errored (Retry). */
export type CourseFailure =
	| { kind: "setup"; code: string; message: string }
	| { kind: "failed"; message: string };

export function FailureNotice({
	failure,
	onRetry,
	onOpenSettings,
}: {
	failure: CourseFailure;
	onRetry?: () => void;
	onOpenSettings?: (section: string) => void;
}) {
	if (failure.kind === "setup") {
		const section = failure.code === "models_not_configured" ? "agent" : "keys";
		return (
			<div data-testid="course-failure-setup" className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3">
				<p className="text-sm">
					{failure.code === "models_not_configured"
						? "Drafting a syllabus needs your models set up. Open Settings to choose them."
						: "Drafting a syllabus needs a provider key. Open Settings to add one."}
				</p>
				<Button variant="outline" size="sm" onClick={() => onOpenSettings?.(section)}>
					Open Settings
				</Button>
			</div>
		);
	}
	return (
		<div data-testid="course-failure" className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3">
			<p className="text-sm text-destructive">{failure.message}</p>
			{onRetry && (
				<Button variant="outline" size="sm" onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-xs uppercase tracking-widest text-muted-foreground/70">{label}</span>
			{children}
		</label>
	);
}

/** Step 1: topic + the fixed intake. */
export function IntakeForm({
	values,
	onChange,
	onSubmit,
	busy,
	failure,
	onOpenSettings,
}: {
	values: IntakeValues;
	onChange: (patch: Partial<IntakeValues>) => void;
	onSubmit: () => void;
	busy: boolean;
	failure: CourseFailure | null;
	onOpenSettings?: (section: string) => void;
}) {
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (intakeComplete(values) && !busy) onSubmit();
	};
	return (
		<form data-testid="intake-form" onSubmit={submit} className="flex flex-col gap-4">
			<Field label="Topic">
				<Input
					value={values.topic}
					onChange={(e) => onChange({ topic: e.target.value })}
					placeholder="microeconomics"
					disabled={busy}
					autoFocus
				/>
			</Field>
			<Field label="Level">
				<Input
					value={values.level}
					onChange={(e) => onChange({ level: e.target.value })}
					placeholder="complete beginner"
					disabled={busy}
				/>
			</Field>
			<Field label="Purpose">
				<Input
					value={values.purpose}
					onChange={(e) => onChange({ purpose: e.target.value })}
					placeholder="understand policy debates"
					disabled={busy}
				/>
			</Field>
			<Field label="Depth">
				<Input
					value={values.depth}
					onChange={(e) => onChange({ depth: e.target.value })}
					placeholder="intro overview … undergraduate course"
					disabled={busy}
				/>
			</Field>
			<Field label="Notes (optional)">
				<Textarea
					value={values.notes}
					onChange={(e) => onChange({ notes: e.target.value })}
					placeholder="Anything else the teacher should know: what to include, what to skip"
					disabled={busy}
				/>
			</Field>
			{failure && <FailureNotice failure={failure} onRetry={onSubmit} onOpenSettings={onOpenSettings} />}
			<div className="flex items-center gap-3">
				<Button type="submit" size="sm" disabled={!intakeComplete(values) || busy}>
					Draft syllabus
				</Button>
				{busy && (
					<span data-testid="drafting-busy" className="text-xs text-muted-foreground">
						Drafting the syllabus… this can take up to a minute.
					</span>
				)}
			</div>
		</form>
	);
}

/** Step 2: the editable draft. */
export function DraftReview({
	title,
	onTitleChange,
	lessons,
	onLessonsChange,
	onBack,
	onSave,
	saving,
	failure,
	onOpenSettings,
}: {
	title: string;
	onTitleChange: (t: string) => void;
	lessons: EditableLesson[];
	onLessonsChange: (next: EditableLesson[]) => void;
	onBack: () => void;
	onSave: () => void;
	saving: boolean;
	failure: CourseFailure | null;
	onOpenSettings?: (section: string) => void;
}) {
	return (
		<div data-testid="draft-review" className="flex flex-col gap-4">
			<Field label="Course title">
				<Input value={title} onChange={(e) => onTitleChange(e.target.value)} disabled={saving} />
			</Field>
			<span className="text-xs uppercase tracking-widest text-muted-foreground/70">Lessons</span>
			<LessonEditor
				lessons={lessons}
				disabled={saving}
				onChange={(i, patch) => onLessonsChange(patchLesson(lessons, i, patch))}
				onMove={(i, d) => onLessonsChange(moveLesson(lessons, i, d))}
				onRemove={(i) => onLessonsChange(removeLesson(lessons, i))}
				onAdd={() => onLessonsChange(addLesson(lessons))}
			/>
			{failure && <FailureNotice failure={failure} onRetry={onSave} onOpenSettings={onOpenSettings} />}
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>
					Back
				</Button>
				<Button size="sm" onClick={onSave} disabled={saving || !editorValid(title, lessons)}>
					Save course
				</Button>
			</div>
		</div>
	);
}

async function errorOf(res: Response): Promise<CourseFailure> {
	const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
	const message = body?.error ?? "Something went wrong.";
	if (res.status === 503 && body?.code) return { kind: "setup", code: body.code, message };
	return { kind: "failed", message };
}

export function NewCourse() {
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	const [values, setValues] = useState<IntakeValues>(EMPTY_INTAKE);
	const [step, setStep] = useState<"form" | "draft">("form");
	const [title, setTitle] = useState("");
	const [lessons, setLessons] = useState<EditableLesson[]>([]);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<CourseFailure | null>(null);
	const [draftUsage, setDraftUsage] = useState<unknown>(null);

	const draft = async () => {
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch("/api/courses/draft", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topic: values.topic.trim(), intake: intakeOf(values) }),
			});
			if (!res.ok) {
				setFailure(await errorOf(res));
				return;
			}
			const { draft: d, usage } = (await res.json()) as { draft: CourseDraft; usage?: unknown };
			setDraftUsage(usage ?? null); // a redraft replaces the previous usage
			setTitle(d.title);
			setLessons(d.lessons.map((l) => ({ key: nextKey(), title: l.title, goal: l.goal })));
			setStep("draft");
		} catch {
			setFailure({ kind: "failed", message: "Could not reach the server." });
		} finally {
			setBusy(false);
		}
	};

	const save = async () => {
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch("/api/courses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					topic: values.topic.trim(),
					title: title.trim(),
					intake: intakeOf(values),
					...(draftUsage ? { draftUsage } : {}),
					lessons: lessons.map((l) => ({
						title: l.title.trim(),
						goal: l.goal.trim(),
						...(l.learnerAdded ? { learnerAdded: true } : {}),
					})),
				}),
			});
			if (!res.ok) {
				setFailure(await errorOf(res));
				setBusy(false);
				return;
			}
			const { course } = (await res.json()) as { course: { id: string } };
			router.push(`/courses/${course.id}`);
		} catch {
			setFailure({ kind: "failed", message: "Could not reach the server." });
			setBusy(false);
		}
	};

	return (
		<CoursesFrame title="New course">
			{step === "form" ? (
				<IntakeForm
					values={values}
					onChange={(p) => setValues((v) => ({ ...v, ...p }))}
					onSubmit={() => void draft()}
					busy={busy}
					failure={failure}
					onOpenSettings={openSettings}
				/>
			) : (
				<DraftReview
					title={title}
					onTitleChange={setTitle}
					lessons={lessons}
					onLessonsChange={setLessons}
					onBack={() => {
						setFailure(null);
						setStep("form");
					}}
					onSave={() => void save()}
					saving={busy}
					failure={failure}
					onOpenSettings={openSettings}
				/>
			)}
		</CoursesFrame>
	);
}
