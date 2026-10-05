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
import styles from "./quick.module.css";

type EmbedResponse = {
  provider: "AMAZON_QUICK_SIGHT";
  mode: "ONE_CLICK" | "REGISTERED_USER_API";
  dashboardId?: string;
  embedUrl: string;
};

const PREVIEW_SECTIONS = [
  ["Leadership overview", "Party, candidate, leadership and sentiment distributions"],
  ["Demographic pulse", "Age histogram, age bands and gender comparisons"],
  ["Geographic intelligence", "Constituency and Mandal heat tables"],
  ["Iteration movement", "Comparable research movement across survey waves"]
];

export default function EnterpriseDashboardPage() {
  const { user } = useCurrentUser();
  const [dashboard, setDashboard] = useState<EmbedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async function () {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setDashboard(await apiFetch("/api/enterprise-dashboard/embed-url") as EmbedResponse);
    } catch (reason) {
      setDashboard(null);
      setError(reason instanceof Error ? reason.message : "Unable to open Amazon Quick Sight");
    } finally {
      setLoading(false);
    }
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
