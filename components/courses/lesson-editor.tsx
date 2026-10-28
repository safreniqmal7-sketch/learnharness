import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EditableLesson } from "./lesson-edit";

/** Editable lesson rows: number, title + goal inputs, up/down/remove, Add lesson.
 *  Presentational — the parent owns the list. */
export function LessonEditor({
	lessons,
	onChange,
	onMove,
	onRemove,
	onAdd,
	disabled = false,
}: {
	lessons: EditableLesson[];
	onChange: (index: number, patch: Partial<EditableLesson>) => void;
	onMove: (index: number, delta: -1 | 1) => void;
	onRemove: (index: number) => void;
	onAdd: () => void;
	disabled?: boolean;
}) {
	return (
		<div data-testid="lesson-editor" className="flex flex-col gap-2">
			{lessons.map((l, i) => (
				<div key={l.key} data-testid="lesson-edit-row" className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
					<span className="w-6 shrink-0 pt-2 text-xs text-muted-foreground">{i + 1}</span>
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Input
							value={l.title}
							onChange={(e) => onChange(i, { title: e.target.value })}
							placeholder="Lesson title"
							aria-label={`Lesson ${i + 1} title`}
							disabled={disabled}
						/>
						<Textarea
							value={l.goal}
							onChange={(e) => onChange(i, { goal: e.target.value })}
							placeholder="What understanding does this lesson end at?"
							aria-label={`Lesson ${i + 1} goal`}
							disabled={disabled}
							className="min-h-0"
						/>
					</div>
					<div className="flex shrink-0 gap-0.5">
						<Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={disabled || i === 0} onClick={() => onMove(i, -1)}>
							<ArrowUpIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Move down"
							disabled={disabled || i === lessons.length - 1}
							onClick={() => onMove(i, 1)}
						>
							<ArrowDownIcon />
						</Button>
						<Button variant="ghost" size="icon-sm" aria-label="Remove lesson" disabled={disabled} onClick={() => onRemove(i)}>
							<XIcon />
						</Button>
					</div>
				</div>
			))}
			<button
				type="button"
				onClick={onAdd}
				disabled={disabled}
				className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
			>
				<PlusIcon className="size-3" />
				Add lesson
			</button>
		</div>
	);
}
