"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, Webhook } from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./pipeline.module.css";

type Summary = {
  awaiting_callbacks: number;
  delayed_callbacks: number;
  failed_attempts_24h: number;
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
type Pipeline = {
  api: { status: string };
  database: { status: string };
  timer: Timer;
  summary: Summary;
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

  const load = useCallback(async function () {
    setLoading(true);
    setMessage(null);
    try { setData(await apiFetch("/api/pipeline") as Pipeline); }
    catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : "Unable to load Pipeline diagnostics");
    } finally { setLoading(false); }
  }, []);

  useEffect(function () {
    if (user?.role.code !== "SUPER_ADMIN") return;
    const timer = window.setTimeout(function () { void load(); }, 0);
    return function () { window.clearTimeout(timer); };
  }, [user, load]);

  return <AppShell><main className={styles.page}>
    <section className={styles.hero}>
      <div><span>SYSTEM OPERATIONS</span><h1>Pipeline</h1>
        <p>Read-only diagnostics for provider callbacks, evidence capture and lifecycle recovery.</p></div>
      {user?.role.code === "SUPER_ADMIN" && <button type="button" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={17} className={loading ? styles.spin : ""} /> Refresh
      </button>}
    </section>

    {user && user.role.code !== "SUPER_ADMIN" ?
      <section className={styles.notice}>Pipeline diagnostics are available to Super Admin only.</section> : <>
        {message && <FeedbackMessage message={message} className={styles.message} />}
        {loading && !data ? <section className={styles.notice}>Loading Pipeline diagnostics…</section> : null}
        {data && <>
          <section className={styles.health}>
            <Health label="API" status={data.api.status} detail="Authenticated Pipeline endpoint" />
            <Health label="Database" status={data.database.status} detail="Operational queries completed" />
            <Health label="Recovery timer" status={data.timer.status} detail={data.timer.status === "waiting" ? "Scheduled on this API host" : "Check the host timer"} />
            <Health label="Last recovery service" status={data.timer.lastResult || "unknown"} detail={data.timer.lastExitStatus === null ? "No exit status observed" : `Exit status ${data.timer.lastExitStatus}`} />
          </section>

          <section className={styles.metrics}>
            <Metric icon={Clock3} label="Awaiting callbacks" value={count(data.summary.awaiting_callbacks)} detail={`${count(data.summary.delayed_callbacks)} past 30 minutes`} warn={data.summary.delayed_callbacks > 0} />
            <Metric icon={Webhook} label="Webhooks, 24 hours" value={`${count(data.summary.processed_24h)}/${count(data.summary.received_24h)}`} detail={`${count(data.summary.unresolved_total)} unresolved overall`} warn={data.summary.unresolved_total > 0} />
            <Metric icon={AlertTriangle} label="Failed attempts, 24 hours" value={count(data.summary.failed_attempts_24h)} detail="Provider or recovery outcomes" warn={data.summary.failed_attempts_24h > 0} />
            <Metric icon={Database} label="Evidence gaps" value={count(data.summary.missing_transcripts + data.summary.missing_responses)} detail={`${count(data.summary.missing_transcripts)} transcripts · ${count(data.summary.missing_responses)} response sets`} warn={data.summary.missing_transcripts + data.summary.missing_responses > 0} />
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
            <div><strong>Provider activity</strong><span>Last webhook {dateTime(data.summary.last_received_at)} · last callback {dateTime(data.summary.last_callback_at)}</span></div>
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
