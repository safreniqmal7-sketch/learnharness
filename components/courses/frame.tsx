"use client";

import type { ReactNode } from "react";
import { TopBar } from "@/components/top-bar";

/** The shared course page frame: the app's TopBar (same mechanics as every
 *  surface) over a scrolling column. */
export function CoursesFrame({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 truncate font-title text-3xl tracking-tight">{title}</h1>
				<div className="min-w-4 flex-1" aria-hidden="true" />
				{actions}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[46rem] px-4 py-6">{children}</div>
			</div>
		</div>
	);
}
