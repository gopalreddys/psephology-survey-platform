import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validateQuickAddInput } from "./demo-voter-quick-add.validation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = {
  fullName: "  Demo  Participant ",
  phoneNumber: "+91 98765 43210",
  geoUnitId: "5410403e-d257-4389-8c47-fba6ac31c666",
  preferredLanguage: "Telugu",
  consentConfirmed: true
};

const parsed = validateQuickAddInput(base);
assert.equal(parsed.fullName, "Demo Participant");
assert.equal(parsed.phoneNumber, "9876543210");
assert.equal(parsed.age, null);
assert.equal(parsed.gender, null);

for (const [change, code] of [
  [{ consentConfirmed: false }, "CONSENT_REQUIRED"],
  [{ phoneNumber: "123" }, "PHONE_INVALID"],
  [{ geoUnitId: "Serilingampally" }, "GEOGRAPHY_REQUIRED"],
  [{ age: "17" }, "AGE_INVALID"],
  [{ gender: "UNKNOWN" }, "GENDER_INVALID"]
]) {
  assert.throws(() => validateQuickAddInput({ ...base, ...change }), {
    code
  });
}

const fixture = mkdtempSync(path.join(tmpdir(), "quick-demo-voter-"));
try {
  mkdirSync(path.join(fixture, "src"), { recursive: true });
  const serverPath = path.join(fixture, "src/server.js");
  writeFileSync(serverPath, [
    'import votersRoutes from "./routes/voters.routes.js";',
    'app.use("/api", votersRoutes);'
  ].join("\n"));
  execFileSync(process.execPath, [path.join(here, "install-demo-voter-quick-add.js"), fixture]);
  const installed = readFileSync(serverPath, "utf8");
  assert.match(installed, /demoVoterQuickAddRoutes/);
  assert.match(installed, /DEMO_VOTER_QUICK_ADD_V1/);
  execFileSync(process.execPath, [path.join(here, "install-demo-voter-quick-add.js"), fixture]);
  assert.equal(readFileSync(serverPath, "utf8"), installed);
  assert.match(readFileSync(path.join(fixture, "src/repositories/demo-voter-quick-add.validation.js"), "utf8"), /CONSENT_REQUIRED/);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("Demo voter quick-add validation and installer tests passed.");
