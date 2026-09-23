"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, FileQuestion, LoaderCircle, PhoneCall, RefreshCw, ShieldAlert, Target } from "lucide-react";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./strategic.module.css";
import scopeStyles from "./scope.module.css";
import intelligenceStyles from "./intelligence.module.css";

type Distribution = { value: string; respondents: number; percentage: number };
type RunSummary = { id: string; iterationId: string; number: number; status: string; callAttempts: number; connectedCalls: number; transcriptCoveragePct: number; responseCoveragePct: number };
type AnalysisIteration = { id: string; number: number; name: string; connectedRespondents: number; runs: RunSummary[] };
type CampaignOption = { id: string; code: string; name: string };
type CampaignRating = {
  value: number | null;
  scale: number;
  band: string;
  confidence: string;
  componentCoverage: number;
  respondentObservations: number;
  iterationCount: number;
  components: Array<{ key: string; label: string; value: number; weight: number; answered: number }>;
  basis: string;
};
type StrategicResponse = {
  campaign: { id: string; code: string; name: string; targetName: string; surveyStage: string };
  scope: {
    level: "CAMPAIGN" | "ITERATION" | "RUN";
    iteration: AnalysisIteration | null;
    run: RunSummary | null;
    operations: null | { callAttempts: number; connectedCalls: number; transcriptCoveragePct: number; responseCoveragePct: number };
    interpretation: string;
  };
  options: { iterations: AnalysisIteration[]; filters: { genders: string[]; ageBands: string[]; mandals: string[] } };
  segment: { filters: { gender: string | null; ageBand: string | null; mandal: string | null }; respondentBase: number | null; minimumBase: number; suppressed: boolean };
  validity: { latestRespondentBase: number; averageAnswerCoveragePct: number; warnings: string[] };
  latestIteration: AnalysisIteration | null;
  issueAnalysis: { priorities: Distribution[]; developmentPriorities: Distribution[]; desiredChanges: Distribution[] };
  iterationDashboard: { respondentBase: number; candidateSentiment: Distribution[]; incumbentSentiment: Distribution[]; partyAttention: Distribution[]; perceivedIssueLeadership: Distribution[] };
  campaignRating: CampaignRating;
  partyLeanIndex: { value: number | null; answered: number; scale: number; basis: string };
  findings: Array<{ type: string; title: string; evidence: string; caution: string }>;
  generatedAt: string;
};

function pct(value: number) { return `${Number(value || 0).toFixed(1)}%`; }

const CHART_COLORS = ["#168b7d", "#d75b72", "#e0a34b", "#6b79b9", "#9b7ab8", "#879692"];

function DonutChart({ title, subtitle, items, empty }: { title: string; subtitle: string; items: Distribution[]; empty: string }) {
  if (!items.length) return <article className={intelligenceStyles.chartCard}><span className={intelligenceStyles.cardEyebrow}>{subtitle}</span><h3>{title}</h3><div className={styles.noSignal}>{empty}</div></article>;
  let cursor = 0;
  const stops = items.map(function (item, index) { const start = cursor; cursor += item.percentage; return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${cursor}%`; });
  return (
    <article className={intelligenceStyles.chartCard}>
      <span className={intelligenceStyles.cardEyebrow}>{subtitle}</span><h3>{title}</h3>
      <div className={intelligenceStyles.donutLayout}>
        <div className={intelligenceStyles.donut} style={{ background: `conic-gradient(${stops.join(", ")})` }}><div><strong>{items.reduce((total, item) => total + item.respondents, 0)}</strong><span>answers</span></div></div>
        <div className={intelligenceStyles.legend}>{items.slice(0, 6).map(function (item, index) { return <div key={item.value}><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span>{item.value}</span><strong>{pct(item.percentage)}</strong></div>; })}</div>
      </div>
    </article>
  );
}

function DistributionCard({ eyebrow, title, items, empty }: { eyebrow: string; title: string; items: Distribution[]; empty: string }) {
  return (
    <article className={styles.signalCard}><span>{eyebrow}</span><h3>{title}</h3>
      {!items.length ? <div className={styles.noSignal}>{empty}</div> : <div className={styles.distribution}>{items.slice(0, 6).map(function (item) { return <div key={item.value} className={styles.distributionRow}><div><span>{item.value}</span><strong>{pct(item.percentage)}</strong></div><div className={styles.bar}><i style={{ width: `${Math.min(item.percentage, 100)}%` }} /></div><small>{item.respondents} answer{item.respondents === 1 ? "" : "s"}</small></div>; })}</div>}
    </article>
  );
}

function FiveStarIndex({ index }: { index: StrategicResponse["partyLeanIndex"] }) {
  return (
    <article className={intelligenceStyles.ratingCard}><span>DIRECT PARTY-STRENGTH MEASURE</span><h3>Aggregate five-star index</h3>
      {index.value === null ? <><div className={intelligenceStyles.emptyStars}>☆☆☆☆☆</div><p>Not measured in this questionnaire. Add a neutral 1–5 party-strength question to a future Iteration to populate this index.</p></> : <><div className={intelligenceStyles.stars} aria-label={`${index.value} out of 5 stars`}>{Array.from({ length: 5 }, (_, item) => <i key={item} data-filled={item + 1 <= Math.round(index.value || 0)}>★</i>)}<strong>{index.value}/5</strong></div><p>{index.answered} direct answers · {index.basis}. This is an aggregate cohort measure, never an individual voter score.</p></>}
    </article>
  );
}

function CampaignAggregateRating({ rating }: { rating: CampaignRating }) {
  return (
    <article className={intelligenceStyles.campaignRating}>
      <div className={intelligenceStyles.campaignRatingLead}>
        <span>CAMPAIGN-LEVEL AGGREGATE RATING</span>
        <h3>{rating.band}</h3>
        {rating.value === null
          ? <div className={intelligenceStyles.emptyStars}>☆☆☆☆☆</div>
          : <div className={intelligenceStyles.stars} aria-label={`${rating.value} out of 5 stars`}>
              {Array.from({ length: 5 }, (_, item) => <i key={item} data-filled={item + 1 <= Math.round(rating.value || 0)}>★</i>)}
              <strong>{rating.value}/5</strong>
            </div>}
        <p>{rating.basis}.</p>
      </div>
      <div className={intelligenceStyles.campaignRatingEvidence}>
        <div><span>Confidence</span><strong>{rating.confidence}</strong></div>
        <div><span>Output coverage</span><strong>{pct(rating.componentCoverage)}</strong></div>
        <div><span>Evidence base</span><strong>{rating.respondentObservations}</strong><small>respondent observations</small></div>
        <div><span>Iterations</span><strong>{rating.iterationCount}</strong><small>completed</small></div>
      </div>
      <div className={intelligenceStyles.ratingComponents}>
        {!rating.components.length
          ? <p>No eligible campaign-level output variables are available.</p>
          : rating.components.map((component) => <div key={component.key}><span>{component.label}</span><strong>{component.value.toFixed(1)}/5</strong><small>{component.answered} answers</small></div>)}
      </div>
    </article>
  );
}

export default function StrategicCampaignAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const { user } = useCurrentUser();
  const [data, setData] = useState<StrategicResponse | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [iterationId, setIterationId] = useState("");
  const [runId, setRunId] = useState("");
  const [gender, setGender] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [mandal, setMandal] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(function () { const query = new URLSearchParams(window.location.search); setIterationId(query.get("iterationId") || ""); setRunId(query.get("runId") || ""); }, []);

  const loadStrategic = useCallback(async function (refresh = false) {
    if (!campaignId) return;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (iterationId) query.set("iterationId", iterationId);
      if (runId) query.set("runId", runId);
      if (gender) query.set("gender", gender);
      if (ageBand) query.set("ageBand", ageBand);
      if (mandal) query.set("mandal", mandal);
      const response = await apiFetch(`/api/analytics/campaigns/${campaignId}${query.size ? `?${query.toString()}` : ""}`) as StrategicResponse;
      response.options.filters ||= { genders: [], ageBands: [], mandals: [] };
      response.segment ||= {
        filters: { gender: null, ageBand: null, mandal: null },
        respondentBase: response.validity.latestRespondentBase,
        minimumBase: 5,
        suppressed: false
      };
      response.issueAnalysis.developmentPriorities ||= [];
      response.issueAnalysis.desiredChanges ||= [];
      response.partyLeanIndex ||= {
        value: null,
        answered: 0,
        scale: 5,
        basis: "Direct respondent rating only"
      };
      response.campaignRating ||= {
        value: null,
        scale: 5,
        band: "Not measured",
        confidence: "Directional",
        componentCoverage: 0,
        respondentObservations: 0,
        iterationCount: 0,
        components: [],
        basis: "Aggregate output-variable composite; not individual vote intention"
      };
      setData(response);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load Analysis"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [ageBand, campaignId, gender, iterationId, mandal, runId]);

  useEffect(function () { if (!user || !campaignId) return; const timer = window.setTimeout(function () { void loadStrategic(); }, 0); return function () { window.clearTimeout(timer); }; }, [campaignId, loadStrategic, user]);
  useEffect(function () { if (!user) return; void apiFetch("/api/analytics").then(function (workspace) { const result = workspace as { campaigns: CampaignOption[] }; setCampaigns(result.campaigns.map((campaign) => ({ id: campaign.id, code: campaign.code, name: campaign.name }))); }).catch(function () { setCampaigns([]); }); }, [user]);

  function resetSegments() { setGender(""); setAgeBand(""); setMandal(""); }

  if (loading) return <AppShell><main className={styles.loading}><LoaderCircle className={styles.spin} />Preparing decision analysis…</main></AppShell>;

  return (
    <AppShell><main className={styles.page}>
      <div className={styles.backRow}><Link href="/analytics"><ArrowLeft size={15} />Back to Analysis</Link></div>
      {error && <FeedbackMessage tone="error" message={error} />}
      {data && <>
        <header className={styles.hero}><div><span>PSEPHOLOGY ANALYSIS</span><h1>{data.campaign.name}</h1><p>{data.campaign.code} · {data.campaign.targetName} · {data.campaign.surveyStage} survey</p></div><div className={styles.heroActions}><button type="button" disabled={refreshing} onClick={function () { void loadStrategic(true); }}><RefreshCw size={15} className={refreshing ? styles.spin : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button></div></header>

        <section className={scopeStyles.scopeSelector}><div className={scopeStyles.scopeIntro}><span>ANALYSIS SCOPE</span><h2>Campaign → Iteration → Run</h2><p>{data.scope.interpretation}</p></div><div className={scopeStyles.scopeControls}>
          <label><span>Campaign</span><select value={campaignId} onChange={(event) => router.push(`/analytics/campaigns/${event.target.value}`)}>{campaigns.length === 0 && <option value={campaignId}>{data.campaign.name}</option>}{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.code}</option>)}</select></label>
          <label><span>Iteration</span><select value={iterationId} onChange={function (event) { setIterationId(event.target.value); setRunId(""); resetSegments(); }}><option value="">Latest completed Iteration</option>{data.options.iterations.map((iteration) => <option key={iteration.id} value={iteration.id}>Iteration {iteration.number} · {iteration.name}</option>)}</select></label>
          <label><span>Run</span><select value={runId} disabled={!iterationId} onChange={function (event) { setRunId(event.target.value); resetSegments(); }}><option value="">All Runs · deduplicated</option>{(data.options.iterations.find((iteration) => iteration.id === iterationId)?.runs || []).map((run) => <option key={run.id} value={run.id}>Run {run.number} · {run.status}</option>)}</select></label>
        </div></section>

        <section className={scopeStyles.segmentFilters}><div><span>COHORT FILTERS</span><strong>Aggregate respondent view</strong><small>Age bands do not overlap; results below n={data.segment.minimumBase} are withheld.</small></div>
          <label><span>Gender</span><select value={gender} onChange={(event) => setGender(event.target.value)}><option value="">All genders</option>{data.options.filters.genders.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Age</span><select value={ageBand} onChange={(event) => setAgeBand(event.target.value)}><option value="">All ages</option>{data.options.filters.ageBands.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Mandal</span><select value={mandal} onChange={(event) => setMandal(event.target.value)}><option value="">All mandals</option>{data.options.filters.mandals.map((value) => <option key={value}>{value}</option>)}</select></label>
          <button type="button" onClick={resetSegments} disabled={!gender && !ageBand && !mandal}>Clear</button>
        </section>

        {data.segment.suppressed ? <section className={scopeStyles.suppressed}><ShieldAlert size={23} /><div><strong>Segment results withheld</strong><p>The selected cohort is below the minimum reporting base of {data.segment.minimumBase}. Broaden one or more filters.</p></div></section> : <>
          {data.scope.operations && <section className={scopeStyles.scopeMetrics} aria-label="Selected analysis scope"><article><PhoneCall size={18} /><span>Attempts</span><strong>{data.scope.operations.callAttempts}</strong></article><article><Activity size={18} /><span>Connected</span><strong>{data.scope.operations.connectedCalls}</strong></article><article><FileQuestion size={18} /><span>Responses</span><strong>{pct(data.scope.operations.responseCoveragePct)}</strong></article><article><Target size={18} /><span>Filtered base</span><strong>{data.segment.respondentBase}</strong></article></section>}

          <section className={intelligenceStyles.dashboardSection}><div className={styles.sectionHead}><div><span>DECISION SUMMARY</span><h2>Signals needed for the next Iteration</h2></div><p>{data.latestIteration ? `Iteration ${data.latestIteration.number} · ${data.segment.respondentBase} deduplicated respondents` : "No Iteration evidence available"}</p></div>
            <CampaignAggregateRating rating={data.campaignRating} />
            <div className={intelligenceStyles.decisionGrid}>
              <DonutChart title="Party attention" subtitle="PARTY LEAN PROXY" items={data.iterationDashboard.partyAttention} empty="No unaided party signal was captured." />
              <DonutChart title="Candidate perception" subtitle="CANDIDATE LEAN" items={data.iterationDashboard.candidateSentiment} empty="No classifiable candidate perception was captured." />
              <DonutChart title="Perceived issue leadership" subtitle="LEADERSHIP LEAN" items={data.iterationDashboard.perceivedIssueLeadership} empty="No leadership signal was captured." />
              <DonutChart title="Incumbent assessment" subtitle="LEADERSHIP PERFORMANCE" items={data.iterationDashboard.incumbentSentiment} empty="No incumbent assessment was captured." />
              <DistributionCard eyebrow="ISSUES" title="Priority issues" items={data.issueAnalysis.priorities} empty="No issue priority was captured." />
              <DistributionCard eyebrow="DEVELOPMENT" title="Development priorities" items={data.issueAnalysis.developmentPriorities} empty="No development priority was captured." />
              <DistributionCard eyebrow="CHANGE" title="Changes voters want" items={data.issueAnalysis.desiredChanges} empty="No desired-change output was captured." />
              <FiveStarIndex index={data.partyLeanIndex} />
            </div>
            <p className={intelligenceStyles.methodNote}><ShieldAlert size={15} />Party attention is an unaided aggregate signal, not declared vote intention. The five-star index is shown only from a direct neutral rating question and is never used to score or target an individual voter.</p>
          </section>

          <section className={styles.findingsSection}><div className={styles.sectionHead}><div><span>WHAT TO DO NEXT</span><h2>Evidence-qualified findings</h2></div><p>Use these summaries to choose the next research question, not to target individual voters.</p></div>{!data.findings.length ? <div className={styles.noSignal}>No decision finding can be generated from the current evidence.</div> : <div className={styles.findings}>{data.findings.slice(0, 4).map((finding) => <article key={`${finding.type}-${finding.title}`}><div><Target size={17} /><span>{finding.type}</span></div><h3>{finding.title}</h3><strong>{finding.evidence}</strong><p>{finding.caution}</p></article>)}</div>}</section>
        </>}

        <section className={styles.validity}><div className={styles.validityLead}><AlertTriangle size={22} /><div><span>INTERPRETATION</span><h2>Directional aggregate evidence</h2><p>Findings describe responding cohorts and do not estimate constituency vote share.</p></div></div><div className={styles.warnings}>{data.validity.warnings.slice(0, 4).map((warning) => <p key={warning}><AlertTriangle size={14} />{warning}</p>)}</div></section>
        <footer className={styles.generated}><FileQuestion size={14} />Generated from stored platform evidence. No individual political profile, propensity score, or targeting list is produced.</footer>
      </>}
    </main></AppShell>
  );
}
