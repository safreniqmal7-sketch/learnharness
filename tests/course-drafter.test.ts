import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { draftCourse } from "../src/agent/course-drafter.ts";

const INTAKE = {
	level: "complete beginner",
	purpose: "understand policy debates",
	depth: "intro overview",
	notes: "I prefer everyday examples",
};
const VALID = { title: "Micro", lessons: [{ title: " Scarcity ", goal: " Explains why choices cost something. " }, { title: "Demand", goal: "Reads a demand curve." }] };

function scripted(replies: string[]): { engine: PiEngine; prompts: string[] } {
	const prompts: string[] = [];
	const faux = createFauxCore({});
	const steps: FauxResponseStep[] = replies.map((r) => (context) => {
		prompts.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)).join("\n"));
		return fauxAssistantMessage([fauxText(r)]);
	});
	faux.setResponses(steps);
	return { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, prompts };
}

describe("draftCourse", () => {
	it("parses valid JSON and trims fields", async () => {
		const { engine } = scripted([JSON.stringify(VALID)]);
		const d = await draftCourse({ topic: "microeconomics", intake: INTAKE }, { engine });
		assert.equal(d.title, "Micro");
		assert.deepEqual(d.lessons[0], { title: "Scarcity", goal: "Explains why choices cost something." });
		assert.equal(d.lessons.length, 2);
	});

	it("parses fenced JSON with surrounding prose", async () => {
		const { engine } = scripted(["Here you go:\n```json\n" + JSON.stringify(VALID) + "\n```\nEnjoy"]);
		const d = await draftCourse({ topic: "t", intake: INTAKE }, { engine });
		assert.equal(d.lessons.length, 2);
	});

	it("retries once with the validation error, then accepts", async () => {
		const { engine, prompts } = scripted(["not json at all", JSON.stringify(VALID)]);
		const d = await draftCourse({ topic: "t", intake: INTAKE }, { engine });
		assert.equal(d.title, "Micro");
		assert.equal(prompts.length, 2);
		assert.match(prompts[1]!, /rejected/);
	});

	it("throws a clear error when invalid twice", async () => {
		const { engine, prompts } = scripted([
			JSON.stringify({ title: "x", lessons: [] }),
			JSON.stringify({ title: "x", lessons: [{ title: "", goal: "g" }] }),
		]);
		await assert.rejects(draftCourse({ topic: "t", intake: INTAKE }, { engine }), /invalid draft twice/);
		assert.equal(prompts.length, 2);
	});

	it("caps at 30 lessons", async () => {
		const many = { title: "Big", lessons: Array.from({ length: 40 }, (_, i) => ({ title: `L${i}`, goal: `G${i}` })) };
		const { engine } = scripted([JSON.stringify(many)]);
		assert.equal((await draftCourse({ topic: "t", intake: INTAKE }, { engine })).lessons.length, 30);
	});

	it("puts the topic and every intake field in the prompt", async () => {
		const { engine, prompts } = scripted([JSON.stringify(VALID)]);
		await draftCourse({ topic: "microeconomics", intake: INTAKE }, { engine });
		for (const s of ["microeconomics", INTAKE.level, INTAKE.purpose, INTAKE.depth, INTAKE.notes]) {
			assert.ok(prompts[0]!.includes(s), `prompt missing ${s}`);
		}
	});
});
