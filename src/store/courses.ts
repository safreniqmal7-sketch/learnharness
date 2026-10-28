/**
 * CourseStore — the fs JSON adapter (one file per course in data/courses/).
 *
 * Implements core/ports.ts CourseStore; shapes live in
 * core/contracts/course.ts. Idioms follow jobs/chats: sync fs, id-guarded
 * filenames, whole-file read-modify-write, JSON with tab indentation. Wired
 * in the composition root (src/server/stores.ts). Structure only — lesson
 * progress derives from transcripts, never stored here.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { CourseStore } from "../core/ports.ts";
import type { Course, Lesson } from "../core/contracts.ts";

/** Courses (data/courses). Not in config.ts PATHS — derived from the data
 *  root like the jobs dir, so the LH_DATA_DIR seam applies. */
const COURSES_DIR = path.join(PATHS.data, "courses");

function courseFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid course id: ${id}`);
	return path.join(COURSES_DIR, `${id}.json`);
}

/** Minimal write-side validation: lesson ids non-empty and unique. */
function assertLessons(lessons: Lesson[]): void {
	const seen = new Set<string>();
	for (const lesson of lessons) {
		const id = typeof lesson?.id === "string" ? lesson.id.trim() : "";
		if (!id) throw new Error("Lesson id must be a non-empty string");
		if (seen.has(lesson.id)) throw new Error(`Duplicate lesson id: ${lesson.id}`);
		seen.add(lesson.id);
	}
}

function writeCourse(course: Course): void {
	fs.mkdirSync(COURSES_DIR, { recursive: true });
	fs.writeFileSync(courseFile(course.id), JSON.stringify(course, null, "\t"), "utf-8");
}

function getCourse(id: string): Course | null {
	try {
		const parsed = JSON.parse(fs.readFileSync(courseFile(id), "utf-8")) as Course;
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lessons)) return null;
		return parsed;
	} catch {
		return null; // unknown id, unreadable, or corrupt — same answer
	}
}

function createCourse(input: Omit<Course, "id" | "createdAt" | "updatedAt">): Course {
	assertLessons(input.lessons);
	const now = new Date().toISOString();
	const course: Course = {
		...input,
		id: `course_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		createdAt: now,
		updatedAt: now,
	};
	writeCourse(course);
	return course;
}

function listCourses(): Course[] {
	try {
		fs.mkdirSync(COURSES_DIR, { recursive: true });
		return fs
			.readdirSync(COURSES_DIR)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getCourse(f.slice(0, -5)))
			.filter((c): c is Course => c !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

function saveCourse(id: string, patch: Pick<Course, "title" | "lessons">): Course {
	const course = getCourse(id);
	if (!course) throw new Error(`Course not found: ${id}`);
	assertLessons(patch.lessons);
	const next: Course = { ...course, title: patch.title, lessons: patch.lessons, updatedAt: new Date().toISOString() };
	writeCourse(next);
	return next;
}

function deleteCourse(id: string): boolean {
	try {
		fs.unlinkSync(courseFile(id));
		return true;
	} catch {
		return false;
	}
}

export const courseStore: CourseStore = {
	createCourse,
	getCourse,
	listCourses,
	saveCourse,
	deleteCourse,
};
