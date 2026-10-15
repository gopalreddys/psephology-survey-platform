"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { buildSarvamReviewPack, REPORTING_PRESETS } from "@/lib/reporting-presets";
import styles from "./questionnaire-reporting-contracts.module.css";

const reportOptions = [
  ["party_salience", "Unaided party mentions"],
  ["issue_leadership", "Party / group issue responsiveness"],
  ["incumbent_assessment", "Incumbent assessment"],
  ["candidate_impression", "Candidate impression"],
  ["candidate_fit", "Candidate criterion fit"],
  ["issue_priority", "Issue priorities"],
  ["development_priority", "Development priorities"],
  ["expected_change", "Expected changes"],
  ["scheme_experience", "Scheme / service experience"],
  ["leader_assessment", "Named-leader assessment"]
] as const;

type ReportKey = typeof reportOptions[number][0];
type TargetType = "NONE" | "PARTY" | "CANDIDATE" | "LEADER" | "SCHEME";
type ValueType = "CATEGORICAL" | "TEXT" | "NUMERIC";
type ReportingContract = {
  reportKey: ReportKey;
  outputVariables: string[];
  valueType: ValueType;
  allowedValues: string[];
  target: { type: TargetType; id: string; name: string };
  missingPolicy: "EXPLICIT_STATES";
};
type CoverageQuestion = {
  id: string;
  questionCode: string | null;
  order: number;
  text: string;
  contract: ReportingContract | null;
  contractValid: boolean;
  contractError: string | null;
  expectedContractFingerprint: string;
};
type ReportingCoverage = {
  questionnaire: { id: string; code: string; name: string; version: number; status: string };
  locked: boolean;
  lockReason: string | null;
  usedByIterations: number;
  metadataWritable: boolean;
  questions: CoverageQuestion[];
};
type ContractDraft = {
  reportKey: ReportKey;
  outputVariables: string;
  valueType: ValueType;
  allowedValues: string;
  targetType: TargetType;
  targetId: string;
  targetName: string;
};

function targetTypes(reportKey: ReportKey): TargetType[] {
  if (reportKey === "candidate_impression" || reportKey === "candidate_fit") return ["CANDIDATE"];
  if (reportKey === "leader_assessment") return ["LEADER"];
  if (reportKey === "scheme_experience") return ["SCHEME"];
  if (reportKey === "party_salience" || reportKey === "issue_leadership") return ["NONE", "PARTY"];
  return ["NONE", "PARTY", "LEADER"];
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contractFromDraft(draft: ContractDraft): ReportingContract {
  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const outputVariables = lines(draft.outputVariables);
  const allowedValues = draft.valueType === "CATEGORICAL" ? lines(draft.allowedValues) : [];
  if (!reportOptions.some(([key]) => key === draft.reportKey)) throw new Error("Select a supported report.");
  if (!["CATEGORICAL", "TEXT", "NUMERIC"].includes(draft.valueType)) throw new Error("Select a supported output type.");
  if (outputVariables.length < 1 || outputVariables.length > 10 || new Set(outputVariables).size !== outputVariables.length
      || outputVariables.some((key) => key.length > 80 || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key))) {
    throw new Error("Enter 1–10 unique output keys in snake_case, one per line (maximum 80 characters each).");
  }
  if (draft.valueType === "CATEGORICAL") {
    const normalized = allowedValues.map((value) => value.toUpperCase().replace(/[\s-]+/g, "_").replace(/[’']/g, ""));
    if (allowedValues.length < 2 || allowedValues.length > 30 || new Set(allowedValues.map((value) => value.toLocaleLowerCase("en-US"))).size !== allowedValues.length
        || allowedValues.some((value) => value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))
        || normalized.some((value) => ["NOT_ANSWERED", "CANT_SAY", "REFUSED"].includes(value))) {
      throw new Error("Enter 2–30 unique substantive categories (maximum 120 characters each). Do not include NOT_ANSWERED, CANT_SAY or REFUSED; missing states are handled separately.");
    }
  }
  if (!targetTypes(draft.reportKey).includes(draft.targetType)) throw new Error("Select the required target type for this report.");
  const targetId = draft.targetId.trim();
  const targetName = draft.targetName.trim();
  if (draft.targetType !== "NONE" && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(targetId) || !targetName || targetName.length > 160 || /[\u0000-\u001f\u007f]/.test(targetName))) {
    throw new Error("Named targets need a stable ID (letters, numbers, dot, underscore, colon or hyphen; maximum 120 characters) and a name (maximum 160 characters).");
  }
  return {
    reportKey: draft.reportKey, outputVariables, valueType: draft.valueType, allowedValues,
    target: draft.targetType === "NONE" ? { type: "NONE", id: "", name: "" } : { type: draft.targetType, id: targetId, name: targetName },
    missingPolicy: "EXPLICIT_STATES"
  };
}

function readContract(value: unknown): ReportingContract | null {
  if (!object(value) || !Array.isArray(value.outputVariables) || !value.outputVariables.every((key) => typeof key === "string")
      || !Array.isArray(value.allowedValues) || !value.allowedValues.every((key) => typeof key === "string")
      || !object(value.target) || typeof value.target.type !== "string" || typeof value.target.id !== "string"
      || typeof value.target.name !== "string" || typeof value.reportKey !== "string" || typeof value.valueType !== "string"
      || value.missingPolicy !== "EXPLICIT_STATES") return null;
  try {
    const contract = contractFromDraft({
      reportKey: value.reportKey as ReportKey, outputVariables: value.outputVariables.join("\n"),
      valueType: value.valueType as ValueType, allowedValues: value.allowedValues.join("\n"),
      targetType: value.target.type as TargetType, targetId: value.target.id, targetName: value.target.name
    });
    if (JSON.stringify(contract.outputVariables) !== JSON.stringify(value.outputVariables)
        || JSON.stringify(contract.allowedValues) !== JSON.stringify(value.allowedValues)
        || contract.target.id !== value.target.id || contract.target.name !== value.target.name) return null;
    return contract;
  } catch { return null; }
}

function readCoverage(value: unknown, questionnaireId: string): ReportingCoverage {
  const unavailable = () => new Error("Reporting coverage returned an invalid response. Editing is unavailable until the current definitions can be verified.");
  if (!object(value) || !object(value.questionnaire) || value.questionnaire.id !== questionnaireId
      || typeof value.questionnaire.code !== "string" || typeof value.questionnaire.name !== "string"
      || typeof value.questionnaire.status !== "string" || !Number.isInteger(value.questionnaire.version)
      || typeof value.locked !== "boolean" || typeof value.metadataWritable !== "boolean"
      || !Number.isInteger(value.usedByIterations) || Number(value.usedByIterations) < 0 || !Array.isArray(value.questions)
      || !(value.lockReason === null || typeof value.lockReason === "string")) throw unavailable();
  const questions = value.questions.map((row) => {
    if (!object(row) || typeof row.id !== "string" || !row.id || !(row.questionCode === null || typeof row.questionCode === "string")
        || !Number.isInteger(row.order) || typeof row.text !== "string" || typeof row.contractValid !== "boolean"
        || !(row.contractError === null || typeof row.contractError === "string")
        || typeof row.expectedContractFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(row.expectedContractFingerprint)
        || !(row.contract === null || object(row.contract))) throw unavailable();
    const contract = readContract(row.contract);
    if (row.contractValid && !contract) throw unavailable();
    return { ...row, contract } as CoverageQuestion;
  });
  if (new Set(questions.map((question) => question.id)).size !== questions.length) throw unavailable();
  return { ...value, questions } as ReportingCoverage;
}

function draftFor(contract: ReportingContract | null): ContractDraft {
  return {
    reportKey: contract?.reportKey || "issue_priority", outputVariables: contract?.outputVariables.join("\n") || "",
    valueType: contract?.valueType || "CATEGORICAL", allowedValues: contract?.allowedValues.join("\n") || "",
    targetType: contract?.target.type || "NONE", targetId: contract?.target.id || "", targetName: contract?.target.name || ""
  };
}

function loadError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Unable to load reporting coverage.";
  if (/404|Cannot GET|Cannot PATCH/i.test(message)) return "Reporting definitions are unavailable. The research reporting backend may not be installed or this questionnaire may no longer be accessible. No coverage result is assumed.";
  if (/<(?:!doctype|html|body|pre)\b/i.test(message)) return "Unable to load reporting definitions. The server did not return a usable response; no coverage result is assumed.";
  return message;
}

export default function QuestionnaireReportingContracts({ questionnaireId }: { questionnaireId: string }) {
  const [coverage, setCoverage] = useState<ReportingCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContractDraft>(() => draftFor(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const requestGeneration = useRef(0);
  const scopeGeneration = useRef(0);
  const saveInFlight = useRef(false);
  const downloadInFlight = useRef(false);

  const load = useCallback(async () => {
    const request = ++requestGeneration.current;
    const scope = scopeGeneration.current;
    setLoading(true);
    setCoverage(null);
    setError(null);
    setNotice(null);
    setEditingId(null);
    setFormError(null);
    try {
      const response = await apiFetch(`/api/questionnaires/${questionnaireId}/reporting-coverage`);
      if (request !== requestGeneration.current || scope !== scopeGeneration.current) return false;
      setCoverage(readCoverage(response, questionnaireId));
      return true;
    } catch (cause) {
      if (request === requestGeneration.current && scope === scopeGeneration.current) setError(loadError(cause));
      return false;
    } finally {
      if (request === requestGeneration.current && scope === scopeGeneration.current) setLoading(false);
    }
  }, [questionnaireId]);

  useEffect(() => {
    const scopes = scopeGeneration;
    const requests = requestGeneration;
    const scope = ++scopes.current;
    saveInFlight.current = false;
    downloadInFlight.current = false;
    void Promise.resolve().then(() => {
      if (scope !== scopes.current) return;
      setSaving(false);
      setDownloading(false);
      void load();
    });
    return () => { ++scopes.current; ++requests.current; };
  }, [load]);

  const current = coverage?.questionnaire.id === questionnaireId ? coverage : null;
  const readOnly = !current || current.locked || current.usedByIterations > 0 || !current.metadataWritable;
  const busy = loading || saving || downloading;

  function edit(question: CoverageQuestion) {
    if (readOnly || busy || saveInFlight.current || downloadInFlight.current) return;
    setEditingId(question.id);
    setDraft(draftFor(question.contract));
    setFormError(null);
    setNotice(null);
  }

  function update(key: keyof ContractDraft, value: string) {
    setDraft((existing) => ({ ...existing, [key]: value }));
    setFormError(null);
  }

  function applyPreset(preset: typeof REPORTING_PRESETS[number]) {
    if (readOnly || busy || saveInFlight.current || downloadInFlight.current || !editingId) return;
    setDraft({ reportKey: preset.reportKey, outputVariables: preset.outputVariable, valueType: "CATEGORICAL",
      allowedValues: preset.allowedValues.join("\n"), targetType: preset.targetType, targetId: "", targetName: "" });
    setFormError(null);
    setNotice(null);
  }

  async function downloadReviewPack() {
    if (!current || busy || editingId || downloadInFlight.current || saveInFlight.current) return;
    const scope = scopeGeneration.current;
    const request = requestGeneration.current;
    downloadInFlight.current = true;
    setDownloading(true);
    setNotice(null);
    setError(null);
    try {
      const pack = await buildSarvamReviewPack(current);
      if (scope !== scopeGeneration.current || request !== requestGeneration.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }));
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `sarvam-review-${current.questionnaire.code.replace(/[^a-z0-9_-]/gi, "_")}-v${current.questionnaire.version}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally { URL.revokeObjectURL(url); }
      setNotice("Review pack downloaded from saved current definitions. Manually review and commit the intended Sarvam agent version, then validate an approved test call before launch. No provider update or call was performed.");
    } catch {
      if (scope === scopeGeneration.current && request === requestGeneration.current) setError("Unable to prepare the local review pack. Refresh current definitions and try again; no provider update or call was performed.");
    } finally {
      if (scope === scopeGeneration.current) { downloadInFlight.current = false; setDownloading(false); }
    }
  }

  async function save() {
    if (readOnly || busy || saveInFlight.current || downloadInFlight.current || !current || !editingId) return;
    const question = current.questions.find((item) => item.id === editingId);
    if (!question) return;
    let contract: ReportingContract;
    try { contract = contractFromDraft(draft); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : "Review the contract fields."); return; }
    const scope = scopeGeneration.current;
    saveInFlight.current = true;
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/questionnaires/${questionnaireId}/questions/${question.id}/reporting-contract`, {
        method: "PATCH", body: JSON.stringify({ expectedContractFingerprint: question.expectedContractFingerprint, contract })
      });
      if (scope !== scopeGeneration.current) return;
      const reloaded = await load();
      if (scope !== scopeGeneration.current) return;
      if (reloaded) setNotice("Contract saved and reloaded. Provider delivery remains unverified.");
      else setError("The change may have been saved, but current reporting definitions could not be reloaded. Refresh before editing; provider delivery remains unverified.");
    } catch (cause) {
      if (scope === scopeGeneration.current) setFormError(loadError(cause));
    } finally {
      if (scope === scopeGeneration.current) { saveInFlight.current = false; setSaving(false); }
    }
  }

  const definedCount = current?.questions.filter((question) => question.contractValid).length || 0;

  return (
    <section className={styles.root} aria-labelledby="questionnaire-reporting-title" aria-busy={busy}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>REPORTING DEFINITIONS</span>
          <h2 id="questionnaire-reporting-title">Question-to-report coverage</h2>
          <p>{current ? `${definedCount}/${current.questions.length} question contracts defined · provider delivery not verified` : "Define the outputs a question is intended to collect."}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => { if (!saveInFlight.current && !downloadInFlight.current) void load(); }} disabled={busy}>Refresh definitions</button>
          <button type="button" onClick={() => { void downloadReviewPack(); }} disabled={busy || !current || Boolean(editingId)}>{downloading ? "Preparing review pack…" : "Download agent review pack"}</button>
        </div>
      </header>
      <details className={styles.help}>
        <summary>How reporting definitions work</summary>
        <p>A contract connects a question to a report, expected output keys, permitted values and a named target where required. It declares planned collection only: saving here does not update a committed Sarvam agent, verify a delivered question, or certify extracted answers.</p>
        <p>Review the committed agent and approved test-call evidence separately before launch. Party mentions are not voting intention; no individual political-lean score is created. NOT_ANSWERED, CANT_SAY and REFUSED are conceptual reporting-state names, not instructions to emit literal provider values. They remain separate from substantive answer categories.</p>
        <p>The current provider normalizer supports wording such as &quot;no answer&quot;, &quot;can&apos;t say&quot; and &quot;refused&quot;. Do not emit underscore tokens from the agent without matching normalizer support. Saving this contract does not configure Sarvam output values.</p>
        <p>The downloadable review pack contains actual saved wording, questionnaire identity and contract fingerprints from the catalogue loaded in this page—not an Iteration snapshot. Refresh definitions before review; this local download does not recheck concurrent changes. It does not contain unsaved edits, change Sarvam, commit an agent or launch a call. Save or cancel editing before downloading.</p>
      </details>
      {loading && <p className={styles.state} role="status">Loading reporting definitions…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {current && readOnly && <p className={styles.locked} role="status">
        {current.usedByIterations > 0 ? `Used by ${current.usedByIterations} iteration(s). ` : "This instrument is read-only. "}
        Reporting definitions are locked. Create a new questionnaire version for changed collection requirements; do not rewrite frozen historical instruments.
        {current.lockReason && <span> {current.lockReason}</span>}
      </p>}
      {current && current.questions.length === 0 && <p className={styles.state}>No questions are recorded in this questionnaire. Add a question before defining reporting outputs.</p>}
      {current && <div className={styles.questions}>{current.questions.map((question) => (
        <details key={question.id} className={styles.question}>
          <summary>
            <span>Question {question.order} · {question.questionCode || "No question code"}</span>
            <span className={question.contractValid ? styles.defined : styles.missing}>{question.contractValid ? "Contract defined" : question.contractError ? "Needs review" : "Not defined"}</span>
          </summary>
          <p className={styles.questionText}>{question.text}</p>
          {question.contractError && <p className={styles.error}>{question.contractError}</p>}
          {question.contract && <dl className={styles.definition}>
            <div><dt>Report</dt><dd>{reportOptions.find(([key]) => key === question.contract?.reportKey)?.[1]}</dd></div>
            <div><dt>Output keys</dt><dd>{question.contract.outputVariables.join(", ")}</dd></div>
            <div><dt>Output type</dt><dd>{question.contract.valueType}</dd></div>
            {question.contract.valueType === "CATEGORICAL" && <div><dt>Substantive categories</dt><dd>{question.contract.allowedValues.join(", ")}</dd></div>}
            <div><dt>Target</dt><dd>{question.contract.target.type === "NONE" ? "No named target" : `${question.contract.target.name} · ${question.contract.target.id}`}</dd></div>
            <div><dt>Verification</dt><dd>Contract defined · provider delivery not verified</dd></div>
          </dl>}
          {!readOnly && editingId !== question.id && <button type="button" onClick={() => edit(question)} disabled={busy} aria-label={`${question.contract ? "Edit" : "Define"} reporting contract for question ${question.order}`}>
            {question.contract ? "Edit definition" : "Define reporting outputs"}
          </button>}
          {editingId === question.id && !readOnly && <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <fieldset disabled={busy}>
              <legend>Reporting contract for question {question.order}</legend>
              <div className={styles.presets} role="group" aria-label="Reporting presets">
                <p>Start with a supported reporting preset. It fills this draft only; question wording is never changed automatically.</p>
                <div className={styles.presetActions}>{REPORTING_PRESETS.map((preset) => (
                  <button key={preset.reportKey} type="button" onClick={() => applyPreset(preset)}>Use {preset.label.toLowerCase()} preset</button>
                ))}</div>
              </div>
              <div className={styles.grid}>
                <label>Report *<select value={draft.reportKey} onChange={(event) => {
                  const reportKey = event.target.value as ReportKey;
                  setDraft((existing) => ({ ...existing, reportKey, targetType: targetTypes(reportKey).includes(existing.targetType) ? existing.targetType : targetTypes(reportKey)[0], targetId: "", targetName: "" }));
                  setFormError(null);
                }}>{reportOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label>Output type *<select value={draft.valueType} onChange={(event) => update("valueType", event.target.value)}>
                  <option value="CATEGORICAL">Categorical</option><option value="TEXT">Text</option><option value="NUMERIC">Numeric</option>
                </select></label>
                <label>Output keys *<textarea value={draft.outputVariables} rows={3} placeholder="One snake_case output key per line" onChange={(event) => update("outputVariables", event.target.value)} /></label>
                {draft.valueType === "CATEGORICAL" && <label>Substantive categories *<textarea value={draft.allowedValues} rows={3} placeholder="One permitted answer category per line" onChange={(event) => update("allowedValues", event.target.value)} /></label>}
                <label>Target type *<select value={draft.targetType} onChange={(event) => { update("targetType", event.target.value); update("targetId", ""); update("targetName", ""); }}>
                  {targetTypes(draft.reportKey).map((type) => <option key={type} value={type}>{type === "NONE" ? "No named target" : type}</option>)}
                </select></label>
                {draft.targetType !== "NONE" && <>
                  <label>Stable target ID *<input value={draft.targetId} maxLength={120} placeholder="Stable identifier, not an inferred label" onChange={(event) => update("targetId", event.target.value)} /></label>
                  <label>Target name *<input value={draft.targetName} maxLength={160} onChange={(event) => update("targetName", event.target.value)} /></label>
                </>}
              </div>
              {REPORTING_PRESETS.filter((preset) => preset.reportKey === draft.reportKey).map((preset) => (
                <details key={preset.reportKey} className={styles.suggestions}>
                  <summary>Neutral question suggestions · copy and review</summary>
                  <p>Author and review a new unused questionnaire for changed collection requirements. These suggestions do not replace the saved question above or update Sarvam. Replace a leader placeholder only with the explicitly identified target.</p>
                  <label>Suggested English question<textarea readOnly rows={4} value={preset.english} /></label>
                  <label>Suggested Telugu question<textarea readOnly rows={4} lang="te" value={preset.telugu} /></label>
                </details>
              ))}
              <p className={styles.policy}>Missing-answer policy: preserve not answered, can&apos;t say and refused separately. Provider wording must match the supported normalizer; this definition does not configure Sarvam or make an election prediction.</p>
              {formError && <p className={styles.error} role="alert">{formError}</p>}
              <div className={styles.actions}>
                <button type="button" onClick={() => { setEditingId(null); setFormError(null); }}>Cancel</button>
                <button type="submit" className={styles.save}>{saving ? "Saving and reloading…" : "Save definition"}</button>
              </div>
            </fieldset>
          </form>}
        </details>
      ))}</div>}
    </section>
  );
}
