"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, Bot, Bug, CheckCircle2, Clock3, Code2, Database,
  ListChecks, Radio, RefreshCw, ShieldCheck, Webhook, Workflow, Wrench
} from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./pipeline.module.css";

type Summary = {
  awaiting_callbacks: number;
  delayed_callbacks: number;
  failed_attempts_24h: number;
  attempts_24h: number;
  provider_accepted_24h: number;
  last_submission_at: string | null;
  last_callback_at: string | null;
  received_24h: number;
  processed_24h: number;
  unresolved_total: number;
  last_received_at: string | null;
  missing_transcripts: number;
  missing_responses: number;
  recovered_24h: number;
  last_recovery_at: string | null;
};
type Timer = {
  status: "waiting" | "inactive" | "unknown";
  nextTrigger: string | null;
  lastTrigger: string | null;
  lastResult: string | null;
  lastExitStatus: string | null;
};
type DelayedCall = {
  execution_id: string; provider_attempt_id: string | null; status: string;
  submitted_at: string | null; created_at: string;
  run_number: number; iteration_number: number; iteration_name: string;
  campaign_name: string | null;
};
type WebhookEvent = {
  id: string; attempt_id: string; delivery_status: string;
  error_message: string | null; received_at: string;
  processed_at: string | null; execution_id: string | null;
};
type TraceIncident = {
  id: string;
  code: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  functionality: string;
  situation: string;
  diagnosis: string;
  evidence: string;
  executionId: string | null;
  campaignName: string | null;
  iterationNumber: number | null;
  runNumber: number | null;
  observedAt: string | null;
  involved: Array<{ program: string; method: string }>;
  preliminaryFixes: string[];
  matchedHistoricalControl: {
    implementedSolution: string;
    controlPrograms: string[];
  } | null;
};
type Pipeline = {
  api: { status: string };
  database: { status: string };
  timer: Timer;
  summary: Summary;
  integration: {
    enabled_agents: number;
    invalid_enabled_agents: number;
    open_iterations: number;
    iteration_configuration_gaps: number;
  };
  latestConversation: {
    execution_id: string;
    callback_received_at: string | null;
    created_at: string;
    connectivity_status: string;
    duration_seconds: number | null;
    normalized_status: string | null;
    transcript_turns: number;
    response_variables: number;
    app_id: string | null;
    app_version: number | null;
    connection_id: string | null;
    campaign_name: string | null;
    iteration_number: number;
    run_number: number;
  } | null;
  health: {
    status: "READY" | "READY_WITH_WARNINGS" | "ATTENTION_REQUIRED";
    pass: number;
    warn: number;
    fail: number;
    blocking: number;
    checks: Array<{
      id: string;
      area: string;
      label: string;
      status: "PASS" | "WARN" | "FAIL";
      message: string;
      blocking: boolean;
    }>;
  };
  issueTrace: {
    runtime: {
      status: "CLEAR" | "WATCH" | "ATTENTION_REQUIRED";
      total: number;
      showstoppers: number;
      warnings: number;
      informational: number;
      byFunctionality: Array<{ functionality: string; count: number }>;
      incidents: TraceIncident[];
    };
    history: {
      periodDays: number;
      resolvedObservations: number;
      buckets: Array<{
        code: string;
        functionality: string;
        severity: TraceIncident["severity"];
        occurrences: number;
        firstSeen: string | null;
        lastSeen: string | null;
        solutionStatus: "IMPLEMENTED";
        implementedSolution: string;
        controlPrograms: string[];
      }>;
    };
  };
  delayedCalls: DelayedCall[];
  unresolvedWebhooks: WebhookEvent[];
  generatedAt: string;
};

function count(value: number | undefined) { return Number(value || 0).toLocaleString(); }
function dateTime(value: string | null | undefined) {
  if (!value || value === "n/a") return "Not observed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeStyle: "short"
  }).format(date);
}

export default function PipelinePage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<"ALL" | TraceIncident["severity"]>("ALL");

  const load = useCallback(async function () {
    setLoading(true);
    setMessage(null);
    try { setData(await apiFetch("/api/pipeline") as Pipeline); }
    catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : "Unable to load Platform Health");
    } finally { setLoading(false); }
  }, []);

  useEffect(function () {
    if (user?.role.code !== "SUPER_ADMIN") return;
    const timer = window.setTimeout(function () { void load(); }, 0);
    return function () { window.clearTimeout(timer); };
  }, [user, load]);

  return <AppShell><main className={styles.page}>
    <section className={styles.hero}>
      <div><span>SUPER ADMIN CONTROL PLANE</span><h1>Platform Health</h1>
        <p>Readiness, integrations, evidence integrity and the governed launch checklist in one place.</p></div>
      {user?.role.code === "SUPER_ADMIN" && <button type="button" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={17} className={loading ? styles.spin : ""} /> Refresh
      </button>}
    </section>

    {user && user.role.code !== "SUPER_ADMIN" ?
      <section className={styles.notice}>Platform Health is available to Super Admin only.</section> : <>
        {message && <FeedbackMessage message={message} className={styles.message} />}
        {loading && !data ? <section className={styles.notice}>Loading Platform Health…</section> : null}
        {data && <>
          <section className={styles.readiness} data-status={data.health.status}>
            <div className={styles.readinessIcon}>
              {data.health.status === "READY" ? <ShieldCheck size={28} /> : <AlertTriangle size={28} />}
            </div>
            <div className={styles.readinessCopy}>
              <span>LAUNCH READINESS</span>
              <h2>{data.health.status === "READY" ? "All critical checks passed"
                : data.health.status === "READY_WITH_WARNINGS" ? "Ready with warnings"
                  : "Attention required before bulk launch"}</h2>
              <p>{data.health.blocking
                ? `${data.health.blocking} blocking check(s) require Super Admin review.`
                : "Core services, Sarvam handoff and the end-to-end conversation proof are ready."}</p>
            </div>
            <div className={styles.readinessTotals}>
              <div><strong>{data.health.pass}</strong><span>Passed</span></div>
              <div><strong>{data.health.warn}</strong><span>Warnings</span></div>
              <div><strong>{data.health.fail}</strong><span>Failed</span></div>
            </div>
          </section>

          <section className={styles.health}>
            <Health label="API" status={data.api.status} detail="Authenticated Platform Health endpoint" />
            <Health label="Database" status={data.database.status} detail="Operational queries completed" />
            <Health label="Recovery timer" status={data.timer.status} detail={data.timer.status === "waiting" ? "Scheduled on this API host" : "Check the host timer"} />
            <Health label="Last recovery service" status={data.timer.lastResult || "unknown"} detail={data.timer.lastExitStatus === null ? "No exit status observed" : `Exit status ${data.timer.lastExitStatus}`} />
          </section>

          <section className={styles.checklistPanel}>
            <div className={styles.panelHead}>
              <div><span>GOVERNED CHECKLIST</span><h2>Pre-launch checks</h2><p>Blocking checks must pass before a bulk Run is launched.</p></div>
              <ListChecks size={25} />
            </div>
            <div className={styles.checklist}>
              {data.health.checks.map((item) => <article key={item.id} className={styles.checkItem} data-status={item.status}>
                <div className={styles.checkIcon}>{item.status === "PASS" ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</div>
                <div><span>{item.area}</span><strong>{item.label}</strong><p>{item.message}</p></div>
                <div className={styles.checkState}><b>{item.status}</b>{item.blocking && item.status !== "PASS" ? <small>BLOCKING</small> : null}</div>
              </article>)}
            </div>
          </section>

          <section className={styles.integrationGrid}>
            <div className={styles.integrationCard}>
              <Bot size={22} /><span>Enabled Sarvam agents</span>
              <strong>{count(data.integration.enabled_agents)}</strong>
              <small>{count(data.integration.invalid_enabled_agents)} incomplete provider records</small>
            </div>
            <div className={styles.integrationCard}>
              <ListChecks size={22} /><span>Open Iterations</span>
              <strong>{count(data.integration.open_iterations)}</strong>
              <small>{count(data.integration.iteration_configuration_gaps)} launch configuration gaps</small>
            </div>
            <div className={styles.integrationCard}>
              <Radio size={22} /><span>Latest conversation proof</span>
              <strong>{data.latestConversation ? `${count(data.latestConversation.transcript_turns)} turns` : "Not observed"}</strong>
              <small>{data.latestConversation
                ? `${data.latestConversation.campaign_name || "Campaign"} · Iteration ${data.latestConversation.iteration_number} · Run ${data.latestConversation.run_number}`
                : "Run one controlled canary call"}</small>
            </div>
            <div className={styles.integrationCard}>
              <ShieldCheck size={22} /><span>Observed deployment</span>
              <strong>{data.latestConversation?.app_version ? `Version ${data.latestConversation.app_version}` : "Unknown"}</strong>
              <small>{data.latestConversation?.app_id || "No provider app identity observed"}</small>
            </div>
          </section>

          <section className={styles.metrics}>
            <Metric icon={Clock3} label="Awaiting callbacks" value={count(data.summary.awaiting_callbacks)} detail={`${count(data.summary.delayed_callbacks)} past 30 minutes`} warn={data.summary.delayed_callbacks > 0} />
            <Metric icon={Webhook} label="Webhooks, 24 hours" value={`${count(data.summary.processed_24h)}/${count(data.summary.received_24h)}`} detail={`${count(data.summary.unresolved_total)} unresolved overall`} warn={data.summary.unresolved_total > 0} />
            <Metric icon={AlertTriangle} label="Failed attempts, 24 hours" value={count(data.summary.failed_attempts_24h)} detail={`${count(data.summary.provider_accepted_24h)}/${count(data.summary.attempts_24h)} submissions accepted by provider`} warn={data.summary.failed_attempts_24h > 0} />
            <Metric icon={Database} label="Evidence gaps" value={count(data.summary.missing_transcripts + data.summary.missing_responses)} detail={`${count(data.summary.missing_transcripts)} transcripts · ${count(data.summary.missing_responses)} response sets`} warn={data.summary.missing_transcripts + data.summary.missing_responses > 0} />
          </section>

          <section className={styles.tracePanel} data-status={data.issueTrace.runtime.status}>
            <div className={styles.traceHead}>
              <div className={styles.traceTitle}>
                <div className={styles.traceIcon}><Bug size={23} /></div>
                <div><span>CALL WORKFLOW OBSERVABILITY</span><h2>Runtime issue tracer</h2>
                  <p>Only unresolved conditions affecting an active call workflow appear here. Resolved observations are kept in the separate history below.</p></div>
              </div>
              <div className={styles.traceTotals}>
                <div><strong>{data.issueTrace.runtime.showstoppers}</strong><span>Showstoppers</span></div>
                <div><strong>{data.issueTrace.runtime.warnings}</strong><span>Warnings</span></div>
                <div><strong>{data.issueTrace.runtime.total}</strong><span>Active issues</span></div>
              </div>
            </div>

            {data.issueTrace.runtime.byFunctionality.length ? <div className={styles.functionalityStrip}>
              {data.issueTrace.runtime.byFunctionality.map((item) => <div key={item.functionality}>
                <Workflow size={14} /><span>{item.functionality}</span><strong>{item.count}</strong>
              </div>)}
            </div> : null}

            <div className={styles.traceToolbar}>
              <strong>{data.issueTrace.runtime.status === "CLEAR" ? "No active workflow issue" : `${data.issueTrace.runtime.total} runtime issue(s) need review`}</strong>
              <div>{(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((filter) =>
                <button key={filter} type="button" data-active={issueFilter === filter}
                  onClick={() => setIssueFilter(filter)}>{filter === "INFO" ? "OPERATIONAL" : filter}</button>)}</div>
            </div>

            <div className={styles.traceList}>
              {data.issueTrace.runtime.incidents.filter((item) => issueFilter === "ALL" || item.severity === issueFilter)
                .map((item) => <details key={item.id} className={styles.traceItem} data-severity={item.severity}>
                  <summary>
                    <div className={styles.traceBadge}>{item.severity === "INFO" ? "OPERATIONAL" : item.severity}</div>
                    <div><strong>{item.code.replaceAll("_", " ")}</strong>
                      <span>{item.functionality} · {item.campaignName || "Platform"}
                        {item.iterationNumber !== null ? ` · Iteration ${item.iterationNumber}` : ""}
                        {item.runNumber !== null ? ` · Run ${item.runNumber}` : ""}</span></div>
                    <time>{dateTime(item.observedAt)}</time>
                  </summary>
                  <div className={styles.traceBody}>
                    <div className={styles.traceNarrative}>
                      <div><span>Situation</span><p>{item.situation}</p></div>
                      <div><span>Observed evidence</span><p>{item.evidence}</p></div>
                      <div><span>Preliminary diagnosis</span><p>{item.diagnosis}</p></div>
                    </div>
                    <div className={styles.traceColumns}>
                      <div><h3><Code2 size={16} /> Programs and functions involved</h3>
                        <ul>{item.involved.map((entry) => <li key={`${entry.program}:${entry.method}`}>
                          <code>{entry.program}</code><span>{entry.method}</span></li>)}</ul></div>
                      <div><h3><Wrench size={16} /> Preliminary fixes</h3>
                        <ol>{item.preliminaryFixes.map((fix) => <li key={fix}>{fix}</li>)}</ol></div>
                    </div>
                    {item.matchedHistoricalControl ? <div className={styles.knownControl}>
                      <ShieldCheck size={17} />
                      <div><span>Matched historical control</span>
                        <p>{item.matchedHistoricalControl.implementedSolution}</p>
                        <div className={styles.controlTags}>{item.matchedHistoricalControl.controlPrograms.map((program) =>
                          <code key={program}>{program}</code>)}</div>
                      </div>
                    </div> : null}
                    {item.executionId ? <Link className={styles.inspectLink} href={`/calls?executionId=${item.executionId}`}>Inspect authorized call evidence →</Link> : null}
                  </div>
                </details>)}
              {data.issueTrace.runtime.incidents.filter((item) => issueFilter === "ALL" || item.severity === issueFilter).length === 0 ?
                <p className={styles.empty}>No active runtime issue matches this severity.</p> : null}
            </div>
          </section>

          <section className={styles.historyPanel}>
            <div className={styles.historyHead}>
              <div><span>RESOLVED ISSUE KNOWLEDGE</span><h2>Historical issues and implemented controls</h2>
                <p>{data.issueTrace.history.resolvedObservations} resolved observation(s), grouped into reusable diagnostic knowledge from the last {data.issueTrace.history.periodDays} days.</p></div>
              <ShieldCheck size={25} />
            </div>
            {data.issueTrace.history.buckets.length ? <div className={styles.historyGrid}>
              {data.issueTrace.history.buckets.map((bucket) => <article key={bucket.code} className={styles.historyCard}>
                <div className={styles.historyCardHead}>
                  <div><span>{bucket.functionality}</span><strong>{bucket.code.replaceAll("_", " ")}</strong></div>
                  <b>{bucket.occurrences}</b>
                </div>
                <p>{bucket.implementedSolution}</p>
                <div className={styles.controlTags}>{bucket.controlPrograms.map((program) =>
                  <code key={program}>{program}</code>)}</div>
                <footer><span>{bucket.solutionStatus}</span><small>Last observed {dateTime(bucket.lastSeen)}</small></footer>
              </article>)}
            </div> : <p className={styles.empty}>No resolved issue history is available in this period.</p>}
          </section>

          <section className={styles.grid}>
            <div className={styles.panel}>
              <div className={styles.panelHead}><div><span>CALL DELIVERY</span><h2>Delayed callbacks</h2><p>Oldest 20 submitted attempts with no callback after 30 minutes.</p></div><strong>{count(data.summary.delayed_callbacks)}</strong></div>
              {data.delayedCalls.length ? <div className={styles.rows}>{data.delayedCalls.map((call) => <Link key={call.execution_id} className={styles.row} href={`/calls?executionId=${call.execution_id}`}>
                <div><strong>{call.campaign_name || "Campaign"} · Iteration {call.iteration_number} · Run {call.run_number}</strong><span>{call.iteration_name} · {call.status} · submitted {dateTime(call.submitted_at || call.created_at)}</span></div><span>Inspect call →</span>
              </Link>)}</div> : <p className={styles.empty}>No delayed callbacks.</p>}
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}><div><span>SARVAM INTEGRATION</span><h2>Unresolved webhook events</h2><p>Latest 20 events not marked processed; raw payloads are not displayed.</p></div><strong>{count(data.summary.unresolved_total)}</strong></div>
              {data.unresolvedWebhooks.length ? <div className={styles.rows}>{data.unresolvedWebhooks.map((event) => <div key={event.id} className={styles.row}>
                <div><strong>{event.delivery_status} · {event.attempt_id}</strong><span>{event.error_message || "Awaiting processing"} · received {dateTime(event.received_at)}</span></div>
                {event.execution_id && <Link href={`/calls?executionId=${event.execution_id}`}>Inspect call →</Link>}
              </div>)}</div> : <p className={styles.empty}>No unresolved webhook events.</p>}
            </div>
          </section>

          <section className={styles.footer}>
            <div><strong>Recovery</strong><span>{count(data.summary.recovered_24h)} stale executions recovered in 24 hours · last recovery event {dateTime(data.summary.last_recovery_at)}</span></div>
            <div><strong>Provider activity</strong><span>Last submission {dateTime(data.summary.last_submission_at)} · webhook {dateTime(data.summary.last_received_at)} · callback {dateTime(data.summary.last_callback_at)}</span></div>
            <div><strong>Timer</strong><span>Last trigger {dateTime(data.timer.lastTrigger)} · next trigger {dateTime(data.timer.nextTrigger)}</span></div>
            <small>Snapshot {dateTime(data.generatedAt)}. An idle provider feed is not proof of delivery health; use a consented test call to verify end-to-end behavior.</small>
          </section>
        </>}
      </>}
  </main></AppShell>;
}

function Health({ label, status, detail }: { label: string; status: string; detail: string }) {
  const healthy = ["reachable", "waiting", "success"].includes(status);
  const unknown = status === "unknown";
  return <div className={styles.healthItem} data-status={healthy ? "good" : unknown ? "unknown" : "warn"}>
    {healthy ? <CheckCircle2 size={20} /> : unknown ? <Activity size={20} /> : <AlertTriangle size={20} />}
    <div><span>{label}</span><strong>{status.replaceAll("_", " ")}</strong><small>{detail}</small></div>
  </div>;
}

function Metric({ icon: Icon, label, value, detail, warn }: {
  icon: typeof Clock3; label: string; value: string; detail: string; warn: boolean;
}) {
  return <div className={styles.metric} data-warn={warn}><Icon size={21} /><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
