import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { createEventBus, createMockPi, createTempDir, makeMinimalCtx, removeTempDir, tryImport } from "../support/helpers.ts";
import { discoverAgents, type AgentConfig } from "../../src/agents/agents.ts";

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

	function executor(
		callerRolePolicy?: { metadata: NonNullable<AgentConfig["projectRole"]>; source: "environment" },
		agents = [role("Manager", "manager"), role("Planner", "nested", ["Reader"]), role("Reader", "leaf")],
		config: Record<string, unknown> = {},
		stateOverrides: Record<string, unknown> = {},
		asyncByDefault = false,
	) {
		return executorModule.createSubagentExecutor({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state: { baseCwd: "", currentSessionId: null, asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null, ...stateOverrides },
			config, asyncByDefault, tempArtifactsDir: cwd,
			getSubagentSessionRoot: () => cwd, expandTilde: (value: string) => value,
			discoverAgents: () => ({ agents }),
			...(callerRolePolicy ? { callerRolePolicy } : {}),
		});
	}

	it("launches a visible role directly without an inventory call", async () => {
		cwd = createTempDir();
		mockPi.reset();
		const result = await executor().execute("direct", { agent: "Reader", task: "read" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		assert.equal(result.isError, undefined);
		assert.ok(result.details?.asyncId, "generated root Manager dispatch defaults to async");
	});

	it("defaults omitted async and Manager async:false dispatches to background execution", async () => {
		mockPi.reset();
		const manager = role("Manager", "manager");
		for (const params of [{ agent: "Reader", task: "read" }, { agent: "Reader", task: "read", async: false }, { agent: "Reader", task: "read", async: false, clarify: true }]) {
			const result = await executor({ metadata: manager.projectRole!, source: "environment" }, undefined, {}, {}, true)
				.execute("background", params, new AbortController().signal, undefined, makeMinimalCtx(cwd));
			assert.equal(result.isError, undefined);
			assert.ok(result.details?.asyncId, "Manager dispatch must start an async run");
		}
	});

	it("allows concurrent Manager calls that request foreground execution by forcing them async before the guard", async () => {
		mockPi.reset();
		mockPi.onCall({ output: "first manager child" });
		mockPi.onCall({ output: "second manager child" });
		const manager = role("Manager", "manager");
		const managerExecutor = executor({ metadata: manager.projectRole!, source: "environment" }, undefined, {}, {}, false);
		const [first, second] = await Promise.all([
			managerExecutor.execute("manager-first", { agent: "Reader", task: "first", async: false }, new AbortController().signal, undefined, makeMinimalCtx(cwd)),
			managerExecutor.execute("manager-second", { agent: "Reader", task: "second", async: false, clarify: true }, new AbortController().signal, undefined, makeMinimalCtx(cwd)),
		]);
		for (const result of [first, second]) {
			assert.equal(result.isError, undefined);
			assert.ok(result.details?.asyncId, "Manager foreground request must be forced to an async run");
			assert.doesNotMatch(result.content[0]?.text ?? "", /Issue exactly ONE subagent call per turn/);
		}
	});

	it("rejects a nested-to-nested edge atomically before a child starts", async () => {
		mockPi.reset();
		const planner = role("Planner", "nested", ["Reader"]);
		const result = await executor({ metadata: planner.projectRole!, source: "environment" }).execute("blocked", { agent: "Planner", task: "delegate" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /not allowed|only leaf roles/);
		assert.equal(fs.readdirSync(mockPi.dir).some((name) => name.startsWith("call-")), false);
	});

	it("loads an exact generated-frontmatter fixture in required mode", async () => {
		const fixture = createTempDir("pi-subagents-generated-role-fixture-");
		try {
			const agentsDir = path.join(fixture, ".pi", "agents");
			fs.mkdirSync(agentsDir, { recursive: true });
			for (const [name, kind, children] of [["Manager", "manager", ""], ["Planner", "nested", "Reader"], ["Reader", "leaf", ""]] as const) {
				fs.writeFileSync(path.join(agentsDir, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\nprojectRoleIdentity: ${name}\nprojectRoleDispatchKind: ${kind}${kind === "nested" ? `\nallowedChildRoleNames: ${children}` : ""}\n---\n\nReturn a concise result.\n`);
			}
			const generatedAgents = discoverAgents(fixture, "project").agents;
			assert.deepEqual(generatedAgents.filter((agent) => agent.source === "project").map((agent) => agent.name).sort(), ["Manager", "Planner", "Reader"]);
			mockPi.reset();
			mockPi.onCall({ output: "fixture done" });
			const result = await executor(undefined, generatedAgents, { projectRolePolicy: { required: true } }).execute("fixture", { agent: "Reader", task: "read" }, new AbortController().signal, undefined, makeMinimalCtx(fixture));
			assert.equal(result.isError, undefined);
		} finally {
			removeTempDir(fixture);
		}
	});

	it("fails closed in required mode when a generated project session lacks metadata", async () => {
		mockPi.reset();
		const missingMetadata: AgentConfig = { ...role("Reader", "leaf"), projectRole: undefined };
		const result = await executor(undefined, [missingMetadata], { projectRolePolicy: { required: true } }).execute("missing", { agent: "Reader", task: "read" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /missing or malformed generated role metadata/);
		assert.equal(fs.readdirSync(mockPi.dir).some((name) => name.startsWith("call-")), false);
	});

	it("rejects an old or malformed generated-frontmatter packet before required-mode execution", () => {
		const fixture = createTempDir("pi-subagents-malformed-role-fixture-");
		try {
			const agentsDir = path.join(fixture, ".pi", "agents");
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(path.join(agentsDir, "Manager.md"), "---\nname: Manager\ndescription: Manager\nprojectRoleIdentity: Manager\nprojectRoleDispatchKind: coordinator\n---\n\nOld packet\n");
			assert.throws(() => discoverAgents(fixture, "project"), /invalid projectRoleDispatchKind/);
		} finally {
			removeTempDir(fixture);
		}
	});

	it("authorizes every allowed resume attach-chain target before source validation", async () => {
		mockPi.reset();
		const sessionFile = path.join(cwd, "allowed-old-session.jsonl");
		fs.writeFileSync(sessionFile, "{}\n");
		const planner = role("Planner", "nested", ["Reader"]);
		const foregroundRuns = new Map([["allowed-old", {
			runId: "allowed-old", mode: "single", cwd, updatedAt: Date.now(),
			children: [{ agent: "Reader", index: 0, status: "completed", sessionFile }],
		}]]);
		const result = await executor({ metadata: planner.projectRole!, source: "environment" }, undefined, {}, { foregroundRuns }).execute(
			"attach-allowed",
			{ action: "resume", id: "allowed-old", message: "continue", chain: [{ agent: "Reader", task: "review" }] },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(cwd),
		);
		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /available for async runs only/);
		assert.doesNotMatch(result.content[0]?.text ?? "", /not allowed|only leaf roles/);
	});

	it("atomically rejects an unauthorized resume attach-chain target before attaching the root", async () => {
		mockPi.reset();
		const sessionFile = path.join(cwd, "old-session.jsonl");
		fs.writeFileSync(sessionFile, "{}\n");
		const planner = role("Planner", "nested", ["Reader"]);
		const foregroundRuns = new Map([["old", {
			runId: "old", mode: "single", cwd, updatedAt: Date.now(),
			children: [{ agent: "Reader", index: 0, status: "completed", sessionFile }],
		}]]);
		const result = await executor({ metadata: planner.projectRole!, source: "environment" }, undefined, {}, { foregroundRuns }).execute(
			"attach-blocked",
			{ action: "resume", id: "old", message: "continue", chain: [{ agent: "Planner", task: "delegate" }] },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(cwd),
		);
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
