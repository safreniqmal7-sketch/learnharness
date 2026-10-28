import { CourseDetail } from "@/components/courses/course-view";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return <CourseDetail courseId={id} />;
}
