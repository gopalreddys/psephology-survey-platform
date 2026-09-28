import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "../db/postgres.js";

const runFile = promisify(execFile);
const RECOVERY_TIMER = "psephology-lifecycle-recovery.timer";
const RECOVERY_SERVICE = "psephology-lifecycle-recovery.service";

function properties(output) {
  return Object.fromEntries(
    output.split("\n").filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

async function unitProperties(unit, names) {
  try {
    const { stdout } = await runFile("systemctl", [
      "show", unit, `--property=${names.join(",")}`, "--no-pager"
    ], { timeout: 2500, maxBuffer: 8192 });
    return properties(stdout);
  } catch {
    // This API may run without systemd (for example, in development).
    return null;
  }
}

export async function recoveryTimerStatus() {
  const [timer, service] = await Promise.all([
    unitProperties(RECOVERY_TIMER, ["LoadState", "ActiveState", "SubState", "NextElapseUSecRealtime", "LastTriggerUSec"]),
    unitProperties(RECOVERY_SERVICE, ["Result", "ExecMainStatus"])
  ]);
  return {
    status: !timer || timer.LoadState !== "loaded" ? "unknown"
      : timer.ActiveState === "active" && timer.SubState === "waiting" ? "waiting"
      : "inactive",
    nextTrigger: timer?.NextElapseUSecRealtime || null,
    lastTrigger: timer?.LastTriggerUSec || null,
    lastResult: service?.Result || null,
    lastExitStatus: service?.ExecMainStatus || null
  };
}

function transcriptTurns(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function turnText(turn) {
  return String(
    turn?.indic_text || turn?.en_text || turn?.text ||
    turn?.content || turn?.message || turn?.utterance || ""
  ).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function repeatedOpeningTurns(transcript) {
  const agentTurns = transcriptTurns(transcript)
    .filter((turn) => String(turn?.role || "").toLowerCase() === "agent")
    .map(turnText).filter(Boolean);
  const first = agentTurns[0] || "";
  if (!first) return 0;
  const firstTokens = new Set(first.split(" ").filter(Boolean));
  return agentTurns.filter((text) => {
    const tokens = new Set(text.split(" ").filter(Boolean));
    const shared = Array.from(firstTokens).filter((token) => tokens.has(token)).length;
    return (2 * shared) / (firstTokens.size + tokens.size || 1) >= 0.78;
  }).length;
}

const TRACE_DEFINITIONS = {
  PROVIDER_REJECTED: {
    severity: "CRITICAL", functionality: "Provider submission",
    situation: "The platform reserved the attempt, but Sarvam did not accept it.",
    diagnosis: "The failure occurred before a provider attempt ID was returned.",
    involved: [
      ["src/services/run-launch.service.js", "launchRun"],
      ["src/services/sarvam-execution.service.js", "executeSarvamCall / prepareSarvamExecution"],
      ["src/repositories/voice-agents.repository.js", "getSarvamVoiceAgentForRunContact"],
      ["src/clients/sarvam.js", "createInstantOutboundCall"]
    ],
    fixes: [
      "Inspect the safe provider error and reject another bulk launch until it is understood.",
      "Compare the Iteration snapshot with the committed Sarvam app version, connection and outbound number.",
      "Validate that only registered runtime variables are sent, then retry one controlled contact."
    ]
  },
  CALLBACK_DELAYED: {
    severity: "CRITICAL", functionality: "Callback processing",
    situation: "Sarvam accepted the attempt, but no callback was recorded within 30 minutes.",
    diagnosis: "The execution is still active without authoritative completion evidence.",
    involved: [
      ["src/clients/sarvam.js", "createInstantOutboundCall"],
      ["src/routes/sarvam-outbound-webhook.routes.js", "POST callback handler"],
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult"],
      ["src/repositories/stale-callback-recovery.repository.js", "recoverStaleCallbacks"]
    ],
    fixes: [
      "Verify the public webhook URL and recent Sarvam delivery history.",
      "Confirm the lifecycle recovery timer is healthy and run recovery only after the threshold.",
      "Do not relaunch the same contact while an accepted provider attempt remains unresolved."
    ]
  },
  UNMATCHED_WEBHOOK: {
    severity: "CRITICAL", functionality: "Webhook correlation",
    situation: "A Sarvam callback could not be matched to a platform execution.",
    diagnosis: "Provider attempt ID or execution metadata did not correlate with the launch audit record.",
    involved: [
      ["src/routes/sarvam-outbound-webhook.routes.js", "POST callback handler"],
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult / metadataFrom"],
      ["src/services/sarvam-execution.service.js", "executeSarvamCall"]
    ],
    fixes: [
      "Compare the callback attempt ID with call_executions.provider_attempt_id.",
      "Verify callback metadata retains call_execution_id and run correlation.",
      "Reconcile the event only after identifying the single authoritative execution."
    ]
  },
  WEBHOOK_PROCESSING_FAILURE: {
    severity: "CRITICAL", functionality: "Webhook processing",
    situation: "A received Sarvam webhook was not processed successfully.",
    diagnosis: "The callback reached AWS but failed during validation, persistence or lifecycle reconciliation.",
    involved: [
      ["src/routes/sarvam-outbound-webhook.routes.js", "POST callback handler"],
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult"],
      ["src/repositories/run-lifecycle.repository.js", "reconcileRunLifecycle"]
    ],
    fixes: [
      "Inspect the stored safe processing error and API journal for the same event time.",
      "Correct validation or database state before replaying the exact event.",
      "Use the event hash to prevent a successful callback from being applied twice."
    ]
  },
  CONVERSATION_OPENING_LOOP: {
    severity: "CRITICAL", functionality: "Conversation runtime",
    situation: "One provider interaction repeated an opening-like agent turn.",
    diagnosis: "A single session reached Sarvam, but its conversation state returned to the greeting.",
    involved: [
      ["src/services/sarvam-execution.service.js", "executeSarvamCall / runtime context merge"],
      ["src/routes/sarvam-runtime.routes.js", "load_runtime_context"],
      ["src/clients/sarvam.js", "createInstantOutboundCall"],
      ["Sarvam committed Agent App", "Greeting and system instructions"]
    ],
    fixes: [
      "Confirm there is exactly one execution, provider attempt and interaction for the contact.",
      "Verify the runtime hook received run_contact_id and returned valid conversation-state JSON.",
      "Keep the Greeting provider-owned and run one canary before resuming the batch."
    ]
  },
  AGENT_DEPLOYMENT_DRIFT: {
    severity: "CRITICAL", functionality: "Voice-agent selection",
    situation: "The submitted provider deployment differs from the frozen Iteration snapshot.",
    diagnosis: "The launch did not preserve the reviewed agent identity end to end.",
    involved: [
      ["src/repositories/voice-agents.repository.js", "voiceAgentSnapshot / getSarvamVoiceAgentForRunContact"],
      ["src/services/sarvam-execution.service.js", "executeSarvamCall"],
      ["src/clients/sarvam.js", "createInstantOutboundCall"]
    ],
    fixes: [
      "Stop the Run and compare app ID, version and connection ID with the Iteration snapshot.",
      "Do not edit a frozen Iteration after its first execution.",
      "Use a fresh Iteration when a different committed deployment is required."
    ]
  },
  CONNECTED_EVIDENCE_GAP: {
    severity: "WARNING", functionality: "Evidence persistence",
    situation: "The call connected, but its transcript or structured response evidence is incomplete.",
    diagnosis: "The provider conversation finished without the evidence required for research closeout.",
    involved: [
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult"],
      ["deployment/sarvam-outbound-webhook/reconcile-sarvam-outbound-attempt.js", "transcript reconciliation"],
      ["src/repositories/run-lifecycle.repository.js", "reconcileRunLifecycle"]
    ],
    fixes: [
      "Inspect the provider attempt and retrieve its authoritative transcript before closing the Run.",
      "Validate final agent variable names against the questionnaire output schema.",
      "Reconcile stored evidence; never fabricate missing responses."
    ]
  },
  CONNECTED_INCOMPLETE: {
    severity: "WARNING", functionality: "Completion classification",
    situation: "The call connected but did not meet the research completion policy.",
    diagnosis: "Conversation evidence exists, but the normalized outcome is not a successful completion.",
    involved: [
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult"],
      ["src/repositories/call-completion-policy.js", "classifyCallCompletion"],
      ["src/repositories/run-lifecycle.repository.js", "reconcileRunLifecycle"]
    ],
    fixes: [
      "Compare transcript progress with the required output variables.",
      "Check whether the respondent refused, disconnected, or the agent failed to advance.",
      "Tune the committed agent only after separating conversation failure from delivery failure."
    ]
  },
  DUPLICATE_PROVIDER_START: {
    severity: "WARNING", functionality: "Launch idempotency",
    situation: "One Run contact has more than one provider start in the trace window.",
    diagnosis: "A repeated click, retry race or missing idempotency guard may have submitted duplicate calls.",
    involved: [
      ["src/routes/runs.routes.js", "POST /runs/:runId/launch"],
      ["src/services/run-launch.service.js", "launchRun"],
      ["src/services/sarvam-execution.service.js", "executeSarvamCall"]
    ],
    fixes: [
      "Compare execution timestamps and attempt-cycle IDs before treating this as a defect.",
      "Preserve the launch idempotency key and disable repeated submission while a request is active.",
      "If the starts belong to governed retries, record them as expected rather than merging them."
    ]
  },
  RUN_LIFECYCLE_DRIFT: {
    severity: "WARNING", functionality: "Run lifecycle",
    situation: "All selected contacts are resolved and no call is active, but the Run remains open.",
    diagnosis: "The final callback did not close the Run and its active cycle consistently.",
    involved: [
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult"],
      ["src/repositories/run-lifecycle.repository.js", "reconcileRunLifecycle"],
      ["deployment/sarvam-outbound-webhook/finalize-resolved-runs.js", "finalize resolved Runs"]
    ],
    fixes: [
      "Run the lifecycle reconciliation in dry-run mode and inspect the candidate.",
      "Verify every selected contact has a terminal final status.",
      "Apply closeout only when there are no active executions."
    ]
  },
  PROVIDER_DELIVERY_FAILURE: {
    severity: "INFO", functionality: "Telephony delivery",
    situation: "The provider returned a failed delivery outcome after accepting the attempt.",
    diagnosis: "This is normally a network, handset or provider outcome rather than a platform defect.",
    involved: [
      ["src/clients/sarvam.js", "createInstantOutboundCall"],
      ["src/repositories/sarvam-outbound-webhook.repository.js", "recordSarvamOutboundResult"]
    ],
    fixes: [
      "Review the provider failure reason and retry eligibility.",
      "Do not change application code for normal busy or no-answer outcomes.",
      "Escalate only when the same technical reason repeats across multiple contacts."
    ]
  }
};

const IMPLEMENTED_CONTROLS = {
  PROVIDER_REJECTED: {
    solution: "Registered-variable allow-list, safe provider validation details and guarded rejected-execution recovery.",
    programs: ["sarvam-agent-variable-handoff", "voice-agent-catalog"]
  },
  CALLBACK_DELAYED: {
    solution: "Thirty-minute stale-callback recovery with a supervised systemd timer and lifecycle reconciliation.",
    programs: ["campaign-lifecycle-governance", "run-lifecycle-automation"]
  },
  UNMATCHED_WEBHOOK: {
    solution: "Attempt-ID plus execution-metadata correlation and idempotent webhook event storage.",
    programs: ["sarvam-outbound-webhook"]
  },
  WEBHOOK_PROCESSING_FAILURE: {
    solution: "Hashed event idempotency, transactional processing and retained safe processing errors.",
    programs: ["sarvam-outbound-webhook", "database-resilience"]
  },
  CONVERSATION_OPENING_LOOP: {
    solution: "One-time opening contract, compact validated runtime context and mandatory controlled-call canary.",
    programs: ["sarvam-conversation-flow", "sarvam-agent-variable-handoff"]
  },
  AGENT_DEPLOYMENT_DRIFT: {
    solution: "Frozen Iteration voice-agent snapshot and runtime selection from that snapshot instead of mutable catalogue defaults.",
    programs: ["voice-agent-catalog", "iteration-agent-version"]
  },
  CONNECTED_EVIDENCE_GAP: {
    solution: "Authoritative attempt/transcript reconciliation and evidence-aware Iteration closeout.",
    programs: ["sarvam-outbound-webhook", "iteration-closeout"]
  },
  CONNECTED_INCOMPLETE: {
    solution: "Deterministic completion policy based on connected evidence and meaningful response variables.",
    programs: ["sarvam-outbound-webhook", "iteration-closeout"]
  },
  DUPLICATE_PROVIDER_START: {
    solution: "Reviewed contact allow-list, launch idempotency and active-request suppression.",
    programs: ["run-contact-selection", "run-bulk-launch"]
  },
  RUN_LIFECYCLE_DRIFT: {
    solution: "Transactional final-callback reconciliation plus guarded dry-run closeout recovery.",
    programs: ["run-lifecycle-automation", "campaign-lifecycle-governance"]
  },
  PROVIDER_DELIVERY_FAILURE: {
    solution: "Normalized delivery outcomes and governed retry eligibility without misclassifying busy/no-answer as code defects.",
    programs: ["sarvam-outbound-webhook", "run-retry-cohort"]
  }
};

function safeEvidence(value) {
  return String(value || "No additional diagnostic detail was recorded.")
    .replace(/\+?\d[\d\s()-]{7,}\d/g, "[REDACTED]")
    .slice(0, 600);
}

function isOpenExecutionWorkflow(row) {
  const runOpen = ["READY", "RUNNING"].includes(
    String(row.run_status || "").toUpperCase()
  );
  const iterationOpen = !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(
    String(row.iteration_link_status || row.iteration_status || "PLANNED").toUpperCase()
  );
  const contactUnresolved = String(row.contact_final_status || "PENDING").toUpperCase() === "PENDING" &&
    row.contact_retry_exhausted !== true;
  const latest = row.is_latest_for_contact !== false;
  return runOpen && iterationOpen && contactUnresolved && latest;
}

function isRuntimeIssue(code, row) {
  if (["CALLBACK_DELAYED", "UNMATCHED_WEBHOOK", "WEBHOOK_PROCESSING_FAILURE",
    "RUN_LIFECYCLE_DRIFT"].includes(code)) return true;
  if (code === "PROVIDER_DELIVERY_FAILURE") return false;
  return isOpenExecutionWorkflow(row);
}

function traceIncident(code, row, evidence, suffix = "") {
  const definition = TRACE_DEFINITIONS[code];
  const knownControl = IMPLEMENTED_CONTROLS[code];
  return {
    id: `${code}:${row.execution_id || row.id || row.run_id || "event"}${suffix}`,
    code,
    severity: definition.severity,
    functionality: definition.functionality,
    situation: definition.situation,
    diagnosis: definition.diagnosis,
    evidence: safeEvidence(evidence),
    runtime: isRuntimeIssue(code, row),
    executionId: row.execution_id || null,
    campaignName: row.campaign_name || null,
    iterationNumber: row.iteration_number === undefined ? null : Number(row.iteration_number),
    runNumber: row.run_number === undefined ? null : Number(row.run_number),
    observedAt: row.callback_received_at || row.updated_at || row.received_at ||
      row.submitted_at || row.created_at || null,
    involved: definition.involved.map(([program, method]) => ({ program, method })),
    preliminaryFixes: definition.fixes,
    matchedHistoricalControl: knownControl ? {
      implementedSolution: knownControl.solution,
      controlPrograms: knownControl.programs
    } : null
  };
}

export function buildCallIssueTrace({ executions = [], webhooks = [], lifecycleDrifts = [], now = new Date() }) {
  const incidents = [];
  const byContact = new Map();

  for (const row of executions) {
    const status = String(row.execution_status || "").toUpperCase();
    const connectivity = String(row.connectivity_status || "").toLowerCase();
    const normalized = String(row.normalized_status || "").toUpperCase();
    const transcriptCount = Number(row.transcript_turns || 0);
    const responseCount = Number(row.response_variables || 0);
    const submittedAt = new Date(row.submitted_at || row.created_at);
    const delayed = !row.callback_received_at &&
      ["PENDING", "SUBMITTED", "RUNNING"].includes(status) &&
      Number.isFinite(submittedAt.getTime()) &&
      now.getTime() - submittedAt.getTime() > 30 * 60 * 1000;
    const deploymentDrift = Boolean(row.submitted_app_id && row.snapshot_app_id) && (
      row.submitted_app_id !== row.snapshot_app_id ||
      Number(row.submitted_app_version || 0) !== Number(row.snapshot_app_version || 0) ||
      row.submitted_connection_id !== row.snapshot_connection_id
    );

    if (status === "FAILED" && !row.provider_attempt_id) {
      incidents.push(traceIncident("PROVIDER_REJECTED", row,
        row.error_message || "Provider attempt ID was not recorded."));
    }
    if (delayed) {
      incidents.push(traceIncident("CALLBACK_DELAYED", row,
        `Status ${status}; submitted ${row.submitted_at || row.created_at}; callback absent.`));
    }
    if (deploymentDrift) {
      incidents.push(traceIncident("AGENT_DEPLOYMENT_DRIFT", row,
        `Submitted ${row.submitted_app_id} v${row.submitted_app_version || "?"}; snapshot ${row.snapshot_app_id} v${row.snapshot_app_version || "?"}.`));
    }
    if (connectivity === "connected" && repeatedOpeningTurns(row.interaction_transcript) > 1) {
      incidents.push(traceIncident("CONVERSATION_OPENING_LOOP", row,
        "A single stored interaction contains more than one highly similar opening-like agent turn."));
    }
    if (connectivity === "connected" && (transcriptCount === 0 || responseCount === 0)) {
      incidents.push(traceIncident("CONNECTED_EVIDENCE_GAP", row,
        `${transcriptCount} transcript turn(s); ${responseCount} structured response variable(s).`));
    } else if (connectivity === "connected" && normalized &&
        !["SUCCESS_COMPLETE", "SUCCESS_PULSE", "SUCCESS_SUBSTANTIAL"].includes(normalized)) {
      incidents.push(traceIncident("CONNECTED_INCOMPLETE", row,
        `${transcriptCount} transcript turn(s); normalized outcome ${normalized}.`));
    }
    if (status === "FAILED" && row.provider_attempt_id &&
        ["failed", "busy", "no_answer"].includes(connectivity)) {
      incidents.push(traceIncident("PROVIDER_DELIVERY_FAILURE", row,
        row.failure_reason || `Provider connectivity status ${connectivity}.`));
    }

    if (row.run_contact_id && row.provider_attempt_id) {
      const starts = byContact.get(row.run_contact_id) || [];
      starts.push(row);
      byContact.set(row.run_contact_id, starts);
    }
  }

  for (const starts of byContact.values()) {
    const uniqueAttempts = new Set(starts.map((row) => row.provider_attempt_id));
    if (uniqueAttempts.size > 1) {
      const row = starts[0];
      incidents.push(traceIncident("DUPLICATE_PROVIDER_START", row,
        `${uniqueAttempts.size} provider attempt IDs are recorded for one Run contact.`, ":duplicate"));
    }
  }

  for (const row of webhooks) {
    const code = String(row.delivery_status || "").toUpperCase() === "UNMATCHED"
      ? "UNMATCHED_WEBHOOK" : "WEBHOOK_PROCESSING_FAILURE";
    incidents.push(traceIncident(code, row,
      row.error_message || `Webhook delivery status ${row.delivery_status}.`));
  }
  for (const row of lifecycleDrifts) {
    incidents.push(traceIncident("RUN_LIFECYCLE_DRIFT", row,
      `${row.resolved_contacts}/${row.selected_contacts} contacts resolved; ${row.active_executions} active executions; Run status ${row.run_status}.`));
  }

  const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  incidents.sort((a, b) => (severityOrder[a.severity] - severityOrder[b.severity]) ||
    String(b.observedAt || "").localeCompare(String(a.observedAt || "")));
  const runtimeIncidents = incidents.filter((item) => item.runtime);
  const historicalIncidents = incidents.filter((item) => !item.runtime);
  const runtimeTotals = runtimeIncidents.reduce((result, item) => {
    result[item.severity.toLowerCase()] += 1;
    result.byFunctionality[item.functionality] =
      (result.byFunctionality[item.functionality] || 0) + 1;
    return result;
  }, { critical: 0, warning: 0, info: 0, byFunctionality: {} });

  const bucketMap = new Map();
  for (const item of historicalIncidents) {
    const control = IMPLEMENTED_CONTROLS[item.code];
    const bucket = bucketMap.get(item.code) || {
      code: item.code,
      functionality: item.functionality,
      severity: item.severity,
      occurrences: 0,
      firstSeen: item.observedAt,
      lastSeen: item.observedAt,
      solutionStatus: "IMPLEMENTED",
      implementedSolution: control?.solution || "Audited workflow handling is retained in the platform runbook.",
      controlPrograms: control?.programs || []
    };
    bucket.occurrences += 1;
    if (String(item.observedAt || "") < String(bucket.firstSeen || "")) {
      bucket.firstSeen = item.observedAt;
    }
    if (String(item.observedAt || "") > String(bucket.lastSeen || "")) {
      bucket.lastSeen = item.observedAt;
    }
    bucketMap.set(item.code, bucket);
  }

  return {
    runtime: {
      status: runtimeTotals.critical > 0 ? "ATTENTION_REQUIRED"
        : runtimeTotals.warning > 0 ? "WATCH" : "CLEAR",
      total: runtimeIncidents.length,
      showstoppers: runtimeTotals.critical,
      warnings: runtimeTotals.warning,
      informational: runtimeTotals.info,
      byFunctionality: Object.entries(runtimeTotals.byFunctionality)
        .map(([functionality, count]) => ({ functionality, count }))
        .sort((a, b) => b.count - a.count || a.functionality.localeCompare(b.functionality)),
      incidents: runtimeIncidents.slice(0, 40)
    },
    history: {
      periodDays: 90,
      resolvedObservations: historicalIncidents.length,
      buckets: Array.from(bucketMap.values())
        .sort((a, b) => b.occurrences - a.occurrences ||
          String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))
    }
  };
}

export async function getPipelineOverview(options = {}) {
  const db = options.db || await getDb();
  const [executions, webhooks, recentWebhooks, evidence, recoveryEvents,
    integrationConfiguration, latestConversation] = await Promise.all([
    db.query(`
      SELECT COUNT(*) FILTER (WHERE callback_received_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'RUNNING'))::int AS awaiting_callbacks,
        COUNT(*) FILTER (WHERE callback_received_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'RUNNING')
          AND COALESCE(submitted_at, created_at) < now() - interval '30 minutes')::int AS delayed_callbacks,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at >= now() - interval '24 hours')::int AS failed_attempts_24h,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS attempts_24h,
        COUNT(*) FILTER (WHERE provider_attempt_id IS NOT NULL
          AND created_at >= now() - interval '24 hours')::int AS provider_accepted_24h,
        MAX(submitted_at) AS last_submission_at,
        MAX(callback_received_at) AS last_callback_at
      FROM call_executions
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE received_at >= now() - interval '24 hours')::int AS received_24h,
        COUNT(*) FILTER (WHERE received_at >= now() - interval '24 hours'
          AND delivery_status = 'PROCESSED')::int AS processed_24h,
        COUNT(*) FILTER (WHERE delivery_status <> 'PROCESSED')::int AS unresolved_total,
        MAX(received_at) AS last_received_at
      FROM sarvam_outbound_webhook_events
    `),
    db.query(`
      SELECT event.id, event.attempt_id, event.delivery_status, event.error_message,
        event.received_at, event.processed_at, execution.id AS execution_id
      FROM sarvam_outbound_webhook_events event
      LEFT JOIN LATERAL (
        SELECT id FROM call_executions
        WHERE provider_attempt_id = event.attempt_id
        ORDER BY created_at DESC LIMIT 1
      ) execution ON TRUE
      WHERE event.delivery_status <> 'PROCESSED'
      ORDER BY event.received_at DESC LIMIT 20
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
          AND (jsonb_typeof(interaction_transcript) <> 'array'
            OR interaction_transcript = '[]'::jsonb))::int AS missing_transcripts,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
          AND (jsonb_typeof(response_variables) <> 'object'
            OR response_variables = '{}'::jsonb))::int AS missing_responses
      FROM calls
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS recovered_24h,
        MAX(created_at) AS last_recovery_at
      FROM operational_lifecycle_events
      WHERE entity_type = 'CALL_EXECUTION'
        AND trigger_source = 'STALE_CALLBACK_RECOVERY'
    `),
    db.query(`
      SELECT
        (SELECT COUNT(*)::int
          FROM sarvam_voice_agents agent
          WHERE agent.is_enabled = TRUE) AS enabled_agents,
        (SELECT COUNT(*)::int
          FROM sarvam_voice_agents agent
          WHERE agent.is_enabled = TRUE
            AND (NULLIF(TRIM(agent.app_id), '') IS NULL
              OR COALESCE(agent.app_version, 0) <= 0
              OR NULLIF(TRIM(agent.connection_id), '') IS NULL
              OR NULLIF(TRIM(agent.outbound_phone_number), '') IS NULL)) AS invalid_enabled_agents,
        (SELECT COUNT(*)::int
          FROM campaign_iteration_links link
          JOIN program_iterations iteration ON iteration.id = link.iteration_id
          WHERE UPPER(COALESCE(link.status, iteration.status, 'PLANNED'))
            NOT IN ('COMPLETED', 'CANCELLED', 'ARCHIVED')) AS open_iterations,
        (SELECT COUNT(*)::int
          FROM campaign_iteration_links link
          JOIN program_iterations iteration ON iteration.id = link.iteration_id
          WHERE UPPER(COALESCE(link.status, iteration.status, 'PLANNED'))
              NOT IN ('COMPLETED', 'CANCELLED', 'ARCHIVED')
            AND (iteration.questionnaire_id IS NULL
              OR iteration.voice_agent_id IS NULL
              OR NULLIF(TRIM(iteration.voice_agent_snapshot ->> 'app_id'), '') IS NULL
              OR CASE
                WHEN COALESCE(iteration.voice_agent_snapshot ->> 'app_version', '') ~ '^[0-9]+$'
                  THEN (iteration.voice_agent_snapshot ->> 'app_version')::int
                ELSE 0
              END <= 0
              OR NULLIF(TRIM(iteration.voice_agent_snapshot ->> 'connection_id'), '') IS NULL
              OR NULLIF(TRIM(iteration.voice_agent_snapshot ->> 'outbound_phone_number'), '') IS NULL))
          AS iteration_configuration_gaps
    `),
    db.query(`
      SELECT execution.id AS execution_id, execution.callback_received_at,
        execution.created_at, call_record.connectivity_status,
        call_record.duration_seconds, call_record.normalized_status,
        CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
          THEN jsonb_array_length(call_record.interaction_transcript) ELSE 0 END
          AS transcript_turns,
        CASE WHEN jsonb_typeof(call_record.response_variables) = 'object'
          THEN (SELECT COUNT(*) FROM jsonb_object_keys(call_record.response_variables))
          ELSE 0 END AS response_variables,
        COALESCE(execution.request_payload #>> '{providerDeployment,app_id}',
          iteration.voice_agent_snapshot ->> 'app_id') AS app_id,
        CASE
          WHEN COALESCE(execution.request_payload #>> '{providerDeployment,app_version}', '') ~ '^[0-9]+$'
            THEN (execution.request_payload #>> '{providerDeployment,app_version}')::int
          WHEN COALESCE(iteration.voice_agent_snapshot ->> 'app_version', '') ~ '^[0-9]+$'
            THEN (iteration.voice_agent_snapshot ->> 'app_version')::int
          ELSE NULL
        END AS app_version,
        COALESCE(execution.request_payload #>> '{providerDeployment,connection_id}',
          iteration.voice_agent_snapshot ->> 'connection_id') AS connection_id,
        campaign.campaign_name, iteration.iteration_number, run.run_number
      FROM call_executions execution
      JOIN campaign_runs run ON run.id = execution.run_id
      JOIN program_iterations iteration ON iteration.id = run.iteration_id
      LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
      LEFT JOIN campaigns campaign ON campaign.id = link.campaign_id
      JOIN LATERAL (
        SELECT item.* FROM calls item
        WHERE item.attempt_id = execution.provider_attempt_id
        ORDER BY item.updated_at DESC NULLS LAST LIMIT 1
      ) call_record ON TRUE
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        AND jsonb_typeof(call_record.interaction_transcript) = 'array'
        AND jsonb_array_length(call_record.interaction_transcript) > 0
      ORDER BY execution.callback_received_at DESC NULLS LAST,
        execution.created_at DESC
      LIMIT 1
    `)
  ]);

  const [delayed, traceExecutions, lifecycleDrifts] = await Promise.all([db.query(`
    SELECT execution.id AS execution_id, execution.provider_attempt_id,
      execution.status, execution.submitted_at, execution.created_at,
      run.run_number, iteration.iteration_number, iteration.iteration_name,
      campaign.campaign_name
    FROM call_executions execution
    JOIN campaign_runs run ON run.id = execution.run_id
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    LEFT JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE execution.callback_received_at IS NULL
      AND execution.status IN ('PENDING', 'SUBMITTED', 'RUNNING')
      AND COALESCE(execution.submitted_at, execution.created_at)
        < now() - interval '30 minutes'
    ORDER BY COALESCE(execution.submitted_at, execution.created_at) ASC
    LIMIT 20
  `), db.query(`
    SELECT execution.id AS execution_id, execution.run_contact_id,
      execution.provider_attempt_id, execution.status AS execution_status,
      execution.error_message, execution.submitted_at,
      execution.callback_received_at, execution.created_at, execution.updated_at,
      execution.request_payload #>> '{providerDeployment,app_id}' AS submitted_app_id,
      execution.request_payload #>> '{providerDeployment,app_version}' AS submitted_app_version,
      execution.request_payload #>> '{providerDeployment,connection_id}' AS submitted_connection_id,
      iteration.voice_agent_snapshot ->> 'app_id' AS snapshot_app_id,
      iteration.voice_agent_snapshot ->> 'app_version' AS snapshot_app_version,
      iteration.voice_agent_snapshot ->> 'connection_id' AS snapshot_connection_id,
      call_record.connectivity_status, call_record.failure_reason,
      call_record.normalized_status, call_record.interaction_transcript,
      run.status AS run_status, iteration.status AS iteration_status,
      link.status AS iteration_link_status,
      contact.final_status AS contact_final_status,
      contact.retry_exhausted AS contact_retry_exhausted,
      NOT EXISTS (
        SELECT 1 FROM call_executions newer
        WHERE newer.run_contact_id = execution.run_contact_id
          AND newer.created_at > execution.created_at
      ) AS is_latest_for_contact,
      CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
        THEN jsonb_array_length(call_record.interaction_transcript) ELSE 0 END AS transcript_turns,
      CASE WHEN jsonb_typeof(call_record.response_variables) = 'object'
        THEN (SELECT COUNT(*) FROM jsonb_object_keys(call_record.response_variables))
        ELSE 0 END AS response_variables,
      campaign.campaign_name, iteration.iteration_number, run.run_number
    FROM call_executions execution
    JOIN campaign_runs run ON run.id = execution.run_id
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    LEFT JOIN campaigns campaign ON campaign.id = link.campaign_id
    LEFT JOIN campaign_run_contacts contact ON contact.id = execution.run_contact_id
    LEFT JOIN LATERAL (
      SELECT item.* FROM calls item
      WHERE item.attempt_id = execution.provider_attempt_id
      ORDER BY item.updated_at DESC NULLS LAST LIMIT 1
    ) call_record ON TRUE
    WHERE execution.created_at >= now() - interval '90 days'
      OR (execution.callback_received_at IS NULL
        AND execution.status IN ('PENDING', 'SUBMITTED', 'RUNNING'))
    ORDER BY execution.created_at DESC
    LIMIT 2000
  `), db.query(`
    SELECT run.id AS run_id, run.status AS run_status, run.run_number,
      iteration.iteration_number, campaign.campaign_name,
      COUNT(contact.id)::int AS selected_contacts,
      COUNT(contact.id) FILTER (WHERE contact.final_status <> 'PENDING')::int AS resolved_contacts,
      (SELECT COUNT(*)::int FROM call_executions active
        WHERE active.run_id = run.id
          AND active.callback_received_at IS NULL
          AND active.status IN ('PENDING', 'SUBMITTED', 'RUNNING')) AS active_executions,
      MAX(run.updated_at) AS updated_at
    FROM campaign_runs run
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    LEFT JOIN campaigns campaign ON campaign.id = link.campaign_id
    JOIN campaign_run_contacts contact ON contact.run_id = run.id
      AND contact.selection_status = 'SELECTED'
    WHERE run.status IN ('READY', 'RUNNING')
    GROUP BY run.id, run.status, run.run_number,
      iteration.iteration_number, campaign.campaign_name
    HAVING COUNT(contact.id) > 0
      AND COUNT(contact.id) FILTER (WHERE contact.final_status <> 'PENDING') = COUNT(contact.id)
      AND (SELECT COUNT(*) FROM call_executions active
        WHERE active.run_id = run.id
          AND active.callback_received_at IS NULL
          AND active.status IN ('PENDING', 'SUBMITTED', 'RUNNING')) = 0
    ORDER BY MAX(run.updated_at) DESC
    LIMIT 20
  `)]);

  const issueTrace = buildCallIssueTrace({
    executions: traceExecutions.rows,
    webhooks: recentWebhooks.rows,
    lifecycleDrifts: lifecycleDrifts.rows
  });

  return {
    database: { status: "reachable" },
    summary: {
      ...executions.rows[0], ...webhooks.rows[0],
      ...evidence.rows[0], ...recoveryEvents.rows[0]
    },
    integration: integrationConfiguration.rows[0],
    latestConversation: latestConversation.rows[0] || null,
    delayedCalls: delayed.rows,
    unresolvedWebhooks: recentWebhooks.rows,
    issueTrace,
    generatedAt: new Date().toISOString()
  };
}

function numeric(value) {
  return Number(value || 0);
}

function check(id, area, label, status, message, blocking = false) {
  return { id, area, label, status, message, blocking };
}

export function evaluatePlatformHealth({ overview, timer, now = new Date() }) {
  const summary = overview.summary || {};
  const integration = overview.integration || {};
  const latest = overview.latestConversation;
  const checks = [];

  checks.push(check(
    "api", "CORE", "API service", "PASS",
    "Authenticated Platform Health endpoint responded."
  ));
  checks.push(check(
    "database", "CORE", "Database connectivity",
    overview.database?.status === "reachable" ? "PASS" : "FAIL",
    overview.database?.status === "reachable"
      ? "Operational PostgreSQL queries completed."
      : "The API could not complete its operational database queries.",
    overview.database?.status !== "reachable"
  ));

  const timerHealthy = timer?.status === "waiting" &&
    (!timer.lastResult || timer.lastResult === "success");
  checks.push(check(
    "recovery", "CORE", "Lifecycle recovery",
    timerHealthy ? "PASS" : timer?.status === "unknown" ? "WARN" : "FAIL",
    timerHealthy
      ? "Recovery timer is waiting and the latest observed service result is healthy."
      : timer?.status === "unknown"
        ? "Recovery timer state could not be verified on this host."
        : "Recovery timer or its latest service result needs attention.",
    !timerHealthy
  ));

  const enabledAgents = numeric(integration.enabled_agents);
  const invalidAgents = numeric(integration.invalid_enabled_agents);
  checks.push(check(
    "sarvam-catalog", "SARVAM", "Voice-agent catalogue",
    enabledAgents > 0 && invalidAgents === 0 ? "PASS" : "FAIL",
    enabledAgents === 0
      ? "No enabled Sarvam voice agent is available."
      : invalidAgents > 0
        ? `${invalidAgents} enabled agent record(s) are missing a deployment field.`
        : `${enabledAgents} enabled agent record(s) have complete provider identity.`,
    enabledAgents === 0 || invalidAgents > 0
  ));

  const openIterations = numeric(integration.open_iterations);
  const configurationGaps = numeric(integration.iteration_configuration_gaps);
  checks.push(check(
    "iteration-config", "PRE-LAUNCH", "Open Iteration configuration",
    configurationGaps === 0 ? "PASS" : "FAIL",
    configurationGaps === 0
      ? openIterations
        ? `${openIterations} open Iteration(s) have questionnaire and voice-agent snapshots.`
        : "No open Iteration currently requires launch configuration."
      : `${configurationGaps} open Iteration(s) are missing questionnaire or voice-agent identity.`,
    configurationGaps > 0
  ));

  const delayed = numeric(summary.delayed_callbacks);
  const unresolved = numeric(summary.unresolved_total);
  checks.push(check(
    "callback-pipeline", "SARVAM", "Callback processing",
    delayed === 0 && unresolved === 0 ? "PASS" : "FAIL",
    delayed === 0 && unresolved === 0
      ? "No delayed callback or unresolved webhook event is recorded."
      : `${delayed} delayed callback(s) and ${unresolved} unresolved webhook event(s) require review.`,
    delayed > 0 || unresolved > 0
  ));

  const evidenceGaps = numeric(summary.missing_transcripts) +
    numeric(summary.missing_responses);
  checks.push(check(
    "evidence", "EVIDENCE", "Connected-call evidence",
    evidenceGaps === 0 ? "PASS" : "WARN",
    evidenceGaps === 0
      ? "All connected calls have retained transcripts and response sets."
      : `${evidenceGaps} historical connected-call evidence gap(s) need reconciliation.`
  ));

  let canaryStatus = "FAIL";
  let canaryMessage = "No connected conversation with transcript evidence is available.";
  let canaryBlocking = true;
  if (latest) {
    const observedAt = new Date(latest.callback_received_at || latest.created_at);
    const ageMs = now.getTime() - observedAt.getTime();
    const stale = !Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000;
    const progressed = numeric(latest.transcript_turns) >= 4 &&
      numeric(latest.response_variables) > 0 &&
      String(latest.normalized_status || "").toUpperCase() === "SUCCESS_COMPLETE";
    canaryStatus = progressed ? stale ? "WARN" : "PASS" : "FAIL";
    canaryBlocking = !progressed || stale;
    canaryMessage = progressed
      ? `${latest.transcript_turns} turns and ${latest.response_variables} response variables were retained${stale ? ", but the proof is older than seven days" : " in the latest successful conversation"}.`
      : `Latest connected evidence has ${numeric(latest.transcript_turns)} turns, ${numeric(latest.response_variables)} response variables and outcome ${latest.normalized_status || "unknown"}.`;
  }
  checks.push(check(
    "conversation-canary", "PRE-LAUNCH", "End-to-end conversation canary",
    canaryStatus, canaryMessage, canaryBlocking
  ));

  const totals = checks.reduce((result, item) => {
    result[item.status.toLowerCase()] += 1;
    if (item.blocking && item.status !== "PASS") result.blocking += 1;
    return result;
  }, { pass: 0, warn: 0, fail: 0, blocking: 0 });

  return {
    status: totals.blocking > 0 ? "ATTENTION_REQUIRED"
      : totals.warn > 0 ? "READY_WITH_WARNINGS" : "READY",
    ...totals,
    checks
  };
}
