export function iteration(number, status = "COMPLETED") {
  return {
    id: `i${number}`, iteration_number: number, iteration_name: `Wave ${number}`,
    status, questionnaire_id: "unchanged-questionnaire", connected_respondents: 12,
    target_sample_size: 12, run_count: 2, closed_run_count: 2,
    call_attempts: 20, transcripts_captured: 12, responses_captured: 12
  };
}

export function gateRow(number, overrides = {}) {
  return {
    iteration_id: `i${number}`, campaign_id: "campaign", iteration_number: number,
    previous_iteration_id: number > 1 ? `i${number - 1}` : null,
    comparison_status: number > 1 ? "COMPARABLE" : "BASELINE",
    comparison_reasons: [], design_declared: true, ...overrides
  };
}

export function response(iterationId, voterId, value, overrides = {}) {
  return {
    call_id: `${iterationId}-${voterId}`, iteration_id: iterationId, voter_id: voterId,
    connectivity_status: "connected", run_id: String(voterId || "").endsWith("0") ? "run-a" : "run-b",
    gender: "Female", age: 35, mandal_name: "North", is_demo_contact: false,
    response_variables: { graduate_issue_priority: value },
    updated_at: "2026-01-02T00:00:00Z", created_at: "2026-01-02T00:00:00Z",
    ...overrides
  };
}

export function fixtureState() {
  const records = [];
  for (let index = 0; index < 6; index++) {
    records.push(response("i1", `female-${index}`, "jobs"));
    records.push(response("i2", `female-${index}`, index < 3 ? "jobs" : "roads"));
    records.push(response("i1", `male-${index}`, "roads", { gender: "Male", age: 55, mandal_name: "South" }));
    records.push(response("i2", `male-${index}`, "jobs", { gender: "Male", age: 55, mandal_name: "South" }));
  }
  records.push(response("i2", "female-0", "roads", { call_id: "older", updated_at: "2026-01-01T00:00:00Z" }));
  records.push(response("i2", "female-0", "", { call_id: "newer-empty", response_variables: {}, updated_at: "2026-01-03T00:00:00Z" }));
  records.push(response("i2", "female-0", "roads", { call_id: "newer-disconnected", connectivity_status: "disconnected", updated_at: "2026-01-04T00:00:00Z" }));
  records.push(response("i2", "female-0", "roads", { call_id: "newer-array", response_variables: ["roads"], updated_at: "2026-01-05T00:00:00Z" }));
  records.push(response("i2", null, "roads", { call_id: "unidentified" }));
  return {
    iterations: [iteration(1), iteration(2)],
    gateRows: [gateRow(1), gateRow(2)], records,
    runs: [
      { id: "run-a", iteration_id: "i2", run_number: 1, status: "COMPLETED", call_attempts: 1, connected_calls: 1, responses_captured: 1 },
      { id: "run-b", iteration_id: "i2", run_number: 2, status: "COMPLETED", call_attempts: 19, connected_calls: 11, responses_captured: 11 }
    ]
  };
}

export function fixtureDb(state) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (sql.includes("analytics_iteration_comparability_v1")) {
        if (state.missingGate) throw Object.assign(new Error("missing comparison view"), { code: "42P01" });
        return { rows: state.gateRows };
      }
      if (sql.includes("WITH iteration_set AS")) return { rows: state.iterations };
      if (sql.includes("WITH contact_stats AS")) return { rows: state.runs };
      if (sql.includes("overlapping_respondents")) return { rows: [{ overlapping_respondents: 0 }] };
      if (sql.includes("FROM calls call_record")) return { rows: state.records };
      if (sql.includes("FROM campaigns campaign")) return { rowCount: 1, rows: [{
        id: "campaign", campaign_code: "TEST", campaign_name: "Fixture Campaign",
        campaign_manager_user_id: "manager", target_name: "Fixture electorate", survey_stage: "PULSE"
      }] };
      throw new Error(`Unexpected fixture query: ${sql}`);
    }
  };
}
