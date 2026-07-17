import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	buildSubagentToolDescription,
	COMPACT_SUBAGENT_TOOL_DESCRIPTION,
	FULL_SUBAGENT_TOOL_DESCRIPTION,
	SUBAGENT_SAFETY_GUIDANCE,
} from "../../src/extension/tool-description.ts";

describe("preference-adapted tool disclosure", () => {
	it("defaults to a direct launch surface with optional list backup", () => {
		const description = buildSubagentToolDescription();
		assert.equal(description, COMPACT_SUBAGENT_TOOL_DESCRIPTION);
		assert.match(description, /DIRECT LAUNCH/);
		assert.match(description, /Do not list first/);
		assert.match(description, /action: "list"/);
		assert.match(description, /optional backup/i);
		assert.match(description, /normally discoverable available agents/i);
		assert.match(description, /does not authorize or restrict runtime operations/i);
		assert.match(description, /Omitting async means true\/background/);
		assert.doesNotMatch(description, /async\?: false/);
		assert.doesNotMatch(description, /CHAIN:/);
		assert.doesNotMatch(description, /schedule-list/);
		assert.doesNotMatch(description, /action: "status"/);
		assert.ok(description.length < FULL_SUBAGENT_TOOL_DESCRIPTION.length / 3);
	});

	it("retains the full optional operational surface", () => {
		const description = buildSubagentToolDescription({ toolDescriptionMode: "full" });
		for (const needle of ["CHAIN", "schedule-list", "watchdog.configure", "append-step", "action: \"status\""]) {
			assert.match(description, new RegExp(needle));
		}
		assert.match(description, /list is optional/i);
		assert.doesNotMatch(description, /Manager role.*Orchestrator/i);
	});

	it("keeps direct-launch guidance in custom descriptions", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-custom-description-"));
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-custom-description-agent-"));
		try {
			fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
			fs.writeFileSync(path.join(cwd, ".pi", "subagent-tool-description.md"), "Custom launch guidance.", "utf8");
			const description = buildSubagentToolDescription({ toolDescriptionMode: "custom" }, { cwd, agentDir });
			assert.match(description, /Custom launch guidance/);
			assert.ok(description.endsWith(SUBAGENT_SAFETY_GUIDANCE));
			assert.match(description, /Launch a discovered agent directly/i);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
			fs.rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
