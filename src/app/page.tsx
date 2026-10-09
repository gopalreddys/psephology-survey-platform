"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ClipboardList,
  Clock3, ExternalLink, FileText, LoaderCircle, Megaphone, PhoneCall, RefreshCw,
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
type Distribution = { value: string; respondents: number; percentage: number | null };
type MeasureSummary = {
  respondentBase: number; answerBase: number; missingCount: number; cantSayCount: number;
  refusedCount: number; uncodedCount: number; coveragePct: number; suppressed: boolean;
  normalizationVersion: string;
};
type Segment = {
  label: string; base: number; suppressed: boolean;
  answerBase: number; respondentBase: number; missingCount: number; cantSayCount: number;
  refusedCount: number; uncodedCount: number; coveragePct: number;
  sentiment: Distribution[]; positivePct: number | null;
};
type SentimentConstruct = {
  key: string; label: string; outputKeys: string[]; type: "SENTIMENT";
};
type SentimentValidation = {
  status: string; method: string; normalizationVersion: string; ruleHash: string; message: string;
};
type DashboardIntelligence = {
  programs: Array<{ id: string; name: string; code: string }>;
  program: { id: string; name: string; code: string };
  campaign: { id: string; name: string; code: string } | null;
  iteration: { id: string; number: number; name: string } | null;
  filters: {
    campaigns: Array<{ id: string; name: string; code: string }>;
    iterations: Array<{ id: string; number: number; name: string; campaignName: string }>;
    mandals: string[]; genders: string[]; ageBands: string[];
    selectedProgramId: string; selectedCampaignId: string; selectedIterationId: string;
    selectedMandal: string; selectedGender: string; selectedAgeBand: string;
    sentimentConstructs: Array<{ key: string; label: string }>;
    selectedSentimentConstruct: string;
  };
  minimumBase: number; respondentBase: number | null; suppressed: boolean; scopeLabel: string;
  sentimentConstruct: SentimentConstruct; sentimentValidation: SentimentValidation;
  rating: { value: number | null; scale: number; confidence: string; basis: string; answeredBase: number };
  measures: Record<"sentiment" | "issues" | "party" | "candidate" | "leadership", MeasureSummary>;
  sentiment: Distribution[];
  issues: Distribution[];
  landscape: { party: Distribution[]; candidate: Distribution[]; leadership: Distribution[] };
  age: Segment[];
  gender: Segment[];
  mandalHeatmap: Segment[];
  predictive: {
    status: string; direction: string; confidence: string; statement: string; scopeLabel: string;
    projectedNextRating: number | null;
    points: Array<{ iterationId: string; iterationNumber: number; iterationName: string; campaignName: string; base: number; answeredBase: number; value: number }>;
    comparability: {
      source: string; reasons: string[];
      comparisons: Array<{ status: "COMPARABLE" | "NOT_COMPARABLE"; reasons: string[]; previousIterationId: string; latestIterationId: string }>;
      includedIterations: number; excludedIterations: number;
      questionnaireCode: string | null; questionnaireVersion: string | null;
      researchPhase: string | null; sampleDesign: string | null;
    };
  };
  methodology: { sampleType: string; weighted: boolean; analysisUnit: string; disclosure: string };
};
type Dashboard = {
  role: PlatformRole; roleBrief?: RoleBrief; summary: Summary; actions: Action[];
  campaigns: Campaign[]; intelligence: DashboardIntelligence | null; generatedAt: string;
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

const CHART_COLORS = ["#168b7d", "#d75b72", "#e0a34b", "#6b79b9", "#9b7ab8"];
function categoryColor(value: string, index: number) {
  const sentimentColors: Record<string, string> = { Positive: "#168b7d", Negative: "#d75b72", Neutral: "#879692", Mixed: "#9b7ab8", "Can't say": "#e0a34b", "Declined to answer": "#6b79b9", "Uncoded response": "#8d9095" };
  return sentimentColors[value] || CHART_COLORS[index % CHART_COLORS.length];
}

function BaseCaption({ summary }: { summary: MeasureSummary }) {
  return <div className={styles.chartHead}><small>
    {summary.answerBase} answered / {summary.respondentBase} respondents · {summary.coveragePct.toFixed(1)}% coverage
    <br />Missing {summary.missingCount} · Can&apos;t say {summary.cantSayCount} · Refused {summary.refusedCount} · Uncoded {summary.uncodedCount}
    <br />{summary.suppressed ? "Percentages withheld: fewer than 5 answers." : "Percentages use all answered responses, including Can't say, Refused and Uncoded."}
  </small></div>;
}

function DashboardDonut({ items }: { items: Distribution[] }) {
  if (!items.length) return <div className={styles.chartEmpty}>No reportable sentiment distribution is available.</div>;
  const stops = items.map(function (item, index) {
    const start = items.slice(0, index).reduce((total, candidate) => total + (candidate.percentage ?? 0), 0);
    const end = start + (item.percentage ?? 0);
    return `${categoryColor(item.value, index)} ${start}% ${end}%`;
  });
  return <div className={styles.donutWrap}>
    <div className={styles.donut} style={{ background: `conic-gradient(${stops.join(", ")})` }}><div><strong>{items.reduce((total, item) => total + item.respondents, 0)}</strong><span>answers</span></div></div>
    <div className={styles.legend}>{items.map(function (item, index) { return <div key={item.value}><i style={{ background: categoryColor(item.value, index) }} /><span>{item.value}</span><strong>{item.percentage === null ? "Withheld" : `${item.percentage.toFixed(1)}%`}</strong></div>; })}</div>
  </div>;
}

function LandscapeBars({ items, empty }: { items: Distribution[]; empty: string }) {
  if (!items.length) return <div className={styles.chartEmpty}>{empty}</div>;
  return <div className={styles.issueBars}>{items.map((item) => <div key={item.value}><div><span>{item.value}</span><strong>{item.percentage === null ? "Withheld" : `${item.percentage.toFixed(1)}%`}</strong></div><div><i style={{ width: `${item.percentage ?? 0}%` }} /></div></div>)}</div>;
}

function SegmentBars({ items }: { items: Segment[] }) {
  if (!items.length) return <div className={styles.chartEmpty}>No demographic evidence is available.</div>;
  return <div className={styles.segmentBars}>{items.map((item) => <div key={item.label} className={styles.segmentRow}><div><span>{item.label}</span><small>{item.answerBase} answered / {item.respondentBase} respondents · {item.coveragePct.toFixed(1)}% coverage · missing {item.missingCount}; can&apos;t say {item.cantSayCount}; refused {item.refusedCount}; uncoded {item.uncodedCount}</small><strong>{item.positivePct === null ? "Withheld below 5 answers" : `${item.positivePct.toFixed(1)}% positive`}</strong></div><div><i style={{ width: `${item.positivePct || 0}%` }} /></div></div>)}</div>;
}

function MandalHeatmap({ items }: { items: Segment[] }) {
  const labels = ["Positive", "Neutral", "Negative", "Mixed", "Can't say"];
  if (!items.length) return <div className={styles.chartEmpty}>No Mandal evidence is available.</div>;
  return <div className={styles.heatmap}>
    <div className={styles.heatmapHeader}><span>Mandal</span>{labels.map((label) => <strong key={label}>{label}</strong>)}</div>
    {items.map((item) => <div className={styles.heatmapRow} key={item.label}><span>{item.label}<small>{item.answerBase} answered / {item.respondentBase} respondents · missing {item.missingCount}; refused {item.refusedCount}; uncoded {item.uncodedCount}</small></span>{labels.map((label) => { const value = item.sentiment.find((entry) => entry.value === label)?.percentage || 0; return <i key={label} data-suppressed={item.suppressed} style={{ backgroundColor: item.suppressed ? "#f4eeee" : `rgba(22, 139, 125, ${Math.max(value / 100, .06)})` }}>{item.suppressed ? "—" : `${value.toFixed(0)}%`}</i>; })}</div>)}
  </div>;
}

function TrendChart({ intelligence }: { intelligence: DashboardIntelligence }) {
  const points = intelligence.predictive.points;
  if (!points.length) return <div className={styles.chartEmpty}>{intelligence.predictive.statement}</div>;
  return <div className={styles.trendChart}>{points.map((point) => <div key={point.iterationId}><div><i style={{ height: `${Math.max((point.value / 5) * 100, 4)}%` }} /><strong>{point.value.toFixed(1)}</strong></div><span>Iteration {point.iterationNumber}</span><small>{point.campaignName} · n={point.answeredBase} rated respondents</small></div>)}</div>;
}

export default function Home() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programId, setProgramId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [iterationId, setIterationId] = useState("");
  const [mandal, setMandal] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [gender, setGender] = useState("");
  const [sentimentConstruct, setSentimentConstruct] = useState("candidate_impression");
  const requestSequenceRef = useRef(0);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const scopeKey = JSON.stringify([programId, campaignId, iterationId, mandal, ageBand, gender, sentimentConstruct]);

  const loadDashboard = useCallback(async function (refresh = false) {
    const requestSequence = ++requestSequenceRef.current;
    if (refresh) setRefreshing(true);
    else {
      setLoading(true);
      setData(null);
    }
    setError(null);
    try {
      const query = new URLSearchParams();
      if (programId) query.set("programId", programId);
      if (campaignId) query.set("campaignId", campaignId);
      if (iterationId) query.set("iterationId", iterationId);
      if (mandal) query.set("mandal", mandal);
      if (ageBand) query.set("ageBand", ageBand);
      if (gender) query.set("gender", gender);
      query.set("sentimentConstruct", sentimentConstruct);
      const dashboard = await apiFetch(`/api/dashboard${query.size ? `?${query.toString()}` : ""}`) as Dashboard;
      if (requestSequence === requestSequenceRef.current) {
        setData(dashboard);
        setLoadedScopeKey(scopeKey);
      }
    }
    catch (reason) {
      if (requestSequence === requestSequenceRef.current) {
        setData(null);
        setError(reason instanceof Error ? reason.message : "Unable to load Dashboard");
      }
    }
    finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [ageBand, campaignId, gender, iterationId, mandal, programId, scopeKey, sentimentConstruct]);

  useEffect(function () {
    if (!user) return;
    const timer = window.setTimeout(function () { void loadDashboard(); }, 0);
    return function () { window.clearTimeout(timer); requestSequenceRef.current += 1; };
  }, [loadDashboard, user]);

  const role = user?.role.code;
  const summary = data?.summary;
  const metrics = role && summary ? metricsFor(role, summary) : [];
  const dashboardMatchesRole = Boolean(role && data?.role === role);
  const dashboardMatchesScope = loadedScopeKey === scopeKey;

  return <AppShell><main className={styles.page}>
    <header className={styles.hero}>
      <div><span>RESEARCH COMMAND CENTER</span><h1>{role ? titleFor(role) : "Dashboard"}</h1><p>{role ? descriptionFor(role) : "Loading your work…"}</p></div>
      <div className={styles.heroActions}>
        {(role === "SUPER_ADMIN" || role === "ADMIN") && <Link href="/enterprise-dashboard"><BarChart3 size={16} />Amazon Quick preview <ExternalLink size={14} /></Link>}
        <button type="button" onClick={function () { void loadDashboard(true); }} disabled={loading || refreshing}><RefreshCw size={16} className={refreshing ? styles.spin : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>
    </header>
    {error && <FeedbackMessage tone="error" message={error} />}
    {loading || (data && (!dashboardMatchesRole || !dashboardMatchesScope)) ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={23} />Loading your Dashboard…</div> : data && <>
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
      {role !== "CAMPAIGNER" && data.intelligence && <section className={styles.intelligencePanel}>
        <div className={styles.intelligenceHead}><div><span>PROGRAM RESEARCH DASHBOARD</span><h2>{data.intelligence.program.name}</h2><p>Program-level pulse with optional Campaign, Iteration, Mandal, age and gender drill-downs. Use Analysis for question, Run and evidence diagnosis.</p></div><div className={styles.intelligenceFilters}>
          <label><span>Program</span><select value={programId || data.intelligence.filters.selectedProgramId} onChange={function (event) { setProgramId(event.target.value); setCampaignId(""); setIterationId(""); setMandal(""); setAgeBand(""); setGender(""); }}>{data.intelligence.programs.map((program) => <option value={program.id} key={program.id}>{program.name} · {program.code}</option>)}</select></label>
          <label><span>Campaign</span><select value={campaignId} onChange={function (event) { setCampaignId(event.target.value); setIterationId(""); setMandal(""); setAgeBand(""); setGender(""); }}><option value="">All Campaigns</option>{data.intelligence.filters.campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></label>
          <label><span>Iteration</span><select value={iterationId} onChange={function (event) { setIterationId(event.target.value); setMandal(""); setAgeBand(""); setGender(""); }}><option value="">All Iterations</option>{data.intelligence.filters.iterations.map((iteration) => <option value={iteration.id} key={iteration.id}>{iteration.campaignName} · Iteration {iteration.number}</option>)}</select></label>
          <label><span>Mandal</span><select value={mandal} onChange={(event) => setMandal(event.target.value)}><option value="">All Mandals</option>{data.intelligence.filters.mandals.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Age</span><select value={ageBand} onChange={(event) => setAgeBand(event.target.value)}><option value="">All age bands</option>{data.intelligence.filters.ageBands.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Gender</span><select value={gender} onChange={(event) => setGender(event.target.value)}><option value="">All genders</option>{data.intelligence.filters.genders.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Sentiment measure</span><select value={sentimentConstruct} onChange={(event) => setSentimentConstruct(event.target.value)}>{data.intelligence.filters.sentimentConstructs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        </div></div>
        <div className={styles.scope} role="note"><AlertTriangle size={17} /><div><strong>Human review pending</strong><br />{data.intelligence.sentimentValidation.message}<br /><small>Rules: {data.intelligence.sentimentValidation.normalizationVersion} · <span title={data.intelligence.sentimentValidation.ruleHash}>hash {data.intelligence.sentimentValidation.ruleHash.slice(0, 12)}</span>. Source variables: {data.intelligence.sentimentConstruct.outputKeys.join(", ")}. The selected measure is held fixed across demographic views and Iteration history.</small></div></div>
        {data.intelligence.suppressed ? <div className={styles.intelligenceSuppressed}><ShieldCheck size={21} /><div><strong>Research result withheld</strong><p>This selected scope has fewer than {data.intelligence.minimumBase} respondent observations. More responses or a broader research scope are required.</p></div></div> : <>
          <div className={styles.intelligenceSummary}>
            <article className={styles.ratingSummary}><span>DESCRIPTIVE {data.intelligence.sentimentConstruct.label.toUpperCase()}</span><strong>{data.intelligence.rating.value === null ? "Not measured" : `${data.intelligence.rating.value.toFixed(1)}/5`}</strong><div>{Array.from({ length: 5 }, (_, index) => <i key={index} data-filled={index + 1 <= Math.round(data.intelligence?.rating.value || 0)}>★</i>)}</div><small>{data.intelligence.rating.confidence} · {data.intelligence.rating.answeredBase} polarity-coded assessments / {data.intelligence.respondentBase || 0} respondent observations</small><small>{data.intelligence.rating.basis}</small><small>{data.intelligence.scopeLabel}</small></article>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>SELECTED SENTIMENT MEASURE</span><h3>{data.intelligence.sentimentConstruct.label}</h3><small>Explicit structured labels only. Mixed is separate from Neutral; no substitution from other measures.</small></div><DashboardDonut items={data.intelligence.sentiment} /><BaseCaption summary={data.intelligence.measures.sentiment} /></article>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>DESCRIPTIVE ITERATION HISTORY</span><h3>{data.intelligence.predictive.direction}</h3><small>{data.intelligence.predictive.projectedNextRating === null ? data.intelligence.predictive.status === "SUPPRESSED" ? `Wave withheld below n=${data.intelligence.minimumBase}` : "Two consecutive comparable, reportable Iterations required" : `Indicative next-Iteration ${data.intelligence.sentimentConstruct.label.toLowerCase()} ${data.intelligence.predictive.projectedNextRating.toFixed(1)}/5`} · {data.intelligence.predictive.confidence}</small><small>{data.intelligence.predictive.scopeLabel}</small></div><TrendChart intelligence={data.intelligence} /><p>{data.intelligence.predictive.statement}</p></article>
          </div>
          <div className={styles.landscapeGrid}>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>PARTY LANDSCAPE</span><h3>Unaided party salience</h3><small>Recorded party mentions only; not vote intention</small></div><LandscapeBars items={data.intelligence.landscape.party} empty="No reportable party-salience distribution is available." /><BaseCaption summary={data.intelligence.measures.party} /></article>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>CANDIDATE LANDSCAPE</span><h3>Candidate impression</h3><small>Explicit impressions only; awareness and criterion fit are separate constructs</small></div><DashboardDonut items={data.intelligence.landscape.candidate} /><BaseCaption summary={data.intelligence.measures.candidate} /></article>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>LEADERSHIP LANDSCAPE</span><h3>Perceived issue leadership</h3><small>Recorded leadership responses only; no incumbent-assessment proxy</small></div><LandscapeBars items={data.intelligence.landscape.leadership} empty="No reportable leadership distribution is available." /><BaseCaption summary={data.intelligence.measures.leadership} /></article>
          </div>
          <div className={styles.reportGrid}>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>AGE REPORT</span><h3>{data.intelligence.sentimentConstruct.label} by age</h3><small>Non-overlapping bands · each percentage uses its own answered base, including Mixed, Can&apos;t say, Refused and Uncoded</small></div><SegmentBars items={data.intelligence.age} /></article>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>GENDER REPORT</span><h3>{data.intelligence.sentimentConstruct.label} by gender</h3><small>Each percentage uses its own answered base, including Mixed, Can&apos;t say, Refused and Uncoded</small></div><SegmentBars items={data.intelligence.gender} /></article>
            <article className={styles.chartCard}><div className={styles.chartHead}><span>ISSUE PRIORITIES</span><h3>What respondents raised</h3></div><LandscapeBars items={data.intelligence.issues} empty="No reportable issue-priority distribution is available." /><BaseCaption summary={data.intelligence.measures.issues} /></article>
          </div>
          <article className={styles.heatmapCard}><div className={styles.chartHead}><span>MANDAL HEATMAP</span><h3>{data.intelligence.sentimentConstruct.label} by Mandal</h3><small>Cells are withheld below {data.intelligence.minimumBase} answered responses · Mixed remains distinct from Neutral · denominator includes Can&apos;t say, Refused and Uncoded (the latter two are retained in row captions) · {data.intelligence.scopeLabel}</small></div><MandalHeatmap items={data.intelligence.mandalHeatmap} /></article>
          <section className={styles.methodologyPanel}>
            <div className={styles.methodologyHead}><div><span>RESEARCH DISCLOSURE</span><h3>How to interpret this Dashboard</h3></div><ShieldCheck size={19} /></div>
            <div className={styles.methodologyGrid}>
              <article><span>Sample</span><strong>Controlled non-probability demo cohort</strong></article>
              <article><span>Collection mode</span><strong>AI-assisted outbound voice interviews</strong></article>
              <article><span>Weighting</span><strong>{data.intelligence.methodology.weighted ? "Applied" : "Not applied"}</strong></article>
              <article><span>Instrument</span><strong>{data.intelligence.predictive.comparability.questionnaireCode ? `${data.intelligence.predictive.comparability.questionnaireCode} v${data.intelligence.predictive.comparability.questionnaireVersion}` : "Mixed or not selected"}</strong></article>
              <article><span>Analysis unit</span><strong>{data.intelligence.methodology.analysisUnit}</strong></article>
              <article><span>Statistical precision</span><strong>No sampling margin of error</strong></article>
            </div>
            <div className={styles.methodologyNote}><ShieldCheck size={16} /><span>{data.intelligence.methodology.disclosure} AI supports interviewing and structured-output capture; findings remain aggregate and require research oversight.</span></div>
          </section>
        </>}
      </section>}
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
