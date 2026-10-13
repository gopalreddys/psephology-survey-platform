"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { interviewCompletionLabels, interviewReasonLabel, parseInterviewCompletionDetail, type InterviewCompletionDetail as Detail } from "@/lib/interview-completion";
import styles from "./interview-completion.module.css";

export default function InterviewCompletionDetail({ executionId, campaignId, iterationId, runId }: { executionId: string; campaignId: string; iterationId: string; runId: string }) {
  const { user } = useCurrentUser();
  const allowed = user?.role.code === "ADMIN" || user?.role.code === "SUPER_ADMIN";
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<Detail | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const scopeKey = JSON.stringify([executionId, campaignId, iterationId, runId, user?.id, user?.role.code, allowed, refresh]);
  useEffect(() => {
    const current = ++generation.current;
    if (!allowed || !opened) return;
    const timer = window.setTimeout(() => {
      setError(false);
      void apiFetch(`/api/interview-completion/executions/${encodeURIComponent(executionId)}`).then((value: unknown) => {
        if (current !== generation.current) return;
        setData(parseInterviewCompletionDetail(value, { executionId, campaignId, iterationId, runId })); setLoadedKey(scopeKey);
      }).catch(() => {
        if (current !== generation.current) return;
        setData(null); setError(true); setLoadedKey(scopeKey);
      });
    }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [allowed, campaignId, executionId, iterationId, opened, runId, scopeKey]);
  if (!allowed) return null;
  const pending = loadedKey !== scopeKey;
  const current = !pending ? data : null;
  return <details className={styles.panel} onToggle={(event) => {
    if (event.target !== event.currentTarget || event.currentTarget.open === opened) return;
    generation.current += 1;
    setData(null); setLoadedKey(""); setError(false); setOpened(event.currentTarget.open);
  }}>
    <summary>Recorded coverage for this call</summary>
    {opened && <div className={styles.body}>
      <p className={styles.note}>Automated answer coverage only — not a human-validated completed interview.</p>
      <button type="button" disabled={pending} onClick={() => setRefresh((value) => value + 1)}>Refresh call coverage</button>
      {pending ? <p role="status">Checking this exact call’s recorded coverage…</p> : error ? <p role="alert" className={styles.warning}>This call’s recorded coverage could not be verified. No completion is assumed.</p> : current ? <>
        <p><strong>{interviewCompletionLabels[current.status]}</strong></p>
        {current.reasonCodes.length > 0 && <ul>{current.reasonCodes.map((item, index) => <li key={index}>{interviewReasonLabel(item)}</li>)}</ul>}
        {current.coverage.requiredQuestions !== null ? <p>{current.coverage.accountedQuestions} of {current.coverage.requiredQuestions} required questions fully accounted for · {current.coverage.substantiveQuestions} fully accounted substantive · {current.coverage.cantSayQuestions} can’t say · {current.coverage.refusedQuestions} refused · {current.coverage.missingQuestions} missing one or more mapped outputs.</p> : <p className={styles.note}>Question coverage is unavailable; missing technical or instrument evidence is not a pass.</p>}
        {current.questions.length > 0 && <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Recorded coverage by frozen question"><table><thead><tr><th>Frozen question</th><th>Completion rule</th><th>Recorded state</th><th>Mapped outputs</th></tr></thead><tbody>{current.questions.map((item) => <tr key={item.code}><th scope="row">{item.code}</th><td>{item.required ? "Required" : "Optional"}</td><td>{interviewReasonLabel(item.status)}</td><td>{item.mappedOutputs}</td></tr>)}</tbody></table></div>}
        <details className={styles.explanation}><summary>How it is measured</summary><p>Only this exact attempt is checked against its verified frozen required-question mappings. All mapped outputs must be accounted for; explicit uncertainty and refusal remain distinct from missing answers. A partly answered question stays missing when any mapped output is absent, so a partial call can have zero fully accounted substantive questions. This check does not judge answer truth, sentiment accuracy or independently validate the interview. Do not pressure participants to replace a refusal or “can’t say.”</p><p>No raw answers or participant identifiers are shown in this check. Existing call-success and retry rules are unchanged.</p><dl className={styles.sources}><dt>Evidence observed (UTC)</dt><dd>{current.source.observedAt || "Not recorded"}</dd><dt>Frozen instrument hash</dt><dd>{current.source.frozenInstrumentHash || "Not verified"}</dd><dt>Evidence fingerprint</dt><dd>{current.source.evidenceFingerprint || "Not verified"}</dd><dt>Rule version</dt><dd>{current.rulesVersion}</dd></dl><ul>{current.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
      </> : <p>No verified coverage is available for this call.</p>}
    </div>}
  </details>;
}
