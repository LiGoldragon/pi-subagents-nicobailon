import assert from "node:assert/strict";
import * as fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { createEventBus, createMockPi, createTempDir, makeMinimalCtx, removeTempDir, tryImport } from "../support/helpers.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

const executorModule = await tryImport<any>("./src/runs/foreground/subagent-executor.ts");
const available = !!executorModule?.createSubagentExecutor;

function role(name: string, kind: "manager" | "nested" | "leaf", children: string[] = []): AgentConfig {
	return {
		name,
		description: name,
		systemPrompt: "Return a concise result.",
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/roles/${name}.md`,
		projectRole: { version: 1, projectRoleIdentity: name, projectRoleDispatchKind: kind, allowedChildRoleNames: children },
	};
}

describe("generated project role executor authorization", { skip: !available ? "executor unavailable" : undefined }, () => {
	const mockPi = createMockPi();
	let cwd = "";

	before(() => mockPi.install());
	after(() => mockPi.uninstall());
	after(() => { if (cwd) removeTempDir(cwd); });

	function executor(callerRolePolicy?: { metadata: NonNullable<AgentConfig["projectRole"]>; source: "environment" }) {
		const manager = role("Manager", "manager");
		const nested = role("Planner", "nested", ["Reader"]);
		const leaf = role("Reader", "leaf");
		const agents = [manager, nested, leaf];
		return executorModule.createSubagentExecutor({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state: { baseCwd: "", currentSessionId: null, asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null },
			config: {}, asyncByDefault: false, tempArtifactsDir: cwd,
			getSubagentSessionRoot: () => cwd, expandTilde: (value: string) => value,
			discoverAgents: () => ({ agents }),
			...(callerRolePolicy ? { callerRolePolicy } : {}),
		});
	}

	it("launches a visible role directly without an inventory call", async () => {
		cwd = createTempDir();
		mockPi.reset();
		mockPi.onCall({ output: "done" });
		const result = await executor().execute("direct", { agent: "Reader", task: "read" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		assert.equal(result.isError, undefined);
		assert.equal(fs.readdirSync(mockPi.dir).some((name) => name.startsWith("call-")), true);
	});

	it("rejects a nested-to-nested edge atomically before a child starts", async () => {
		mockPi.reset();
		const planner = role("Planner", "nested", ["Reader"]);
		const result = await executor({ metadata: planner.projectRole!, source: "environment" }).execute("blocked", { agent: "Planner", task: "delegate" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /not allowed|only leaf roles/);
		assert.equal(fs.readdirSync(mockPi.dir).some((name) => name.startsWith("call-")), false);
	});

	it("rejects generated-role model overrides before a child starts", async () => {
		mockPi.reset();
		const planner = role("Planner", "nested", ["Reader"]);
		const result = await executor({ metadata: planner.projectRole!, source: "environment" }).execute("blocked-model", { agent: "Reader", task: "read", model: "other/model" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /model overrides/);
		assert.equal(fs.readdirSync(mockPi.dir).some((name) => name.startsWith("call-")), false);
	});
});
