"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ClipboardList,
  Clock3, FileText, LoaderCircle, Megaphone, PhoneCall, RefreshCw,
  ShieldCheck, Users
} from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser, type PlatformRole } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./dashboard.module.css";

type Summary = {
  campaignsVisible: number; campaignsCompleted: number; campaignsWithoutManager: number;
  iterationsVisible: number; iterationsCompleted: number;
  runsReady: number; runsRunning: number; runsClosed: number;
  pendingContacts: number; retryEligibleContacts: number; successfulContacts: number;
  callAttempts: number; awaitingCallbacks: number; staleCallbacks: number;
  connectedCalls: number; missingTranscripts: number; missingResponses: number;
};
type RoleBrief = {
  eyebrow: string; title: string; status: string; description: string;
  responsibility: string; boundary: string; nextHref: string; nextLabel: string;
};
type Action = {
  kind: string; priority: number; title: string; detail: string;
  href: string; campaignName: string | null;
};
type Iteration = {
  id: string; number: number; name: string; status: string;
  runCount: number; readyRunCount: number; runningRunCount: number;
};
type Campaign = {
  id: string; name: string; code: string; status: string;
  managerAssigned: boolean; iterationCount: number;
  completedIterationCount: number; activeRunCount: number;
  callAttempts: number; connectedCalls: number; successfulContacts: number;
  evidenceExceptions: number; connectionRatePct: number; evidenceReadyPct: number;
  iterations: Iteration[];
};
type Dashboard = {
  role: PlatformRole; roleBrief?: RoleBrief; summary: Summary; actions: Action[];
  campaigns: Campaign[]; generatedAt: string;
};
type Metric = {
  label: string; value: string; detail: string; icon: typeof BarChart3;
};

function count(value: number) { return Number(value || 0).toLocaleString(); }

function titleFor(role: PlatformRole) {
  switch (role) {
    case "SUPER_ADMIN": return "Platform overview";
    case "ADMIN": return "Campaign administration";
    case "CAMPAIGN_MANAGER": return "Campaign command center";
    case "CAMPAIGNER": return "My survey work";
  }
}

function descriptionFor(role: PlatformRole) {
  switch (role) {
    case "SUPER_ADMIN": return "Review campaign ownership, execution progress and evidence exceptions across the platform.";
    case "ADMIN": return "Track the campaigns you can manage, resolve assignment gaps and monitor research execution.";
    case "CAMPAIGN_MANAGER": return "Plan assigned Iterations, review Run progress and move completed campaigns through closeout.";
    case "CAMPAIGNER": return "See only your allocated Iterations, ready Runs and call follow-up work.";
  }
}

function metricsFor(role: PlatformRole, s: Summary): Metric[] {
  if (role === "CAMPAIGNER") return [
    { label: "Assigned Iterations", value: count(s.iterationsVisible), detail: `${count(s.campaignsVisible)} visible Campaigns`, icon: ClipboardList },
    { label: "Ready Runs", value: count(s.runsReady), detail: "Review recipients before launch", icon: PhoneCall },
    { label: "Pending contacts", value: count(s.pendingContacts), detail: `${count(s.retryEligibleContacts)} retry eligible`, icon: Users },
    { label: "Awaiting callbacks", value: count(s.awaitingCallbacks), detail: `${count(s.staleCallbacks)} beyond 30 minutes`, icon: Clock3 }
  ];
  if (role === "CAMPAIGN_MANAGER") return [
    { label: "Assigned Campaigns", value: count(s.campaignsVisible), detail: `${count(s.campaignsCompleted)} completed`, icon: Megaphone },
    { label: "Iterations complete", value: `${count(s.iterationsCompleted)}/${count(s.iterationsVisible)}`, detail: "Across assigned Campaigns", icon: CheckCircle2 },
    { label: "Active Runs", value: count(s.runsReady + s.runsRunning), detail: `${count(s.runsClosed)} closed`, icon: PhoneCall },
    { label: "Evidence gaps", value: count(s.missingTranscripts + s.missingResponses), detail: "Transcript and response exceptions", icon: AlertTriangle }
  ];
  if (role === "ADMIN") return [
    { label: "Managed Campaigns", value: count(s.campaignsVisible), detail: `${count(s.campaignsCompleted)} completed`, icon: Megaphone },
    { label: "Ownership gaps", value: count(s.campaignsWithoutManager), detail: "Campaigns awaiting a manager", icon: Users },
    { label: "Execution queue", value: count(s.runsReady + s.runsRunning), detail: `${count(s.pendingContacts)} pending contacts`, icon: PhoneCall },
    { label: "Evidence exceptions", value: count(s.staleCallbacks + s.missingTranscripts + s.missingResponses), detail: "Delayed or incomplete records", icon: AlertTriangle }
  ];
  return [
    { label: "Portfolio Campaigns", value: count(s.campaignsVisible), detail: `${count(s.campaignsCompleted)} completed`, icon: Megaphone },
    { label: "Governance gaps", value: count(s.campaignsWithoutManager), detail: "Campaigns without ownership", icon: ShieldCheck },
    { label: "Platform activity", value: count(s.runsReady + s.runsRunning), detail: `${count(s.callAttempts)} call attempts`, icon: PhoneCall },
    { label: "Evidence exceptions", value: count(s.staleCallbacks + s.missingTranscripts + s.missingResponses), detail: `${count(s.staleCallbacks)} delayed callbacks`, icon: AlertTriangle }
  ];
}

function flowItems(role: PlatformRole, s: Summary) {
  if (role === "CAMPAIGNER") return [
    ["Runs ready", s.runsReady], ["Pending contacts", s.pendingContacts],
    ["Retry eligible", s.retryEligibleContacts], ["Call attempts", s.callAttempts],
    ["Connected calls", s.connectedCalls], ["Awaiting callbacks", s.awaitingCallbacks]
  ];
  if (role === "CAMPAIGN_MANAGER") return [
    ["Iterations complete", s.iterationsCompleted], ["Successful outcomes", s.successfulContacts],
    ["Connected calls", s.connectedCalls], ["Awaiting callbacks", s.awaitingCallbacks],
    ["Missing transcripts", s.missingTranscripts], ["Missing responses", s.missingResponses]
  ];
  return [
    ["Runs ready", s.runsReady], ["Runs running", s.runsRunning],
    ["Call attempts", s.callAttempts], ["Connected calls", s.connectedCalls],
    ["Missing transcripts", s.missingTranscripts], ["Missing responses", s.missingResponses]
  ];
}

function actionLabel(kind: string) {
  switch (kind) {
    case "STALE_CALLBACKS": return "CALLBACK";
    case "ASSIGN_MANAGER": return "OWNERSHIP";
    case "CONFIGURE_ITERATION": return "CONFIGURATION";
    case "REVIEW_RUN": return "READY RUN";
    case "RETRY_CONTACTS": return "RETRY";
    case "EVIDENCE_GAP": return "EVIDENCE";
    case "REVIEW_CAMPAIGN": return "CLOSEOUT";
    default: return "PLANNING";
  }
}

export default function Home() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async function (refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try { setData(await apiFetch("/api/dashboard") as Dashboard); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load Dashboard"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(function () {
    if (!user) return;
    const timer = window.setTimeout(function () { void loadDashboard(); }, 0);
    return function () { window.clearTimeout(timer); };
  }, [loadDashboard, user]);

  const role = user?.role.code;
  const summary = data?.summary;
  const metrics = role && summary ? metricsFor(role, summary) : [];

  return <AppShell><main className={styles.page}>
    <header className={styles.hero}>
      <div><span>RESEARCH COMMAND CENTER</span><h1>{role ? titleFor(role) : "Dashboard"}</h1><p>{role ? descriptionFor(role) : "Loading your work…"}</p></div>
      <button type="button" onClick={function () { void loadDashboard(true); }} disabled={loading || refreshing}><RefreshCw size={16} className={refreshing ? styles.spin : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button>
    </header>
    {error && <FeedbackMessage tone="error" message={error} />}
    {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={23} />Loading your Dashboard…</div> : data && <>
      <div className={styles.scope}><ShieldCheck size={15} />These figures reflect only Campaigns and Iterations visible to your role. No demo result is presented as a vote forecast.</div>
      {data.roleBrief && <section className={styles.roleBrief} data-status={data.roleBrief.status}>
        <div className={styles.roleBriefMain}>
          <span>{data.roleBrief.eyebrow}</span>
          <div className={styles.roleTitle}><h2>{data.roleBrief.title}</h2><strong>{data.roleBrief.status.replaceAll("_", " ")}</strong></div>
          <p>{data.roleBrief.description}</p>
        </div>
        <div className={styles.roleBriefDetail}>
          <div><span>YOUR CURRENT SCOPE</span><strong>{data.roleBrief.responsibility}</strong></div>
          <div><span>DECISION BOUNDARY</span><p>{data.roleBrief.boundary}</p></div>
          <Link href={data.roleBrief.nextHref}>{data.roleBrief.nextLabel}<ArrowRight size={16} /></Link>
        </div>
      </section>}
      <section className={styles.metrics} aria-label="Operational summary">
        {metrics.map(function (metric) { const Icon = metric.icon; return <article key={metric.label} className={styles.metric}><div className={styles.metricIcon}><Icon size={18} /></div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></article>; })}
      </section>
      <div className={styles.contentGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><span>PRIORITY QUEUE</span><h2>What needs attention</h2></div><strong>{data.actions.length} item{data.actions.length === 1 ? "" : "s"}</strong></div>
          {!data.actions.length ? <div className={styles.empty}><CheckCircle2 size={24} /><strong>No action flags in your visible work</strong><p>This reflects only Dashboard checks; review Campaigns and Calls for full detail.</p></div> : <div className={styles.actions}>{data.actions.map(function (item, index) { return <Link href={item.href} key={`${item.kind}-${item.href}-${index}`} className={styles.action}><div className={styles.actionIcon} data-urgent={item.priority >= 90}>{item.priority >= 90 ? <AlertTriangle size={18} /> : <ArrowRight size={18} />}</div><div><span>{actionLabel(item.kind)}{item.campaignName ? ` · ${item.campaignName}` : ""}</span><strong>{item.title}</strong><p>{item.detail}</p></div><ArrowRight size={17} /></Link>; })}</div>}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><span>{role === "CAMPAIGNER" ? "EXECUTION FLOW" : "RESEARCH FLOW"}</span><h2>{role === "CAMPAIGNER" ? "My call workload" : role === "CAMPAIGN_MANAGER" ? "Coverage and evidence" : "Execution and evidence"}</h2></div></div>
          <div className={styles.flowGrid}>
            {role && summary && flowItems(role, summary).map(function ([label, value]) { return <div key={label}><span>{label}</span><strong>{count(Number(value))}</strong></div>; })}
          </div>
          <div className={styles.quickLinks}>
            <Link href="/campaigns"><Megaphone size={16} />Campaigns <ArrowRight size={15} /></Link>
            <Link href="/calls"><PhoneCall size={16} />Calls <ArrowRight size={15} /></Link>
            {role !== "CAMPAIGNER" && <Link href="/analytics"><BarChart3 size={16} />Analytics <ArrowRight size={15} /></Link>}
            {(role === "SUPER_ADMIN" || role === "ADMIN") && <Link href="/programs"><FileText size={16} />Programs <ArrowRight size={15} /></Link>}
          </div>
        </section>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span>VISIBLE CAMPAIGNS</span><h2>{role === "CAMPAIGNER" ? "My allocated work" : "Campaign progress"}</h2></div><Link className={styles.viewAll} href="/campaigns">View all <ArrowRight size={15} /></Link></div>
        {!data.campaigns.length ? <div className={styles.empty}><Megaphone size={24} /><strong>No Campaigns visible yet</strong><p>{role === "CAMPAIGNER" ? "Assigned Campaigns will appear here when work is allocated." : "Create or assign a Campaign to begin tracking research operations."}</p></div> : <div className={styles.campaigns}>{data.campaigns.map(function (campaign) { return <article className={styles.campaign} key={campaign.id}><div className={styles.campaignTop}><div><span>{campaign.code} · {campaign.status}</span><Link href={`/campaigns/${campaign.id}`}>{campaign.name} <ArrowRight size={15} /></Link></div><strong>{campaign.completedIterationCount}/{campaign.iterationCount} Iterations complete</strong></div><div className={styles.campaignFlow}><div><span>Attempts</span><strong>{count(campaign.callAttempts)}</strong></div><div><span>Connected</span><strong>{count(campaign.connectedCalls)}</strong></div><div><span>Successful</span><strong>{count(campaign.successfulContacts)}</strong></div><div><span>Evidence ready</span><strong>{campaign.evidenceReadyPct.toFixed(1)}%</strong></div></div><div className={styles.campaignBar}><i style={{ width: `${Math.min(campaign.connectionRatePct, 100)}%` }} /></div><small className={styles.campaignRate}>{campaign.connectionRatePct.toFixed(1)}% attempt-to-connection rate · {campaign.evidenceExceptions} evidence exception{campaign.evidenceExceptions === 1 ? "" : "s"}</small><div className={styles.iterations}>{!campaign.iterations.length ? <p>No Iterations visible for this Campaign.</p> : campaign.iterations.map(function (iteration) { return <Link href={`/iterations/${iteration.id}`} key={iteration.id}><div><strong>Iteration {iteration.number}</strong><span>{iteration.name}</span></div><small>{iteration.status} · {iteration.readyRunCount} ready · {iteration.runningRunCount} running</small><ArrowRight size={14} /></Link>; })}</div></article>; })}</div>}
      </section>
      <footer className={styles.footer}>Snapshot generated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.generatedAt))}. Status metrics are operational; research interpretation remains in Analytics.</footer>
    </>}
  </main></AppShell>;
}
