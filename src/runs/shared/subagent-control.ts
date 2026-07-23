import {
	type ActivityState,
	type ControlConfig,
	type ControlEvent,
	type ControlEventType,
	type ControlNotificationChannel,
	type ResolvedControlConfig,
} from "../../shared/types.ts";

const CONTROL_EVENT_TYPES: ControlEventType[] = ["needs_attention"];
const CONTROL_NOTIFICATION_CHANNELS: ControlNotificationChannel[] = ["event", "async", "intercom"];
const DEFAULT_NOTIFY_ON: ControlEventType[] = ["needs_attention"];

export const DEFAULT_CONTROL_CONFIG: ResolvedControlConfig = {
	enabled: true,
	failedToolAttemptsBeforeAttention: 3,
	notifyOn: DEFAULT_NOTIFY_ON,
	notifyChannels: CONTROL_NOTIFICATION_CHANNELS,
};

function parsePositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number") return undefined;
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return undefined;
	return value;
}

function parseControlList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
	if (!Array.isArray(value)) return undefined;
	if (value.length === 0) return [];
	const allowedSet = new Set(allowed);
	const parsed = value.filter((entry): entry is T => typeof entry === "string" && allowedSet.has(entry as T));
	return parsed.length > 0 ? Array.from(new Set(parsed)) : undefined;
}

export function resolveControlConfig(
	globalConfig?: ControlConfig,
	override?: ControlConfig,
): ResolvedControlConfig {
	const enabled = override?.enabled ?? globalConfig?.enabled ?? DEFAULT_CONTROL_CONFIG.enabled;
	const failedToolAttemptsBeforeAttention = parsePositiveInt(override?.failedToolAttemptsBeforeAttention)
		?? parsePositiveInt(globalConfig?.failedToolAttemptsBeforeAttention)
		?? DEFAULT_CONTROL_CONFIG.failedToolAttemptsBeforeAttention;
	const notifyOn = parseControlList(override?.notifyOn, CONTROL_EVENT_TYPES)
		?? parseControlList(globalConfig?.notifyOn, CONTROL_EVENT_TYPES)
		?? DEFAULT_CONTROL_CONFIG.notifyOn;
	const notifyChannels = parseControlList(override?.notifyChannels, CONTROL_NOTIFICATION_CHANNELS)
		?? parseControlList(globalConfig?.notifyChannels, CONTROL_NOTIFICATION_CHANNELS)
		?? DEFAULT_CONTROL_CONFIG.notifyChannels;
	return {
		enabled,
		failedToolAttemptsBeforeAttention,
		notifyOn: [...notifyOn],
		notifyChannels: [...notifyChannels],
	};
}

export function buildControlEvent(input: {
	type?: ControlEventType;
	from?: ActivityState;
	to: ActivityState;
	runId: string;
	agent: string;
	index?: number;
	ts?: number;
	message?: string;
	reason?: ControlEvent["reason"];
	turns?: number;
	tokens?: number;
	toolCount?: number;
	currentTool?: string;
	currentPath?: string;
	recentFailureSummary?: string;
}): ControlEvent {
	const type = input.type ?? "needs_attention";
	const message = input.message ?? `${input.agent} needs attention`;
	return {
		type,
		...(input.from ? { from: input.from } : {}),
		to: input.to,
		ts: input.ts ?? Date.now(),
		runId: input.runId,
		agent: input.agent,
		...(input.index !== undefined ? { index: input.index } : {}),
		message,
		...(input.reason ? { reason: input.reason } : {}),
		...(input.turns !== undefined ? { turns: input.turns } : {}),
		...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
		...(input.toolCount !== undefined ? { toolCount: input.toolCount } : {}),
		...(input.currentTool ? { currentTool: input.currentTool } : {}),
		...(input.currentPath ? { currentPath: input.currentPath } : {}),
		...(input.recentFailureSummary ? { recentFailureSummary: input.recentFailureSummary } : {}),
	};
}

export function shouldNotifyControlEvent(config: ResolvedControlConfig, event: ControlEvent): boolean {
	return config.enabled && config.notifyOn.includes(event.type);
}

export function controlNotificationKey(event: ControlEvent, childIntercomTarget?: string): string {
	const childKey = childIntercomTarget ?? (event.index !== undefined ? `${event.runId}:${event.index}` : event.runId);
	return `${childKey}:${event.type}:${event.reason ?? "attention"}`;
}

export function claimControlNotification(config: ResolvedControlConfig, event: ControlEvent, seenKeys: Set<string>, childIntercomTarget?: string): boolean {
	if (!shouldNotifyControlEvent(config, event)) return false;
	const key = controlNotificationKey(event, childIntercomTarget);
	if (seenKeys.has(key)) return false;
	seenKeys.add(key);
	return true;
}

export function formatControlNoticeMessage(event: ControlEvent, childIntercomTarget?: string): string {
	const runTarget = event.runId;
	if (event.reason === "completion_guard") {
		return [
			`Subagent failed: ${event.agent}`,
			`Run: ${runTarget}${event.index !== undefined ? ` step ${event.index + 1}` : ""}`,
			`Signal: ${event.message}`,
			"Next: read the output artifact or session from the subagent result, then retry with a more explicit implementation prompt or handle the fix directly.",
			childIntercomTarget ? `Run intercom target (may be inactive): ${childIntercomTarget}` : undefined,
		].filter((line): line is string => Boolean(line)).join("\n");
	}

	const nudgeMessage = "What are you blocked on? Reply with the smallest next step or ask for a decision.";
	const nudgeCommand = `subagent({ action: "resume", id: "${runTarget}", ${event.index !== undefined ? `index: ${event.index}, ` : ""}message: "${nudgeMessage}" })`;
	return [
		`Subagent needs attention: ${event.agent}`,
		`Run: ${runTarget}${event.index !== undefined ? ` step ${event.index + 1}` : ""}`,
		`Signal: ${event.message}`,
		event.recentFailureSummary ? `Recent failures: ${event.recentFailureSummary}` : undefined,
		"Hint: Inspect status first unless the run is clearly blocked. Live async nudges interrupt the child before sending the follow-up.",
		`Nudge: ${nudgeCommand}`,
		childIntercomTarget ? `Direct intercom target: ${childIntercomTarget}` : undefined,
		`Status: subagent({ action: "status", id: "${runTarget}" })`,
		`Interrupt: subagent({ action: "interrupt", id: "${runTarget}" })`,
	].filter((line): line is string => Boolean(line)).join("\n");
}

export function formatControlIntercomMessage(event: ControlEvent, childIntercomTarget?: string): string {
	const statusLabel = event.reason === "completion_guard" ? "subagent failed" : "subagent needs attention";
	return [
		statusLabel,
		"",
		event.reason === "completion_guard"
			? `${event.agent} failed in run ${event.runId}.`
			: `${event.agent} needs attention in run ${event.runId}.`,
		"",
		formatControlNoticeMessage(event, childIntercomTarget),
	].join("\n");
}
