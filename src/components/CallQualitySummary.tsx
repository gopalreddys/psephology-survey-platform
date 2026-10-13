"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseCallQualitySummary, qualityLabel, type CallQualitySummary as Summary } from "@/lib/call-quality-review";
import styles from "./call-quality-review.module.css";

export default function CallQualitySummary({ campaignId, iterationId, refreshKey }: { campaignId: string; iterationId: string; refreshKey: string }) {
  const { user } = useCurrentUser();
  const allowed = user && ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"].includes(user.role.code);
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const scopeKey = JSON.stringify([campaignId, iterationId, refreshKey, refresh, user?.id, user?.role.code, Boolean(allowed)]);
  useEffect(() => {
    const current = ++generation.current;
    if (!allowed || !opened) return;
    const timer = window.setTimeout(() => {
      setError(false);
      void apiFetch(`/api/research-quality/campaigns/${encodeURIComponent(campaignId)}?iterationId=${encodeURIComponent(iterationId)}`).then((value: unknown) => {
        if (current !== generation.current) return;
        setData(parseCallQualitySummary(value, campaignId, iterationId)); setLoadedKey(scopeKey);
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
  return <details className={styles.summary} onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary>Audited call-sample quality</summary>
    <p>Entire selected Iteration across all Runs. Gender, age and Mandal filters do not narrow this review summary. Sample approval does not validate the entire Iteration, electorate representativeness or sentiment accuracy.</p>
    {opened && <><button type="button" disabled={pending} onClick={() => setRefresh((value) => value + 1)}>Refresh sample checks</button>{pending ? <p role="status">Loading Iteration-wide sample checks…</p> : error ? <p role="alert" className={styles.warning}>Sample checks are unavailable. This is not zero reviews or an approval.</p> : current ? <><p><strong>Status: {qualityLabel(current.status)}</strong></p>{current.status === "NOT_AVAILABLE" ? <p>No verified sample-review summary is available.</p> : <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Iteration-wide call-sample review counts"><table><thead><tr><th>Reviewable calls</th><th>Reviewed calls</th><th>Approved samples</th><th>Rejected samples</th><th>Stale samples</th></tr></thead><tbody><tr>{(["reviewableCalls", "reviewedCalls", "approvedCalls", "rejectedCalls", "staleCalls"] as const).map((key) => <td key={key}>{current.counts[key]}</td>)}</tr></tbody></table></div>}<p>Latest decision: {current.latestDecisionAt || "Not recorded"}</p><ul>{current.limitations.map((item) => <li key={item}>{item}</li>)}</ul></> : <p>No verified summary is available.</p>}</>}
  </details>;
}
