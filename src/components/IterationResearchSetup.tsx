"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./iterationResearchSetup.module.css";

type ResearchQualityResponse = {
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

export function ResearchDesignEditor({ data, onSaved }: {
  data: ResearchQualityResponse;
  onSaved: () => Promise<void>;
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
    try {
      const result = await apiFetch(`/api/enterprise-dashboard/research-designs/${selected!.iterationId}/history`) as { revisions: DesignHistory[] };
      setHistory(result.revisions);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Unable to load declaration history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function save() {
    if (!ready || saving || historyLoading) return;
    setSaving(true);
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
      if (saved.iterationId !== selected!.iterationId || saved.campaignId !== selected!.campaignId) {
        throw new Error("Saved declaration response does not match this Iteration and Campaign.");
      }
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
    }
  }

  return <section className={styles.designRegistry}>
    <div className={styles.designHead}>
      <div><span>RESEARCH DESIGN REGISTRY · {completeCount}/{data.researchDesigns.length} DECLARED</span><h2>Record actual methodology, not assumptions</h2><p>Admin and Super Admin declarations require population, contact frame, selection, cohort and weighting. Different stage questionnaires are separate studies until unchanged measures can be verified.</p></div>
      <p className={styles.scopeLabel}>{selected.campaignName} · Iteration {selected.iterationNumber} · {selected.iterationName}</p>
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


/** One editor, in the operational Iteration workspace. Loading and every mutation retain server authorization. */
export default function IterationResearchSetup({ iterationId, campaignId }: {
  iterationId: string;
  campaignId?: string | null;
}) {
  const { user } = useCurrentUser();
  const allowed = Boolean(user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code));
  const scopeKey = JSON.stringify([user?.id, iterationId, campaignId || null]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<{ scopeKey: string; data: ResearchQualityResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ scopeKey: string; message: string } | null>(null);
  const generation = useRef(0);
  const current = loaded?.scopeKey === scopeKey ? loaded.data : null;
  const error = failure?.scopeKey === scopeKey ? failure.message : null;

  const load = useCallback(async () => {
    if (!allowed || !iterationId) return;
    const request = ++generation.current;
    setLoading(true);
    setFailure(null);
    try {
      const result = await apiFetch("/api/enterprise-dashboard/research-quality") as ResearchQualityResponse;
      const matches = result.researchDesigns.filter((item) => item.iterationId === iterationId
        && (!campaignId || item.campaignId === campaignId));
      if (matches.length !== 1) throw new Error("This Iteration has no unique authorized methodology record in this Campaign.");
      if (request !== generation.current) return;
      setLoaded({ scopeKey, data: { researchDesigns: matches } });
    } catch (reason) {
      if (request === generation.current) {
        setLoaded(null);
        setFailure({ scopeKey, message: reason instanceof Error ? reason.message : "Unable to load Iteration research setup." });
      }
      throw reason;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [allowed, campaignId, iterationId, scopeKey]);

  useEffect(() => {
    if (!expanded || !allowed) return;
    const timer = window.setTimeout(() => { void load().catch(() => {}); }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [allowed, expanded, load]);

  if (!allowed) return null;

  return <details className={styles.setupPanel} open={expanded}
    onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span>Iteration research setup</span><small>Actual methodology · Admin only</small></summary>
    <div className={styles.setupBody}>
      {loading && <p role="status">Loading this Iteration&apos;s authorized declaration…</p>}
      {current && <button type="button" disabled={loading} onClick={() => { void load().catch(() => {}); }}>Check latest declaration revision</button>}
      {error && <div role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => { void load().catch(() => {}); }}>Retry research setup</button></div>}
      {current && <ResearchDesignEditor key={scopeKey} data={current} onSaved={load} />}
    </div>
  </details>;
}
