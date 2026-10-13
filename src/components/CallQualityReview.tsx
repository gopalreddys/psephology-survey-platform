"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseCallQualityEvidence, qualityChecks, qualityIssueBuckets, qualityLabel, qualityLanguages, qualityNoteError, type CallQualityEvidence, type QualityCheck, type QualityCheckResult, type QualityIssue, type QualityLanguage } from "@/lib/call-quality-review";
import styles from "./call-quality-review.module.css";

function transcriptTurn(turn: unknown): { speaker: string; text: string } {
  if (typeof turn === "string") return { speaker: "Turn", text: turn };
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) return { speaker: "Turn", text: "Transcript turn unavailable." };
  const row = turn as Record<string, unknown>;
  const speaker = row.role ?? row.speaker ?? row.participant ?? row.source;
  const content = row.text ?? row.content ?? row.message ?? row.transcript;
  return { speaker: typeof speaker === "string" ? speaker : "Turn", text: typeof content === "string" ? content : "Transcript text unavailable." };
}
function emptyChecks(): Record<QualityCheck, "" | QualityCheckResult> { return Object.fromEntries(qualityChecks.map(([key]) => [key, ""])) as Record<QualityCheck, "" | QualityCheckResult>; }

export default function CallQualityReview({ executionId, campaignId, iterationId, runId }: { executionId: string; campaignId: string; iterationId: string; runId: string }) {
  const { user } = useCurrentUser();
  const allowed = user?.role.code === "ADMIN" || user?.role.code === "SUPER_ADMIN";
  const [data, setData] = useState<CallQualityEvidence | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [language, setLanguage] = useState<"" | QualityLanguage>("");
  const [checks, setChecks] = useState(emptyChecks);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [decisionAttested, setDecisionAttested] = useState(false);
  const generation = useRef(0);
  const writeLock = useRef(false);
  const scopeKey = JSON.stringify([executionId, campaignId, iterationId, runId, user?.id, user?.role.code, allowed, refresh]);

  useEffect(() => {
    const current = ++generation.current;
    if (!allowed) return;
    const timer = window.setTimeout(() => {
      setData(null); setError(null); setLanguage(""); setChecks(emptyChecks()); setIssues([]); setNote(""); setReason(""); setAttested(false); setDecisionAttested(false);
      void apiFetch(`/api/research-quality/executions/${encodeURIComponent(executionId)}`).then((value: unknown) => {
        if (current !== generation.current) return;
        setData(parseCallQualityEvidence(value, executionId, { campaignId, iterationId, runId })); setLoadedKey(scopeKey);
      }).catch(() => {
        if (current !== generation.current) return;
        setData(null); setLoadedKey(scopeKey); setError("Call-quality checks are unavailable. No approval is assumed; reload before reviewing.");
      });
    }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [allowed, campaignId, executionId, iterationId, runId, scopeKey]);

  const current = allowed && loadedKey === scopeKey ? data : null;
  const pending = loadedKey !== scopeKey;
  const canReview = Boolean(current?.reviewable && current.evidenceFingerprint && current.permissions.canReview && !current.ownReview && !saving && !pending);
  const canDecide = Boolean(current?.reviewable && current.evidenceFingerprint && current.permissions.canDecide && !saving && !pending);

  async function submit(kind: "review" | "APPROVE_SAMPLE" | "REJECT_SAMPLE") {
    if (writeLock.current || !current || !current.evidenceFingerprint || (kind === "review" ? !canReview : !canDecide)) return;
    if (kind === "APPROVE_SAMPLE" && !current.approvalReady) return;
    let body: Record<string, unknown>;
    if (kind === "review") {
      if (!language || qualityChecks.some(([key]) => !checks[key])) { setNotice("Select the observed language and assess every check. Do not assume a pass."); return; }
      const validation = qualityNoteError(note);
      if (validation) { setNotice(validation); return; }
      if (!attested) { setNotice("Confirm that you reviewed this exact evidence before submitting."); return; }
      body = { expectedEvidenceFingerprint: current.evidenceFingerprint, language, checks, issueBuckets: issues, note: note.trim(), attested: true };
    } else {
      const validation = qualityNoteError(reason, true);
      if (validation) { setNotice(validation); return; }
      if (!decisionAttested) { setNotice("Confirm the scope of this call-sample decision before submitting."); return; }
      body = { expectedEvidenceFingerprint: current.evidenceFingerprint, expectedDecisionRevision: current.decisionRevision, action: kind, reason: reason.trim(), attested: true };
    }
    const requestGeneration = generation.current;
    writeLock.current = true; setSaving(true); setNotice(null);
    try {
      await apiFetch(`/api/research-quality/executions/${encodeURIComponent(executionId)}/${kind === "review" ? "reviews" : "decisions"}`, { method: "POST", body: JSON.stringify(body) });
      if (requestGeneration !== generation.current) return;
      setNotice(kind === "review" ? "Immutable review recorded. Reloading current evidence…" : "Call-sample decision recorded. Reloading current evidence…");
      setRefresh((value) => value + 1);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      if (cause instanceof Error && /\b409\b|conflict|changed|stale/i.test(cause.message)) {
        setNotice("Evidence or decision changed. Draft cleared; inspect the refreshed evidence and submit a new deliberate review if permitted."); setRefresh((value) => value + 1);
      } else {
        setNotice("The write was not confirmed. Draft cleared; reload the evidence before trying again."); setRefresh((value) => value + 1);
      }
    } finally { writeLock.current = false; setSaving(false); }
  }

  if (!allowed) return null;
  return <section className={styles.panel} aria-label="Audited call-quality sample review" aria-busy={pending || saving}>
    <header className={styles.header}><div><span className={styles.eyebrow}>CALL-QUALITY CONTROL</span><h3>Review this call sample</h3><p>Operational quality only — not validation of sentiment, population accuracy or an entire Iteration.</p></div><button type="button" disabled={pending || saving} onClick={() => { setNotice(null); setRefresh((value) => value + 1); }}>Refresh evidence</button></header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {pending ? <p role="status">Loading current call evidence…</p> : error ? <p role="alert" className={styles.warning}>{error}</p> : current ? <>
      <dl className={styles.sources}><dt>Evidence fingerprint</dt><dd>{current.evidenceFingerprint || "Not available"}</dd><dt>Actual request agent</dt><dd>{current.evidence.agent.basis === "EXECUTION_REQUEST" ? `${current.evidence.agent.appId || "Not recorded"} · version ${current.evidence.agent.version ?? "Not recorded"}` : "Not recorded — an Iteration assignment is not execution proof"}</dd><dt>Frozen instrument hash</dt><dd>{current.evidence.frozenInstrumentHash || "Not recorded"}</dd><dt>Normalization-rule hash</dt><dd>{current.evidence.normalizationRuleHash || "Not recorded"}</dd></dl>
      {current.blockedReasons.length > 0 && <div className={styles.warning}><strong>Approval prerequisites not met</strong><ul>{current.blockedReasons.map((item) => <li key={item}>{item}</li>)}</ul><p>Diagnostic reviews may still be recorded when permitted. Missing evidence is not a pass.</p></div>}
      <details className={styles.details}><summary>Exact evidence for this review</summary><h4>{current.evidence.frozenInstrumentHash ? "Verified frozen questions" : "Recorded question content — not verified frozen"}</h4>{!current.evidence.frozenInstrumentHash && <p>Recorded question content is diagnostic only; it cannot establish a verified frozen instrument.</p>}{current.evidence.questions.length ? <ol>{current.evidence.questions.map((question) => <li key={question.code}><strong>{question.code}</strong> · {question.text}<small>Order {question.order} · {question.outputVariables.join(", ") || "No output variables recorded"}</small></li>)}</ol> : <p>No verified frozen question content is available.</p>}<h4>Conversation transcript</h4>{current.evidence.transcript.length ? <div className={styles.transcript}>{current.evidence.transcript.map((turn, index) => { const item = transcriptTurn(turn); return <div key={index}><strong>{item.speaker}</strong><p>{item.text}</p></div>; })}</div> : <p>No transcript evidence is available.</p>}<h4>Provider outputs — not human-validated answers</h4>{Object.keys(current.evidence.outputs).length ? <dl className={styles.sources}>{Object.entries(current.evidence.outputs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : <p>No structured output evidence is available.</p>}</details>
      <p className={styles.note}>{current.counts.currentReviews} current review(s) · {current.counts.staleReviews} stale review(s). Stale reviews do not satisfy approval.</p>
      {current.ownReview ? <div className={styles.notice}><strong>Your review is recorded and immutable for this evidence.</strong><p>Other current reviews become visible only after your independent review is submitted.</p></div> : current.permissions.canReview ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit("review"); }}>
        <h4>Independent review</h4><p>Listen to the call when audio is available and inspect the transcript, frozen questions and outputs. Choose “Not assessable” when the evidence cannot establish a result.</p>
        <fieldset disabled={!canReview}><legend>Observed language and quality checks</legend><label>Observed language<select value={language} onChange={(event) => setLanguage(event.target.value as QualityLanguage)}><option value="">Select observed language</option>{qualityLanguages.map((value) => <option key={value} value={value}>{qualityLabel(value)}</option>)}</select></label>{qualityChecks.map(([key, label]) => <label key={key}>{label}<select value={checks[key]} onChange={(event) => setChecks((value) => ({ ...value, [key]: event.target.value as QualityCheckResult }))}><option value="">Select an assessment</option><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="NOT_ASSESSABLE">Not assessable</option></select></label>)}</fieldset>
        <fieldset disabled={!canReview}><legend>Observed issue buckets</legend>{qualityIssueBuckets.map(([key, label]) => <label className={styles.checkbox} key={key}><input type="checkbox" checked={issues.includes(key)} onChange={(event) => setIssues((value) => event.target.checked ? [...value, key] : value.filter((item) => item !== key))} />{label}</label>)}</fieldset>
        <label>Diagnostic note (optional; no names, phone numbers or IDs)<textarea maxLength={1000} value={note} disabled={!canReview} onChange={(event) => setNote(event.target.value)} /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={attested} disabled={!canReview} onChange={(event) => setAttested(event.target.checked)} />I independently reviewed the current evidence and recorded only findings supported by it.</label>
        <button type="submit" disabled={!canReview || !attested}>{saving ? "Recording…" : "Record immutable review"}</button>
      </form> : <p className={styles.note}>Review recording is not permitted for this evidence and reviewer.</p>}
      {current.ownReview && <details className={styles.details}><summary>Your recorded assessment</summary><p>{qualityLabel(current.ownReview.language)} · {current.ownReview.createdAt}</p><ul>{qualityChecks.map(([key, label]) => <li key={key}>{label}: <strong>{qualityLabel(current.ownReview!.checks[key])}</strong></li>)}</ul><p>Issue buckets: {current.ownReview.issueBuckets.map((key) => qualityIssueBuckets.find(([value]) => value === key)?.[1]).join(", ") || "None recorded"}</p>{current.ownReview.note && <p>{current.ownReview.note}</p>}</details>}
      {current.reviews.length > 0 && <details className={styles.details}><summary>Current independent reviews</summary>{current.reviews.map((review) => <div className={styles.record} key={review.id}><p>{qualityLabel(review.language)} · {review.createdAt}</p><ul>{qualityChecks.map(([key, label]) => <li key={key}>{label}: <strong>{qualityLabel(review.checks[key])}</strong></li>)}</ul><p>Issue buckets: {review.issueBuckets.map((key) => qualityIssueBuckets.find(([value]) => value === key)?.[1]).join(", ") || "None recorded"}</p>{review.note && <p>{review.note}</p>}</div>)}</details>}
      {current.decision && <div className={styles.notice}><strong>{current.decision.action === "APPROVE_SAMPLE" ? "Recorded call-sample approval" : "Recorded call-sample rejection"}{current.decision.evidenceFingerprint !== current.evidenceFingerprint ? " — stale evidence" : ""}</strong><p>{current.decision.reason}</p><p>This is a recorded decision, not automatic current certification. The Iteration-wide sample summary checks whether it remains effective.</p><small>Revision {current.decision.revision} · {current.decision.decidedAt}</small></div>}
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}><h4>Independent decision</h4><p>Approval requires two distinct all-pass reviews and a third distinct approver, plus verified question and actual agent evidence. This does not approve the entire survey or certify sentiment accuracy.</p><label>Decision reason (no personal details)<textarea maxLength={1000} value={reason} disabled={!canDecide} onChange={(event) => setReason(event.target.value)} /></label><label className={styles.checkbox}><input type="checkbox" checked={decisionAttested} disabled={!canDecide} onChange={(event) => setDecisionAttested(event.target.checked)} />I understand this decision covers only the reviewed call sample and its current evidence.</label><div className={styles.actions}><button type="button" disabled={!canDecide || !current.approvalReady || !decisionAttested} onClick={() => void submit("APPROVE_SAMPLE")}>Approve reviewed call sample</button><button type="button" disabled={!canDecide || !decisionAttested} onClick={() => void submit("REJECT_SAMPLE")}>Reject reviewed call sample</button></div>{!canDecide && <p className={styles.note}>A distinct authorized approver is required; reviewers cannot decide their own current review.</p>}</form>
    </> : <p>No current call-quality evidence is available.</p>}
  </section>;
}
