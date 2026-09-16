"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity, AlertCircle, BarChart3, CheckCircle2, Clock3, FileText,
  LoaderCircle, Phone, RefreshCw, Search, Timer, UserRound, X
} from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./calls.module.css";

type Summary = {
  total_attempts: number; connected: number; failed: number; awaiting_callback: number;
  transcripts_captured: number; average_duration_seconds: string | number | null;
};
type Campaign = { id: string; campaign_code: string; campaign_name: string };
type CallItem = {
  execution_id: string; execution_status: string; provider_attempt_id: string | null;
  attempt_number: number; submitted_at: string | null; callback_received_at: string | null;
  created_at: string; completed_at: string | null; error_message: string | null;
  call_id: string | null; interaction_id: string | null; connectivity_status: string | null;
  failure_reason: string | null; duration_seconds: string | number | null; transcript_turns: number;
  response_variables: number; voter_name: string | null; phone_ending: string; is_demo_contact: boolean;
  attempt_status: string | null; final_status: string | null; retry_eligible: boolean | null;
  retry_exhausted: boolean | null; completion_reason: string | null;
  run_id: string; run_number: number; run_name: string; run_status: string;
  iteration_id: string; iteration_number: number; iteration_name: string;
  campaign_id: string; campaign_code: string; campaign_name: string; campaign_status: string;
  voice_agent_name: string | null;
};
type CallDetail = Omit<CallItem, "response_variables"> & {
  interaction_transcript: unknown[] | null;
  response_variables: Record<string, unknown> | null;
  analytical_snapshot: Record<string, unknown> | null;
};
type HierarchyRow = {
  campaign_id: string; campaign_code: string; campaign_name: string;
  iteration_id: string; iteration_number: number; iteration_name: string;
  run_id: string; run_number: number; run_name: string; run_status: string;
  total_attempts: number; connected: number; failed: number; awaiting_callback: number;
  transcripts_captured: number; average_duration_seconds: string | number | null; latest_attempt_at: string;
};
type CallResponse = {
  items: CallItem[]; total: number; limit: number; offset: number; summary: Summary;
  hierarchy: HierarchyRow[]; campaigns: Campaign[];
};

function number(value: unknown) { return Number(value || 0); }
function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function duration(value: string | number | null) {
  const seconds = Math.round(number(value));
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
function operationalStatus(item: Pick<CallItem, "connectivity_status" | "callback_received_at" | "execution_status">) {
  if (String(item.connectivity_status || "").toLowerCase() === "connected") return "CONNECTED";
  if (!item.callback_received_at && ["PENDING", "SUBMITTED", "RUNNING"].includes(String(item.execution_status).toUpperCase())) return "AWAITING CALLBACK";
  return String(item.execution_status || item.connectivity_status || "UNKNOWN").toUpperCase();
}
function transcriptTurn(value: unknown) {
  if (!value || typeof value !== "object") return { speaker: "Turn", text: String(value ?? "") };
  const item = value as Record<string, unknown>;
  return {
    speaker: String(item.role || item.speaker || item.participant || item.source || "Turn"),
    text: String(item.text || item.content || item.message || item.transcript || JSON.stringify(item))
  };
}

export default function CallsPage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<CallResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filters, setFilters] = useState({ status: "ALL", campaignId: "", search: "", from: "", to: "" });
  const [selectedIterationId, setSelectedIterationId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  function queryFor(iterationId = "", runId = "") {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(function ([key, value]) { if (value && value !== "ALL") query.set(key, value); });
    if (iterationId) query.set("iterationId", iterationId);
    if (runId) query.set("runId", runId);
    query.set("limit", "100");
    return query;
  }

  async function loadCalls() {
    setLoading(true); setMessage(null);
    try {
      const scope = await apiFetch(`/api/call-operations?${queryFor().toString()}`) as CallResponse;
      const iterationId = scope.hierarchy.some(function (row) { return row.iteration_id === selectedIterationId; })
        ? selectedIterationId : scope.hierarchy[0]?.iteration_id || "";
      const runId = scope.hierarchy.some(function (row) { return row.iteration_id === iterationId && row.run_id === selectedRunId; })
        ? selectedRunId : scope.hierarchy.find(function (row) { return row.iteration_id === iterationId; })?.run_id || "";
      setSelectedIterationId(iterationId); setSelectedRunId(runId);
      if (!runId) return setData(scope);
      const selectedData = await apiFetch(`/api/call-operations?${queryFor(iterationId, runId).toString()}`) as CallResponse;
      setData({ ...selectedData, hierarchy: scope.hierarchy, campaigns: scope.campaigns });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load call operations"); }
    finally { setLoading(false); }
  }

  async function loadRun(iterationId: string, runId: string) {
    setSelectedIterationId(iterationId); setSelectedRunId(runId); setLoading(true); setMessage(null);
    try {
      const selectedData = await apiFetch(`/api/call-operations?${queryFor(iterationId, runId).toString()}`) as CallResponse;
      setData(function (current) {
        return { ...selectedData, hierarchy: current?.hierarchy || selectedData.hierarchy, campaigns: current?.campaigns || selectedData.campaigns };
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load Run calls"); }
    finally { setLoading(false); }
  }

  useEffect(function () { if (user) loadCalls(); }, [user]);

  async function openDetail(executionId: string) {
    setDetailLoading(true); setMessage(null);
    try { setSelected(await apiFetch(`/api/call-operations/${executionId}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load call details"); }
    finally { setDetailLoading(false); }
  }

  const summary = data?.summary;
  const iterations = Array.from(new Map((data?.hierarchy || []).map(function (row) {
    const existing = (data?.hierarchy || []).filter(function (item) { return item.iteration_id === row.iteration_id; });
    return [row.iteration_id, {
      id: row.iteration_id, number: row.iteration_number, name: row.iteration_name,
      campaignName: row.campaign_name, campaignId: row.campaign_id,
      runs: existing.length,
      total: existing.reduce(function (sum, item) { return sum + number(item.total_attempts); }, 0),
      connected: existing.reduce(function (sum, item) { return sum + number(item.connected); }, 0),
      failed: existing.reduce(function (sum, item) { return sum + number(item.failed); }, 0)
    }];
  })).values());
  const runs = (data?.hierarchy || []).filter(function (row) { return row.iteration_id === selectedIterationId; });
  return <AppShell><main className={styles.page}>
    <section className={styles.hero}><div><span>VOICE OPERATIONS</span><h1>Calls</h1><p>Track every authorized call attempt from provider submission through callback, transcript and final voter outcome.</p></div><button type="button" onClick={loadCalls} disabled={loading}><RefreshCw size={16} className={loading ? styles.spin : ""} />Refresh</button></section>
    {message && <FeedbackMessage message={message} className={styles.message} />}
    <section className={styles.metrics}>
      <Metric icon={Phone} label="Total attempts" value={number(summary?.total_attempts)} detail={`${data?.total || 0} in current view`} />
      <Metric icon={CheckCircle2} label="Connected" value={number(summary?.connected)} detail="Provider confirmed" tone="good" />
      <Metric icon={AlertCircle} label="Failed" value={number(summary?.failed)} detail="Retry or terminal review" tone="danger" />
      <Metric icon={Clock3} label="Awaiting callback" value={number(summary?.awaiting_callback)} detail="Recovery timer monitors these" tone="warn" />
      <Metric icon={FileText} label="Transcripts" value={number(summary?.transcripts_captured)} detail={`Average ${duration(summary?.average_duration_seconds ?? null)}`} />
    </section>
    <section className={styles.workspace}>
      <div className={styles.workspaceHead}><div><span>ITERATION → RUN → CALL</span><h2>Call analysis</h2><p>Select an Iteration, then a Run, to review its recipients and evidence.</p></div><strong>{iterations.length} iterations</strong></div>
      <div className={styles.filters}>
        <label className={styles.search}><Search size={15} /><input value={filters.search} onChange={function (event) { setFilters({ ...filters, search: event.target.value }); }} placeholder="Voter, campaign, attempt ID or last 4 digits" /></label>
        <label>Status<select value={filters.status} onChange={function (event) { setFilters({ ...filters, status: event.target.value }); }}><option value="ALL">All statuses</option><option value="CONNECTED">Connected</option><option value="FAILED">Failed</option><option value="AWAITING_CALLBACK">Awaiting callback</option><option value="COMPLETED">Completed execution</option></select></label>
        <label>Campaign<select value={filters.campaignId} onChange={function (event) { setFilters({ ...filters, campaignId: event.target.value }); }}><option value="">All campaigns</option>{data?.campaigns.map(function (campaign) { return <option key={campaign.id} value={campaign.id}>{campaign.campaign_name}</option>; })}</select></label>
        <label>From<input type="date" value={filters.from} onChange={function (event) { setFilters({ ...filters, from: event.target.value }); }} /></label>
        <label>To<input type="date" value={filters.to} onChange={function (event) { setFilters({ ...filters, to: event.target.value }); }} /></label>
        <button type="button" onClick={loadCalls} disabled={loading}>{loading ? <LoaderCircle size={15} className={styles.spin} /> : <Search size={15} />}Apply</button>
      </div>
      {loading && !data ? <div className={styles.empty}><LoaderCircle size={22} className={styles.spin} />Loading call operations…</div> : !iterations.length ? <div className={styles.empty}><Phone size={24} /><strong>No call attempts match these filters</strong><span>Launch an authorized Run or adjust the filters.</span></div> : <div className={styles.hierarchy}>
        <aside className={styles.iterations}><div className={styles.sectionLabel}>1 · Select Iteration</div>{iterations.map(function (iteration) { return <button type="button" key={iteration.id} data-active={iteration.id === selectedIterationId} onClick={function () { const firstRun = (data?.hierarchy || []).find(function (row) { return row.iteration_id === iteration.id; }); if (firstRun) loadRun(iteration.id, firstRun.run_id); }}><div><span>Iteration {iteration.number}</span><strong>{iteration.name}</strong><small>{iteration.campaignName}</small></div><div className={styles.iterationStats}><em>{iteration.runs} Runs</em><em>{iteration.connected}/{iteration.total} connected</em>{iteration.failed > 0 && <em>{iteration.failed} failed</em>}</div></button>; })}</aside>
        <div className={styles.runWorkspace}><div className={styles.sectionLabel}>2 · Select Run</div><div className={styles.runs}>{runs.map(function (run) { return <button type="button" key={run.run_id} data-active={run.run_id === selectedRunId} onClick={function () { loadRun(run.iteration_id, run.run_id); }}><div><span>Run {run.run_number}</span><strong>{run.run_name}</strong><small>{run.run_status} · {dateTime(run.latest_attempt_at)}</small></div><div className={styles.runStats}><em>{run.total_attempts} attempts</em><em>{run.connected} connected</em><em>{run.failed} failed</em><em>{run.transcripts_captured} transcripts</em></div></button>; })}</div>
          <div className={styles.callLevel}><div className={styles.callLevelHead}><div><span>3 · Call attempts</span><strong>{runs.find(function (run) { return run.run_id === selectedRunId; })?.run_name || "Select a Run"}</strong></div><em>{data?.total || 0} attempts</em></div>
          {loading ? <div className={styles.empty}><LoaderCircle size={21} className={styles.spin} />Loading Run calls…</div> : !data?.items.length ? <div className={styles.empty}><Phone size={22} /><strong>No attempts in this Run match the filters</strong></div> : <div className={styles.tableWrap}><table><thead><tr><th>Recipient</th><th>Attempt</th><th>Status</th><th>Timing</th><th>Evidence</th><th>Outcome</th></tr></thead><tbody>{data.items.map(function (item) { const status = operationalStatus(item); return <tr key={item.execution_id} onClick={function () { openDetail(item.execution_id); }}><td><strong>{item.voter_name || "Unknown voter"}</strong><span>•••• {item.phone_ending || "—"}{item.is_demo_contact ? " · Demo" : ""}</span></td><td><strong>Attempt {item.attempt_number}</strong><span>{item.voice_agent_name || "Agent not recorded"}</span></td><td><em data-status={status}>{status}</em><span>{item.connectivity_status || item.execution_status}</span></td><td><strong>{duration(item.duration_seconds)}</strong><span>{dateTime(item.created_at)}</span></td><td><strong>{item.transcript_turns} turns</strong><span>{item.response_variables} response variables</span></td><td><strong>{item.final_status || item.attempt_status || "PENDING"}</strong><span>{item.completion_reason || item.failure_reason || (item.retry_eligible ? "Retry eligible" : "—")}</span></td></tr>; })}</tbody></table></div>}
          </div>
        </div>
      </div>}
    </section>
    {(selected || detailLoading) && <div className={styles.backdrop} role="presentation" onMouseDown={function (event) { if (event.target === event.currentTarget && !detailLoading) setSelected(null); }}><section className={styles.drawer} role="dialog" aria-modal="true" aria-label="Call details">{detailLoading && !selected ? <div className={styles.empty}><LoaderCircle className={styles.spin} />Loading call details…</div> : selected && <><header><div><span>CALL ATTEMPT</span><h2>{selected.voter_name || "Unknown voter"}</h2><p>•••• {selected.phone_ending} · Attempt {selected.attempt_number} · {selected.voice_agent_name || "Voice agent not recorded"}</p></div><button type="button" onClick={function () { setSelected(null); }}><X size={18} /></button></header><div className={styles.detailBody}>
        <div className={styles.detailGrid}><Detail label="Operational status" value={operationalStatus(selected)} /><Detail label="Provider attempt" value={selected.provider_attempt_id || "Not assigned"} /><Detail label="Submitted" value={dateTime(selected.submitted_at || selected.created_at)} /><Detail label="Callback received" value={dateTime(selected.callback_received_at)} /><Detail label="Duration" value={duration(selected.duration_seconds)} /><Detail label="Final outcome" value={selected.final_status || selected.completion_reason || "Pending"} /></div>
        <nav><Link href={`/campaigns/${selected.campaign_id}`}>{selected.campaign_name}</Link><Link href={`/iterations/${selected.iteration_id}`}>Iteration {selected.iteration_number}</Link></nav>
        {(selected.error_message || selected.failure_reason) && <div className={styles.failure}><AlertCircle size={17} /><span><strong>Failure detail</strong>{selected.error_message || selected.failure_reason}</span></div>}
        <section><h3>Conversation transcript</h3>{Array.isArray(selected.interaction_transcript) && selected.interaction_transcript.length ? <div className={styles.transcript}>{selected.interaction_transcript.map(function (turn, index) { const parsed = transcriptTurn(turn); return <div key={index}><strong>{parsed.speaker}</strong><p>{parsed.text}</p></div>; })}</div> : <div className={styles.noEvidence}>No transcript was stored for this attempt.</div>}</section>
        <section><h3>Captured response variables</h3>{selected.response_variables && Object.keys(selected.response_variables).length ? <div className={styles.variables}>{Object.entries(selected.response_variables).map(function ([key, value]) { return <div key={key}><span>{key}</span><strong>{typeof value === "object" ? JSON.stringify(value) : String(value)}</strong></div>; })}</div> : <div className={styles.noEvidence}>No response variables were stored for this attempt.</div>}</section>
      </div></>}</section></div>}
  </main></AppShell>;
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof Phone; label: string; value: number; detail: string; tone?: string }) {
  return <article className={styles.metric} data-tone={tone || "default"}><Icon size={19} /><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}
function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
