import assert from "node:assert/strict";
import { assertIterationAgentVersionChange } from "../campaign-workspace/iteration-agent-version.policy.js";

const campaign = { status: "ACTIVE" };
const iteration = { status: "ACTIVE" };
const currentSnapshot = {
  app_id: "Political-A-b26ad56c-c4ae",
  app_version: 4,
  connection_id: "connection-1",
  outbound_phone_number: "+918000000000",
  usage_category: "URBAN_FEMALE"
};
const targetAgent = {
  ...currentSnapshot,
  app_version: 5
};

assert.deepEqual(assertIterationAgentVersionChange({
  campaign, iteration, currentSnapshot, targetAgent, activeExecutions: 0
}), { currentVersion: 4, nextVersion: 5 });

assert.throws(() => assertIterationAgentVersionChange({
  campaign, iteration, currentSnapshot, targetAgent, activeExecutions: 1
}), /active calls/);
assert.throws(() => assertIterationAgentVersionChange({
  campaign, iteration: { status: "COMPLETED" }, currentSnapshot, targetAgent
}), /completed or locked/);
assert.throws(() => assertIterationAgentVersionChange({
  campaign, iteration, currentSnapshot, targetAgent: { ...targetAgent, app_id: "another-app" }
}), /same Sarvam Agent App/);
assert.throws(() => assertIterationAgentVersionChange({
  campaign, iteration, currentSnapshot, targetAgent: { ...targetAgent, app_version: 4 }
}), /newer than v4/);
assert.throws(() => assertIterationAgentVersionChange({
  campaign, iteration, currentSnapshot, targetAgent: { ...targetAgent, connection_id: "connection-2" }
}), /retain the outbound connection/);

console.log("Iteration agent-version policy tests passed.");
