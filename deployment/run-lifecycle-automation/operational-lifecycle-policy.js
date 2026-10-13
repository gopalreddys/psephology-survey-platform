// Operational closure is independent of interview coverage or research acceptance.
export const CLOSED_RUN_STATUSES = Object.freeze(["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"]);
export const TERMINAL_ATTEMPT_STATUSES = Object.freeze(["COMPLETED", "FAILED"]);
export const TERMINAL_EXECUTION_STATUSES = Object.freeze(["COMPLETED", "FAILED", "CANCELLED"]);

function columnName(value) {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(value)) {
    throw new Error("Invalid internal lifecycle SQL column");
  }
  return value;
}

export function terminalAttemptSql(column = "contact.attempt_status") {
  return `UPPER(COALESCE(${columnName(column)}, 'PENDING')) IN ('COMPLETED', 'FAILED')`;
}

export function activeExecutionSql(column = "execution.status") {
  return `UPPER(COALESCE(${columnName(column)}, 'PENDING')) NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')`;
}

function validCounts(state, fields) {
  return fields.every((key) => (typeof state[key] === "number" ||
    (typeof state[key] === "string" && /^\d+$/.test(state[key]))) &&
    Number.isSafeInteger(Number(state[key])) && Number(state[key]) >= 0);
}

export function evaluateRunLifecycle(state = {}) {
  return validCounts(state, ["total_contacts", "pending_contacts", "active_executions"]) &&
    Number(state.total_contacts) > 0 && Number(state.pending_contacts) === 0 &&
    Number(state.active_executions) === 0;
}

export function evaluateIterationLifecycle(state = {}) {
  const fields = ["total_runs", "closed_policy_runs", "open_runs", "pending_contacts", "active_executions"];
  const valid = validCounts(state, fields);
  const blockers = [];
  if (!valid) blockers.push("Operational lifecycle evidence is unavailable.");
  else {
    if (Number(state.total_runs) !== 3 || Number(state.closed_policy_runs) !== 3) {
      blockers.push("Complete exactly Runs 1, 2 and 3 before closing this iteration.");
    }
    if (Number(state.open_runs)) blockers.push(`${state.open_runs} Run(s) are still open.`);
    if (Number(state.pending_contacts)) blockers.push(`${state.pending_contacts} contact attempt(s) remain pending.`);
    if (Number(state.active_executions)) blockers.push(`${state.active_executions} call execution(s) remain active.`);
  }
  return { readyToComplete: valid && blockers.length === 0, blockers };
}

export function deploymentIdentity(value = {}) {
  const appId = String(value.app_id || "").trim();
  const version = Number(value.app_version);
  const connectionId = String(value.connection_id || "").trim();
  if (!appId || !Number.isInteger(version) || version < 1 || !connectionId) return null;
  return { app_id: appId, app_version: version, connection_id: connectionId };
}

export function sameDeployment(left, right) {
  const a = deploymentIdentity(left);
  const b = deploymentIdentity(right);
  return Boolean(a && b && a.app_id === b.app_id && a.app_version === b.app_version &&
    a.connection_id === b.connection_id);
}
