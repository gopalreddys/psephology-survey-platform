import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "psephology-baseline-archive-test-"));
try {
  const source = path.join(tempRoot, "baseline.json");
  const archive = path.join(tempRoot, "archive");
  const report = {
    reportVersion: 1,
    generatedAt: "2026-09-15T00:00:00.000Z",
    campaign: { id: "3d1badb2-c8fc-4cc2-9234-7d594e9bc407" },
    status: "PASS_WITH_WARNINGS"
  };
  const content = `${JSON.stringify(report)}\n`;
  await writeFile(source, content, { mode: 0o600 });
  execFileSync(process.execPath, [path.join(packageRoot, "archive-demo-release-baseline.js"), source, archive]);
  const destination = path.join(archive, `${report.campaign.id}-2026-09-15T00-00-00.000Z.json`);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.equal((await stat(archive)).mode & 0o777, 0o700);
  assert.equal(createHash("sha256").update(await readFile(destination)).digest("hex"),
    createHash("sha256").update(content).digest("hex"));
  assert.throws(() => execFileSync(process.execPath,
    [path.join(packageRoot, "archive-demo-release-baseline.js"), source, archive],
    { stdio: "ignore" }));
  console.log("Demo baseline archive tests passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
