const CLOSED_ITERATION_STATUSES = new Set(["COMPLETED", "LOCKED"]);
const CLOSED_RUN_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "ARCHIVED"
]);

function number(value) {
  return Number(value || 0);
}

function check(id, passed, message, options = {}) {
  return {
    id,
    status: passed ? "PASS" : options.warning ? "WARN" : "FAIL",
    message
  };
}

export function evaluateCampaignBaseline({
  campaign,
  iterations,
  runs,
  contacts,
  evidence,
  lifecycleEvents
}) {
  const completedIterations = iterations.filter(function (iteration) {
    return CLOSED_ITERATION_STATUSES.has(
      String(iteration.status || "").toUpperCase()
    );
  });
  const configuredIterations = iterations.filter(function (iteration) {
    return iteration.voice_agent_id && iteration.questionnaire_id;
  });
  const closedRuns = runs.filter(function (run) {
    return CLOSED_RUN_STATUSES.has(String(run.status || "").toUpperCase());
  });
  const runCounts = new Map();

  runs.forEach(function (run) {
    runCounts.set(run.iteration_id, number(runCounts.get(run.iteration_id)) + 1);
  });

  const iterationsWithThreeRuns = iterations.filter(function (iteration) {
    return number(runCounts.get(iteration.id)) === 3;
  });

  const selectedContacts = number(contacts.selected_contacts);
  const nonDemoContacts = number(contacts.non_demo_contacts);
  const pendingContacts = number(contacts.pending_contacts);
  const activeExecutions = number(evidence.active_executions);
  const executions = number(evidence.executions);
  const callbacks = number(evidence.callbacks_received);
  const connectedCalls = number(evidence.connected_calls);
  const transcripts = number(evidence.transcripts_captured);
  const responses = number(evidence.responses_captured);

  const checks = [
    check(
      "campaign-completed",
      String(campaign.status || "").toUpperCase() === "COMPLETED",
      `Campaign status is ${campaign.status || "unknown"}.`
    ),
    check(
      "campaign-manager-assigned",
      Boolean(campaign.campaign_manager_user_id),
      campaign.campaign_manager_user_id
        ? "Campaign Manager is assigned."
        : "Campaign Manager is missing."
    ),
    check(
      "iterations-present",
      iterations.length > 0,
      `${iterations.length} Iteration(s) found.`
    ),
    check(
      "iterations-completed",
      iterations.length > 0 && completedIterations.length === iterations.length,
      `${completedIterations.length}/${iterations.length} Iteration(s) are closed.`
    ),
    check(
      "iterations-configured",
      iterations.length > 0 && configuredIterations.length === iterations.length,
      `${configuredIterations.length}/${iterations.length} Iteration(s) have a voice agent and questionnaire.`
    ),
    check(
      "three-run-policy",
      iterations.length > 0 && iterationsWithThreeRuns.length === iterations.length,
      `${iterationsWithThreeRuns.length}/${iterations.length} Iteration(s) contain exactly three Runs.`
    ),
    check(
      "runs-closed",
      runs.length > 0 && closedRuns.length === runs.length,
      `${closedRuns.length}/${runs.length} Run(s) are closed.`
    ),
    check(
      "contacts-resolved",
      selectedContacts > 0 && pendingContacts === 0,
      `${selectedContacts} selected contact(s); ${pendingContacts} remain pending.`
    ),
    check(
      "demo-only-cohort",
      selectedContacts > 0 && nonDemoContacts === 0,
      `${nonDemoContacts} selected contact(s) are outside the approved demo cohort.`
    ),
    check(
      "executions-resolved",
      executions > 0 && activeExecutions === 0,
      `${executions} execution(s); ${activeExecutions} remain active.`
    ),
    check(
      "callbacks-recorded",
      executions > 0 && callbacks === executions,
      `${callbacks}/${executions} execution callback(s) were recorded; terminal executions without callbacks remain visible as recovered history.`,
      { warning: activeExecutions === 0 }
    ),
    check(
      "connected-evidence-retained",
      connectedCalls > 0 &&
        transcripts === connectedCalls &&
        responses === connectedCalls,
      `${connectedCalls} connected call(s); ${transcripts} transcript(s) and ${responses} response set(s) retained.`
    ),
    check(
      "lifecycle-audited",
      number(lifecycleEvents) > 0,
      `${number(lifecycleEvents)} lifecycle event(s) retained.`
    )
  ];

  return {
    status: checks.every(function (item) { return item.status !== "FAIL"; })
      ? "PASS"
      : "FAIL",
    checks,
    summary: {
      iterations: iterations.length,
      runs: runs.length,
      selectedContacts,
      executions,
      callbacks,
      connectedCalls,
      transcripts,
      responses,
      lifecycleEvents: number(lifecycleEvents)
    }
  };
}
