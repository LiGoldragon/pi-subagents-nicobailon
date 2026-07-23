import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildControlEvent,
	claimControlNotification,
	controlNotificationKey,
	deriveActivityState,
	formatControlIntercomMessage,
	formatControlNoticeMessage,
	resolveControlConfig,
	shouldNotifyControlEvent,
} from "../../src/runs/shared/subagent-control.ts";

const config = resolveControlConfig(undefined, {
	needsAttentionAfterMs: 300,
});

describe("subagent control attention state", () => {
	it("never turns silence into an attention action", () => {
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, now: 50 }), undefined);
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, now: 400 }), undefined);
		assert.equal(deriveActivityState({ config, startedAt: 0, now: 400 }), undefined);
	});


	it("builds compact needs-attention control events without inferring a silence reason", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			index: 2,
			ts: 1_000,
			lastActivityAt: 100,
		});
		assert.deepEqual(event, {
			type: "needs_attention",
			to: "needs_attention",
			ts: 1_000,
			runId: "run-1",
			agent: "worker",
			index: 2,
			message: "worker needs attention",
			reason: "idle",
			elapsedMs: 900,
		});
	});

	it("supports a specific attention message", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			message: "worker completed without making edits for an implementation task",
		});

		assert.equal(event.message, "worker completed without making edits for an implementation task");
	});

	it("builds terminal completion guard control events", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			message: "worker completed without making edits for an implementation task",
			reason: "completion_guard",
		});

		assert.equal(event.reason, "completion_guard");
	});

	it("only notifies on explicit attention events", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker" });
		const activeEvent = buildControlEvent({ type: "active_long_running", to: "active_long_running", runId: "run-1", agent: "worker" });
		assert.equal(shouldNotifyControlEvent(config, event), true);
		assert.equal(shouldNotifyControlEvent(config, activeEvent), false);
		assert.deepEqual(config.notifyOn, ["needs_attention"]);
		assert.deepEqual(config.notifyChannels, ["event", "async", "intercom"]);
	});

	it("resolves custom notification config", () => {
		const custom = resolveControlConfig(undefined, {
			needsAttentionAfterMs: 1234,
			activeNoticeAfterMs: 2345,
			activeNoticeAfterTurns: 7,
			activeNoticeAfterTokens: 8000,
			failedToolAttemptsBeforeAttention: 4,
			notifyOn: ["active_long_running", "needs_attention", "nope" as never],
			notifyChannels: ["event", "intercom", "bad" as never],
		});
		assert.equal(custom.needsAttentionAfterMs, 1234);
		assert.equal(custom.activeNoticeAfterMs, 2345);
		assert.equal(custom.activeNoticeAfterTurns, 7);
		assert.equal(custom.activeNoticeAfterTokens, 8000);
		assert.equal(custom.failedToolAttemptsBeforeAttention, 4);
		assert.deepEqual(custom.notifyOn, ["needs_attention"]);
		assert.deepEqual(custom.notifyChannels, ["event", "intercom"]);
	});

	it("falls back to defaults for invalid non-empty notification arrays", () => {
		const custom = resolveControlConfig(undefined, {
			notifyOn: ["bogus" as never],
			notifyChannels: ["bogus" as never],
		});
		assert.deepEqual(custom.notifyOn, ["needs_attention"]);
		assert.deepEqual(custom.notifyChannels, ["event", "async", "intercom"]);
	});

	it("allows empty notification arrays to disable notifications", () => {
		const custom = resolveControlConfig(undefined, {
			notifyOn: [],
			notifyChannels: [],
		});
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker" });
		assert.deepEqual(custom.notifyOn, []);
		assert.deepEqual(custom.notifyChannels, []);
		assert.equal(shouldNotifyControlEvent(custom, event), false);
	});

	it("formats control notices with a proactive hint and concrete commands", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "78f659a3", agent: "worker" });

		const message = formatControlNoticeMessage(event, "subagent-worker-78f659a3");

		assert.match(message, /Subagent needs attention: worker/);
		assert.match(message, /Hint: Inspect status first unless the run is clearly blocked/);
		assert.match(message, /Live async nudges interrupt the child before sending the follow-up/);
		assert.match(message, /Nudge: subagent\(\{ action: "resume", id: "78f659a3", message: "What are you blocked on\?/);
		assert.match(message, /Direct intercom target: subagent-worker-78f659a3/);
		assert.match(message, /Status: subagent\(\{ action: "status", id: "78f659a3" \}\)/);
		assert.match(message, /Interrupt: subagent\(\{ action: "interrupt", id: "78f659a3" \}\)/);
		assert.doesNotMatch(message, /Wait:/);
	});

	it("formats terminal completion guard notices without live-run commands", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "78f659a3",
			agent: "worker",
			index: 0,
			message: "worker completed without making edits for an implementation task",
			reason: "completion_guard",
		});

		const message = formatControlNoticeMessage(event, "subagent-worker-78f659a3-1");

		assert.match(message, /Subagent failed: worker/);
		assert.match(message, /read the output artifact or session/);
		assert.match(message, /Run intercom target \(may be inactive\): subagent-worker-78f659a3-1/);
		assert.doesNotMatch(message, /Status:/);
		assert.doesNotMatch(message, /Interrupt:/);
		assert.doesNotMatch(message, /What are you blocked on/);
	});

	it("formats intercom notifications with the same control commands", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "78f659a3", agent: "worker" });

		const message = formatControlIntercomMessage(event, "subagent-worker-78f659a3");

		assert.match(message, /worker needs attention in run 78f659a3/);
		assert.match(message, /Nudge: subagent\(\{ action: "resume", id: "78f659a3", message: "What are you blocked on\?/);
	});

	it("dedupes notifications once per child target and attention state", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker", index: 0 });
		const seen = new Set<string>();

		assert.equal(controlNotificationKey(event, "subagent-worker-run-1-1"), "subagent-worker-run-1-1:needs_attention:idle");
		assert.equal(claimControlNotification(resolveControlConfig(), event, seen, "subagent-worker-run-1-1"), true);
		assert.equal(claimControlNotification(resolveControlConfig(), event, seen, "subagent-worker-run-1-1"), false);

		const terminalEvent = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			index: 0,
			message: "worker completed without making edits for an implementation task",
			reason: "completion_guard",
		});
		assert.equal(claimControlNotification(resolveControlConfig(), terminalEvent, seen, "subagent-worker-run-1-1"), true);
	});
});
