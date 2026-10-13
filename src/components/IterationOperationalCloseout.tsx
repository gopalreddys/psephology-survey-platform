"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./iterationResearchSetup.module.css";

type Closeout = {
  iteration: { id: string; campaign_id: string; status: string };
  runs: Array<{ id: string; run_number: number; status: string }>;
  summary: { completedRuns: number; runCount: number; callbacksReceived: number; transcriptsCaptured: number; retryEligibleVoters: number };
  readyToComplete: boolean;
  blockers: string[];
};

/** Manual operational closure stays in planning/execution, never in the analytical workbench. */
export default function IterationOperationalCloseout({ iterationId, campaignId, refreshKey, onCompleted }: {
  iterationId: string;
  campaignId?: string | null;
  refreshKey: string;
  onCompleted: () => Promise<void>;
}) {
  const { user } = useCurrentUser();
  const canComplete = user?.role.code === "CAMPAIGN_MANAGER" && Boolean(campaignId);
  const scopeKey = JSON.stringify([user?.id, iterationId, campaignId]);
  const [loaded, setLoaded] = useState<{ scopeKey: string; data: Closeout } | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const submitting = useRef(false);
  const data = loaded?.scopeKey === scopeKey ? loaded.data : null;

  const load = useCallback(async () => {
    if (!canComplete) return;
    const request = ++requestGeneration.current;
    setLoading(true);
    setMessage(null);
    try {
      const result = await apiFetch(`/api/iterations/${encodeURIComponent(iterationId)}/closeout`) as Closeout;
      if (result.iteration.id !== iterationId || (campaignId && result.iteration.campaign_id !== campaignId)) {
        throw new Error("Closeout scope does not match this Iteration and Campaign.");
      }
      if (request === requestGeneration.current) setLoaded({ scopeKey, data: result });
    } catch (reason) {
      if (request === requestGeneration.current) {
        setLoaded(null);
        setMessage(reason instanceof Error ? reason.message : "Unable to load operational closeout.");
      }
    } finally { if (request === requestGeneration.current) setLoading(false); }
  }, [campaignId, canComplete, iterationId, scopeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); requestGeneration.current += 1; };
  }, [load, refreshKey]);

  async function complete() {
    if (!canComplete || !data?.readyToComplete || data.iteration.status.toUpperCase() === "COMPLETED" || submitting.current) return;
    if (!window.confirm("Complete this Iteration? The server will recheck all three policy Runs and active calls. Operational closure does not approve methodology, call quality or research findings.")) return;
    submitting.current = true;
    setCompleting(true);
    setMessage(null);
    const request = ++requestGeneration.current;
    try {
      const result = await apiFetch(`/api/iterations/${encodeURIComponent(iterationId)}/complete`, { method: "POST" }) as Closeout;
      if (result.iteration.id !== iterationId || (campaignId && result.iteration.campaign_id !== campaignId)) throw new Error("Completed closeout response has an unexpected scope.");
      if (request !== requestGeneration.current) return;
      setLoaded({ scopeKey, data: result });
      setMessage("Iteration operationally completed. Research review remains separate.");
      setCompleting(false);
      await onCompleted();
    } catch (reason) {
      if (request === requestGeneration.current) setMessage(reason instanceof Error ? reason.message : "Unable to complete Iteration.");
    } finally {
      submitting.current = false;
      if (request === requestGeneration.current) setCompleting(false);
    }
  }

  if (!canComplete) return null;
  const completed = data?.iteration.status.toUpperCase() === "COMPLETED";
  return <section className={styles.closeout} aria-label="Iteration operational closeout">
    <div className={styles.closeoutHeader}><div><h2>Iteration closeout</h2><p>Three closed policy Runs and no active calls. The server rechecks readiness and assignment before completion.</p></div><strong>{completed ? "Completed" : data?.readyToComplete ? "Ready to complete" : "Not ready"}</strong></div>
    {loading && <p role="status">Checking closeout readiness…</p>}
    {message && <FeedbackMessage message={message} />}
    {data && <><dl>
      <div><dt>Closed Runs</dt><dd>{data.summary.completedRuns}/{data.summary.runCount}</dd></div>
      <div><dt>Callbacks retained</dt><dd>{data.summary.callbacksReceived}</dd></div>
      <div><dt>Transcripts retained</dt><dd>{data.summary.transcriptsCaptured}</dd></div>
      <div><dt>Retry eligible</dt><dd>{data.summary.retryEligibleVoters}</dd></div>
    </dl><details><summary>Run status and completion checks</summary><ul>{data.runs.map((run) => <li key={run.id}>Run {run.run_number} · {run.status.replaceAll("_", " ")}</li>)}{data.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details></>}
    <div className={styles.closeoutFooter}><p>Operational outcomes are not independently validated interviews or representative findings.</p>{!completed && <button type="button" disabled={loading || completing || !data?.readyToComplete} onClick={() => { void complete(); }}>{completing ? "Completing…" : "Complete Iteration"}</button>}</div>
    {!data && !loading && <button type="button" onClick={() => { void load(); }}>Retry closeout check</button>}
  </section>;
}
