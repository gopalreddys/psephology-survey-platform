"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, FileQuestion, LoaderCircle, PhoneCall, RefreshCw, ShieldAlert, Target } from "lucide-react";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./strategic.module.css";
import scopeStyles from "./scope.module.css";
import intelligenceStyles from "./intelligence.module.css";

type Measure = { answerBase: number; respondentBase: number; missingCount: number; cantSayCount: number; refusedCount: number; uncodedCount: number; suppressed: boolean; unit?: string };
type Distribution = Measure & { value: string; respondents: number; percentage: number | null };
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
type RatingComponent = { key: string; label: string; value: number; weight: number; answered: number; variables: string[] };
type PartyStrengthAnalysis = {
  estimate: { value: number | null; scale: number; band: string; confidence: string; judgment: string; components: RatingComponent[]; basis: string };
  directMeasure: { value: number | null; answered: number; scale: number; basis: string };
  distinction: string;
};
type SentimentAnalysis = {
  measure?: Measure;
  construct?: string; label?: string; outputVariables?: string[];
  validation?: { status: string; method: string; normalizationVersion: string; ruleHash: string; message: string };
  judgment: string; confidence: string; respondentBase: number; codedAnswers: number; outputCoveragePct: number;
  distribution: Distribution[];
  variables: Array<{ key: string; type?: string; label: string; answered: number; measure?: Measure; distribution: Distribution[] }>;
};
type StrategicResponse = {
  outputMeasures: Record<string, Measure>;
  campaign: { id: string; code: string; name: string; targetName: string; surveyStage: string };
  scope: {
    level: "CAMPAIGN" | "ITERATION" | "RUN";
    iteration: AnalysisIteration | null;
    run: RunSummary | null;
    operations: null | { callAttempts: number; connectedCalls: number; transcriptCoveragePct: number; responseCoveragePct: number };
    insightScope: { level: "ITERATION"; iterationId: string | null; runRestriction: null; filters: { gender: string | null; ageBand: string | null; mandal: string | null }; description: string };
    interpretation: string;
  };
  options: { iterations: AnalysisIteration[]; filters: { genders: string[]; ageBands: string[]; mandals: string[] }; sentimentConstructs?: Array<{ key: string; label: string }> };
  segment: { filters: { gender: string | null; ageBand: string | null; mandal: string | null }; respondentBase: number | null; minimumBase: number; suppressed: boolean };
  validity: { latestRespondentBase: number; averageAnswerCoveragePct: number; warnings: string[] };
  latestIteration: AnalysisIteration | null;
  comparison: null | {
    status: "COMPARABLE" | "NOT_COMPARABLE";
    reasons: string[];
    previousIteration: AnalysisIteration | null;
    latestIteration: AnalysisIteration | null;
    movements: Array<{ key: string; label: string; largestShift: { value: string; shiftPercentagePoints: number }; respondentBases: Array<{ iterationId: string; respondents: number }> }>;
  };
  issueAnalysis: { priorities: Distribution[]; developmentPriorities: Distribution[]; desiredChanges: Distribution[] };
  iterationDashboard: { respondentBase: number; candidateSentiment: Distribution[]; incumbentSentiment: Distribution[]; partyAttention: Distribution[]; perceivedIssueLeadership: Distribution[] };
  campaignRating: CampaignRating;
  partyLeanIndex: { value: number | null; answered: number; scale: number; basis: string };
  partyStrengthAnalysis: PartyStrengthAnalysis;
  predictiveAnalysis: { outlook: string; confidence: string; judgment: string; respondentBase: number; variables: string[]; drivers: Array<{ label: string; value: number; answered: number; variables: string[] }>; limitations: string[] };
  sentimentAnalysis: SentimentAnalysis;
  nextIterationPlan: Array<{ priority: number; title: string; objective: string; rationale: string; variables: string[] }>;
  methodology: { analysisUnit: string; ageBands: string[]; minimumSegmentBase: number; weighting: string; representativeSampling: string; uncertainty: string; benchmarkRule: string };
  findings: Array<{ type: string; title: string; evidence: string; caution: string; variables: string[] }>;
  generatedAt: string;
};

function pct(value: number | null) { return value === null ? "Withheld" : `${Number(value || 0).toFixed(1)}%`; }

function AnswerBase({ measure }: { measure?: Measure }) {
  if (!measure) return <small>Answer base unavailable; refresh after the reporting update.</small>;
  return <p className={intelligenceStyles.methodNote}>{measure.answerBase}/{measure.respondentBase} recorded answers · Missing {measure.missingCount} · Can&apos;t say {measure.cantSayCount} · Declined {measure.refusedCount} · Uncoded {measure.uncodedCount}. {measure.suppressed ? "Percentages withheld below five answers or assessed respondents." : "Percentages include all non-missing answers."} {measure.unit}</p>;
}

const CHART_COLORS = ["#168b7d", "#d75b72", "#e0a34b", "#6b79b9", "#9b7ab8", "#879692"];
function categoryColor(value: string, index: number) {
  const sentimentColors: Record<string, string> = { Positive: "#168b7d", Negative: "#d75b72", Neutral: "#879692", Mixed: "#9b7ab8", "Can't say": "#e0a34b", "Declined to answer": "#6b79b9", "Uncoded response": "#8d9095" };
  return sentimentColors[value] || CHART_COLORS[index % CHART_COLORS.length];
}

function DonutChart({ title, subtitle, items, empty, measure }: { title: string; subtitle: string; items: Distribution[]; empty: string; measure?: Measure }) {
  if (!items.length) return <article className={intelligenceStyles.chartCard}><span className={intelligenceStyles.cardEyebrow}>{subtitle}</span><h3>{title}</h3><AnswerBase measure={measure} /><div className={styles.noSignal}>{empty}</div></article>;
  const stops = items.map(function (item, index) { const start = items.slice(0, index).reduce((total, previous) => total + (previous.percentage || 0), 0); return `${categoryColor(item.value, index)} ${start}% ${start + (item.percentage || 0)}%`; });
  return (
    <article className={intelligenceStyles.chartCard}>
      <span className={intelligenceStyles.cardEyebrow}>{subtitle}</span><h3>{title}</h3>
      <div className={intelligenceStyles.donutLayout}>
        <div className={intelligenceStyles.donut} style={{ background: `conic-gradient(${stops.join(", ")})` }}><div><strong>{items.reduce((total, item) => total + item.respondents, 0)}</strong><span>answers</span></div></div>
        <div className={intelligenceStyles.legend}>{items.map(function (item, index) { return <div key={item.value}><i style={{ background: categoryColor(item.value, index) }} /><span>{item.value} ({item.respondents}/{item.answerBase})</span><strong>{pct(item.percentage)}</strong></div>; })}</div>
      </div>
      <AnswerBase measure={measure || items[0]} />
    </article>
  );
}

function DistributionCard({ eyebrow, title, items, empty, measure }: { eyebrow: string; title: string; items: Distribution[]; empty: string; measure?: Measure }) {
  return (
    <article className={styles.signalCard}><span>{eyebrow}</span><h3>{title}</h3>
      <AnswerBase measure={measure || items[0]} />
      {!items.length ? <div className={styles.noSignal}>{empty}</div> : <div className={styles.distribution}>{items.map(function (item) { return <div key={item.value} className={styles.distributionRow}><div><span>{item.value}</span><strong>{pct(item.percentage)}</strong></div><div className={styles.bar}><i style={{ width: `${Math.min(item.percentage || 0, 100)}%` }} /></div><small>{item.respondents}/{item.answerBase} answers</small></div>; })}</div>}
    </article>
  );
}

function VariableChips({ variables }: { variables: string[] }) {
  return <div className={intelligenceStyles.variableChips}>{variables.map((variable) => <code key={variable}>{variable}</code>)}</div>;
}

function IterationJudgments({ data }: { data: StrategicResponse }) {
  const estimate = data.partyStrengthAnalysis.estimate;
  const sentiment = data.sentimentAnalysis;
  return (
    <section className={intelligenceStyles.judgmentSection}>
      <div className={intelligenceStyles.judgmentIntro}><span>ITERATION-WIDE ANALYTICS</span><h2>Descriptive signals, separate measures</h2><p>{data.scope.insightScope.description} Research insights apply the selected gender, age and Mandal filters to respondents across all Runs. Run selection affects operational metrics only.</p></div>
      <div className={intelligenceStyles.analysisGuard}><ShieldAlert size={16} /><span>{sentiment.validation?.message || "Human review pending. Explicit structured labels only—not a validated sentiment model."} {sentiment.validation && <small>Rules: {sentiment.validation.normalizationVersion} · {sentiment.validation.ruleHash.slice(0, 12)}</small>}</span></div>
      <div className={intelligenceStyles.judgmentGrid}>
        <article className={intelligenceStyles.predictiveCard}>
          <span>DIRECTIONAL RESEARCH OUTLOOK</span>
          <h3>{data.predictiveAnalysis.outlook}</h3>
          {estimate.value === null
          ? <div className={intelligenceStyles.emptyStars}>☆☆☆☆☆</div>
          : <div className={intelligenceStyles.stars} aria-label={`${estimate.value} out of 5 stars`}>
              {Array.from({ length: 5 }, (_, item) => <i key={item} data-filled={item + 1 <= Math.round(estimate.value || 0)}>★</i>)}
              <strong>{estimate.value}/5</strong>
            </div>}
          <p>{data.predictiveAnalysis.judgment}</p>
          <div className={intelligenceStyles.judgmentStats}><div><span>Band</span><strong>{estimate.band}</strong></div><div><span>Interpretation</span><strong>{data.predictiveAnalysis.confidence}</strong></div><div><span>Base</span><strong>{data.predictiveAnalysis.respondentBase}</strong></div></div>
          <strong className={intelligenceStyles.variablesLabel}>Variables used</strong><VariableChips variables={data.predictiveAnalysis.variables} />
        </article>
        <article className={intelligenceStyles.sentimentCard}>
          <span>{sentiment.label || "SELECTED SENTIMENT CONSTRUCT"}</span>
          <h3>{sentiment.judgment}</h3>
          <AnswerBase measure={sentiment.measure} />
          <div className={intelligenceStyles.sentimentBars}>{sentiment.distribution.map((item, index) => <div key={item.value}><div><i style={{ background: categoryColor(item.value, index) }} /><span>{item.value} ({item.respondents}/{item.answerBase})</span><strong>{pct(item.percentage)}</strong></div><div><i style={{ width: `${item.percentage || 0}%`, background: categoryColor(item.value, index) }} /></div></div>)}</div>
          <div className={intelligenceStyles.judgmentStats}><div><span>Review status</span><strong>{sentiment.confidence}</strong></div><div><span>Coded answers</span><strong>{sentiment.codedAnswers}</strong></div><div><span>Coverage</span><strong>{pct(sentiment.outputCoveragePct)}</strong></div></div>
          <strong className={intelligenceStyles.variablesLabel}>Variables used · no cross-construct fallback</strong><VariableChips variables={sentiment.outputVariables || []} />
        </article>
      </div>
      <details><summary>Other constructs · reported separately, never pooled</summary><div className={intelligenceStyles.decisionGrid}>{sentiment.variables.filter((variable) => variable.key !== sentiment.construct).map((variable) => <DistributionCard key={variable.key} eyebrow={variable.type === "SUITABILITY" ? "SUITABILITY · NOT SENTIMENT" : "SEPARATE ASSESSMENT"} title={variable.label} measure={variable.measure} items={variable.distribution} empty="No reportable answers for this construct." />)}</div></details>
      <article className={intelligenceStyles.partyStrengthCard}>
        <div><span>PARTY-STRENGTH MEASUREMENT</span><h3>Derived aggregate estimate and direct measure</h3><p>{data.partyStrengthAnalysis.distinction}</p></div>
        <div className={intelligenceStyles.strengthMeasures}><div><span>Derived from outputs</span><strong>{estimate.value === null ? "Not measured" : `${estimate.value}/5`}</strong><small>{estimate.judgment}</small></div><div><span>Direct neutral 1–5 question</span><strong>{data.partyStrengthAnalysis.directMeasure.value === null ? "Not asked" : `${data.partyStrengthAnalysis.directMeasure.value}/5`}</strong><small>{data.partyStrengthAnalysis.directMeasure.answered} direct answers</small></div></div>
        <div className={intelligenceStyles.strengthComponents}>{estimate.components.map((component) => <div key={component.key}><span>{component.label}</span><strong>{component.value.toFixed(1)}/5</strong><small>{component.answered} answers</small><VariableChips variables={component.variables} /></div>)}</div>
      </article>
      <div className={intelligenceStyles.analysisGuard}><ShieldAlert size={16} /><span>This outlook is an aggregate directional research judgment—not constituency vote share, an election forecast, or a participant-level political score.</span></div>
    </section>
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
  const [sentimentConstruct, setSentimentConstruct] = useState("candidate_impression");
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const requestGeneration = useRef(0);
  const scopeKey = JSON.stringify([campaignId, iterationId, runId, gender, ageBand, mandal, sentimentConstruct]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(function () {
    const timer = window.setTimeout(function () {
      const query = new URLSearchParams(window.location.search);
      setIterationId(query.get("iterationId") || "");
      setRunId(query.get("runId") || "");
      setGender(query.get("gender") || "");
      setAgeBand(query.get("ageBand") || "");
      setMandal(query.get("mandal") || "");
      setSentimentConstruct(query.get("sentimentConstruct") || "candidate_impression");
      setScopeInitialized(true);
    }, 0);
    return function () { window.clearTimeout(timer); };
  }, []);

  const loadStrategic = useCallback(async function (refresh = false) {
    if (!campaignId) return;
    const generation = ++requestGeneration.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (iterationId) query.set("iterationId", iterationId);
      if (runId) query.set("runId", runId);
      if (gender) query.set("gender", gender);
      if (ageBand) query.set("ageBand", ageBand);
      if (mandal) query.set("mandal", mandal);
      query.set("sentimentConstruct", sentimentConstruct);
      const response = await apiFetch(`/api/analytics/campaigns/${campaignId}${query.size ? `?${query.toString()}` : ""}`) as StrategicResponse;
      if (generation !== requestGeneration.current) return;
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
      response.partyStrengthAnalysis ||= {
        estimate: { value: null, scale: 5, band: "Not measured", confidence: "Directional", judgment: "Party strength cannot be estimated from the recorded outputs", components: [], basis: "Weighted aggregate of recorded output variables" },
        directMeasure: response.partyLeanIndex,
        distinction: "No direct or derived party-strength measurement is available."
      };
      response.sentimentAnalysis ||= {
        judgment: "No sentiment judgment is available",
        confidence: "Directional",
        respondentBase: response.segment.respondentBase || 0,
        codedAnswers: 0,
        outputCoveragePct: 0,
        distribution: [],
        variables: []
      };
      response.predictiveAnalysis ||= {
        outlook: "Insufficient evidence",
        confidence: "Directional",
        judgment: "Complete the structured outputs before drawing a directional research judgment.",
        respondentBase: response.segment.respondentBase || 0,
        variables: [],
        drivers: [],
        limitations: []
      };
      response.nextIterationPlan ||= [];
      response.methodology ||= {
        analysisUnit: "Entire selected Iteration, deduplicated by respondent across Runs",
        ageBands: ["18–29", "30–39", "40–49", "50+"],
        minimumSegmentBase: 5,
        weighting: "Not configured",
        representativeSampling: "Not verified",
        uncertainty: "Directional sample; do not report constituency estimates",
        benchmarkRule: "Movement requires completed consecutive Iterations approved by the declared research-methods comparability gate, with the same cohort filters in both waves."
      };
      response.scope.insightScope ||= {
        level: "ITERATION", iterationId: response.scope.iteration?.id || null, runRestriction: null,
        filters: response.segment.filters,
        description: response.scope.iteration ? `Iteration ${response.scope.iteration.number} across all Runs, with the selected cohort filters.` : "No Iteration evidence is available."
      };
      response.findings = (response.findings || []).map((finding) => ({ ...finding, variables: finding.variables || [] }));
      setData(response);
      setLoadedScopeKey(scopeKey);
    } catch (reason) { if (generation === requestGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load Analysis"); }
    finally { if (generation === requestGeneration.current) { setLoading(false); setRefreshing(false); } }
  }, [ageBand, campaignId, gender, iterationId, mandal, runId, scopeKey, sentimentConstruct]);

  useEffect(function () { if (!user || !campaignId || !scopeInitialized) return; const timer = window.setTimeout(function () { void loadStrategic(); }, 0); return function () { window.clearTimeout(timer); requestGeneration.current += 1; }; }, [campaignId, loadStrategic, scopeInitialized, user]);
  useEffect(function () { if (!user) return; void apiFetch("/api/analytics").then(function (workspace) { const result = workspace as { campaigns: CampaignOption[] }; setCampaigns(result.campaigns.map((campaign) => ({ id: campaign.id, code: campaign.code, name: campaign.name }))); }).catch(function () { setCampaigns([]); }); }, [user]);

  function resetSegments() { setGender(""); setAgeBand(""); setMandal(""); }

  if (loading || (data && loadedScopeKey !== scopeKey && !error)) return <AppShell><main className={styles.loading}><LoaderCircle className={styles.spin} />Preparing decision analysis…</main></AppShell>;

  return (
    <AppShell><main className={styles.page}>
      <div className={styles.backRow}><Link href="/analytics"><ArrowLeft size={15} />Back to Analysis</Link></div>
      {error && <FeedbackMessage tone="error" message={error} />}
      {data && loadedScopeKey === scopeKey && <>
        <header className={styles.hero}><div><span>PSEPHOLOGY ANALYSIS</span><h1>{data.campaign.name}</h1><p>{data.campaign.code} · {data.campaign.targetName} · {data.campaign.surveyStage} survey</p></div><div className={styles.heroActions}><button type="button" disabled={refreshing} onClick={function () { void loadStrategic(true); }}><RefreshCw size={15} className={refreshing ? styles.spin : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button></div></header>

        <section className={scopeStyles.scopeSelector}><div className={scopeStyles.scopeIntro}><span>ANALYSIS SCOPE</span><h2>Iteration insights · Run operations</h2><p>{data.scope.interpretation}</p></div><div className={scopeStyles.scopeControls}>
          <label><span>Campaign</span><select value={campaignId} onChange={(event) => router.push(`/analytics/campaigns/${event.target.value}`)}>{campaigns.length === 0 && <option value={campaignId}>{data.campaign.name}</option>}{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.code}</option>)}</select></label>
          <label><span>Iteration · insight scope</span><select value={iterationId} onChange={function (event) { setIterationId(event.target.value); setRunId(""); resetSegments(); }}><option value="">{!iterationId && data.scope.iteration ? `Latest completed · Iteration ${data.scope.iteration.number}` : "Latest completed Iteration"}</option>{data.options.iterations.map((iteration) => <option key={iteration.id} value={iteration.id}>Iteration {iteration.number} · {iteration.name}</option>)}</select></label>
          <label><span>Run · operations only</span><select value={runId} disabled={!iterationId} onChange={function (event) { setRunId(event.target.value); }}><option value="">All Run operations</option>{(data.options.iterations.find((iteration) => iteration.id === iterationId)?.runs || []).map((run) => <option key={run.id} value={run.id}>Run {run.number} · {run.status}</option>)}</select></label>
        </div></section>

        <section className={scopeStyles.segmentFilters}><div><span>COHORT FILTERS</span><strong>Aggregate respondent view</strong><small>Age bands do not overlap; results below n={data.segment.minimumBase} are withheld.</small></div>
          <label><span>Gender</span><select value={gender} onChange={(event) => setGender(event.target.value)}><option value="">All genders</option>{data.options.filters.genders.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Age</span><select value={ageBand} onChange={(event) => setAgeBand(event.target.value)}><option value="">All ages</option>{data.options.filters.ageBands.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Mandal</span><select value={mandal} onChange={(event) => setMandal(event.target.value)}><option value="">All mandals</option>{data.options.filters.mandals.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Sentiment construct</span><select value={sentimentConstruct} onChange={(event) => setSentimentConstruct(event.target.value)}>{(data.options.sentimentConstructs || [{ key: "candidate_impression", label: "Candidate impression" }]).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <button type="button" onClick={resetSegments} disabled={!gender && !ageBand && !mandal}>Clear</button>
        </section>

        <section className={scopeStyles.comparability} aria-label="Iteration movement comparability">
          <div><ShieldAlert size={19} /><strong>{data.comparison?.status === "COMPARABLE" && data.comparison.movements.length ? "Consecutive-wave movement available" : "Consecutive-wave movement withheld"}</strong></div>
          <p>{data.comparison?.previousIteration && data.comparison.latestIteration ? `Iteration ${data.comparison.previousIteration.number} → ${data.comparison.latestIteration.number}. ` : "A completed consecutive predecessor is required. "}Both waves use the same selected gender, age and Mandal filters, with at least n={data.segment.minimumBase} answers per reported measure.</p>
          {data.comparison?.reasons.length ? <p>{data.comparison.reasons.join(" ")}</p> : !data.comparison?.movements.length ? <p>No repeated structured measure meets the methods gate and minimum answer base in both waves.</p> : <div className={scopeStyles.movementList}>{data.comparison.movements.slice(0, 4).map((movement) => <article key={movement.key}><span>{movement.label} · {movement.largestShift.value}</span><strong>{movement.largestShift.shiftPercentagePoints > 0 ? "+" : ""}{movement.largestShift.shiftPercentagePoints.toFixed(1)} pp</strong><small>Answered bases: {movement.respondentBases.map((base) => base.respondents).join(" → ")}</small></article>)}</div>}
        </section>

        {data.scope.operations && <section className={scopeStyles.scopeMetrics} aria-label="Selected operational scope"><article><PhoneCall size={18} /><span>{data.scope.run ? "Run attempts" : "Iteration attempts"}</span><strong>{data.scope.operations.callAttempts}</strong></article><article><Activity size={18} /><span>Connected</span><strong>{data.scope.operations.connectedCalls}</strong></article><article><FileQuestion size={18} /><span>Responses</span><strong>{pct(data.scope.operations.responseCoveragePct)}</strong></article><article><Target size={18} /><span>Filtered insight base</span><strong>{data.segment.suppressed ? "Withheld" : data.segment.respondentBase}</strong></article></section>}

        {data.segment.suppressed ? <section className={scopeStyles.suppressed}><ShieldAlert size={23} /><div><strong>Segment results withheld</strong><p>The selected cohort is below the minimum reporting base of {data.segment.minimumBase}. Broaden one or more filters or collect more structured responses.</p></div></section> : <>

          <IterationJudgments data={data} />

          <section className={intelligenceStyles.dashboardSection}><div className={styles.sectionHead}><div><span>EVIDENCE BEHIND THE JUDGMENT</span><h2>Decision signals from recorded outputs</h2></div><p>{data.latestIteration ? `Iteration ${data.latestIteration.number} · ${data.segment.respondentBase} deduplicated respondents` : "No Iteration evidence available"}</p></div>
            <div className={intelligenceStyles.decisionGrid}>
              <DonutChart title="Party attention" subtitle="UNAIDED RECALL, NOT VOTE CHOICE" items={data.iterationDashboard.partyAttention} measure={data.outputMeasures?.party_salience_unaided} empty="No reportable unaided party signal was captured." />
              <DonutChart title="Candidate perception" subtitle="RECORDED ASSESSMENT" items={data.iterationDashboard.candidateSentiment} measure={data.outputMeasures?.candidate_assessment} empty="No reportable candidate perception was captured." />
              <DonutChart title="Perceived issue leadership" subtitle="AIDED ISSUE LEADER" items={data.iterationDashboard.perceivedIssueLeadership} measure={data.outputMeasures?.perceived_issue_leader_aided} empty="No reportable leadership signal was captured." />
              <DonutChart title="Incumbent assessment" subtitle="LEADERSHIP PERFORMANCE" items={data.iterationDashboard.incumbentSentiment} measure={data.outputMeasures?.incumbent_assessment} empty="No reportable incumbent assessment was captured." />
              <DistributionCard eyebrow="ISSUES" title="Priority issues" items={data.issueAnalysis.priorities} measure={data.outputMeasures?.graduate_issue_priority} empty="No reportable issue priority was captured." />
              <DistributionCard eyebrow="DEVELOPMENT" title="Development priorities" items={data.issueAnalysis.developmentPriorities} measure={data.outputMeasures?.development_priority} empty="No reportable development priority was captured." />
              <DistributionCard eyebrow="CHANGE" title="Changes voters want" items={data.issueAnalysis.desiredChanges} measure={data.outputMeasures?.desired_change} empty="No reportable desired-change output was captured." />
            </div>
            <p className={intelligenceStyles.methodNote}><ShieldAlert size={15} />Party attention, candidate perception and leadership signals are aggregate evidence components. Their exact output variables are documented in the directional-outlook and sentiment sections above.</p>
          </section>

          <section className={styles.findingsSection}><div className={styles.sectionHead}><div><span>WHAT THE EVIDENCE SAYS</span><h2>Evidence-qualified findings</h2></div><p>Each finding shows the output variables used.</p></div>{!data.findings.length ? <div className={styles.noSignal}>No decision finding can be generated from the current evidence.</div> : <div className={styles.findings}>{data.findings.slice(0, 4).map((finding) => <article key={`${finding.type}-${finding.title}`}><div><Target size={17} /><span>{finding.type}</span></div><h3>{finding.title}</h3><strong>{finding.evidence}</strong><p>{finding.caution}</p><VariableChips variables={finding.variables} /></article>)}</div>}</section>

          <section className={intelligenceStyles.actionPlan}><div className={styles.sectionHead}><div><span>NEXT-LEVEL SURVEY PLAN</span><h2>Clear actions for the next Iteration</h2></div><p>Prioritized from Iteration evidence with the selected cohort filters.</p></div><div className={intelligenceStyles.planGrid}>{data.nextIterationPlan.map((item) => <article key={item.priority}><span>PRIORITY {item.priority}</span><h3>{item.title}</h3><p>{item.objective}</p><strong>{item.rationale}</strong><VariableChips variables={item.variables} /></article>)}</div></section>
        </>}

        <section className={intelligenceStyles.methodology}><div><span>PSEPHOLOGY QUALITY GATE</span><h2>How to interpret this Analysis</h2><p>{data.methodology.analysisUnit}</p></div><div><article><span>Age bands</span><strong>{data.methodology.ageBands.join(" · ")}</strong></article><article><span>Minimum segment</span><strong>n={data.methodology.minimumSegmentBase}</strong></article><article><span>Weighting</span><strong>{data.methodology.weighting}</strong></article><article><span>Sampling</span><strong>{data.methodology.representativeSampling}</strong></article><article><span>Collection mode</span><strong>AI-assisted outbound voice interviews</strong></article><article><span>Statistical precision</span><strong>No sampling margin of error</strong></article></div><p><AlertTriangle size={14} />{data.methodology.uncertainty}</p><p><FileQuestion size={14} />{data.methodology.benchmarkRule}</p><p><ShieldAlert size={14} />AI supports interviewing and structured-output capture. Interpretation remains aggregate and should receive research oversight before external use.</p></section>

        <section className={styles.validity}><div className={styles.validityLead}><AlertTriangle size={22} /><div><span>INTERPRETATION</span><h2>Directional aggregate evidence</h2><p>Findings describe responding cohorts and do not estimate constituency vote share.</p></div></div><div className={styles.warnings}>{data.validity.warnings.slice(0, 4).map((warning) => <p key={warning}><AlertTriangle size={14} />{warning}</p>)}</div></section>
        <footer className={styles.generated}><FileQuestion size={14} />Generated from stored platform evidence. No individual political profile, propensity score, or targeting list is produced.</footer>
      </>}
    </main></AppShell>
  );
}
