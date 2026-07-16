import type { AgentConfig } from "./agents.ts";
import type { ProjectRolePolicyConfig } from "../shared/types.ts";

/** Metadata emitted by the skills generator for a project-owned role. */
export interface ProjectRoleMetadata {
	version: 1;
	projectRoleIdentity: string;
	projectRoleDispatchKind: "manager" | "nested" | "leaf";
	allowedChildRoleNames: string[];
}

export interface CallerRolePolicy {
	metadata: ProjectRoleMetadata;
	source: "environment" | "discovery";
}

export const PROJECT_ROLE_METADATA_ENV = "PI_SUBAGENT_PROJECT_ROLE_METADATA";

function splitRoleNames(value: string | undefined): string[] {
	if (!value?.trim()) return [];
	return [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
}

/**
 * Parses the generated frontmatter contract. A nested role must declare the
 * complete, exact child set; manager and leaf roles must not carry children.
 */
export function parseProjectRoleMetadata(frontmatter: Record<string, string>, runtimeName: string): ProjectRoleMetadata | undefined {
	const identity = frontmatter.projectRoleIdentity?.trim();
	const dispatchKind = frontmatter.projectRoleDispatchKind?.trim();
	const hasRoleField = identity !== undefined || dispatchKind !== undefined || frontmatter.allowedChildRoleNames !== undefined;
	if (!hasRoleField) return undefined;
	if (!identity || identity !== runtimeName) {
		throw new Error(`Agent '${runtimeName}' has invalid project role metadata; projectRoleIdentity must exactly equal its runtime name.`);
	}
	if (dispatchKind !== "manager" && dispatchKind !== "nested" && dispatchKind !== "leaf") {
		throw new Error(`Agent '${runtimeName}' has invalid projectRoleDispatchKind; expected manager, nested, or leaf.`);
	}
	const allowedChildRoleNames = splitRoleNames(frontmatter.allowedChildRoleNames);
	if (dispatchKind === "nested" && frontmatter.allowedChildRoleNames === undefined) {
		throw new Error(`Nested project role '${runtimeName}' must declare allowedChildRoleNames, including an empty exact set when appropriate.`);
	}
	if (dispatchKind !== "nested" && allowedChildRoleNames.length > 0) {
		throw new Error(`Project role '${runtimeName}' may declare allowedChildRoleNames only when projectRoleDispatchKind is nested.`);
	}
	return { version: 1, projectRoleIdentity: identity, projectRoleDispatchKind: dispatchKind, allowedChildRoleNames };
}

export function serializeProjectRoleMetadata(metadata: ProjectRoleMetadata): string {
	return JSON.stringify(metadata);
}

export function parseProjectRoleMetadataEnvironment(value = process.env[PROJECT_ROLE_METADATA_ENV]): ProjectRoleMetadata | undefined {
	if (!value?.trim()) return undefined;
	try {
		const parsed = JSON.parse(value) as Partial<ProjectRoleMetadata>;
		if (parsed.version !== 1 || typeof parsed.projectRoleIdentity !== "string" || !parsed.projectRoleIdentity.trim()
			|| (parsed.projectRoleDispatchKind !== "manager" && parsed.projectRoleDispatchKind !== "nested" && parsed.projectRoleDispatchKind !== "leaf")
			|| !Array.isArray(parsed.allowedChildRoleNames) || parsed.allowedChildRoleNames.some((name) => typeof name !== "string" || !name.trim())) {
			return undefined;
		}
		return {
			version: 1,
			projectRoleIdentity: parsed.projectRoleIdentity,
			projectRoleDispatchKind: parsed.projectRoleDispatchKind,
			allowedChildRoleNames: [...new Set(parsed.allowedChildRoleNames)],
		};
	} catch {
		return undefined;
	}
}

export function visibleProjectRoles(caller: CallerRolePolicy, agents: AgentConfig[]): AgentConfig[] {
	return agents.filter((agent) => {
		if (agent.source !== "project" || agent.disabled || !agent.projectRole) return false;
		if (caller.metadata.projectRoleDispatchKind === "manager") return agent.projectRole.projectRoleDispatchKind !== "manager";
		if (caller.metadata.projectRoleDispatchKind === "nested") {
			return caller.metadata.allowedChildRoleNames.includes(agent.name) && agent.projectRole.projectRoleDispatchKind === "leaf";
		}
		return false;
	});
}

export function discoverRootManagerPolicy(agents: AgentConfig[]): CallerRolePolicy | undefined {
	const managers = agents.filter((agent) => agent.source === "project" && !agent.disabled && agent.projectRole?.projectRoleDispatchKind === "manager");
	if (managers.length !== 1) return undefined;
	return { metadata: managers[0]!.projectRole!, source: "discovery" };
}

function targetRole(agents: AgentConfig[], name: string): { agent?: AgentConfig; error?: string } {
	const agent = agents.find((candidate) => candidate.name === name);
	if (!agent) return { error: `Unknown project role: ${name}` };
	if (agent.disabled) return { error: `Project role '${name}' is disabled.` };
	if (agent.source !== "project" || !agent.projectRole) return { error: `Target '${name}' is not a generated project role.` };
	return { agent };
}

/** Validates every requested child before execution allocates state or starts one. */
export function authorizeProjectRoleDispatch(input: {
	caller: CallerRolePolicy | undefined;
	agents: AgentConfig[];
	targetNames: string[];
	hasPerCallModelOverride: boolean;
	policyConfig?: ProjectRolePolicyConfig;
}): string | undefined {
	if (!input.caller) {
		if (input.policyConfig?.required === true) {
			return "Generated project-role policy is required, but this session has missing or malformed generated role metadata.";
		}
		// Only a managed deployment can identify project agents as generated.
		// Ordinary project agent files retain upstream-compatible behavior until
		// that deployment opts into required policy enforcement.
		return undefined;
	}
	if (input.hasPerCallModelOverride) return "Generated project roles use their generated effective model; per-call model overrides are not allowed.";
	for (const targetName of input.targetNames) {
		const target = targetRole(input.agents, targetName);
		if (target.error) return target.error;
		const targetMetadata = target.agent!.projectRole!;
		if (input.caller.metadata.projectRoleDispatchKind === "leaf") {
			return `Leaf project role '${input.caller.metadata.projectRoleIdentity}' cannot dispatch subagents.`;
		}
		if (input.caller.metadata.projectRoleDispatchKind === "manager") {
			if (targetMetadata.projectRoleDispatchKind === "manager") return `Manager project role '${targetName}' cannot be dispatched.`;
			continue;
		}
		if (!input.caller.metadata.allowedChildRoleNames.includes(targetName)) {
			return `Nested project role '${input.caller.metadata.projectRoleIdentity}' is not allowed to dispatch '${targetName}'.`;
		}
		if (targetMetadata.projectRoleDispatchKind !== "leaf") {
			return `Nested project role '${input.caller.metadata.projectRoleIdentity}' may dispatch only leaf roles; '${targetName}' is ${targetMetadata.projectRoleDispatchKind}.`;
		}
	}
	return undefined;
}
