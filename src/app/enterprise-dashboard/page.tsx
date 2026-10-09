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
    respondentBase: number;
    averageDirectPartyStrength: number | null;
    partyStrengthChange: number | null;
    positiveSentimentPct: number | null;
    positiveSentimentChangePct: number | null;
    candidatePositivePct: number | null;
    candidatePositiveChangePct: number | null;
    sentimentAnswerBase: number;
    sentimentMissingCount: number;
    sentimentUncodedCount: number;
    sentimentCantSayCount: number;
    sentimentRefusedCount: number;
    candidateAnswerBase: number;
    candidateMissingCount: number;
    candidateUncodedCount: number;
    candidateCantSayCount: number;
    candidateRefusedCount: number;
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
  cohortDesign: string;
  changeReason: string;
};

const EMPTY_DESIGN: DesignForm = {
  targetPopulation: "",
  sampleFrameName: "",
  samplingMethod: "",
  selectionMethod: "",
  weightingStatus: "NOT_CONFIGURED",
  weightingMethod: "",
  weightingVariables: "",
  fieldworkMode: "",
  methodologyNotes: "",
  cohortDesign: "NOT_DECLARED",
  changeReason: ""
};

function formFromDesign(design: ResearchQualityResponse["researchDesigns"][number] | undefined): DesignForm {
  if (!design) return EMPTY_DESIGN;
  return {
    targetPopulation: design.targetPopulation === "Not declared" ? "" : design.targetPopulation,
    sampleFrameName: design.sampleFrameName,
    samplingMethod: design.declaredAt ? design.samplingMethod : "",
    selectionMethod: design.declaredAt ? design.selectionMethod : "",
    weightingStatus: design.weightingStatus,
    weightingMethod: design.weightingMethod,
    weightingVariables: design.weightingVariables.join(", "),
    fieldworkMode: design.declaredAt ? design.fieldworkMode : "",
    methodologyNotes: design.declaredAt ? design.methodologyNotes : "",
    cohortDesign: design.cohortDesign,
    changeReason: ""
  };
}

const PREVIEW_SECTIONS = [
  ["Leadership overview", "Party, candidate, leadership and sentiment distributions"],
  ["Demographic pulse", "Age histogram, age bands and gender comparisons"],
  ["Geographic intelligence", "Constituency and Mandal heat tables"],
  ["Iteration movement", "Comparable research movement across survey waves"],
  ["Research quality", "Fieldwork coverage, completeness and interpretation limits"]
];

type DesignHistory = {
  revision: number;
  actorUserId: string;
  changeReason: string;
  declaredAt: string;
  design: {
    target_population: string;
    sample_frame_name: string;
    selection_method: string;
    sampling_method: string;
    cohort_design: string;
    weighting_status: string;
    weighting_method: string | null;
    weighting_variables: string[];
    fieldwork_mode: string;
    methodology_notes: string | null;
  };
};

function ResearchDesignRegistry({ data, onSaved, onBusy }: {
  data: ResearchQualityResponse;
  onSaved: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState(data.researchDesigns[0]?.iterationId || "");
  const [form, setForm] = useState<DesignForm>(() => formFromDesign(data.researchDesigns[0]));
  const [editingRevision, setEditingRevision] = useState(data.researchDesigns[0]?.revision || 0);
  const [attested, setAttested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<DesignHistory[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const selected = data.researchDesigns.find((item) => item.iterationId === selectedId);

  if (!selected) return null;
  const completeCount = data.researchDesigns.filter((item) => item.declarationComplete).length;
  const stale = editingRevision !== selected.revision;
  const ready = attested && form.targetPopulation.trim() && form.sampleFrameName.trim()
    && form.selectionMethod.trim() && form.samplingMethod && form.fieldworkMode
    && form.cohortDesign !== "NOT_DECLARED" && form.changeReason.trim()
    && !stale && ["NOT_REQUIRED", "PLANNED"].includes(form.weightingStatus)
    && (form.weightingStatus !== "PLANNED" || (form.weightingMethod.trim() && form.weightingVariables.trim()));

  function update(field: keyof DesignForm, value: string) {
    setForm((current) => field === "weightingStatus" && value !== "PLANNED"
      ? { ...current, [field]: value, weightingMethod: "", weightingVariables: "" }
      : { ...current, [field]: value });
    setAttested(false);
  }

  function selectDesign(iterationId: string) {
    const design = data.researchDesigns.find((item) => item.iterationId === iterationId);
    setSelectedId(iterationId);
    setForm(formFromDesign(design));
    setEditingRevision(design?.revision || 0);
    setAttested(false);
    setMessage(null);
    setHistory(null);
    setHistoryError(null);
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    onBusy(true);
    try {
      const result = await apiFetch(`/api/enterprise-dashboard/research-designs/${selected!.iterationId}/history`) as { revisions: DesignHistory[] };
      setHistory(result.revisions);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Unable to load declaration history");
    } finally {
      setHistoryLoading(false);
      onBusy(false);
    }
  }

  async function save() {
    if (!ready || saving || historyLoading) return;
    setSaving(true);
    onBusy(true);
    setMessage(null);
    let persisted = false;
    try {
      const saved = await apiFetch(`/api/enterprise-dashboard/research-designs/${selected!.iterationId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...form, attested, expectedRevision: editingRevision,
          weightingVariables: form.weightingVariables.split(",").map((value) => value.trim()).filter(Boolean)
        })
      }) as ResearchQualityResponse["researchDesigns"][number];
      persisted = true;
      setEditingRevision(saved.revision);
      setAttested(false);
      setForm(formFromDesign(saved));
      setHistory(null);
      setMessage(`Saved revision ${saved.revision}. ${saved.declarationComplete ? "Actual methodology recorded." : "Methodology still needs review."} Comparisons also require unchanged frozen questions; results remain unweighted.`);
      await onSaved();
    } catch (reason) {
      setMessage(persisted ? "Declaration saved. Refresh the page to reload comparison status."
        : reason instanceof Error ? reason.message : "Unable to save research design");
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }

  return <section className={styles.designRegistry}>
    <div className={styles.designHead}>
      <div><span>RESEARCH DESIGN REGISTRY · {completeCount}/{data.researchDesigns.length} DECLARED</span><h2>Record actual methodology, not assumptions</h2><p>Admin and Super Admin declarations require population, contact frame, selection, cohort and weighting. Different stage questionnaires are separate studies until unchanged measures can be verified.</p></div>
      <label>Campaign and Iteration<select value={selected.iterationId} disabled={saving || historyLoading} onChange={(event) => selectDesign(event.target.value)}>
        {data.researchDesigns.map((item) => <option key={item.iterationId} value={item.iterationId}>{item.campaignName} · Iteration {item.iterationNumber}{item.declarationComplete ? " · Declared" : " · Needs declaration"}</option>)}
      </select></label>
    </div>
    <div className={styles.comparabilityStatus} data-status={selected.comparisonStatus}>
      <strong>{selected.comparisonStatus.replaceAll("_", " ")}</strong>
      <span>{selected.comparisonReasons.length ? selected.comparisonReasons.join(" · ") : selected.comparisonStatus === "BASELINE" ? "Baseline wave — not a trend" : "Declared methods and frozen instrument match the previous Iteration"}</span>
    </div>
    <div className={styles.methodologyNotice}>
      <p><strong>Instrument provenance:</strong> {selected.questionContentRecorded ? `${selected.frozenQuestionCount} approved questions frozen at selection.` : "Historical question wording was not retained. A declaration cannot reconstruct it or unlock trend comparisons."}</p>
      <p><strong>Coverage:</strong> Attempting every available contact is not a completed electorate census. Connection rate counts call attempts, including retries; it is not a standardized survey response rate. Record frame exclusions and non-response limitations below.</p>
      <p><strong>Reporting:</strong> All current percentages are unweighted. Five answers is a display threshold, not statistical representativeness.</p>
      {selected.declaredAt && <p>Latest declaration: revision {selected.revision} · {new Date(selected.declaredAt).toLocaleString()} · actor {selected.declaredByUserId || "not retained"}</p>}
      {stale && <p role="alert">This form is based on revision {editingRevision}; revision {selected.revision} is now saved. Reload the selected declaration below before editing.</p>}
    </div>
    <fieldset className={styles.designFields} disabled={saving}>
      <legend className={styles.srOnly}>Actual survey methodology</legend>
      <div className={styles.designGrid}>
        <label>Target population *<input maxLength={500} value={form.targetPopulation} onChange={(event) => update("targetPopulation", event.target.value)} placeholder="Who the findings are intended to describe" /></label>
        <label>Contact frame and version *<input maxLength={500} value={form.sampleFrameName} onChange={(event) => update("sampleFrameName", event.target.value)} placeholder="Actual list or roll extract used, including its date" /></label>
        <label>Sampling / invitation method *<select value={form.samplingMethod} onChange={(event) => update("samplingMethod", event.target.value)}>
          <option value="" disabled>Select the actual method</option>
          <option value="DIRECTIONAL_NON_PROBABILITY">Directional non-probability</option>
          <option value="CENSUS">Attempt all eligible contacts in the declared frame</option><option value="SIMPLE_RANDOM">Simple random</option>
          <option value="STRATIFIED_RANDOM">Stratified random</option><option value="CLUSTER">Cluster</option>
          <option value="SYSTEMATIC">Systematic</option><option value="QUOTA">Quota</option>
          <option value="PURPOSIVE">Purposive</option><option value="CONVENIENCE">Convenience</option>
        </select></label>
        <label>Actual selection and exclusions *<input maxLength={500} value={form.selectionMethod} onChange={(event) => update("selectionMethod", event.target.value)} placeholder="How contacts were selected, excluded and retried" /></label>
        <label>Participant cohort across waves *<select value={form.cohortDesign} onChange={(event) => update("cohortDesign", event.target.value)}>
          <option value="NOT_DECLARED" disabled>Select the actual cohort design</option>
          <option value="SAME_PARTICIPANTS">Same participants invited again</option>
          <option value="INDEPENDENT_SAMPLES">Independently selected participants</option>
          <option value="PARTIAL_OVERLAP">Partially overlapping participant lists</option>
        </select></label>
        <label>Weighting declaration *<select value={form.weightingStatus} onChange={(event) => update("weightingStatus", event.target.value)}>
          <option value="NOT_CONFIGURED" disabled>Confirm actual weighting status</option>
          <option value="NOT_REQUIRED">No weights used</option><option value="PLANNED">Planned, not applied to current reports</option>
          {form.weightingStatus === "APPLIED" && <option value="APPLIED" disabled>Previously claimed applied — review required</option>}
        </select></label>
        <label>Planned weighting method<input maxLength={500} disabled={form.weightingStatus !== "PLANNED"} value={form.weightingMethod} onChange={(event) => update("weightingMethod", event.target.value)} placeholder="Document the actual plan, if any" /></label>
        <label>Planned weighting variables<input disabled={form.weightingStatus !== "PLANNED"} value={form.weightingVariables} onChange={(event) => update("weightingVariables", event.target.value)} placeholder="age_band, gender, mandal" /></label>
        <label>Fieldwork mode *<select value={form.fieldworkMode} onChange={(event) => update("fieldworkMode", event.target.value)}>
          <option value="" disabled>Select the actual mode</option><option value="AI_ASSISTED_OUTBOUND_VOICE">AI-assisted outbound voice</option><option value="HUMAN_ASSISTED_PHONE">Human-assisted phone</option><option value="MIXED_MODE">Mixed mode</option>
        </select></label>
        <label className={styles.notesField}>Limitations and evidence<textarea maxLength={2000} value={form.methodologyNotes} onChange={(event) => update("methodologyNotes", event.target.value)} placeholder="Coverage gaps, non-response, recruitment bias, fieldwork evidence" /></label>
        <label className={styles.notesField}>Reason / source for this declaration *<textarea maxLength={1000} value={form.changeReason} onChange={(event) => update("changeReason", event.target.value)} placeholder="Identify the fieldwork record or confirmation supporting these actual methods" /></label>
      </div>
      <label className={styles.attestation}><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />I confirm these entries describe the actual fieldwork and verified records, not intended future methods. I understand the results remain unweighted.</label>
    </fieldset>
    <div className={styles.designActions}><span role="status">{message}</span><button type="button" onClick={() => { void save(); }} disabled={saving || historyLoading || !ready}>{saving ? "Saving…" : "Save audited declaration"}</button></div>
    <div className={styles.declarationHistory}>
      <button type="button" disabled={saving || historyLoading} onClick={() => selectDesign(selected.iterationId)}>Reload selected declaration (discard unsaved edits)</button>{" "}
      <button type="button" onClick={() => { void loadHistory(); }} disabled={saving || historyLoading}>{historyLoading ? "Loading…" : "View declaration history"}</button>
      {historyError && <p role="alert">{historyError}</p>}
      {history && !history.length && <p>No audited declarations yet. Historical defaults are not treated as verified methods.</p>}
      {history?.map((entry) => <details key={entry.revision}>
        <summary>Revision {entry.revision} · {new Date(entry.declaredAt).toLocaleString()} · {entry.changeReason}</summary>
        <p>Recorded by {entry.actorUserId}</p>
        <dl>
          <dt>Population</dt><dd>{entry.design.target_population}</dd>
          <dt>Frame</dt><dd>{entry.design.sample_frame_name}</dd>
          <dt>Sampling / selection</dt><dd>{entry.design.sampling_method} · {entry.design.selection_method}</dd>
          <dt>Cohort / mode</dt><dd>{entry.design.cohort_design} · {entry.design.fieldwork_mode}</dd>
          <dt>Weighting declaration</dt><dd>{entry.design.weighting_status} · {entry.design.weighting_method || "No method applied"} · {entry.design.weighting_variables.join(", ") || "No weighting variables"}</dd>
          <dt>Limitations</dt><dd>{entry.design.methodology_notes || "None recorded"}</dd>
        </dl>
      </details>)}
      {history?.length === 50 && <p>Showing the latest 50 revisions. Earlier revisions remain retained.</p>}
    </div>
  </section>;
}

export default function EnterpriseDashboardPage() {
  const { user } = useCurrentUser();
  const [dashboard, setDashboard] = useState<EmbedResponse | null>(null);
  const [quality, setQuality] = useState<ResearchQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [registryBusy, setRegistryBusy] = useState(false);

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
      <button type="button" onClick={function () { void loadDashboard(); }} disabled={loading || registryBusy}>
        <RefreshCw size={16} className={loading ? styles.spin : ""} />Refresh session
      </button>
    </header>

    <section className={styles.governance}>
      <ShieldCheck size={18} />
      <div><strong>Governed leadership view · human review pending</strong><span>Aggregate output variables only. No names, phone numbers, EPIC IDs, transcripts or raw JSON enter the BI dataset. Sentiment uses explicit labels, not a validated NLP model. Existing Amazon Quick assets require a separate dataset refresh and label review before presentation.</span></div>
    </section>

    {quality && <section className={styles.qualityPanel}>
      <div className={styles.qualityHead}>
        <div><span>PSEPHOLOGY QUALITY GATE</span><h2>Evidence strength before interpretation</h2><p>Separates fieldwork and data quality from findings. Operational coverage is not model validation, statistical confidence or electoral probability.</p><p>{quality.scope?.label || "Whole portfolio; independent of embedded Amazon Quick filters"}. {quality.scope?.runScope || "All Runs within each Iteration"}.</p></div>
        <strong data-status={quality.portfolio.evidenceQualityStatus}>{quality.portfolio.evidenceQualityStatus}</strong>
      </div>
      <div className={styles.qualityMetrics}>
        <article><span>Respondent evidence</span><strong>{quality.portfolio.respondentBase}</strong><small>latest connected response per voter and Iteration</small></article>
        <article><span>Connection rate</span><strong>{quality.portfolio.connectionRatePct}%</strong><small>{quality.portfolio.connectedCalls} of {quality.portfolio.callAttempts} attempts connected</small></article>
        <article><span>Structured outputs</span><strong>{quality.portfolio.responseCoveragePct}%</strong><small>{quality.portfolio.responsesCaptured} of {quality.portfolio.connectedCalls} connected calls retaining analyzable variables</small></article>
        <article><span>Demographic completeness</span><strong>{quality.portfolio.demographicCompletenessPct}%</strong><small>base: {quality.portfolio.demographicFieldBase} gender, age band and Mandal field slots</small></article>
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
      <div className={styles.interpretationGuard} role="note">
        <AlertTriangle size={17} />
        <p><strong>Human review pending.</strong> {quality.sentimentValidation.message} Rules: {quality.sentimentValidation.normalizationVersion} · <span title={quality.sentimentValidation.ruleHash}>hash {quality.sentimentValidation.ruleHash.slice(0, 12)}</span>.<br />{quality.methodology.sentimentConstruct}. {quality.methodology.candidateConstruct}. {quality.methodology.sentimentCoding}.<br />{quality.methodology.assetPublication}.</p>
      </div>
      {quality.movement.length > 0 && <div className={styles.movementPreview}>
        <p>{quality.scope?.movementScope || "Full Iterations, not filtered by age, gender or Mandal"}. Use the native Dashboard or Analysis filters for segment-specific comparisons.</p>
        <div><span>DESCRIPTIVE ITERATION MOVEMENT</span><strong>Fixed-construct wave signals · human review pending</strong></div>
        <div className={styles.movementGrid}>{quality.movement.slice(-6).map((item) => <article key={item.iterationId}>
          <span>{item.campaignName}</span>
          <strong>Iteration {item.iterationNumber}</strong>
          <small>Respondent evidence n={item.respondentBase}</small>
          <small>{item.sentimentConstruct}</small>
          <small>Positive incumbent assessment {item.positiveSentimentPct === null ? "withheld" : `${item.positiveSentimentPct}%`} · answer base n={item.sentimentAnswerBase}</small>
          <small>Sentiment: {item.sentimentMissingCount} missing · {item.sentimentUncodedCount} uncoded · {item.sentimentCantSayCount} can’t say · {item.sentimentRefusedCount} declined</small>
          <small>{item.candidateConstruct}</small>
          <small>Positive candidate impression {item.candidatePositivePct === null ? "withheld" : `${item.candidatePositivePct}%`} · answer base n={item.candidateAnswerBase}</small>
          <small>Candidate: {item.candidateMissingCount} missing · {item.candidateUncodedCount} uncoded · {item.candidateCantSayCount} can’t say · {item.candidateRefusedCount} declined</small>
          <small>{item.percentageBasis}</small>
          <em>{item.comparisonBasis === "BASELINE" ? "Baseline" : item.comparisonBasis !== "COMPARABLE" ? `Movement suppressed · ${item.comparisonReasons.join(" · ")}` : item.positiveSentimentChangePct === null ? "Sentiment movement unavailable: at least five answers are required in each adjacent wave" : `${item.positiveSentimentChangePct >= 0 ? "+" : ""}${item.positiveSentimentChangePct} pp vs previous · answer bases ${item.previousSentimentAnswerBase} → ${item.sentimentAnswerBase}`}</em>
        </article>)}</div>
      </div>}
    </section>}

    {quality && <ResearchDesignRegistry data={quality} onSaved={loadDashboard} onBusy={setRegistryBusy} />}

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
