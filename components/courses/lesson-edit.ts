/** Pure list edits shared by the draft editor and the course edit mode. */

export interface EditableLesson {
	/** Client-only stable React key. */
	key: string;
	/** Present for lessons that already exist on a saved course. */
	id?: string;
	title: string;
	goal: string;
	/** Added by the learner in this editor (draft flow). */
	learnerAdded?: boolean;
}

let counter = 0;
export function nextKey(): string {
	counter += 1;
	return `l${counter}`;
}

export function moveLesson<T>(list: readonly T[], from: number, delta: -1 | 1): T[] {
	const to = from + delta;
	if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
	const next = [...list];
	[next[from], next[to]] = [next[to]!, next[from]!];
	return next;
}

export function removeLesson<T>(list: readonly T[], index: number): T[] {
	return list.filter((_, i) => i !== index);
}

export function patchLesson(list: readonly EditableLesson[], index: number, patch: Partial<EditableLesson>): EditableLesson[] {
	return list.map((l, i) => (i === index ? { ...l, ...patch } : l));
}

export function addLesson(list: readonly EditableLesson[]): EditableLesson[] {
	return [...list, { key: nextKey(), title: "", goal: "", learnerAdded: true }];
}

/** Every lesson needs a title and a goal; the course needs a title and at least one lesson. */
export function editorValid(title: string, list: readonly EditableLesson[]): boolean {
	return title.trim() !== "" && list.length > 0 && list.every((l) => l.title.trim() !== "" && l.goal.trim() !== "");
}
