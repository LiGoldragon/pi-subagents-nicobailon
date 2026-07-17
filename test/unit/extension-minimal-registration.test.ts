import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");

function inspectRegistration(config: object): { tools: Record<string, string[]>; commands: string[] } {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-registration-"));
	try {
		fs.mkdirSync(path.join(agentDir, "extensions", "subagent"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "extensions", "subagent", "config.json"), JSON.stringify(config));
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			const tools = {}; const commands = [];
			const pi = new Proxy({
				events: { on() { return () => {}; }, emit() {} },
				registerTool(tool) { tools[tool.name] = Object.keys(tool.parameters.properties ?? {}).sort(); },
				registerCommand(name) { commands.push(name); }, registerShortcut() {}, registerMessageRenderer() {}, sendMessage() {}, getSessionName() {},
			}, { get(target, property) { return property in target ? target[property] : () => undefined; } });
			registerSubagentExtension(pi); process.stdout.write(JSON.stringify({ tools, commands }));
		`;
		const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
		delete env.PI_SUBAGENT_CHILD;
		delete env.PI_SUBAGENT_FANOUT_CHILD;
		const output = execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], {
			cwd: projectRoot,
			env,
			encoding: "utf8",
		});
		return JSON.parse(output) as { tools: Record<string, string[]>; commands: string[] };
	} finally {
		fs.rmSync(agentDir, { recursive: true, force: true });
	}
}

describe("extension disclosure registration", () => {
	it("keeps minimal registration to direct launch plus recovery list without wait or workflow commands", () => {
		const registration = inspectRegistration({});
		assert.deepEqual(registration.tools.subagent, ["action", "agent", "async", "context", "task"]);
		assert.equal(registration.tools.subagent_wait, undefined);
		for (const command of ["run", "chain", "parallel", "run-chain", "prompt-workflow", "chain-prompts"]) assert.equal(registration.commands.includes(command), false);
	});

	it("registers the full documented schema and wait tool only in explicit advanced mode", () => {
		const registration = inspectRegistration({ toolDescriptionMode: "full" });
		assert.ok(registration.tools.subagent?.includes("action"));
		assert.ok(registration.tools.subagent?.includes("chain"));
		assert.ok(registration.tools.subagent_wait);
		assert.ok(registration.commands.includes("run"));
		assert.ok(registration.commands.includes("prompt-workflow"));
		assert.ok(registration.commands.includes("chain-prompts"));
	});

	it("registers packaged prompt workflows in custom mode too", () => {
		const registration = inspectRegistration({ toolDescriptionMode: "custom" });
		assert.ok(registration.tools.subagent?.includes("action"));
		assert.ok(registration.commands.includes("prompt-workflow"));
		assert.ok(registration.commands.includes("chain-prompts"));
	});
});
