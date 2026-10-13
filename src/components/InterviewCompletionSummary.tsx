"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { interviewCompletionCountLabels, interviewReasonLabel, parseInterviewCompletionSummary, type InterviewCompletionSummary as Summary } from "@/lib/interview-completion";
import styles from "./interview-completion.module.css";

export default function InterviewCompletionSummary({ campaignId, iterationId, refreshKey }: { campaignId: string; iterationId: string; refreshKey: string }) {
  const { user } = useCurrentUser();
  const allowed = Boolean(user && ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"].includes(user.role.code));
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const scopeKey = JSON.stringify([campaignId, iterationId, refreshKey, refresh, user?.id, user?.role.code, allowed]);
  useEffect(() => {
    const current = ++generation.current;
    if (!allowed || !opened) return;
    const timer = window.setTimeout(() => {
      setError(false);
      void apiFetch(`/api/interview-completion/campaigns/${encodeURIComponent(campaignId)}?iterationId=${encodeURIComponent(iterationId)}`).then((value: unknown) => {
        if (current !== generation.current) return;
        setData(parseInterviewCompletionSummary(value, campaignId, iterationId)); setLoadedKey(scopeKey);
      }).catch(() => {
        if (current !== generation.current) return;
        setData(null); setError(true); setLoadedKey(scopeKey);
      });
    }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [allowed, campaignId, iterationId, opened, scopeKey]);
  if (!allowed) return null;
  const pending = loadedKey !== scopeKey;
  const current = !pending ? data : null;
  return <details className={styles.panel} onToggle={(event) => {
    if (event.target !== event.currentTarget || event.currentTarget.open === opened) return;
    generation.current += 1;
    setData(null); setLoadedKey(""); setError(false); setOpened(event.currentTarget.open);
  }}>
    <summary>Recorded interview coverage</summary>
    {opened && <div className={styles.body}>
      <p className={styles.note}>Entire selected Iteration across all Runs. Gender, age, Mandal and Run filters do not narrow these counts.</p>
      <button type="button" disabled={pending} onClick={() => setRefresh((value) => value + 1)}>Refresh recorded coverage</button>
      {pending ? <p role="status">Checking Iteration-wide recorded coverage…</p> : error ? <p role="alert" className={styles.warning}>Recorded coverage is unavailable. This is not zero records or completed interviews.</p> : current ? <>
        <p><strong>{current.status === "AVAILABLE" ? "Recorded coverage available" : current.status === "WITHHELD" ? "Counts withheld" : "Recorded coverage unavailable"}</strong>{current.status !== "AVAILABLE" && ` · ${interviewReasonLabel(current.reason)}`}</p>
        {current.status === "AVAILABLE" ? <>
          <p>Retained Run 1 cohort: <strong>{current.counts.selectedBase}</strong> database voter records.</p>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Iteration-wide recorded interview coverage"><table><thead><tr><th>Latest matched attempt</th><th>Database voter records</th></tr></thead><tbody>{interviewCompletionCountLabels.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{current.counts[key]}</td></tr>)}</tbody></table></div>
        </> : <p className={styles.note}>{current.status === "WITHHELD" ? "The whole partition, including its cohort base, is withheld to protect small cells. Withheld is not zero." : "A verified retained cohort is not available. No counts or completion rate are assumed."}</p>}
        <details className={styles.explanation}><summary>How it is measured</summary><p>Automated coverage of frozen required-question outputs from each record’s latest matched attempt. Separate attempts are never combined into a complete interview. Explicit “can’t say” and refusal are distinguished from missing answers; neither is a reason to pressure a participant.</p><p>Complete recorded coverage is not independently validated interview completion, sentiment accuracy or a survey response rate. The existing call-success and retry rules are unchanged.</p><dl className={styles.sources}><dt>Evidence observed (UTC)</dt><dd>{current.observedAt || "Not recorded"}</dd><dt>Frozen instrument hash</dt><dd>{current.source.frozenInstrumentHash || "Not verified"}</dd><dt>Rule version</dt><dd>{current.rulesVersion}</dd></dl><ul>{current.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
      </> : <p>No verified recorded-coverage summary is available.</p>}
    </div>}
  </details>;
}
