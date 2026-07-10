import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpm(args: string[], cwd: string): string {
	const result = spawnSync(npm, args, { cwd, encoding: "utf-8" });
	assert.equal(result.status, 0, `${npm} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
	return result.stdout;
}

test("packed artifact installs jiti CLI for detached TypeScript runners", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-packed-"));
	try {
		const packOutput = runNpm(["pack", "--json", "--pack-destination", tempDir], projectRoot);
		const pack = JSON.parse(packOutput) as Array<{ filename?: string }>;
		const tarballName = pack[0]?.filename;
		assert.ok(tarballName, "npm pack did not report a tarball filename");
		const tarball = path.join(tempDir, tarballName);
		assert.equal(fs.existsSync(tarball), true);

		const installDir = path.join(tempDir, "install");
		fs.mkdirSync(installDir);
		runNpm(["install", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--legacy-peer-deps", tarball], installDir);
		assert.equal(fs.existsSync(path.join(installDir, "node_modules", "jiti", "lib", "jiti-cli.mjs")), true);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
