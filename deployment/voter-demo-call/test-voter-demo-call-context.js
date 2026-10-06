import assert from "node:assert/strict";
import fs from "node:fs";

import { buildVoterDemoAgentVariables } from "./voter-demo-call-context.js";

const variables = buildVoterDemoAgentVariables({
  demoCallId: "009397f6-80c2-45ab-b489-d08b7d26a551",
  voter: {
    id: "812cd7db-63e7-4ca2-a370-cc04f5bcec07",
    full_name: "Manohar",
    preferred_language: "Telugu",
    occupation: "Business",
    qualification: null,
    gender: "MALE",
    geography_name: "Serilingampalle",
    geography_type: "MANDAL",
    parent_geography_name: "Rangareddy",
    parent_geography_type: "DISTRICT",
    mandal_name_source: "Serilingampalle",
    assembly_constituency_name: "Serilingampally"
  }
});

assert.equal(variables.source, "VOTER_MASTER_DEMO");
assert.equal(variables.analytics_excluded, "true");
assert.equal(variables.user_name, "Manohar");
assert.equal(variables.mandal, "Serilingampalle");
assert.equal(variables.district, "Rangareddy");
assert.equal(variables.mla_constituency, "Serilingampally");
assert.match(variables.research_context, /survey_completed/);
assert.match(variables.research_context, /all three required civic themes/);
assert.match(variables.questionnaire_context, /Three required civic themes/);
assert.match(variables.knowledge_context, /Mandal: Serilingampalle/);
assert.match(variables.knowledge_context, /platform reference data/);
assert.match(variables.agent_style_context, /Never repeat, paraphrase, summarize/);

const withoutGeography = buildVoterDemoAgentVariables({
  demoCallId: "demo",
  voter: {
    id: "voter",
    full_name: "Test",
    preferred_language: null
  }
});

assert.equal(withoutGeography.preferred_language, "Telugu");
assert.equal(withoutGeography.mandal, "");
assert.match(withoutGeography.knowledge_context, /No platform geography/);

const repository = fs.readFileSync(
  new URL("./voter-demo-calls.repository.js", import.meta.url),
  "utf8"
);
const webhook = fs.readFileSync(
  new URL(
    "../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js",
    import.meta.url
  ),
  "utf8"
);
const migration = fs.readFileSync(
  new URL("./027_voter_demo_call_outcomes.sql", import.meta.url),
  "utf8"
);

assert.match(repository, /LEFT JOIN geo_units geography/);
assert.match(repository, /FOR UPDATE OF voter_master/);
assert.match(repository, /recordVoterDemoCallOutcome/);
assert.match(repository, /provider_status = \$4/);
assert.match(webhook, /metadata\.demo_call_id/);
assert.match(webhook, /recordVoterDemoCallOutcome/);
assert.match(webhook, /demoCall: true/);
assert.match(webhook, /payload\?\.metadata/);
assert.match(webhook, /payload\?\.interaction_id/);
assert.match(webhook, /payload\?\.connectivity_status/);
assert.match(webhook, /payload\.output_agent_variables/);
assert.match(webhook, /finalVariables\.disposition === "survey_completed"/);
assert.match(migration, /final_agent_variables jsonb/);
assert.match(migration, /callback_received_at timestamptz/);

console.log("Voter demo call context tests passed.");
