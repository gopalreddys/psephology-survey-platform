import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateIdentifier, validateRegistration } from "./voter-electorate.validation.js";
import { patchOutboundClient } from "../outbound-consent/patch-outbound-client.mjs";

const identifier = validateIdentifier({
  identifierType: "mlc_graduate_roll",
  identifierValue: " GR-2026-42 ",
  isPrimary: true
});
assert.equal(identifier.identifierType, "MLC_GRADUATE_ROLL");
assert.equal(identifier.identifierValue, "GR-2026-42");

const registration = validateRegistration({
  electorateType: "MLC_GRADUATES",
  jurisdictionId: "5410403e-d257-4389-8c47-fba6ac31c666",
  rollIdentifierId: "8f88caf7-e820-4c87-93af-c064cf1b5128",
  verified: true
});
assert.equal(registration.targetType, "MLC");
assert.equal(registration.expectedIdentifierType, "MLC_GRADUATE_ROLL");
assert.throws(() => validateRegistration({ electorateType: "ASSEMBLY", verified: true }), {
  code: "JURISDICTION_REQUIRED"
});
assert.throws(() => validateRegistration({
  electorateType: "LOCAL_BODY",
  targetType: "MLA",
  localBodyId: "x",
  rollIdentifierId: "y",
  verified: true
}), { code: "TARGET_TYPE_INVALID" });

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = mkdtempSync(path.join(tmpdir(), "voter-electorate-management-"));
try {
  mkdirSync(path.join(fixture, "src"), { recursive: true });
  const serverPath = path.join(fixture, "src/server.js");
  writeFileSync(serverPath, [
    'import votersRoutes from "./routes/voters.routes.js";',
    'app.use("/api", votersRoutes);'
  ].join("\n"));
  const beforePrerequisites = readFileSync(serverPath, "utf8");
  assert.throws(() => execFileSync(process.execPath, [path.join(here, "install-voter-electorate-management.js"), fixture], {
    stdio: ["ignore", "pipe", "pipe"]
  }), error => /coordinated outbound-consent installer and 035 migration/.test(String(error.stderr)));
  assert.equal(readFileSync(serverPath, "utf8"), beforePrerequisites);
  assert.deepEqual(readdirSync(path.join(fixture, "src")), ["server.js"], "Consent preflight rejects the legacy installer before any partial feature directories or files are created");
  // Explicit provider-free installed consent artifacts; their presence does
  // not claim that a production database migration has been executed.
  for (const directory of ["src/repositories", "src/clients", "sql"]) mkdirSync(path.join(fixture, directory), { recursive: true });
  writeFileSync(path.join(fixture, "src/repositories/outbound-consent.repository.js"),
    readFileSync(new URL("../outbound-consent/outbound-consent.repository.js", import.meta.url)));
  writeFileSync(path.join(fixture, "sql/035_outbound_contact_suppression.sql"),
    readFileSync(new URL("../outbound-consent/035_outbound_contact_suppression.sql", import.meta.url)));
  writeFileSync(path.join(fixture, "src/clients/sarvam.js"), patchOutboundClient(
    "export async function createInstantOutboundCall(options) { return options; }\n"
  ));
  execFileSync(process.execPath, [path.join(here, "install-voter-electorate-management.js"), fixture]);
  const installed = readFileSync(serverPath, "utf8");
  assert.match(installed, /VOTER_ELECTORATE_MANAGEMENT_V1/);
  assert.match(installed, /voterElectorateRoutes/);
  assert.match(
    readFileSync(path.join(fixture, "src/repositories/campaign-voter-selection.repository.js"), "utf8"),
    /voter_is_eligible_for_campaign/
  );
  execFileSync(process.execPath, [path.join(here, "install-voter-electorate-management.js"), fixture]);
  assert.equal(readFileSync(serverPath, "utf8"), installed);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("Voter electorate management validation and installer tests passed.");
