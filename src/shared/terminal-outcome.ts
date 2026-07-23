import type {
	SingleResult,
	TerminalAgentOutcomeReason,
	TerminalOutcome,
	TerminalProcessEvidence,
	TerminalRuntimeErrorReason,
} from "./types.ts";

export interface TerminalOutcomeInput {
	process?: TerminalProcessEvidence;
	agentOutcome?: TerminalAgentOutcomeReason;
	runtimeError?: TerminalRuntimeErrorReason;
	/** A runner's final, deliberate completion decision; never an effective exit-code inference. */
	completed?: boolean;
}

/**
 * Classify terminal state from explicit runner decisions and witnessed process
 * closure only. An effective result exit code is deliberately not evidence of
 * either agent intent or a process fault.
 */
export function classifyTerminalOutcome(input: TerminalOutcomeInput): TerminalOutcome {
	if (input.agentOutcome) return { kind: "agent-outcome", reason: input.agentOutcome };
	if (input.runtimeError) return { kind: "runtime-error", reason: input.runtimeError };

	const process = input.process;
	if (!process) return { kind: "unknown-termination" };
	if (process.source === "spawn-error") return { kind: "runtime-error", reason: "spawn-error" };
	if (process.exitCode !== null && process.exitCode !== 0) return { kind: "runtime-error", reason: "process-exit" };
	if (process.signal && !process.forcedTermination) return { kind: "runtime-error", reason: "process-signal" };
	if (process.terminalEvent === "none") return { kind: "unknown-termination" };
	return input.completed ? { kind: "done" } : { kind: "unknown-termination" };
}

/**
 * Compatibility fallback for records serialized before terminal outcomes.
 * Historical effective result exit codes are not terminal evidence. The old
 * processExitCode remains a witnessed child close code when it is present.
 */
export function resolveTerminalOutcome(result: Pick<
	SingleResult,
	"terminalOutcome" | "terminalProcess" | "processExitCode" | "detached" | "stopped" | "timedOut" | "turnBudgetExceeded" | "interrupted"
>): TerminalOutcome {
	if (result.terminalOutcome) return result.terminalOutcome;
	if (result.detached) return { kind: "agent-outcome", reason: "detached" };
	if (result.stopped) return { kind: "agent-outcome", reason: "stopped" };
	if (result.timedOut) return { kind: "agent-outcome", reason: "timed-out" };
	if (result.turnBudgetExceeded) return { kind: "agent-outcome", reason: "turn-budget" };
	if (result.interrupted) return { kind: "agent-outcome", reason: "interrupted" };
	if (result.terminalProcess) return classifyTerminalOutcome({ process: result.terminalProcess });
	if (result.processExitCode !== undefined && result.processExitCode !== null && result.processExitCode !== 0) {
		return { kind: "runtime-error", reason: "process-exit" };
	}
	return { kind: "unknown-termination" };
}

const AGENT_REASON_LABEL: Record<TerminalAgentOutcomeReason, string> = {
	"completion-guard": "completion guard rejected an editless implementation result",
	"acceptance-rejected": "acceptance requirements were not met",
	stopped: "stopped by request",
	"timed-out": "timed out",
	"turn-budget": "turn budget exhausted",
	interrupted: "interrupted awaiting explicit next action",
	detached: "detached for coordination",
};

const RUNTIME_REASON_LABEL: Record<TerminalRuntimeErrorReason, string> = {
	"process-exit": "process exited nonzero",
	"process-signal": "process ended by signal",
	"spawn-error": "process could not start",
	"protocol-error": "child protocol failed",
};

export function terminalOutcomeLabel(outcome: TerminalOutcome): string {
	switch (outcome.kind) {
		case "done": return "Done";
		case "agent-outcome": return `Agent outcome — ${AGENT_REASON_LABEL[outcome.reason]}`;
		case "runtime-error": return `Runtime error — ${RUNTIME_REASON_LABEL[outcome.reason]}`;
		case "unknown-termination": return "Unknown termination";
	}
}

export function terminalOutcomeGlyph(outcome: TerminalOutcome): "✓" | "■" | "✗" | "?" {
	switch (outcome.kind) {
		case "done": return "✓";
		case "agent-outcome": return "■";
		case "runtime-error": return "✗";
		case "unknown-termination": return "?";
	}
}
