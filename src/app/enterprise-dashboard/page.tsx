"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, LoaderCircle,
  RefreshCw, ShieldCheck
} from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import TelanganaBoundaryMap from "./TelanganaBoundaryMap";
import styles from "./quick.module.css";

type EmbedResponse = {
  provider: "AMAZON_QUICK_SIGHT";
  mode: "ONE_CLICK" | "REGISTERED_USER_API";
  dashboardId?: string;
  embedUrl: string;
};

type ResearchQualityResponse = {
  portfolio: {
    campaignCount: number;
    respondentBase: number;
    callAttempts: number;
    connectedCalls: number;
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
    respondentBase: number;
    averageDirectPartyStrength: number | null;
    partyStrengthChange: number | null;
    positiveSentimentPct: number;
    positiveSentimentChangePct: number | null;
    candidatePositivePct: number;
    candidatePositiveChangePct: number | null;
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
    declaredAt: string | null;
    comparisonStatus: string;
    comparisonReasons: string[];
  }>;
};

type DesignForm = {
  targetPopulation: string;
  sampleFrameName: string;
  samplingMethod: string;
  selectionMethod: string;
  weightingStatus: string;
  weightingMethod: string;
  weightingVariables: string;
  fieldworkMode: string;
  methodologyNotes: string;
};

const EMPTY_DESIGN: DesignForm = {
  targetPopulation: "",
  sampleFrameName: "",
  samplingMethod: "DIRECTIONAL_NON_PROBABILITY",
  selectionMethod: "",
  weightingStatus: "NOT_CONFIGURED",
  weightingMethod: "",
  weightingVariables: "",
  fieldworkMode: "AI_ASSISTED_OUTBOUND_VOICE",
  methodologyNotes: ""
};

function formFromDesign(design: ResearchQualityResponse["researchDesigns"][number] | undefined): DesignForm {
  if (!design) return EMPTY_DESIGN;
  return {
    targetPopulation: design.targetPopulation === "Not declared" ? "" : design.targetPopulation,
    sampleFrameName: design.sampleFrameName,
    samplingMethod: design.samplingMethod,
    selectionMethod: design.selectionMethod,
    weightingStatus: design.weightingStatus,
    weightingMethod: design.weightingMethod,
    weightingVariables: design.weightingVariables.join(", "),
    fieldworkMode: design.fieldworkMode,
    methodologyNotes: design.methodologyNotes
  };
}

const PREVIEW_SECTIONS = [
  ["Leadership overview", "Party, candidate, leadership and sentiment distributions"],
  ["Demographic pulse", "Age histogram, age bands and gender comparisons"],
  ["Geographic intelligence", "Constituency and Mandal heat tables"],
  ["Iteration movement", "Comparable research movement across survey waves"],
  ["Research quality", "Fieldwork coverage, completeness and interpretation limits"]
];

function ResearchDesignRegistry({ data, onSaved }: {
  data: ResearchQualityResponse;
  onSaved: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(data.researchDesigns[0]?.iterationId || "");
  const [form, setForm] = useState<DesignForm>(function () {
    return formFromDesign(data.researchDesigns[0]);
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = data.researchDesigns.find((item) => item.iterationId === selectedId)
    || data.researchDesigns[0];

  if (!selected) return null;

  function update(field: keyof DesignForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectDesign(iterationId: string) {
    setSelectedId(iterationId);
    setForm(formFromDesign(data.researchDesigns.find(
      (item) => item.iterationId === iterationId
    )));
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/enterprise-dashboard/research-designs/${selected.iterationId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          weightingVariables: form.weightingVariables
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        })
      });
      setMessage("Research design declared. Comparability has been recalculated.");
      await onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to save research design");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.designRegistry}>
    <div className={styles.designHead}>
      <div><span>RESEARCH DESIGN REGISTRY</span><h2>Declare the basis of each survey wave</h2><p>Movement remains suppressed until questionnaire identity, population, frame, sampling, weighting and fieldwork mode are comparable.</p></div>
      <label>Campaign and Iteration<select value={selected.iterationId} onChange={(event) => selectDesign(event.target.value)}>
        {data.researchDesigns.map((item) => <option key={item.iterationId} value={item.iterationId}>{item.campaignName} · Iteration {item.iterationNumber}</option>)}
      </select></label>
    </div>
    <div className={styles.comparabilityStatus} data-status={selected.comparisonStatus}>
      <strong>{selected.comparisonStatus.replaceAll("_", " ")}</strong>
      <span>{selected.comparisonReasons.length ? selected.comparisonReasons.join(" · ") : selected.comparisonStatus === "BASELINE" ? "Baseline wave" : "Declared design matches the previous Iteration"}</span>
    </div>
    <div className={styles.designGrid}>
      <label>Target population<input value={form.targetPopulation} onChange={(event) => update("targetPopulation", event.target.value)} placeholder="Eligible graduates in the constituency" /></label>
      <label>Sample frame<input value={form.sampleFrameName} onChange={(event) => update("sampleFrameName", event.target.value)} placeholder="Approved graduate-elector frame" /></label>
      <label>Sampling method<select value={form.samplingMethod} onChange={(event) => update("samplingMethod", event.target.value)}>
        <option value="DIRECTIONAL_NON_PROBABILITY">Directional non-probability</option>
        <option value="CENSUS">Census</option><option value="SIMPLE_RANDOM">Simple random</option>
        <option value="STRATIFIED_RANDOM">Stratified random</option><option value="CLUSTER">Cluster</option>
        <option value="SYSTEMATIC">Systematic</option><option value="QUOTA">Quota</option>
        <option value="PURPOSIVE">Purposive</option><option value="CONVENIENCE">Convenience</option>
      </select></label>
      <label>Selection method<input value={form.selectionMethod} onChange={(event) => update("selectionMethod", event.target.value)} placeholder="How respondents were selected" /></label>
      <label>Weighting status<select value={form.weightingStatus} onChange={(event) => update("weightingStatus", event.target.value)}>
        <option value="NOT_CONFIGURED">Not configured</option><option value="NOT_REQUIRED">Not required</option>
        <option value="PLANNED">Planned</option><option value="APPLIED">Applied</option>
      </select></label>
      <label>Weighting method<input value={form.weightingMethod} onChange={(event) => update("weightingMethod", event.target.value)} placeholder="Raking, post-stratification…" /></label>
      <label>Weighting variables<input value={form.weightingVariables} onChange={(event) => update("weightingVariables", event.target.value)} placeholder="age_band, gender, mandal" /></label>
      <label>Fieldwork mode<select value={form.fieldworkMode} onChange={(event) => update("fieldworkMode", event.target.value)}><option value="AI_ASSISTED_OUTBOUND_VOICE">AI-assisted outbound voice</option><option value="HUMAN_ASSISTED_PHONE">Human-assisted phone</option><option value="MIXED_MODE">Mixed mode</option></select></label>
      <label className={styles.notesField}>Methodology notes<textarea value={form.methodologyNotes} onChange={(event) => update("methodologyNotes", event.target.value)} placeholder="Frame limitations, quota controls and known sources of bias" /></label>
    </div>
    <div className={styles.designActions}>{message && <span>{message}</span>}<button type="button" onClick={function () { void save(); }} disabled={saving || !form.targetPopulation.trim()}>{saving ? "Saving…" : "Save research design"}</button></div>
  </section>;
}

export default function EnterpriseDashboardPage() {
  const { user } = useCurrentUser();
  const [dashboard, setDashboard] = useState<EmbedResponse | null>(null);
  const [quality, setQuality] = useState<ResearchQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qualityError, setQualityError] = useState<string | null>(null);

  const loadDashboard = useCallback(async function () {
    if (!user) return;
    setLoading(true);
    setError(null);
    setQualityError(null);
    const [dashboardResult, qualityResult] = await Promise.allSettled([
      apiFetch("/api/enterprise-dashboard/embed-url") as Promise<EmbedResponse>,
      apiFetch("/api/enterprise-dashboard/research-quality") as Promise<ResearchQualityResponse>
    ]);
    if (dashboardResult.status === "fulfilled") {
      setDashboard(dashboardResult.value);
    } else {
      setDashboard(null);
      setError(dashboardResult.reason instanceof Error
        ? dashboardResult.reason.message
        : "Unable to open Amazon Quick Sight");
    }
    if (qualityResult.status === "fulfilled") {
      setQuality(qualityResult.value);
    } else {
      setQuality(null);
      setQualityError(qualityResult.reason instanceof Error
        ? qualityResult.reason.message
        : "Unable to load the research quality gate");
    }
    setLoading(false);
  }, [user]);

  useEffect(function () {
    const timer = window.setTimeout(function () { void loadDashboard(); }, 0);
    return function () { window.clearTimeout(timer); };
  }, [loadDashboard]);

  return <AppShell><main className={styles.page}>
    <header className={styles.hero}>
      <div>
        <Link href="/"><ArrowLeft size={16} />Back to Dashboard</Link>
        <span>AMAZON QUICK · ENTERPRISE PREVIEW</span>
        <h1>Leadership research intelligence</h1>
        <p>Interactive, aggregate survey reporting across geography, constituency, Iteration, age, gender, party, candidate and leadership variables.</p>
      </div>
      <button type="button" onClick={function () { void loadDashboard(); }} disabled={loading}>
        <RefreshCw size={16} className={loading ? styles.spin : ""} />Refresh session
      </button>
    </header>

    <section className={styles.governance}>
      <ShieldCheck size={18} />
      <div><strong>Governed leadership view</strong><span>Aggregate output variables only. No names, phone numbers, EPIC IDs, transcripts or raw JSON enter the BI dataset.</span></div>
    </section>

    {quality && <section className={styles.qualityPanel}>
      <div className={styles.qualityHead}>
        <div><span>PSEPHOLOGY QUALITY GATE</span><h2>Evidence strength before interpretation</h2><p>Separates fieldwork and data quality from political findings. This is operational research confidence—not electoral probability.</p></div>
        <strong data-status={quality.portfolio.evidenceQualityStatus}>{quality.portfolio.evidenceQualityStatus}</strong>
      </div>
      <div className={styles.qualityMetrics}>
        <article><span>Respondent evidence</span><strong>{quality.portfolio.respondentBase}</strong><small>latest connected response per voter and Iteration</small></article>
        <article><span>Connection rate</span><strong>{quality.portfolio.connectionRatePct}%</strong><small>{quality.portfolio.connectedCalls} of {quality.portfolio.callAttempts} attempts connected</small></article>
        <article><span>Structured outputs</span><strong>{quality.portfolio.responseCoveragePct}%</strong><small>connected calls retaining analyzable variables</small></article>
        <article><span>Demographic completeness</span><strong>{quality.portfolio.demographicCompletenessPct}%</strong><small>gender, age band and Mandal fields present</small></article>
      </div>
      <div className={styles.methodStrip}>
        <div><span>Sampling</span><strong>{quality.methodology.samplingDesign}</strong></div>
        <div><span>Weighting</span><strong>{quality.methodology.weightingStatus}</strong></div>
        <div><span>Precision</span><strong>{quality.methodology.statisticalPrecision}</strong></div>
      </div>
      <div className={styles.interpretationGuard}>
        <ShieldCheck size={17} />
        <p><strong>Permitted:</strong> {quality.methodology.permittedUse}. <strong>Do not use for:</strong> {quality.methodology.prohibitedUse}. {quality.methodology.comparisonRule}.</p>
      </div>
      {quality.movement.length > 0 && <div className={styles.movementPreview}>
        <div><span>ITERATION MOVEMENT</span><strong>Comparable wave signals</strong></div>
        <div className={styles.movementGrid}>{quality.movement.slice(-6).map((item) => <article key={item.iterationId}>
          <span>{item.campaignName}</span>
          <strong>Iteration {item.iterationNumber}</strong>
          <small>n={item.respondentBase} · Positive sentiment {item.positiveSentimentPct}%</small>
          <em>{item.comparisonBasis === "BASELINE" ? "Baseline" : item.comparisonBasis !== "COMPARABLE" ? `Movement suppressed · ${item.comparisonReasons.join(" · ")}` : `${item.positiveSentimentChangePct !== null && item.positiveSentimentChangePct >= 0 ? "+" : ""}${item.positiveSentimentChangePct ?? 0} pp vs previous`}</em>
        </article>)}</div>
      </div>}
    </section>}

    {quality && <ResearchDesignRegistry data={quality} onSaved={loadDashboard} />}

    {qualityError && <section className={styles.qualityUnavailable}><AlertTriangle size={16} /><span>Research quality gate unavailable: {qualityError}</span></section>}

    {user && <TelanganaBoundaryMap />}

    {loading && <section className={styles.loading}><LoaderCircle size={24} className={styles.spin} />Creating a secure Amazon Quick Sight session…</section>}

    {!loading && error && <>
      <FeedbackMessage tone="error" message={error} />
      <section className={styles.setup}>
        <div className={styles.setupHead}><AlertTriangle size={22} /><div><span>ENTERPRISE PREVIEW SETUP</span><h2>The dashboard design is ready; AWS publishing is still required</h2><p>The platform will embed the published Amazon Quick Sight dashboard here after its dashboard ID, Reader ARN and allowed domain are configured.</p></div></div>
        <div className={styles.previewGrid}>{PREVIEW_SECTIONS.map(([title, detail]) => <article key={title}><CheckCircle2 size={17} /><div><strong>{title}</strong><span>{detail}</span></div></article>)}</div>
        <Link href="/">View the native program dashboard preview <BarChart3 size={16} /></Link>
      </section>
    </>}

    {!loading && dashboard?.embedUrl && <section className={styles.framePanel}>
      <div><span>LIVE AMAZON QUICK SIGHT</span><strong>{dashboard.mode === "ONE_CLICK" ? "Authenticated one-click embed" : "Short-lived registered-user session"}</strong><small>Filters and exports remain inside the governed BI experience.</small></div>
      <iframe
        title="Psephology enterprise leadership dashboard"
        src={dashboard.embedUrl}
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </section>}
  </main></AppShell>;
}
