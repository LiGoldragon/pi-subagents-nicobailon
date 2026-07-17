import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { handleList } from "../../src/agents/agent-management.ts";

function text(result: { content: Array<{ text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

describe("generated project role inventory", () => {
	it("filters Manager diagnostics to generated visible roles and omits generic workflow suggestions", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-role-list-"));
		try {
			const agents = path.join(cwd, ".pi", "agents");
			fs.mkdirSync(agents, { recursive: true });
			for (const [name, kind, children] of [["Manager", "manager", ""], ["Planner", "nested", "Reader"], ["Reader", "leaf", ""]] as const) {
				fs.writeFileSync(path.join(agents, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\nprojectRoleIdentity: ${name}\nprojectRoleDispatchKind: ${kind}${kind === "nested" ? `\nallowedChildRoleNames: ${children}` : ""}\n---\n\n${name}\n`);
			}
			const result = handleList({}, {
				cwd,
				modelRegistry: { getAvailable: () => [] },
				callerRolePolicy: { source: "environment", metadata: { version: 1, projectRoleIdentity: "Manager", projectRoleDispatchKind: "manager", allowedChildRoleNames: [] } },
			});
			assert.match(text(result), /- Planner \(project\): Planner/);
			assert.match(text(result), /- Reader \(project\): Reader/);
			assert.doesNotMatch(text(result), /Manager \(project\)/);
			assert.doesNotMatch(text(result), /Proactive skill subagent suggestions/);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("filters nested recovery inventory to declared leaf roles without exposing Manager", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-role-list-nested-"));
		try {
			const agents = path.join(cwd, ".pi", "agents");
			fs.mkdirSync(agents, { recursive: true });
			for (const [name, kind, children] of [["Manager", "manager", ""], ["Planner", "nested", "Reader"], ["Reader", "leaf", ""], ["Writer", "leaf", ""]] as const) {
				fs.writeFileSync(path.join(agents, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\nprojectRoleIdentity: ${name}\nprojectRoleDispatchKind: ${kind}${kind === "nested" ? `\nallowedChildRoleNames: ${children}` : ""}\n---\n\n${name}\n`);
			}
			const result = handleList({}, {
				cwd,
				modelRegistry: { getAvailable: () => [] },
				callerRolePolicy: { source: "environment", metadata: { version: 1, projectRoleIdentity: "Planner", projectRoleDispatchKind: "nested", allowedChildRoleNames: ["Reader"] } },
			});
			assert.match(text(result), /- Reader \(project\): Reader/);
			assert.doesNotMatch(text(result), /Manager \(project\)|Writer \(project\)/);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
