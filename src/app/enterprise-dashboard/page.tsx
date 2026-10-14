"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, BarChart3, ChevronDown, Info, LoaderCircle,
  RefreshCw, ShieldCheck
} from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import TelanganaBoundaryMap from "./TelanganaBoundaryMap";
import QuickDashboardEmbed from "./QuickDashboardEmbed";
import styles from "./quick.module.css";

type EmbedResponse = {
  provider: "AMAZON_QUICK_SIGHT";
  mode: "ONE_CLICK" | "REGISTERED_USER_API";
  dashboardId?: string;
  embedUrl: string;
  issuedAt?: string;
  sessionLifetimeMinutes?: number;
  accessScope?: "SUPER_ADMIN_PORTFOLIO" | "USER_RLS";
  freshness?: { status: string; oldestCompletedIngestionAt: string | null; datasetCount: number | null };
};

type ResearchQualityResponse = {
  sentimentValidation: {
    status: string; method: string; normalizationVersion: string; ruleHash: string; message: string;
  };
  scope?: { label: string; runScope: string; movementScope: string };
  portfolio: {
    campaignCount: number;
    respondentBase: number;
    callAttempts: number;
    connectedCalls: number;
    transcriptsCaptured: number;
    responsesCaptured: number;
    demographicFieldBase: number;
    connectionRatePct: number;
    transcriptCoveragePct: number;
    responseCoveragePct: number;
    demographicCompletenessPct: number;
    evidenceQualityStatus: "LIMITED" | "MIXED" | "DIRECTIONAL";
  };
  methodology: {
    samplingDesign: string;
    weightingStatus: string;
    statisticalPrecision: string;
    comparisonRule: string;
    sentimentConstruct: string;
    candidateConstruct: string;
    sentimentCoding: string;
    assetPublication: string;
    permittedUse: string;
    prohibitedUse: string;
  };
  campaigns: Array<{
    campaignId: string;
    campaignName: string;
    respondentBase: number;
    responseCoveragePct: number;
    demographicCompletenessPct: number;
    evidenceQualityStatus: string;
    fieldworkStartedAt: string | null;
    fieldworkEndedAt: string | null;
  }>;
  movement: Array<{
    campaignId: string;
    campaignName: string;
    iterationId: string;
    iterationNumber: number;
    iterationName: string;
    respondentBase: number | null;
    averageDirectPartyStrength: number | null;
    partyStrengthChange: number | null;
    positiveSentimentPct: number | null;
    positiveSentimentChangePct: number | null;
    candidatePositivePct: number | null;
    candidatePositiveChangePct: number | null;
    sentimentAnswerBase: number | null;
    sentimentMissingCount: number | null;
    sentimentUncodedCount: number | null;
    sentimentCantSayCount: number | null;
    sentimentRefusedCount: number | null;
    candidateAnswerBase: number | null;
    candidateMissingCount: number | null;
    candidateUncodedCount: number | null;
    candidateCantSayCount: number | null;
    candidateRefusedCount: number | null;
    previousSentimentAnswerBase: number | null;
    previousCandidateAnswerBase: number | null;
    percentageBasis: string;
    sentimentConstruct: string;
    candidateConstruct: string;
    comparisonBasis: string;
    comparisonReasons: string[];
  }>;
  researchDesigns: Array<{
    campaignId: string;
    campaignName: string;
    iterationId: string;
    iterationNumber: number;
    iterationName: string;
    targetPopulation: string;
    sampleFrameName: string;
    samplingMethod: string;
    selectionMethod: string;
    weightingStatus: string;
    weightingMethod: string;
    weightingVariables: string[];
    fieldworkMode: string;
    methodologyNotes: string;
    cohortDesign: string;
    revision: number;
    declaredByUserId: string | null;
    declaredAt: string | null;
    declarationComplete: boolean;
    questionContentRecorded: boolean;
    frozenQuestionCount: number;
    questionContentFingerprint: string | null;
    comparisonStatus: string;
    comparisonReasons: string[];
  }>;
};

function MeasurementNote({ label = "How it’s measured", children }: {
  label?: string;
  children: ReactNode;
}) {
  return <details className={styles.measurementNote}>
    <summary><Info size={14} aria-hidden="true" />{label}</summary>
    <div className={styles.noteContent}>{children}</div>
  </details>;
}

function countLabel(value: number | null) {
  return value === null ? "Withheld" : String(value);
}

function SupportingPanel({ title, status, children }: {
  title: string;
  status: string;
  children: ReactNode;
}) {
  return <details className={styles.supportingPanel}>
    <summary><span>{title}</span><small>{status}</small><ChevronDown size={17} aria-hidden="true" /></summary>
    <div className={styles.supportingContent}>{children}</div>
  </details>;
}

const PREVIEW_SECTIONS = [
  ["Leadership overview", "Recorded party salience, candidate impression, issue leadership and priorities"],
  ["Demographic pulse", "Age bands 18–29, 30–39, 40–49 and 50+; gender comparisons"],
  ["Geographic intelligence", "Constituency and Mandal heat tables"],
  ["Iteration movement", "Comparable research movement across survey waves"],
  ["Research quality", "Fieldwork coverage, completeness and interpretation limits"]
];

export default function EnterpriseDashboardPage() {
  // Report state must live inside AppShell's authenticated subtree. Sign-out
  // unmounts this child, discarding the consumed URL and the previous profile.
  return <AppShell><AuthenticatedEnterpriseDashboard /></AppShell>;
}

function AuthenticatedEnterpriseDashboard() {
  const { user } = useCurrentUser();
  const [dashboard, setDashboard] = useState<EmbedResponse | null>(null);
  const [quality, setQuality] = useState<ResearchQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [loadedActorId, setLoadedActorId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async function () {
    if (!user || user.role.code !== "SUPER_ADMIN") return;
    const sequence = ++requestSequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setDashboard(null);
    setQuality(null);
    setLoading(true);
    setError(null);
    setQualityError(null);
    const requestTimeout = window.setTimeout(() => {
      if (sequence !== requestSequence.current) return;
      controller.abort();
      setLoadedActorId(user.id);
      setError("Report connection timed out. Refresh to open a new session.");
      setLoading(false);
    }, 45_000);
    const [dashboardResult, qualityResult] = await Promise.allSettled([
      apiFetch("/api/enterprise-dashboard/embed-url", { signal: controller.signal }) as Promise<EmbedResponse>,
      apiFetch("/api/enterprise-dashboard/research-quality", { signal: controller.signal }) as Promise<ResearchQualityResponse>
    ]);
    window.clearTimeout(requestTimeout);
    if (controller.signal.aborted || sequence !== requestSequence.current) return;
    setLoadedActorId(user.id);
    if (dashboardResult.status === "fulfilled") {
      setDashboard(dashboardResult.value);
    } else {
      setError(dashboardResult.reason instanceof Error
        ? dashboardResult.reason.message : "Unable to open Amazon Quick");
    }
    if (qualityResult.status === "fulfilled") {
      setQuality(qualityResult.value);
    } else {
      setQuality(null);
      setQualityError(qualityResult.reason instanceof Error
        ? qualityResult.reason.message : "Unable to load research quality");
    }
    setLoading(false);
  }, [user]);

  useEffect(function () {
    const timer = window.setTimeout(function () { void loadDashboard(); }, 0);
    return function () {
      window.clearTimeout(timer);
      requestSequence.current += 1;
      activeRequest.current?.abort();
    };
  }, [loadDashboard]);

  const actorMatches = loadedActorId === user?.id;
  const shownDashboard = actorMatches ? dashboard : null;
  const shownQuality = actorMatches ? quality : null;
  if (user && user.role.code !== "SUPER_ADMIN") return (
    <main className={styles.page}>
      <section className={styles.setup} aria-label="Amazon Quick access">
        <h1>Amazon Quick unavailable for this role</h1>
        <FeedbackMessage tone="info" message="Amazon Quick is available to Super Admin only in this demo. Your native Dashboard remains available." />
        <Link href="/"><ArrowLeft size={16} />Open native Dashboard</Link>
        {user.role.code !== "CAMPAIGNER" && <Link href="/analytics"><BarChart3 size={16} />Open Analysis</Link>}
      </section>
    </main>
  );

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div>
        <Link href="/"><ArrowLeft size={16} />Back to Dashboard</Link>
        <span>LEADERSHIP DASHBOARD</span>
        <h1>Survey outcomes</h1>
        <p>Explore the results by campaign, Iteration and voter segment.</p>
      </div>
      <button type="button" onClick={function () { void loadDashboard(); }} disabled={loading}>
        <RefreshCw size={16} className={loading ? styles.spin : ""} />Refresh
      </button>
    </header>

    <section className={styles.resultContext} aria-label="Survey interpretation status">
      <div className={styles.contextLabels}>
        <strong>DEMO · TEST SURVEY EVIDENCE</strong>
        <span>Unweighted</span><span>Human review pending</span>
      </div>
      <MeasurementNote label="About these results">
        <h2>Reporting capability preview, not population findings</h2>
        <p>This preview uses a small test cohort. It is not an electorate estimate or a vote forecast. Unavailable values are not replaced with zero, and minimum-person safeguards are not lowered to fill a chart.</p>
        <dl>
          <div><dt>Not recorded</dt><dd>The required answer or demographic field was not captured.</dd></div>
          <div><dt>Withheld</dt><dd>Fewer than five distinct people qualify for the displayed cell after filters, or its answered base is below the minimum.</dd></div>
          <div><dt>Not comparable</dt><dd>Survey waves do not pass the recorded-method and questionnaire checks.</dd></div>
          <div><dt>Technical error</dt><dd>A dataset, visual or session cannot load. This still needs a fix; it is not a missing survey value.</dd></div>
        </dl>
        <p>Aggregate output variables only. No names, phone numbers, EPIC IDs, transcripts or raw JSON enter the BI dataset. Sentiment uses explicit labels, not a validated NLP model. Existing Amazon Quick assets require a separate dataset refresh and label review before presentation.</p>
        <p>Before an actual survey, each report needs a matching question, committed agent extraction field, captured callback output and tested reporting mapping. A chart design alone does not confirm that collection contract.</p>
      </MeasurementNote>
    </section>

    {actorMatches && qualityError && <section className={styles.qualityUnavailable} role="alert"><AlertTriangle size={16} /><span>Survey quality unavailable: {qualityError}</span></section>}

    {loading && <section className={styles.loading} role="status"><LoaderCircle size={24} className={styles.spin} />Loading survey reports…</section>}

    {!loading && actorMatches && error && <>
      <FeedbackMessage tone="error" message={error} />
      <section className={styles.setup}>
        <div className={styles.setupHead}><AlertTriangle size={22} /><div><h2>Dashboard session unavailable</h2><p>The reports could not load. Refresh to try again; this is not a missing survey answer.</p></div></div>
        <MeasurementNote label="Troubleshooting and available reports">
          <p>Check the published dashboard, authorized Reader and allowed domain before presentation.</p>
          <div className={styles.previewGrid}>{PREVIEW_SECTIONS.map(([title, detail]) => <article key={title}><BarChart3 size={17} /><div><strong>{title}</strong><span>{detail}</span></div></article>)}</div>
        </MeasurementNote>
        <Link href="/">Open the native dashboard <BarChart3 size={16} /></Link>
      </section>
    </>}

    {!loading && shownDashboard?.embedUrl && <section className={styles.framePanel} aria-label="Survey reports">
      <div className={styles.frameHeader}>
        <div><h2>Survey results</h2><span>Amazon Quick</span></div>
        <MeasurementNote label="Report definitions">
          <dl>
            <div><dt>Party mentions</dt><dd>Recorded party salience: attention or unaided mentions, not vote intention or party support.</dd></div>
            <div><dt>Candidate impression</dt><dd>Recorded positive, neutral, negative or mixed impressions. Candidate awareness and criterion fit are separate measures.</dd></div>
            <div><dt>Incumbent assessment</dt><dd>Recorded assessment of incumbent performance, not overall political sentiment or named-leader approval.</dd></div>
            <div><dt>Issues and priorities</dt><dd>Issues raised and groups perceived as responsive to them, where those answers were captured.</dd></div>
            <div><dt>Wave comparisons</dt><dd>Changes appear only for comparable adjacent Iterations with sufficient answered bases. A baseline is not a trend.</dd></div>
            <div><dt>Segments and percentages</dt><dd>Check the base shown on each chart after filters. Missing, uncoded, can’t say and declined answers remain distinct. Age bands are 18–29, 30–39, 40–49 and 50+.</dd></div>
          </dl>
          <p>Use the report tabs and filters inside Amazon Quick. The fieldwork summary and supporting comparisons below have their own portfolio scope and do not follow these filters. Profile segments currently reflect voter master data, not frozen interview demographics.</p>
        </MeasurementNote>
      </div>
      <div className={styles.reportMeta}>
        <span>{shownDashboard.accessScope === "USER_RLS" ? "Authorized portfolio" : "Super Admin · full portfolio"}</span>
        <span>{shownDashboard.freshness?.oldestCompletedIngestionAt
          ? `SPICE ingestion: ${new Date(shownDashboard.freshness.oldestCompletedIngestionAt).toLocaleString()}`
          : "Data refresh time unavailable"}</span>
        {shownDashboard.freshness?.status === "UPDATING" ? <span>Dataset refresh in progress</span>
          : shownDashboard.freshness?.status === "REFRESH_FAILED" ? <span>Latest dataset refresh failed</span>
          : shownDashboard.freshness?.status === "STALE" ? <span>Dataset refresh overdue</span>
          : shownDashboard.freshness?.status !== "CURRENT" && shownDashboard.freshness?.status !== "DIRECT_QUERY" && <span>Refresh status needs verification</span>}
      </div>
      <QuickDashboardEmbed key={shownDashboard.embedUrl}
        embedUrl={shownDashboard.embedUrl} issuedAt={shownDashboard.issuedAt}
        sessionLifetimeMinutes={shownDashboard.sessionLifetimeMinutes}
        onRenew={() => { void loadDashboard(); }} />
    </section>}

    {shownQuality && <SupportingPanel title="Fieldwork summary" status="Whole portfolio · all Runs · independent of report filters"><section className={styles.qualityPanel}>
      <div className={styles.qualityHead}>
        <div><h2>Fieldwork summary</h2><p>Whole portfolio · all Runs · independent of report filters</p></div>
        <strong data-status={shownQuality.portfolio.evidenceQualityStatus}>{shownQuality.portfolio.evidenceQualityStatus === "LIMITED" ? "Limited evidence" : shownQuality.portfolio.evidenceQualityStatus === "MIXED" ? "Mixed coverage" : "Directional evidence"}</strong>
      </div>
      <div className={styles.qualityMetrics}>
        <article><span>Response records</span><strong>{shownQuality.portfolio.respondentBase}</strong><small>Person–Iteration records</small><MeasurementNote><p>Latest connected response per voter and Iteration. One person participating in multiple Iterations can count more than once; this is not a unique-person count for the portfolio.</p></MeasurementNote></article>
        <article><span>Calls connected</span><strong>{shownQuality.portfolio.connectionRatePct}%</strong><small>{shownQuality.portfolio.connectedCalls} / {shownQuality.portfolio.callAttempts} attempts</small><MeasurementNote><p>Connected calls divided by all call attempts, including retries. This is an operational connection rate, not a standardized survey response rate.</p></MeasurementNote></article>
        <article><span>Answers captured</span><strong>{shownQuality.portfolio.responseCoveragePct}%</strong><small>{shownQuality.portfolio.responsesCaptured} / {shownQuality.portfolio.connectedCalls} connected calls</small><MeasurementNote><p>Connected calls retaining structured output variables divided by all connected calls. A retained response set does not mean every question was answered or validated.</p></MeasurementNote></article>
        <article><span>Profile completeness</span><strong>{shownQuality.portfolio.demographicCompletenessPct}%</strong><small>Age · gender · Mandal</small><MeasurementNote><p>Recorded gender, age band and Mandal fields divided by {shownQuality.portfolio.demographicFieldBase} available field slots (three per response record). This measures profile completeness, not population representativeness.</p></MeasurementNote></article>
      </div>

      <MeasurementNote label="Quality checks and interpretation limits">
        <p>{shownQuality.scope?.label || "Whole portfolio; independent of embedded Amazon Quick filters"}. {shownQuality.scope?.runScope || "All Runs within each Iteration"}. Quality status describes fieldwork and completeness, not model validation, statistical confidence or electoral probability.</p>
        <div className={styles.methodStrip}>
          <div><span>Sampling</span><strong>{shownQuality.methodology.samplingDesign}</strong></div>
          <div><span>Weighting</span><strong>{shownQuality.methodology.weightingStatus}</strong></div>
          <div><span>Precision</span><strong>{shownQuality.methodology.statisticalPrecision}</strong></div>
        </div>
        <div className={styles.interpretationGuard}>
          <ShieldCheck size={17} />
          <p><strong>Permitted:</strong> {shownQuality.methodology.permittedUse}. <strong>Do not use for:</strong> {shownQuality.methodology.prohibitedUse}. {shownQuality.methodology.comparisonRule}.</p>
        </div>
        <div className={styles.interpretationGuard} role="note">
          <AlertTriangle size={17} />
          <p><strong>Human review pending.</strong> {shownQuality.sentimentValidation.message} Rules: {shownQuality.sentimentValidation.normalizationVersion} · <span title={shownQuality.sentimentValidation.ruleHash}>hash {shownQuality.sentimentValidation.ruleHash.slice(0, 12)}</span>.<br />{shownQuality.methodology.sentimentConstruct}. {shownQuality.methodology.candidateConstruct}. {shownQuality.methodology.sentimentCoding}.<br />{shownQuality.methodology.assetPublication}.</p>
        </div>
      </MeasurementNote>
    </section></SupportingPanel>}

    {shownQuality && shownQuality.movement.length > 0 && <SupportingPanel title="Iteration comparisons" status="Full Iterations · not filtered by age, gender or Mandal">
      <div className={styles.movementPreview}>
        <p>{shownQuality.scope?.movementScope || "Full Iterations, not filtered by age, gender or Mandal"}. Human review pending.</p>
        <div className={styles.movementGrid}>{shownQuality.movement.slice(-6).map((item) => <article key={item.iterationId}>
          <span>{item.campaignName}</span>
          <strong>Iteration {item.iterationNumber}</strong>
          <small>Response records: {countLabel(item.respondentBase)}</small>
          <small>Incumbent positive: {item.positiveSentimentPct === null ? "Withheld" : `${item.positiveSentimentPct}%`} · n={countLabel(item.sentimentAnswerBase)}</small>
          <small>Candidate positive: {item.candidatePositivePct === null ? "Withheld" : `${item.candidatePositivePct}%`} · n={countLabel(item.candidateAnswerBase)}</small>
          <em>{item.comparisonBasis === "BASELINE" ? "Baseline — no earlier comparison" : item.comparisonBasis === "SUPPRESSED" ? "Withheld — too few response records" : item.comparisonBasis !== "COMPARABLE" ? "Not comparable — change withheld" : item.positiveSentimentChangePct === null ? "Change unavailable" : `${item.positiveSentimentChangePct >= 0 ? "+" : ""}${item.positiveSentimentChangePct} pp incumbent positive vs previous`}</em>
          <MeasurementNote label="Measures and comparison checks">
            <small>{item.sentimentConstruct}</small>
            <small>Positive incumbent assessment {item.positiveSentimentPct === null ? "withheld" : `${item.positiveSentimentPct}%`} · answer base n={countLabel(item.sentimentAnswerBase)}</small>
            <small>Sentiment: {countLabel(item.sentimentMissingCount)} missing · {countLabel(item.sentimentUncodedCount)} uncoded · {countLabel(item.sentimentCantSayCount)} can’t say · {countLabel(item.sentimentRefusedCount)} declined</small>
            <small>{item.candidateConstruct}</small>
            <small>Positive candidate impression {item.candidatePositivePct === null ? "withheld" : `${item.candidatePositivePct}%`} · answer base n={countLabel(item.candidateAnswerBase)}</small>
            <small>Candidate: {countLabel(item.candidateMissingCount)} missing · {countLabel(item.candidateUncodedCount)} uncoded · {countLabel(item.candidateCantSayCount)} can’t say · {countLabel(item.candidateRefusedCount)} declined</small>
            <small>{item.percentageBasis}</small>
            <em>{item.comparisonBasis === "BASELINE" ? "Baseline" : item.comparisonBasis === "SUPPRESSED" ? "Movement withheld: at least five response records are required in each adjacent wave" : item.comparisonBasis !== "COMPARABLE" ? `Movement suppressed · ${item.comparisonReasons.join(" · ")}` : item.positiveSentimentChangePct === null ? "Sentiment movement unavailable: at least five answers are required in each adjacent wave" : `${item.positiveSentimentChangePct >= 0 ? "+" : ""}${item.positiveSentimentChangePct} pp vs previous · answer bases ${countLabel(item.previousSentimentAnswerBase)} → ${countLabel(item.sentimentAnswerBase)}`}</em>
          </MeasurementNote>
        </article>)}</div>
      </div>
    </SupportingPanel>}

    {shownQuality && user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code) && <SupportingPanel title="Research setup" status={`${shownQuality.researchDesigns.filter((item) => item.declarationComplete).length}/${shownQuality.researchDesigns.length} methodology declarations recorded`}>
      <p>Methodology is maintained in Iteration operations, not in the reporting workspace.</p>
      <div className={styles.setupLinks}>{shownQuality.researchDesigns.map((item) =>
        <Link key={item.iterationId} href={`/iterations/${item.iterationId}`}>
          {item.campaignName} · Iteration {item.iterationNumber}
          <small>{item.declarationComplete ? "Declaration recorded" : "Not declared"}</small>
        </Link>
      )}</div>
    </SupportingPanel>}

    {user && <SupportingPanel title="Boundary explorer" status="Geographic reference · not a survey heatmap"><TelanganaBoundaryMap /></SupportingPanel>}
  </main>;
}
