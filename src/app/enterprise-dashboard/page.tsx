"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, BarChart3, ChevronDown, Info, LoaderCircle,
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

function MeasurementNote({ label = "How it’s measured", children }: {
  label?: string;
  children: ReactNode;
}) {
  return <details className={styles.measurementNote}>
    <summary><Info size={14} aria-hidden="true" />{label}</summary>
    <div className={styles.noteContent}>{children}</div>
  </details>;
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
  ["Leadership overview", "Recorded party salience, candidate impression, issue leadership and priorities"],
  ["Demographic pulse", "Age bands 18–29, 30–39, 40–49 and 50+; gender comparisons"],
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
        <span>LEADERSHIP DASHBOARD</span>
        <h1>Survey outcomes</h1>
        <p>Explore the results by campaign, Iteration and voter segment.</p>
      </div>
      <button type="button" onClick={function () { void loadDashboard(); }} disabled={loading || registryBusy}>
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

    {qualityError && <section className={styles.qualityUnavailable} role="alert"><AlertTriangle size={16} /><span>Survey quality unavailable: {qualityError}</span></section>}

    {loading && <section className={styles.loading} role="status"><LoaderCircle size={24} className={styles.spin} />Loading survey reports…</section>}

    {!loading && error && <>
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

    {!loading && dashboard?.embedUrl && <section className={styles.framePanel} aria-label="Survey reports">
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
          <p>Use the report tabs and filters inside Amazon Quick. The fieldwork summary and supporting comparisons below have their own portfolio scope and do not follow these filters.</p>
        </MeasurementNote>
      </div>
      <iframe
        title="Psephology enterprise leadership dashboard"
        src={dashboard.embedUrl}
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </section>}

    {quality && <section className={styles.qualityPanel}>
      <div className={styles.qualityHead}>
        <div><h2>Fieldwork summary</h2><p>Whole portfolio · all Runs · independent of report filters</p></div>
        <strong data-status={quality.portfolio.evidenceQualityStatus}>{quality.portfolio.evidenceQualityStatus === "LIMITED" ? "Limited evidence" : quality.portfolio.evidenceQualityStatus === "MIXED" ? "Mixed coverage" : "Directional evidence"}</strong>
      </div>
      <div className={styles.qualityMetrics}>
        <article><span>Response records</span><strong>{quality.portfolio.respondentBase}</strong><small>Person–Iteration records</small><MeasurementNote><p>Latest connected response per voter and Iteration. One person participating in multiple Iterations can count more than once; this is not a unique-person count for the portfolio.</p></MeasurementNote></article>
        <article><span>Calls connected</span><strong>{quality.portfolio.connectionRatePct}%</strong><small>{quality.portfolio.connectedCalls} / {quality.portfolio.callAttempts} attempts</small><MeasurementNote><p>Connected calls divided by all call attempts, including retries. This is an operational connection rate, not a standardized survey response rate.</p></MeasurementNote></article>
        <article><span>Answers captured</span><strong>{quality.portfolio.responseCoveragePct}%</strong><small>{quality.portfolio.responsesCaptured} / {quality.portfolio.connectedCalls} connected calls</small><MeasurementNote><p>Connected calls retaining structured output variables divided by all connected calls. A retained response set does not mean every question was answered or validated.</p></MeasurementNote></article>
        <article><span>Profile completeness</span><strong>{quality.portfolio.demographicCompletenessPct}%</strong><small>Age · gender · Mandal</small><MeasurementNote><p>Recorded gender, age band and Mandal fields divided by {quality.portfolio.demographicFieldBase} available field slots (three per response record). This measures profile completeness, not population representativeness.</p></MeasurementNote></article>
      </div>

      <MeasurementNote label="Quality checks and interpretation limits">
        <p>{quality.scope?.label || "Whole portfolio; independent of embedded Amazon Quick filters"}. {quality.scope?.runScope || "All Runs within each Iteration"}. Quality status describes fieldwork and completeness, not model validation, statistical confidence or electoral probability.</p>
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
      </MeasurementNote>
    </section>}

    {quality && quality.movement.length > 0 && <SupportingPanel title="Iteration comparisons" status="Full Iterations · not filtered by age, gender or Mandal">
      <div className={styles.movementPreview}>
        <p>{quality.scope?.movementScope || "Full Iterations, not filtered by age, gender or Mandal"}. Human review pending.</p>
        <div className={styles.movementGrid}>{quality.movement.slice(-6).map((item) => <article key={item.iterationId}>
          <span>{item.campaignName}</span>
          <strong>Iteration {item.iterationNumber}</strong>
          <small>Response records: {item.respondentBase}</small>
          <small>Incumbent positive: {item.positiveSentimentPct === null ? "Withheld" : `${item.positiveSentimentPct}%`} · n={item.sentimentAnswerBase}</small>
          <small>Candidate positive: {item.candidatePositivePct === null ? "Withheld" : `${item.candidatePositivePct}%`} · n={item.candidateAnswerBase}</small>
          <em>{item.comparisonBasis === "BASELINE" ? "Baseline — no earlier comparison" : item.comparisonBasis === "SUPPRESSED" ? "Withheld — too few response records" : item.comparisonBasis !== "COMPARABLE" ? "Not comparable — change withheld" : item.positiveSentimentChangePct === null ? "Change unavailable" : `${item.positiveSentimentChangePct >= 0 ? "+" : ""}${item.positiveSentimentChangePct} pp incumbent positive vs previous`}</em>
          <MeasurementNote label="Measures and comparison checks">
            <small>{item.sentimentConstruct}</small>
            <small>Positive incumbent assessment {item.positiveSentimentPct === null ? "withheld" : `${item.positiveSentimentPct}%`} · answer base n={item.sentimentAnswerBase}</small>
            <small>Sentiment: {item.sentimentMissingCount} missing · {item.sentimentUncodedCount} uncoded · {item.sentimentCantSayCount} can’t say · {item.sentimentRefusedCount} declined</small>
            <small>{item.candidateConstruct}</small>
            <small>Positive candidate impression {item.candidatePositivePct === null ? "withheld" : `${item.candidatePositivePct}%`} · answer base n={item.candidateAnswerBase}</small>
            <small>Candidate: {item.candidateMissingCount} missing · {item.candidateUncodedCount} uncoded · {item.candidateCantSayCount} can’t say · {item.candidateRefusedCount} declined</small>
            <small>{item.percentageBasis}</small>
            <em>{item.comparisonBasis === "BASELINE" ? "Baseline" : item.comparisonBasis === "SUPPRESSED" ? "Movement withheld: at least five response records are required in each adjacent wave" : item.comparisonBasis !== "COMPARABLE" ? `Movement suppressed · ${item.comparisonReasons.join(" · ")}` : item.positiveSentimentChangePct === null ? "Sentiment movement unavailable: at least five answers are required in each adjacent wave" : `${item.positiveSentimentChangePct >= 0 ? "+" : ""}${item.positiveSentimentChangePct} pp vs previous · answer bases ${item.previousSentimentAnswerBase} → ${item.sentimentAnswerBase}`}</em>
          </MeasurementNote>
        </article>)}</div>
      </div>
    </SupportingPanel>}

    {quality && user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code) && <SupportingPanel title="Research setup" status={`${quality.researchDesigns.filter((item) => item.declarationComplete).length}/${quality.researchDesigns.length} methodology declarations recorded`}>
      <ResearchDesignRegistry data={quality} onSaved={loadDashboard} onBusy={setRegistryBusy} />
    </SupportingPanel>}

    {user && <SupportingPanel title="Boundary explorer" status="Geographic reference · not a survey heatmap"><TelanganaBoundaryMap /></SupportingPanel>}
  </main></AppShell>;
}
