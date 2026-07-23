import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildControlEvent,
	claimControlNotification,
	controlNotificationKey,
	formatControlIntercomMessage,
	formatControlNoticeMessage,
	resolveControlConfig,
	shouldNotifyControlEvent,
} from "../../src/runs/shared/subagent-control.ts";

const config = resolveControlConfig();

describe("subagent control attention state", () => {
	it("has no time, silence, activity, or turn-threshold controls", () => {
		const control = resolveControlConfig(undefined, { failedToolAttemptsBeforeAttention: 4 });
		assert.deepEqual(control, {
			enabled: true,
			failedToolAttemptsBeforeAttention: 4,
			notifyOn: ["needs_attention"],
			notifyChannels: ["event", "async", "intercom"],
		});
	});

	it("builds attention events only from explicit callers, without timestamp-derived fields", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			index: 2,
			ts: 1_000,
			message: "worker needs attention after repeated mutating tool failures",
			reason: "tool_failures",
		});
		assert.deepEqual(event, {
			type: "needs_attention",
			to: "needs_attention",
			ts: 1_000,
			runId: "run-1",
			agent: "worker",
			index: 2,
			message: "worker needs attention after repeated mutating tool failures",
			reason: "tool_failures",
		});
	});

	it("only notifies explicit needs-attention events", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker", reason: "tool_failures" });
		assert.equal(shouldNotifyControlEvent(config, event), true);
		assert.deepEqual(config.notifyOn, ["needs_attention"]);
		assert.deepEqual(config.notifyChannels, ["event", "async", "intercom"]);
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
		const custom = resolveControlConfig(undefined, { notifyOn: [], notifyChannels: [] });
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker" });
		assert.deepEqual(custom.notifyOn, []);
		assert.deepEqual(custom.notifyChannels, []);
		assert.equal(shouldNotifyControlEvent(custom, event), false);
	});

	it("formats control notices with a proactive hint and concrete commands", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "78f659a3", agent: "worker", reason: "tool_failures" });
		const notice = formatControlNoticeMessage(event, "child-session");
		assert.match(notice, /Subagent needs attention: worker/);
		assert.match(notice, /Nudge: subagent/);
		assert.match(notice, /Direct intercom target: child-session/);
		assert.match(formatControlIntercomMessage(event), /subagent needs attention/);
	});

	it("dedupes notifications per child and explicit reason", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker", index: 0, reason: "tool_failures" });
		const seen = new Set<string>();
		assert.equal(claimControlNotification(config, event, seen, "subagent-worker-run-1-1"), true);
		assert.equal(claimControlNotification(config, event, seen, "subagent-worker-run-1-1"), false);
		assert.equal(controlNotificationKey(event, "subagent-worker-run-1-1"), "subagent-worker-run-1-1:needs_attention:tool_failures");
	});
});
