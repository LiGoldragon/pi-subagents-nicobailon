import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentConfig } from "../../src/agents/agents.ts";
import {
	authorizeProjectRoleDispatch,
	discoverRootManagerPolicy,
	parseProjectRoleMetadata,
	parseProjectRoleMetadataEnvironment,
	serializeProjectRoleMetadata,
	visibleProjectRoles,
	type CallerRolePolicy,
} from "../../src/agents/project-role-policy.ts";

function role(name: string, dispatchKind: "manager" | "nested" | "leaf", children: string[] = [], disabled = false): AgentConfig {
	return {
		name,
		description: name,
		systemPrompt: "",
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/project/${name}.md`,
		disabled,
		projectRole: { version: 1, projectRoleIdentity: name, projectRoleDispatchKind: dispatchKind, allowedChildRoleNames: children },
	};
}

function policy(agent: AgentConfig): CallerRolePolicy {
	return { metadata: agent.projectRole!, source: "environment" };
}

describe("generated project role metadata", () => {
	it("round-trips the versioned generated frontmatter contract", () => {
		const metadata = parseProjectRoleMetadata({
			projectRoleIdentity: "project.planner",
			projectRoleDispatchKind: "nested",
			allowedChildRoleNames: "project.reader, project.writer",
		}, "project.planner");
		assert.deepEqual(metadata, {
			version: 1,
			projectRoleIdentity: "project.planner",
			projectRoleDispatchKind: "nested",
			allowedChildRoleNames: ["project.reader", "project.writer"],
		});
		assert.deepEqual(parseProjectRoleMetadataEnvironment(serializeProjectRoleMetadata(metadata!)), metadata);
	});

	it("rejects incomplete and mismatched nested-role metadata", () => {
		assert.throws(() => parseProjectRoleMetadata({ projectRoleIdentity: "other", projectRoleDispatchKind: "leaf" }, "leaf"), /exactly equal/);
		assert.throws(() => parseProjectRoleMetadata({ projectRoleIdentity: "nested", projectRoleDispatchKind: "nested" }, "nested"), /must declare allowedChildRoleNames/);
		assert.equal(parseProjectRoleMetadataEnvironment("{bad json}"), undefined);
	});
});

describe("caller-aware generated project role authorization", () => {
	const manager = role("Manager", "manager");
	const nested = role("Planner", "nested", ["Reader", "Planner"]);
	const leaf = role("Reader", "leaf");
	const secondLeaf = role("Writer", "leaf");
	const disabledLeaf = role("Disabled", "leaf", [], true);
	const builtinLike: AgentConfig = { ...role("Builtin", "leaf"), source: "builtin" };
	const agents = [manager, nested, leaf, secondLeaf, disabledLeaf, builtinLike];

	it("covers manager, nested, and leaf authorization matrix", () => {
		assert.equal(authorizeProjectRoleDispatch({ caller: policy(manager), agents, targetNames: ["Planner", "Reader"], hasPerCallModelOverride: false }), undefined);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(manager), agents, targetNames: ["Manager"], hasPerCallModelOverride: false }) ?? "", /cannot be dispatched/);
		assert.equal(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Reader"], hasPerCallModelOverride: false }), undefined);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Planner"], hasPerCallModelOverride: false }) ?? "", /only leaf roles/);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Writer"], hasPerCallModelOverride: false }) ?? "", /not allowed/);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(leaf), agents, targetNames: ["Reader"], hasPerCallModelOverride: false }) ?? "", /cannot dispatch/);
	});

	it("fails closed for a managed session without generated policy while retaining non-managed compatibility", () => {
		assert.equal(authorizeProjectRoleDispatch({ caller: undefined, agents: [{ ...leaf, source: "user" }], targetNames: ["legacy"], hasPerCallModelOverride: false }), undefined);
		assert.equal(authorizeProjectRoleDispatch({ caller: undefined, agents: [nested, leaf], targetNames: ["Reader"], hasPerCallModelOverride: false }), undefined);
		assert.match(authorizeProjectRoleDispatch({ caller: undefined, agents: [], targetNames: ["legacy"], hasPerCallModelOverride: false, policyConfig: { required: true, allowLegacyNonProject: true } }) ?? "", /required/);
	});

	it("atomically accepts every allowed attach target and rejects any forbidden target", () => {
		assert.equal(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Reader", "Reader"], hasPerCallModelOverride: false }), undefined);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Reader", "Planner"], hasPerCallModelOverride: false }) ?? "", /only leaf roles/);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Reader", "Builtin"], hasPerCallModelOverride: false }) ?? "", /not a generated project role/);
		assert.match(authorizeProjectRoleDispatch({ caller: policy(nested), agents, targetNames: ["Reader"], hasPerCallModelOverride: true }) ?? "", /model overrides/);
	});

	it("rejects disabled, built-in, unknown, and per-call-model targets before launch", () => {
		for (const target of ["Disabled", "Builtin", "Unknown"]) {
			assert.ok(authorizeProjectRoleDispatch({ caller: policy(manager), agents, targetNames: [target], hasPerCallModelOverride: false }), target);
		}
		assert.match(authorizeProjectRoleDispatch({ caller: policy(manager), agents, targetNames: ["Reader"], hasPerCallModelOverride: true }) ?? "", /model overrides/);
	});

	it("lists only roles visible to the frozen caller policy", () => {
		assert.deepEqual(visibleProjectRoles(policy(manager), agents).map((agent) => agent.name), ["Planner", "Reader", "Writer"]);
		assert.deepEqual(visibleProjectRoles(policy(nested), agents).map((agent) => agent.name), ["Reader"]);
		assert.deepEqual(visibleProjectRoles(policy(leaf), agents), []);
		assert.equal(discoverRootManagerPolicy(agents)?.metadata.projectRoleIdentity, "Manager");
	});
});
