import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = mkdtempSync(path.join(tmpdir(), "voter-electorate-"));

try {
  execFileSync(process.execPath, [
    path.join(here, "install-voter-electorate-model.js"),
    fixture
  ]);
  assert(existsSync(path.join(fixture, "sql/023_voter_electorate_model.sql")));
  assert(existsSync(path.join(fixture, "src/db/migrate-voter-electorate-model.js")));
  const sql = readFileSync(
    path.join(fixture, "sql/023_voter_electorate_model.sql"),
    "utf8"
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS voter_identifiers/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS voter_electorate_registrations/);
  assert.match(sql, /ALTER COLUMN epic_number DROP NOT NULL/);
  assert.match(sql, /voter_is_eligible_for_campaign/);
  assert.match(sql, /MLC_GRADUATES/);
  assert.match(sql, /LOCAL_BODY_ROLL/);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("Voter electorate model installer test passed.");
