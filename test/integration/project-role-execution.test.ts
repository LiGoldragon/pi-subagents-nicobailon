import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { discoverAgents } from "../../src/agents/agents.ts";
import { createEventBus, createMockPi, createTempDir, makeMinimalCtx, removeTempDir, tryImport } from "../support/helpers.ts";

const executorModule = await tryImport<typeof import("../../src/runs/foreground/subagent-executor.ts")>("./src/runs/foreground/subagent-executor.ts");
const available = !!executorModule?.createSubagentExecutor;

describe("generated role metadata remains guidance only", { skip: !available ? "executor unavailable" : undefined }, () => {
	const mockPi = createMockPi();
	let cwd = "";

	before(() => mockPi.install());
	after(() => mockPi.uninstall());
	after(() => { if (cwd) removeTempDir(cwd); });

	function createExecutor() {
		return executorModule!.createSubagentExecutor({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state: { baseCwd: "", currentSessionId: null, asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null },
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: cwd,
			getSubagentSessionRoot: () => cwd,
			expandTilde: (value: string) => value,
			discoverAgents: (directory, scope) => discoverAgents(directory, scope),
		});
	}

	it("launches every discovered agent and lists normally despite root, nested, leaf, missing, and malformed metadata", async () => {
		cwd = createTempDir("pi-subagents-role-metadata-inert-");
		const agentsDir = path.join(cwd, ".pi", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		const fixtures = [
			["Manager", "projectRoleIdentity: Manager\nprojectRoleDispatchKind: manager"],
			["Planner", "projectRoleIdentity: Planner\nprojectRoleDispatchKind: nested\nallowedChildRoleNames: Reader"],
			["Reader", "projectRoleIdentity: Reader\nprojectRoleDispatchKind: leaf"],
			["MetadataFree", ""],
			["OldPacket", "projectRoleIdentity: wrong\nprojectRoleDispatchKind: coordinator\nallowedChildRoleNames: no-one"],
		] as const;
		for (const [name, metadata] of fixtures) {
			fs.writeFileSync(path.join(agentsDir, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\ntools: read\n${metadata}\n---\n\nReturn a concise result.\n`);
		}

		const discovered = discoverAgents(cwd, "project").agents;
		const projectAgents = discovered.filter((agent) => agent.source === "project");
		assert.equal(projectAgents.length, fixtures.length);
		assert.equal(projectAgents.find((agent) => agent.name === "OldPacket")?.extraFields?.projectRoleDispatchKind, "coordinator");

		const executor = createExecutor();
		for (const [name] of fixtures) {
			mockPi.reset();
			mockPi.onCall({ output: `${name} completed` });
			const result = await executor.execute(name, { agent: name, task: "work", async: false, model: "test/model" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
			assert.equal(result.isError, undefined, `${name} must launch without role authorization`);
			assert.ok(fs.readdirSync(mockPi.dir).some((file) => file.startsWith("call-")), `${name} must allocate a child before completing`);
		}

		const listed = await executor.execute("list", { action: "list" }, new AbortController().signal, undefined, makeMinimalCtx(cwd));
		const text = listed.content[0]?.text ?? "";
		for (const [name] of fixtures) assert.match(text, new RegExp(`- ${name} \\(`));
	});
});
