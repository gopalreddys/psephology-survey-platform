import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(path.join(here, "call-operations.repository.js"), "utf8");
assert.match(repository, /campaigner_user_id/);
assert.match(repository, /interaction_transcript/);
assert.match(repository, /hierarchyPromise/);
assert.match(repository, /GROUP BY campaign\.id[\s\S]*iteration\.id[\s\S]*run\.id/);
assert.match(repository, /RIGHT\(COALESCE\(voter\.phone_number/);
assert.doesNotMatch(repository, /voter\.phone_number AS phone/);

const fixture = mkdtempSync(path.join(tmpdir(), "call-operations-"));
try {
  mkdirSync(path.join(fixture, "src"), { recursive: true });
  const serverPath = path.join(fixture, "src/server.js");
  writeFileSync(serverPath, ['import votersRoutes from "./routes/voters.routes.js";', 'app.use("/api", votersRoutes);'].join("\n"));
  execFileSync(process.execPath, [path.join(here, "install-call-operations.js"), fixture]);
  const installed = readFileSync(serverPath, "utf8");
  assert.match(installed, /CALL_OPERATIONS_WORKSPACE_V1/);
  assert.match(installed, /callOperationsRoutes/);
  execFileSync(process.execPath, [path.join(here, "install-call-operations.js"), fixture]);
  assert.equal(readFileSync(serverPath, "utf8"), installed);
} finally { rmSync(fixture, { recursive: true, force: true }); }

console.log("Call Operations installer and privacy tests passed.");
