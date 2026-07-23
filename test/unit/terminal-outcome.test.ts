import test from "node:test";
import assert from "node:assert/strict";

import {
	classifyTerminalOutcome,
	createTerminalDiagnostics,
	resolveTerminalOutcome,
	terminalOutcomeGlyph,
	terminalOutcomeLabel,
} from "../../src/shared/terminal-outcome.ts";

test("classifies all typed terminal outcomes", () => {
	const done = classifyTerminalOutcome({
		process: { source: "close", exitCode: 0, terminalEvent: "assistant-stop" },
		completed: true,
	});
	assert.deepEqual(done, { kind: "done" });
	assert.equal(terminalOutcomeLabel(done), "Done");
	assert.equal(terminalOutcomeGlyph(done), "✓");

	const agentOutcome = classifyTerminalOutcome({
		agentOutcome: "completion-guard",
		process: { source: "close", exitCode: 0, terminalEvent: "assistant-stop" },
	});
	assert.deepEqual(agentOutcome, { kind: "agent-outcome", reason: "completion-guard" });
	assert.match(terminalOutcomeLabel(agentOutcome), /^Agent outcome — completion guard/);
	assert.equal(terminalOutcomeGlyph(agentOutcome), "■");

	const runtimeError = classifyTerminalOutcome({
		process: { source: "close", exitCode: 7, terminalEvent: "none" },
	});
	assert.deepEqual(runtimeError, { kind: "runtime-error", reason: "process-exit" });
	assert.equal(terminalOutcomeGlyph(runtimeError), "✗");

	const lifecycleDisconnect = classifyTerminalOutcome({
		process: { source: "close", exitCode: 0, terminalEvent: "none" },
		completed: true,
	});
	assert.deepEqual(lifecycleDisconnect, { kind: "runtime-error", reason: "lifecycle-disconnect" });
	assert.equal(terminalOutcomeLabel(lifecycleDisconnect), "Runtime error — child lifecycle ended before a terminal event");
	assert.equal(terminalOutcomeGlyph(lifecycleDisconnect), "✗");

	const unknown = classifyTerminalOutcome({ completed: true });
	assert.deepEqual(unknown, { kind: "unknown-termination" });
	assert.equal(terminalOutcomeLabel(unknown), "Unknown termination");
	assert.equal(terminalOutcomeGlyph(unknown), "?");
});

test("completion guard wins over a successful effective process exit", () => {
	assert.deepEqual(classifyTerminalOutcome({
		agentOutcome: "completion-guard",
		process: { source: "close", exitCode: 0, terminalEvent: "assistant-stop" },
		completed: false,
	}), { kind: "agent-outcome", reason: "completion-guard" });
});

test("classifies only witnessed lifecycle and process failures as runtime errors", () => {
	assert.deepEqual(classifyTerminalOutcome({
		process: { source: "spawn-error", exitCode: null, terminalEvent: "none" },
	}), { kind: "runtime-error", reason: "spawn-error" });
	assert.deepEqual(classifyTerminalOutcome({
		process: { source: "close", exitCode: null, signal: "SIGKILL", terminalEvent: "none" },
	}), { kind: "runtime-error", reason: "process-signal" });
	assert.deepEqual(classifyTerminalOutcome({
		runtimeError: "protocol-error",
		process: { source: "close", exitCode: 0, terminalEvent: "assistant-stop" },
	}), { kind: "runtime-error", reason: "protocol-error" });
});

test("serializes privacy-safe process, compaction, provider, and lifecycle diagnostics", () => {
	assert.deepEqual(createTerminalDiagnostics({
		process: { source: "close", exitCode: 0, terminalEvent: "none" },
		providerError: true,
	}), {
		process: { source: "close", exitCode: 0, terminalEvent: "none" },
		compaction: "not-observed",
		provider: "error-observed",
		lifecycle: "missing-terminal-event",
	});
	assert.deepEqual(createTerminalDiagnostics({ detached: true }), {
		compaction: "not-observed",
		provider: "none-observed",
		lifecycle: "detached-before-close",
	});
});

test("old records use explicit fallback without treating effective exit codes as intent", () => {
	assert.deepEqual(resolveTerminalOutcome({ processExitCode: 9 }), {
		kind: "runtime-error",
		reason: "process-exit",
	});
	assert.deepEqual(resolveTerminalOutcome({}), { kind: "unknown-termination" });
	assert.deepEqual(resolveTerminalOutcome({ stopped: true, processExitCode: null }), {
		kind: "agent-outcome",
		reason: "stopped",
	});
});
