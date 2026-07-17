import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSubagentToolDescription, FULL_SUBAGENT_TOOL_DESCRIPTION } from "../../src/extension/tool-description.ts";

let schemasAvailable = true;
let SubagentParams: { properties?: Record<string, unknown> } | undefined;
let FullSubagentParams: { properties?: Record<string, unknown> } | undefined;
try {
	const schemas = await import("../../src/extension/schemas.ts");
	SubagentParams = schemas.SubagentParams as { properties?: Record<string, unknown> };
	FullSubagentParams = schemas.FullSubagentParams as { properties?: Record<string, unknown> };
} catch (error) {
	if (!(error instanceof Error) || !/Cannot find package ['"]typebox/.test(error.message)) throw error;
	schemasAvailable = false;
}

describe("minimal generated-role launch schema", { skip: !schemasAvailable ? "typebox not available" : undefined }, () => {
	it("registers direct launch fields plus recovery-only list by default", () => {
		assert.deepEqual(Object.keys(SubagentParams?.properties ?? {}).sort(), ["action", "agent", "async", "context", "task"]);
		const context = SubagentParams?.properties?.context as { enum?: string[] } | undefined;
		const action = SubagentParams?.properties?.action as { enum?: string[] } | undefined;
		assert.deepEqual(context?.enum, ["fresh", "fork"]);
		assert.deepEqual(action?.enum, ["list"]);
	});

	it("keeps controls, fanout, budgets, models, and administration in full disclosure", () => {
		const full = FullSubagentParams?.properties ?? {};
		for (const field of ["id", "tasks", "chain", "worktree", "acceptance", "toolBudget", "turnBudget", "model", "schedule", "config", "control"]) {
			assert.ok(full[field], `full schema should expose ${field}`);
			assert.equal(SubagentParams?.properties?.[field], undefined, `minimal schema must omit ${field}`);
		}
	});

	it("materially reduces default startup context", () => {
		const minimalSurface = `${buildSubagentToolDescription()}${JSON.stringify(SubagentParams)}`;
		const fullSurface = `${FULL_SUBAGENT_TOOL_DESCRIPTION}${JSON.stringify(FullSubagentParams)}`;
		assert.ok(minimalSurface.length < fullSurface.length / 3, `${minimalSurface.length} should be far below ${fullSurface.length}`);
		assert.ok(minimalSurface.length < 2_500, `minimal surface should stay below 2500 chars, got ${minimalSurface.length}`);
	});
});
