import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionConfig, ToolDescriptionMode } from "../shared/types.ts";
import { getAgentDir, getProjectConfigDir } from "../shared/utils.ts";

const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";
const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;

export const SUBAGENT_SAFETY_GUIDANCE = `SAFETY-CRITICAL SUBAGENT GUIDANCE:
• Dispatch known configured roles directly; runtime rejects unknown or disabled names. Use { action: "list" } only for diagnostics, configuration changes, or unknown-role recovery.
• Keep execution and management separate: omit action for SINGLE/PARALLEL/CHAIN execution; use action only for list/get/models/create/update/delete/status/interrupt/stop/resume/append-step/doctor.
• Async/background runs: launch with async:true only when work can proceed independently. Do not sleep or poll status just to wait; if this turn must block, use the wait tool. Otherwise continue useful work or respond and let completion notifications arrive.
• Child-safety boundary: ordinary child subagents are not orchestrators and must not run subagents. Only explicitly configured fanout children may use the child-safe subagent tool, still bounded by depth/session limits.
• Writing/review safety: keep one writer for the same cwd/worktree. Use fresh-context read-only reviewers/validators for independent review, then have the parent synthesize and apply fixes as the sole writer unless an isolated worktree was intentionally requested.
• Artifacts/status essentials: chain outputs live under {chain_dir}; async runs expose asyncId/asyncDir with status.json, events.jsonl, output logs, and status via { action: "status", id }. Include output paths and residual risks when reporting results.`;

export const FULL_SUBAGENT_TOOL_DESCRIPTION = `Delegate to subagents or manage agent definitions.

EXECUTION (use exactly ONE mode):
• Dispatch known configured roles directly; runtime rejects unknown or disabled names. Use { action: "list" } only for diagnostics, configuration changes, or unknown-role recovery.
• SINGLE: { agent, task? } - one task; omit task for self-contained agents
• CHAIN: { chain: [{agent:"agent-a"}, {parallel:[{agent:"agent-b",count:3}]}] } - sequential pipeline with optional parallel fan-out
• PARALLEL: { tasks: [{agent,task,count?,output?,reads?,progress?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)
• Optional context: { context: "fresh" | "fork" } (explicit value overrides every child; when omitted, each requested agent uses its own defaultContext, otherwise "fresh")
• Budget controls are opt-in: normally omit timeoutMs, maxRuntimeMs, turnBudget, and toolBudget. Set one only for an explicit user request or concrete external constraint, never speculative cost/runaway concerns. timeoutMs and maxRuntimeMs are run-level aliases.
• When proactive skill subagent suggestions are available, consider a small fresh-context fanout for broad tasks where one of those skills would materially help

CHAIN TEMPLATE VARIABLES (use in task strings):
• {task} - The original task/request from the user
• {previous} - Text response from the previous step (empty for first step)
• {chain_dir} - Shared directory for chain files (e.g., <tmpdir>/pi-subagents-<scope>/chain-runs/abc123/)

Example: { chain: [{agent:"agent-a", task:"Analyze {task}"}, {agent:"agent-b", task:"Plan based on {previous}"}] }

MANAGEMENT (use action field, omit agent/task/chain/tasks):
• { action: "list" } - inspect configured agents/chains after configuration changes, for diagnostics, or during unknown-role recovery
• { action: "get", agent: "name" } - full detail; packaged agents use dotted runtime names like "package.agent"
• { action: "models", agent?: "name" } - show the runtime-loaded builtin subagent model mapping, optionally filtered to one builtin
• { action: "watchdog.status" | "watchdog.check" | "watchdog.recommend-model" } - inspect the opt-in subagent watchdog and its strong complementary model recommendation
• { action: "watchdog.configure", model: "recommended" | "inherit" | "provider/model[:thinking]", scope?: "session" | "user" | "project", target?: "main" | "children" | "child", agent?: "name", thinking?: "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" } - configure watchdog model selection; default scope is session, use persistent scopes only when the user asks
• { action: "create", config: { name: "custom-agent", package: "code-analysis", systemPrompt, systemPromptMode, inheritProjectContext, inheritSkills, defaultContext, ... } }
• { action: "update", agent: "code-analysis.custom-agent", config: { package: "analysis", ... } } - merge
• { action: "delete", agent: "code-analysis.custom-agent" }
• { action: "eject", agent: "reviewer", agentScope?: "user" | "project" } - copy a bundled/package agent to user/project scope as an editable custom file that shadows the original (default scope: user)
• { action: "disable", agent: "reviewer", agentScope?: "user" | "project" } - hide any agent from runtime discovery via a reversible settings override (default scope: user)
• { action: "enable", agent: "reviewer", agentScope?: "user" | "project" } - remove a disabled override and restore discovery
• { action: "reset", agent: "reviewer", agentScope?: "user" | "project" } - delete the scope's custom agent file and/or settings override, restoring the bundled default
• Use chainName for chain operations; packaged chains also use dotted runtime names

CONTROL:
• { action: "status", id: "..." } - inspect an async/background run by id or prefix
• { action: "status", view: "fleet" } - read-only active foreground/async fleet view with transcript commands
• { action: "status", id: "...", view: "transcript", index?: 0, lines?: 80 } - tail a run or child output/session transcript
• { action: "interrupt", id?: "..." } - soft-interrupt the current child turn and leave the run paused
• { action: "stop", id: "..." } - stop a current-session top-level async run; stopped runs finish with state "stopped"
• { action: "resume", id: "...", message: "...", index?: 0 } - interrupt then follow up with a live async child, or revive a completed async/foreground child from its session
• { action: "steer", id: "...", message: "...", index?: 0 } - queue non-terminal guidance for a live/queued async Pi child when supported
• { action: "append-step", id: "...", chain: [{agent:"agent-c", task:"Use {previous}"}] } - append one step to the tail of a running async chain

SCHEDULE (opt-in; requires { "scheduledRuns": { "enabled": true } } in config.json):
• { action: "schedule", agent, task?, schedule: "+10m" | "2030-01-01T09:00:00Z", scheduleName? } - defer a subagent launch until a future time. Also accepts tasks[] or chain[]. Scheduled runs always launch async with fresh context; they become normal tracked async runs once they fire. Only schedule explicit delayed runs the user asked for.
• { action: "schedule-list" } - list scheduled runs for this session
• { action: "schedule-status", id: "..." } - inspect one scheduled run
• { action: "schedule-cancel", id: "..." } - cancel a scheduled run before it fires

DIAGNOSTICS:
• { action: "doctor" } - read-only report for runtime paths, discovery, sessions, and intercom

${SUBAGENT_SAFETY_GUIDANCE}`;

export const COMPACT_SUBAGENT_TOOL_DESCRIPTION = `Delegate focused work to configured subagents. Use exactly one mode per call.

EXECUTE:
• Dispatch known configured roles directly; runtime rejects unknown or disabled names. Use { action:"list" } only for diagnostics, configuration changes, or unknown-role recovery.
• SINGLE {agent, task?}; PARALLEL {tasks:[{agent,task,count?,output?,reads?,progress?}], concurrency?, worktree?}; CHAIN {chain:[{agent,task?},{parallel:[...]}]}.
• context is "fresh" or "fork"; omitted uses each role defaultContext, otherwise fresh. Budgets are opt-in: normally omit timeoutMs, maxRuntimeMs, turnBudget, and toolBudget.
• Chain templates may use {task}, {previous}, {chain_dir}, and named outputs. Worktrees require clean git repos.

CONTROL:
• Use action without execution fields. Common actions: list, get, status, interrupt, stop, resume, steer, append-step, doctor.
• async:true detaches independent work. Do not poll just to wait; use subagent_wait only when this turn must block. Status and artifacts are available through { action:"status", id:"..." }.

SAFETY:
• Ordinary child subagents are not orchestrators. Only explicit fanout children may use child-safe subagent, bounded by depth/session limits.
• Keep one writer per cwd/worktree. Use fresh read-only review/validation fanout, then synthesize and apply fixes from the parent unless isolated worktrees were intentionally requested.

Set toolDescriptionMode:"full" for administration, configuration, scheduling, and the complete parameter reference.`;

function isToolDescriptionMode(value: unknown): value is ToolDescriptionMode {
	return value === "full" || value === "compact" || value === "custom";
}

function warn(options: ToolDescriptionOptions | undefined, message: string): void {
	(options?.warn ?? console.warn)(`[pi-subagents] ${message}`);
}

export interface ToolDescriptionOptions {
	cwd?: string;
	agentDir?: string;
	warn?: (message: string) => void;
}

export function resolveToolDescriptionMode(config: Pick<ExtensionConfig, "toolDescriptionMode">, options?: ToolDescriptionOptions): ToolDescriptionMode {
	const mode = config.toolDescriptionMode;
	if (mode === undefined) return "compact";
	if (isToolDescriptionMode(mode)) return mode;
	warn(options, `Ignoring invalid toolDescriptionMode ${JSON.stringify(mode)}; expected "full", "compact", or "custom".`);
	return "compact";
}

function customDescriptionPaths(options?: ToolDescriptionOptions): string[] {
	const cwd = options?.cwd ?? process.cwd();
	const agentDir = options?.agentDir ?? getAgentDir();
	return [
		path.join(getProjectConfigDir(cwd), CUSTOM_TOOL_DESCRIPTION_FILE),
		path.join(agentDir, CUSTOM_TOOL_DESCRIPTION_FILE),
	];
}

function renderCustomTemplate(template: string, options?: ToolDescriptionOptions): string {
	const cwd = options?.cwd ?? process.cwd();
	const agentDir = options?.agentDir ?? getAgentDir();
	const projectConfigDir = getProjectConfigDir(cwd);
	const variables: Record<string, () => string> = {
		fullDescription: () => FULL_SUBAGENT_TOOL_DESCRIPTION,
		full: () => FULL_SUBAGENT_TOOL_DESCRIPTION,
		compactDescription: () => COMPACT_SUBAGENT_TOOL_DESCRIPTION,
		compact: () => COMPACT_SUBAGENT_TOOL_DESCRIPTION,
		safetyGuidance: () => SUBAGENT_SAFETY_GUIDANCE,
		safety: () => SUBAGENT_SAFETY_GUIDANCE,
		agentDir: () => agentDir,
		projectConfigDir: () => projectConfigDir,
	};
	return template.replace(/\{\{(\w+)\}\}/g, (raw, name: string) => {
		const replacement = variables[name];
		if (replacement) return replacement();
		warn(options, `${CUSTOM_TOOL_DESCRIPTION_FILE}: unknown placeholder ${raw} left unchanged.`);
		return raw;
	});
}

function loadCustomToolDescription(options?: ToolDescriptionOptions): string | undefined {
	for (const filePath of customDescriptionPaths(options)) {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch (error) {
			if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
			warn(options, `Failed to inspect custom tool description '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (!stat.isFile()) {
			warn(options, `Ignoring custom tool description '${filePath}' because it is not a file.`);
			continue;
		}
		if (stat.size > CUSTOM_TOOL_DESCRIPTION_MAX_BYTES) {
			warn(options, `Ignoring custom tool description '${filePath}' because it is larger than ${CUSTOM_TOOL_DESCRIPTION_MAX_BYTES} bytes.`);
			continue;
		}
		try {
			const template = fs.readFileSync(filePath, "utf-8").trim();
			if (!template) {
				warn(options, `Ignoring empty custom tool description '${filePath}'.`);
				continue;
			}
			const rendered = renderCustomTemplate(template, options).trim();
			if (!rendered) {
				warn(options, `Ignoring custom tool description '${filePath}' because it rendered empty.`);
				continue;
			}
			return rendered;
		} catch (error) {
			warn(options, `Failed to read custom tool description '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return undefined;
}

function withMandatorySafetyGuidance(description: string): string {
	const customDescription = description
		.split(SUBAGENT_SAFETY_GUIDANCE)
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n\n");
	return customDescription
		? `${customDescription}\n\n${SUBAGENT_SAFETY_GUIDANCE}`
		: SUBAGENT_SAFETY_GUIDANCE;
}

export interface ResolvedSubagentToolDescription {
	mode: ToolDescriptionMode;
	description: string;
}

export function resolveSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): ResolvedSubagentToolDescription {
	const mode = resolveToolDescriptionMode(config, options);
	if (mode === "compact") return { mode, description: COMPACT_SUBAGENT_TOOL_DESCRIPTION };
	if (mode === "full") return { mode, description: FULL_SUBAGENT_TOOL_DESCRIPTION };
	const custom = loadCustomToolDescription(options);
	if (custom) return { mode, description: withMandatorySafetyGuidance(custom) };
	warn(options, `${CUSTOM_TOOL_DESCRIPTION_FILE} was not found or valid for toolDescriptionMode "custom"; using compact description.`);
	return { mode: "compact", description: COMPACT_SUBAGENT_TOOL_DESCRIPTION };
}

export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {
	return resolveSubagentToolDescription(config, options).description;
}
