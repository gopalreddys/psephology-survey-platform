import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./voice-agents.repository.js", import.meta.url), "utf8");
const body = source.replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const { areConfusableAgentNames, decorateIdentityConflicts } = new Function(
  "crypto",
  "getDb",
  "fetchSarvamDeployments",
  `${body}\nreturn { areConfusableAgentNames, decorateIdentityConflicts };`
)(crypto, async () => ({}), async () => []);

assert.equal(
  areConfusableAgentNames("Political_Agent_Base", "Plotical_Agent_Base"),
  true
);
assert.equal(
  areConfusableAgentNames("Political_Agent_Base", "Telangana Rural Male"),
  false
);

const common = {
  connection_id: "ee3407f4-85-8805a44f-a822",
  outbound_phone_number: "+918065356536",
  usage_category: "URBAN_FEMALE",
  is_enabled: true,
  is_current: true,
  is_selectable: true
};
const decorated = decorateIdentityConflicts([
  {
    ...common,
    id: "one",
    app_id: "Political-A-b26ad56c-c4ae",
    provider_name: "Political_Agent_Base"
  },
  {
    ...common,
    id: "two",
    app_id: "Plotical-Ag-2871fbcc-d029",
    provider_name: "Plotical_Agent_Base"
  },
  {
    ...common,
    id: "three",
    app_id: "Rural-Agent-1",
    provider_name: "Telangana Rural Male",
    usage_category: "RURAL_MALE"
  }
]);

assert.equal(decorated[0].identity_conflict, true);
assert.deepEqual(decorated[0].identity_conflict_app_ids, ["Plotical-Ag-2871fbcc-d029"]);
assert.equal(decorated[0].is_selectable, false);
assert.equal(decorated[1].identity_conflict, true);
assert.equal(decorated[2].identity_conflict, false);
assert.equal(decorated[2].is_selectable, true);

console.log("Voice-agent identity guard tests passed.");
