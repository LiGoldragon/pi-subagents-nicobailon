import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { WAIT_TOOL_ENABLED_ENV } from "../../src/runs/background/subagent-wait.ts";
import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "../../src/runs/shared/pi-args.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parentToolEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env[SUBAGENT_CHILD_ENV];
	delete env[SUBAGENT_FANOUT_CHILD_ENV];
	delete env[WAIT_TOOL_ENABLED_ENV];
	return env;
}

describe("subagent extension child mode", () => {
	it("injects the roster only when the selected root is the generated Manager", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-root-roster-"));
		try {
			const agentsDir = path.join(root, ".pi", "agents");
			fs.mkdirSync(agentsDir, { recursive: true });
			for (const [name, kind, children] of [["Manager", "manager", ""], ["Planner", "nested", "Reader"], ["Reader", "leaf", ""]] as const) {
				fs.writeFileSync(path.join(agentsDir, `${name.toLowerCase()}.md`), `---\nname: ${name}\ndescription: ${name}\nprojectRoleIdentity: ${name}\nprojectRoleDispatchKind: ${kind}${kind === "nested" ? `\nallowedChildRoleNames: ${children}` : ""}\n---\n\n${name} root prompt\n`);
			}
			const script = String.raw`
				import registerSubagentExtension from "./index.ts";
				const handlers = new Map();
				const pi = new Proxy({
					events: { on() { return () => {}; }, emit() {} },
					on(name, handler) { handlers.set(name, handler); },
					registerTool() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, sendMessage() {}, getSessionName() { return undefined; },
				}, { get(target, prop) { return prop in target ? target[prop] : () => undefined; } });
				registerSubagentExtension(pi);
				const result = handlers.get("before_agent_start")({ systemPrompt: "base", systemPromptOptions: { cwd: process.env.ROOT_CWD, customPrompt: process.env.ROOT_PROMPT } }, { cwd: process.env.ROOT_CWD });
				process.stdout.write(result?.systemPrompt ?? "");
			`;
			const run = (prompt: string): string => {
				const env = parentToolEnv();
				env.ROOT_CWD = root;
				env.ROOT_PROMPT = prompt;
				return execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], { cwd: projectRoot, env, encoding: "utf-8" });
			};
			assert.match(run("Manager root prompt"), /Generated Manager roster/);
			for (const prompt of ["Planner root prompt", "Reader root prompt"]) {
				assert.doesNotMatch(run(prompt), /Generated Manager roster/);
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	it("collapses tool detail before direct subagent tool execution", () => {
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			const events = { on() { return () => {}; }, emit() {} };
			let registeredTool;
			const fakePi = new Proxy({
				events,
				registerTool(tool) { if (tool.name === "subagent") registeredTool = tool; },
				registerCommand() {},
				registerShortcut() {},
				registerMessageRenderer() {},
				sendMessage() {},
				getSessionName() { return undefined; },
			}, {
				get(target, prop) {
					if (prop in target) return target[prop];
					return () => undefined;
				},
			});
			registerSubagentExtension(fakePi);
			if (!registeredTool) throw new Error("tool not registered");
			const calls = [];
			const ctx = {
				cwd: process.cwd(),
				hasUI: true,
				ui: {
					setToolsExpanded(value) { calls.push(value); },
					setWidget() {},
					requestRender() {},
					theme: { fg(_name, text) { return text; }, bg(_name, text) { return text; }, bold(text) { return text; } },
				},
				sessionManager: { getSessionId() { return "session-test"; }, getSessionFile() { return null; } },
				modelRegistry: { getAvailable() { return []; } },
			};
			await registeredTool.execute("collapse-check", { action: "list" }, new AbortController().signal, undefined, ctx);
			if (calls[0] !== false) throw new Error("expected setToolsExpanded(false), got " + JSON.stringify(calls));
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, env: parentToolEnv(), stdio: "pipe" },
		);
	});

	it("does not show async badge for explicit foreground clarify chain calls", () => {
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			const events = { on() { return () => {}; }, emit() {} };
			let registeredTool;
			const fakePi = new Proxy({
				events,
				registerTool(tool) { if (tool.name === "subagent") registeredTool = tool; },
				registerCommand() {},
				registerShortcut() {},
				registerMessageRenderer() {},
				sendMessage() {},
				getSessionName() { return undefined; },
			}, {
				get(target, prop) {
					if (prop in target) return target[prop];
					return () => undefined;
				},
			});
			registerSubagentExtension(fakePi);
			if (!registeredTool) throw new Error("tool not registered");
			const theme = { fg(_name, text) { return text; }, bold(text) { return text; } };
			const asyncChain = registeredTool.renderCall({ chain: [{ agent: "worker" }, { agent: "reviewer" }], async: true }, theme).text;
			const asyncParallel = registeredTool.renderCall({ tasks: [{ agent: "worker" }, { agent: "reviewer", count: 2 }], async: true }, theme).text;
			const clarifyChain = registeredTool.renderCall({ chain: [{ agent: "worker" }, { agent: "reviewer" }], async: true, clarify: true }, theme).text;
			if (!asyncChain.includes("[async]")) throw new Error("expected async chain badge, got " + asyncChain);
			if (!asyncParallel.includes("parallel (3) [async]")) throw new Error("expected async parallel badge, got " + asyncParallel);
			if (clarifyChain.includes("[async]")) throw new Error("unexpected clarify async badge: " + clarifyChain);
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, env: parentToolEnv(), stdio: "pipe" },
		);
	});

	it("registers only subagent_wait and honors waitTool disabled config", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-wait-tool-config-"));
		try {
			const configDir = path.join(agentDir, "extensions", "subagent");
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ toolDescriptionMode: "full", waitTool: { enabled: false } }), "utf-8");

			const script = String.raw`
				import registerSubagentExtension from "./index.ts";
				const events = { on() { return () => {}; }, emit() {} };
				let subagentWaitTool;
				let legacyWaitRegistered = false;
				const fakePi = new Proxy({
					events,
					registerTool(tool) {
						if (tool.name === "subagent_wait") subagentWaitTool = tool;
						if (tool.name === "wait") legacyWaitRegistered = true;
					},
					registerCommand() {},
					registerShortcut() {},
					registerMessageRenderer() {},
					sendMessage() {},
					getSessionName() { return undefined; },
				}, {
					get(target, prop) {
						if (prop in target) return target[prop];
						return () => undefined;
					},
				});
				registerSubagentExtension(fakePi);
				if (!subagentWaitTool) throw new Error("subagent_wait tool not registered");
				if (legacyWaitRegistered) throw new Error("legacy wait tool must not be registered");
				const result = await subagentWaitTool.execute("subagent-wait-disabled", {}, new AbortController().signal, undefined, {});
				process.stdout.write(JSON.stringify(result.content[0].text));
			`;

			const env = parentToolEnv();
			env.PI_CODING_AGENT_DIR = agentDir;
			const output = execFileSync(
				process.execPath,
				[
					"--experimental-transform-types",
					"--import",
					"./test/support/register-loader.mjs",
					"--input-type=module",
					"--eval",
					script,
				],
				{ cwd: projectRoot, env, encoding: "utf-8" },
			);
			assert.match(JSON.parse(output) as string, /disabled/i);
		} finally {
			fs.rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("does not restore the async widget from tool results when asyncWidget is disabled", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-async-widget-config-"));
		try {
			const configDir = path.join(agentDir, "extensions", "subagent");
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ asyncWidget: false }), "utf-8");
			const script = String.raw`
				import registerSubagentExtension from "./index.ts";
				const eventHandlers = new Map();
				const handlers = new Map();
				const events = { on(channel, handler) { eventHandlers.set(channel, handler); return () => {}; }, emit() {} };
				const fakePi = new Proxy({
					events,
					on(channel, handler) { handlers.set(channel, handler); },
					registerTool() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
					sendMessage() {}, getSessionName() { return undefined; },
				}, { get(target, prop) { return prop in target ? target[prop] : () => undefined; } });
				const widgets = [];
				const ctx = {
					cwd: process.cwd(), hasUI: true,
					ui: { setWidget(_key, value) { widgets.push(value); }, requestRender() {}, theme: { fg(_name, text) { return text; }, bg(_name, text) { return text; }, bold(text) { return text; } } },
					sessionManager: { getSessionId() { return "session-widget"; }, getSessionFile() { return null; }, getEntries() { return []; } },
					modelRegistry: { getAvailable() { return []; } },
				};
				registerSubagentExtension(fakePi);
				handlers.get("session_start")({}, ctx);
				widgets.length = 0;
				eventHandlers.get("subagent:async-started")({ id: "widget-run", pid: 1, sessionId: "session-widget", mode: "single", agent: "worker", asyncDir: "/tmp/widget-run" });
				handlers.get("tool_result")({ toolName: "subagent" }, ctx);
				if (widgets.length < 2 || widgets.some((value) => value !== undefined)) throw new Error("async widget rendered despite disabled config: " + JSON.stringify(widgets));
				handlers.get("session_shutdown")();
			`;
			const env = parentToolEnv();
			env.PI_CODING_AGENT_DIR = agentDir;
			execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], { cwd: projectRoot, env, stdio: "pipe" });
		} finally {
			fs.rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("registers the main watchdog command and renderer in parent mode", () => {
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			const events = { on() { return () => {}; }, emit() {} };
			const commands = [];
			const renderers = [];
			const fakePi = new Proxy({
				events,
				registerTool() {},
				registerCommand(name) { commands.push(name); },
				registerShortcut() {},
				registerMessageRenderer(type) { renderers.push(type); },
				sendMessage() {},
				getSessionName() { return undefined; },
			}, {
				get(target, prop) {
					if (prop in target) return target[prop];
					return () => undefined;
				},
			});
			registerSubagentExtension(fakePi);
			if (!commands.includes("subagents-watchdog")) throw new Error("watchdog command not registered: " + commands.join(", "));
			if (!renderers.includes("subagent_watchdog_warning")) throw new Error("watchdog renderer not registered: " + renderers.join(", "));
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, env: parentToolEnv(), stdio: "pipe" },
		);
	});

	it("returns before registering anything for non-fanout children", () => {
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "./src/runs/shared/pi-args.ts";
			process.env[SUBAGENT_CHILD_ENV] = "1";
			process.env[SUBAGENT_FANOUT_CHILD_ENV] = "0";
			const calls = [];
			const fakePi = new Proxy({}, {
				get(_target, prop) {
					return (..._args) => {
						calls.push(String(prop));
						return undefined;
					};
				},
			});
			registerSubagentExtension(fakePi);
			if (calls.length > 0) {
				throw new Error("Unexpected child-mode registrations: " + calls.join(", "));
			}
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, stdio: "pipe" },
		);
	});

	it("returns before registering anything for fanout children", () => {
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "./src/runs/shared/pi-args.ts";
			process.env[SUBAGENT_CHILD_ENV] = "1";
			process.env[SUBAGENT_FANOUT_CHILD_ENV] = "1";
			const calls = [];
			const fakePi = new Proxy({}, {
				get(target, prop) {
					if (prop in target) return target[prop];
					return (..._args) => {
						calls.push(String(prop));
						return undefined;
					};
				},
			});
			registerSubagentExtension(fakePi);
			if (calls.length > 0) {
				throw new Error("Unexpected child-mode registrations: " + calls.join(", "));
			}
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, stdio: "pipe" },
		);
	});

	it("does not double-register the child-safe subagent tool when index and fanout-child both load", () => {
		const script = String.raw`
			import registerSubagentExtension from "./index.ts";
			import registerFanoutChildSubagentExtension from "./src/extension/fanout-child.ts";
			import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "./src/runs/shared/pi-args.ts";
			process.env[SUBAGENT_CHILD_ENV] = "1";
			process.env[SUBAGENT_FANOUT_CHILD_ENV] = "1";
			process.env.PI_SUBAGENT_PROJECT_ROLE_METADATA = JSON.stringify({ version: 1, projectRoleIdentity: "Planner", projectRoleDispatchKind: "nested", allowedChildRoleNames: [] });

			const registeredNames = new Set();
			const registrations = [];
			function makePi(source) {
				return {
					events: { on() { return () => {}; }, emit() {} },
					registerTool(tool) {
						if (registeredNames.has(tool.name)) {
							throw new Error("Tool " + tool.name + " conflicts with " + source);
						}
						registeredNames.add(tool.name);
						registrations.push({ source, name: tool.name });
					},
					getSessionName() { return undefined; },
				};
			}

			registerSubagentExtension(makePi("index.ts"));
			registerFanoutChildSubagentExtension(makePi("fanout-child.ts"));
			if (registrations.length !== 1 || registrations[0].name !== "subagent" || registrations[0].source !== "fanout-child.ts") {
				throw new Error("expected only fanout-child.ts to register subagent, got " + JSON.stringify(registrations));
			}
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, stdio: "pipe" },
		);
	});

	it("fails closed instead of registering fanout for missing or malformed generated metadata", () => {
		const script = String.raw`
			import registerFanoutChildSubagentExtension from "./src/extension/fanout-child.ts";
			import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "./src/runs/shared/pi-args.ts";
			process.env[SUBAGENT_CHILD_ENV] = "1";
			process.env[SUBAGENT_FANOUT_CHILD_ENV] = "1";
			process.env.PI_SUBAGENT_PROJECT_ROLE_METADATA = "{old-packet";
			let registered = false;
			registerFanoutChildSubagentExtension({ registerTool() { registered = true; } });
			if (registered) throw new Error("malformed generated packet must not receive fanout");
		`;
		execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], { cwd: projectRoot, stdio: "pipe" });
	});

	it("registers metadata-free fanout only with explicit legacy non-project configuration", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-legacy-fanout-"));
		try {
			fs.mkdirSync(path.join(agentDir, "extensions", "subagent"), { recursive: true });
			fs.writeFileSync(path.join(agentDir, "extensions", "subagent", "config.json"), JSON.stringify({ projectRolePolicy: { allowLegacyNonProject: true } }));
			const script = String.raw`
				import registerFanoutChildSubagentExtension from "./src/extension/fanout-child.ts";
				import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "./src/runs/shared/pi-args.ts";
				process.env[SUBAGENT_CHILD_ENV] = "1";
				process.env[SUBAGENT_FANOUT_CHILD_ENV] = "1";
				delete process.env.PI_SUBAGENT_PROJECT_ROLE_METADATA;
				let registered = false;
				registerFanoutChildSubagentExtension({ registerTool() { registered = true; }, events: { on() { return () => {}; } } });
				if (!registered) throw new Error("explicit legacy fanout configuration should register");
			`;
			execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], {
				cwd: projectRoot,
				env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
				stdio: "pipe",
			});
		} finally {
			fs.rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("lets fanout children call read-only list but blocks mutating management actions", () => {
		const script = String.raw`
			import registerFanoutChildSubagentExtension from "./src/extension/fanout-child.ts";
			import { SUBAGENT_CHILD_ENV, SUBAGENT_FANOUT_CHILD_ENV } from "./src/runs/shared/pi-args.ts";
			process.env[SUBAGENT_CHILD_ENV] = "1";
			process.env[SUBAGENT_FANOUT_CHILD_ENV] = "1";
			process.env.PI_SUBAGENT_PROJECT_ROLE_METADATA = JSON.stringify({ version: 1, projectRoleIdentity: "Planner", projectRoleDispatchKind: "nested", allowedChildRoleNames: [] });
			let registeredTool;
			const fakePi = {
				events: { on() { return () => {}; }, emit() {} },
				registerTool(tool) { registeredTool = tool; },
				getSessionName() { return undefined; },
			};
			registerFanoutChildSubagentExtension(fakePi);
			if (!registeredTool) throw new Error("tool not registered");
			const ctx = {
				cwd: process.cwd(),
				hasUI: false,
				sessionManager: { getSessionId() { return "session-test"; }, getSessionFile() { return null; } },
				modelRegistry: { getAvailable() { return []; } },
			};
			const list = await registeredTool.execute("list-check", { action: "list" }, new AbortController().signal, undefined, ctx);
			if (list.isError) throw new Error("list should be allowed: " + JSON.stringify(list.content));
			const create = await registeredTool.execute("create-check", { action: "create", config: { name: "x" } }, new AbortController().signal, undefined, ctx);
			if (!create.isError) throw new Error("create should be blocked");
			const text = create.content?.[0]?.text ?? "";
			if (!text.includes("not available from child-safe subagent fanout mode")) throw new Error("unexpected create error: " + text);
		`;

		execFileSync(
			process.execPath,
			[
				"--experimental-transform-types",
				"--import",
				"./test/support/register-loader.mjs",
				"--input-type=module",
				"--eval",
				script,
			],
			{ cwd: projectRoot, stdio: "pipe" },
		);
	});
});
