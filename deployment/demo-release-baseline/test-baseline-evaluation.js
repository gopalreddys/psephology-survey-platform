import assert from "node:assert/strict";

import { evaluateCampaignBaseline } from "./baseline-evaluation.js";

const campaign = {
  status: "COMPLETED",
  campaign_manager_user_id: "manager-1"
};
const iterations = [1, 2, 3].map(function (number) {
  return {
    id: `iteration-${number}`,
    status: "COMPLETED",
    voice_agent_id: "agent-1",
    questionnaire_id: "questionnaire-1"
  };
});
const runs = iterations.flatMap(function (iteration) {
  return [1, 2, 3].map(function (runNumber) {
    return {
      id: `${iteration.id}-run-${runNumber}`,
      iteration_id: iteration.id,
      run_number: runNumber,
      status: "COMPLETED"
    };
  });
});
const goodInput = {
  campaign,
  iterations,
  runs,
  contacts: {
    selected_contacts: 30,
    non_demo_contacts: 0,
    pending_contacts: 0
  },
  evidence: {
    executions: 24,
    callbacks_received: 24,
    active_executions: 0,
    connected_calls: 19,
    transcripts_captured: 19,
    responses_captured: 19
  },
  lifecycleEvents: 40
};

const passing = evaluateCampaignBaseline(goodInput);
assert.equal(passing.status, "PASS");
assert.equal(passing.checks.length, 13);
assert.equal(
  passing.checks.every(function (item) { return item.status === "PASS"; }),
  true
);

const failing = evaluateCampaignBaseline({
  ...goodInput,
  campaign: { status: "ACTIVE", campaign_manager_user_id: null },
  iterations: iterations.map(function (iteration, index) {
    return index === 0
      ? { ...iteration, status: "ACTIVE", voice_agent_id: null }
      : iteration;
  }),
  runs: runs.slice(1),
  contacts: {
    selected_contacts: 30,
    non_demo_contacts: 1,
    pending_contacts: 1
  },
  evidence: {
    executions: 24,
    callbacks_received: 23,
    active_executions: 1,
    connected_calls: 19,
    transcripts_captured: 18,
    responses_captured: 17
  },
  lifecycleEvents: 0
});
assert.equal(failing.status, "FAIL");
assert.equal(
  failing.checks.find(function (item) {
    return item.id === "callbacks-recorded";
  }).status,
  "FAIL"
);
assert.deepEqual(
  failing.checks.filter(function (item) { return item.status === "FAIL"; })
    .map(function (item) { return item.id; }),
  [
    "campaign-completed",
    "campaign-manager-assigned",
    "iterations-completed",
    "iterations-configured",
    "three-run-policy",
    "contacts-resolved",
    "demo-only-cohort",
    "executions-resolved",
    "callbacks-recorded",
    "connected-evidence-retained",
    "lifecycle-audited"
  ]
);

const recoveredWithoutCallback = evaluateCampaignBaseline({
  ...goodInput,
  evidence: {
    ...goodInput.evidence,
    callbacks_received: 23
  }
});
assert.equal(recoveredWithoutCallback.status, "PASS");
assert.equal(
  recoveredWithoutCallback.checks.find(function (item) {
    return item.id === "callbacks-recorded";
  }).status,
  "WARN"
);

console.log("Demo baseline evaluation tests passed.");
