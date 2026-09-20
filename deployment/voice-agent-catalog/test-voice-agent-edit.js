import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(packageRoot, "voice-agents.repository.js"), "utf8");
const body = source.replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const input = {
  providerName: "Political Agent Base",
  appId: "Political-A-b26ad56c-c4ae",
  appVersion: 2,
  connectionId: "ee3407f4-85-8805a44f-a822",
  outboundPhoneNumber: "+919876543210",
  usageCategory: "URBAN_FEMALE",
  description: "Committed version 2"
};
const sourceAgent = {
  id: "source-id",
  catalog_source: "MANUAL_AGENT_APP",
  app_id: input.appId,
  app_version: 1,
  connection_id: input.connectionId,
  outbound_phone_number: input.outboundPhoneNumber,
  is_enabled: true
};

function harness(agent, inserted = true) {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes("SELECT * FROM sarvam_voice_agents")) return { rowCount: 1, rows: [agent] };
      if (sql.includes("INSERT INTO sarvam_voice_agents")) return {
        rowCount: Number(inserted), rows: inserted ? [{ ...agent, id: "new-id", app_version: params[2] }] : []
      };
      if (sql.includes("UPDATE sarvam_voice_agents")) return { rowCount: 1, rows: [{ ...agent, provider_name: params[1] }] };
      return { rowCount: 0, rows: [] };
    },
    release() { statements.push({ sql: "RELEASE" }); }
  };
  const getDb = async () => ({ connect: async () => client });
  const repository = new Function("crypto", "getDb", "fetchSarvamDeployments", `${body}\nreturn { editManualVoiceAgent };`)(crypto, getDb, () => {});
  return { edit: repository.editManualVoiceAgent, statements };
}

const actor = { id: "admin-id", role_code: "ADMIN" };

{
  const { edit, statements } = harness(sourceAgent);
  const result = await edit(sourceAgent.id, input, actor);
  assert.equal(result.createdVersion, true);
  assert.equal(result.agent.id, "new-id");
  const supersede = statements.find((item) => item.sql.includes("id <> $2"));
  assert.ok(supersede, "older versions must be superseded after a new version is created");
  assert.deepEqual(supersede.params, [input.appId, "new-id"]);
  const insert = statements.find((item) => item.sql.includes("INSERT INTO sarvam_voice_agents"));
  assert.equal(insert.params[8].includes("previous_catalog_id"), true);
  assert.equal(statements.some((item) => item.sql === "COMMIT"), true);
}

{
  const { edit, statements } = harness(sourceAgent);
  const result = await edit(sourceAgent.id, { ...input, appVersion: 1 }, actor);
  assert.equal(result.createdVersion, false);
  assert.equal(statements.some((item) => item.sql.includes("INSERT INTO sarvam_voice_agents")), false);
  assert.equal(statements.some((item) => item.sql.includes("UPDATE sarvam_voice_agents")), true);
}

{
  const { edit, statements } = harness(sourceAgent, false);
  await assert.rejects(edit(sourceAgent.id, input, actor), { statusCode: 409 });
  assert.equal(statements.some((item) => item.sql === "ROLLBACK"), true);
}

{
  const { edit, statements } = harness({ ...sourceAgent, catalog_source: "SARVAM_DEPLOYMENT_API" });
  await assert.rejects(edit(sourceAgent.id, input, actor), { statusCode: 409 });
  assert.equal(statements.some((item) => item.sql === "ROLLBACK"), true);
}

{
  const { edit, statements } = harness(sourceAgent);
  await assert.rejects(edit(sourceAgent.id, { ...input, appId: "Different-App" }, actor), { statusCode: 400 });
  assert.equal(statements.some((item) => item.sql === "ROLLBACK"), true);
}

{
  const { edit, statements } = harness(sourceAgent);
  await assert.rejects(edit(sourceAgent.id, input, { ...actor, role_code: "CAMPAIGN_MANAGER" }), { statusCode: 403 });
  assert.equal(statements.length, 0);
}

console.log("Voice-agent edit tests passed.");
