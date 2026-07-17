import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionConfig } from "../shared/types.ts";
import { getAgentDir } from "../shared/utils.ts";

export function getConfigPath(): string {
	return path.join(getAgentDir(), "extensions", "subagent", "config.json");
}

function readConfigForUpdate(configPath = getConfigPath()): ExtensionConfig {
	if (!fs.existsSync(configPath)) return {};
	const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Subagent config at '${configPath}' must be a JSON object`);
	}
	const config = parsed as ExtensionConfig;
	if (config.projectRolePolicy !== undefined) {
		const policy = config.projectRolePolicy;
		if (!policy || typeof policy !== "object" || Array.isArray(policy)
			|| (policy.required !== undefined && typeof policy.required !== "boolean")
			|| (policy.allowLegacyNonProject !== undefined && typeof policy.allowLegacyNonProject !== "boolean")) {
			throw new Error(`Subagent config at '${configPath}' has invalid projectRolePolicy; required and allowLegacyNonProject must be booleans.`);
		}
	}
	return config;
}

export function saveConfig(config: ExtensionConfig, configPath = getConfigPath()): void {
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf-8");
}

export function updateConfig(updater: (config: ExtensionConfig) => ExtensionConfig): ExtensionConfig {
	const configPath = getConfigPath();
	const next = updater(readConfigForUpdate(configPath));
	saveConfig(next, configPath);
	return next;
}

export function loadConfig(): ExtensionConfig {
	const configPath = getConfigPath();
	try {
		return readConfigForUpdate(configPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Failed to load subagent config from '${configPath}':`, error);
		return { projectRolePolicy: { required: true, configurationError: message } };
	}
}
