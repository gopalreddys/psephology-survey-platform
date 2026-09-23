"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileQuestion,
  Gauge,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Users
} from "lucide-react";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser, type PlatformRole } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./analytics.module.css";
import roleStyles from "./role-lens.module.css";

type Questionnaire = {
  id: string;
  code: string;
  name: string;
};

type IterationAnalytics = {
  id: string;
  number: number;
  name: string;
  researchPhase: string;
  status: string;
  completed: boolean;
  targetSample: number;
  questionnaire: Questionnaire | null;
  runCount: number;
  closedRunCount: number;
  selectedVoters: number;
  successfulVoters: number;
  retryExhaustedVoters: number;
  pendingVoters: number;
  callAttempts: number;
  callbacksReceived: number;
  connectedCalls: number;
  transcriptsCaptured: number;
  responsesCaptured: number;
  averageDurationSeconds: number;
  successfulCoveragePct: number;
  callbackCoveragePct: number;
  transcriptCoveragePct: number;
  responseCoveragePct: number;
  latestAttemptAt: string | null;
};

type CampaignAnalytics = {
  id: string;
  code: string;
  name: string;
  status: string;
  surveyStage: string;
  targetType: string;
  targetName: string;
  targetCode: string | null;
  programName: string | null;
  campaignManagerName: string | null;
  iterationCount: number;
  completedIterationCount: number;
  runCount: number;
  closedRunCount: number;
  selectedVoters: number;
  successfulVoters: number;
  callAttempts: number;
  callbacksReceived: number;
  connectedCalls: number;
  transcriptsCaptured: number;
  responsesCaptured: number;
  successfulCoveragePct: number;
  callbackCoveragePct: number;
  transcriptCoveragePct: number;
  responseCoveragePct: number;
  iterations: IterationAnalytics[];
};

type AnalyticsResponse = {
  summary: {
    campaignCount: number;
    completedCampaignCount: number;
    iterationCount: number;
    completedIterationCount: number;
    runCount: number;
    closedRunCount: number;
    selectedVoters: number;
    successfulVoters: number;
    callAttempts: number;
    callbacksReceived: number;
    connectedCalls: number;
    transcriptsCaptured: number;
    responsesCaptured: number;
    successfulCoveragePct: number;
    callbackCoveragePct: number;
    transcriptCoveragePct: number;
    responseCoveragePct: number;
  };
  campaigns: CampaignAnalytics[];
  generatedAt: string;
};

type AnalyticsSummary = AnalyticsResponse["summary"];
type MetricDefinition = {
  icon: typeof Activity; label: string; value: string; detail: string;
};
type LensItem = { label: string; value: string; detail: string };

function count(value: number) {
  return Number(value || 0).toLocaleString();
}

function pct(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function analyticsCopy(role: PlatformRole) {
  if (role === "SUPER_ADMIN") return {
    eyebrow: "PLATFORM RESEARCH GOVERNANCE",
    title: "Portfolio intelligence",
    description: "Review lifecycle completion and evidence integrity across every Campaign visible to platform governance."
  };
  if (role === "ADMIN") return {
    eyebrow: "ADMINISTRATIVE RESEARCH ASSURANCE",
    title: "Campaign evidence oversight",
    description: "Verify that administered Campaigns are progressing with complete callbacks, transcripts, and structured responses."
  };
  return {
    eyebrow: "CAMPAIGN RESEARCH INTELLIGENCE",
    title: "Assigned campaign analysis",
    description: "Interpret respondent coverage and Iteration evidence for the Campaigns assigned to you."
  };
}

function analyticsMetrics(role: PlatformRole, summary: AnalyticsSummary): MetricDefinition[] {
  if (role === "CAMPAIGN_MANAGER") return [
    { icon: BarChart3, label: "Assigned Campaigns", value: count(summary.campaignCount), detail: `${count(summary.completedCampaignCount)} completed` },
    { icon: ClipboardCheck, label: "Iteration progress", value: `${count(summary.completedIterationCount)}/${count(summary.iterationCount)}`, detail: `${count(summary.closedRunCount)}/${count(summary.runCount)} Runs closed` },
    { icon: Target, label: "Respondent coverage", value: pct(summary.successfulCoveragePct), detail: `${count(summary.successfulVoters)}/${count(summary.selectedVoters)} successful` },
    { icon: MessageSquareText, label: "Analysis evidence", value: pct(Math.min(summary.transcriptCoveragePct, summary.responseCoveragePct)), detail: "Lowest transcript/response coverage" }
  ];
  if (role === "ADMIN") return [
    { icon: BarChart3, label: "Administered Campaigns", value: count(summary.campaignCount), detail: `${count(summary.completedCampaignCount)} completed` },
    { icon: ClipboardCheck, label: "Lifecycle closure", value: `${count(summary.closedRunCount)}/${count(summary.runCount)}`, detail: `${count(summary.completedIterationCount)}/${count(summary.iterationCount)} Iterations complete` },
    { icon: Gauge, label: "Callback reconciliation", value: pct(summary.callbackCoveragePct), detail: `${count(summary.callbacksReceived)}/${count(summary.callAttempts)} attempts` },
    { icon: MessageSquareText, label: "Evidence retained", value: pct(Math.min(summary.transcriptCoveragePct, summary.responseCoveragePct)), detail: "Lowest transcript/response coverage" }
  ];
  return [
    { icon: BarChart3, label: "Platform Campaigns", value: count(summary.campaignCount), detail: `${count(summary.completedCampaignCount)} completed` },
    { icon: ClipboardCheck, label: "Lifecycle governance", value: `${count(summary.completedIterationCount)}/${count(summary.iterationCount)}`, detail: `${count(summary.closedRunCount)}/${count(summary.runCount)} Runs closed` },
    { icon: Gauge, label: "Provider assurance", value: pct(summary.callbackCoveragePct), detail: `${count(summary.callbacksReceived)}/${count(summary.callAttempts)} callbacks` },
    { icon: ShieldCheck, label: "Evidence integrity", value: pct(Math.min(summary.transcriptCoveragePct, summary.responseCoveragePct)), detail: "Lowest retained-evidence coverage" }
  ];
}

function decisionLens(role: PlatformRole, summary: AnalyticsSummary): LensItem[] {
  const iterationProgress = summary.iterationCount
    ? (summary.completedIterationCount / summary.iterationCount) * 100 : 0;
  const evidenceReadiness = Math.min(
    summary.callbackCoveragePct,
    summary.transcriptCoveragePct,
    summary.responseCoveragePct
  );
  if (role === "SUPER_ADMIN") return [
    { label: "PORTFOLIO CLOSURE", value: pct(iterationProgress), detail: "Share of visible Iterations operationally completed." },
    { label: "EVIDENCE FLOOR", value: pct(evidenceReadiness), detail: "Lowest of callback, transcript, and response coverage." },
    { label: "GOVERNANCE VIEW", value: count(summary.campaignCount), detail: "Non-archived Campaigns visible under platform scope." }
  ];
  if (role === "ADMIN") return [
    { label: "DELIVERY PROGRESS", value: pct(iterationProgress), detail: "Iteration completion across administered Campaigns." },
    { label: "DATA ASSURANCE", value: pct(evidenceReadiness), detail: "Minimum evidence coverage to investigate before sign-off." },
    { label: "OPEN ITERATIONS", value: count(Math.max(summary.iterationCount - summary.completedIterationCount, 0)), detail: "Iterations still requiring operational completion." }
  ];
  return [
    { label: "RESEARCH COVERAGE", value: pct(summary.successfulCoveragePct), detail: "Selected respondents with a successful survey outcome." },
    { label: "ANALYSIS READINESS", value: pct(evidenceReadiness), detail: "Minimum retained evidence supporting interpretation." },
    { label: "OPEN ITERATIONS", value: count(Math.max(summary.iterationCount - summary.completedIterationCount, 0)), detail: "Assigned Iterations still moving through execution." }
  ];
}

function dateTime(value: string | null) {
  if (!value) return "No attempts recorded";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function Metric({
  icon: Icon,
  label,
  value,
  detail
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className={styles.metric}>
      <div><Icon size={19} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Quality({ label, value, detail }: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className={styles.qualityItem}>
      <div><span>{label}</span><strong>{pct(value)}</strong></div>
      <div className={styles.progress}><i style={{ width: `${Math.min(value, 100)}%` }} /></div>
      <small>{detail}</small>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCampaignId, setExpandedCampaignId] = useState("");

  const loadAnalytics = useCallback(async function (refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await apiFetch("/api/analytics") as AnalyticsResponse;
      setData(result);
      setExpandedCampaignId(function (current) {
        return result.campaigns.some((campaign) => campaign.id === current)
          ? current
          : result.campaigns[0]?.id || "";
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Analytics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(function () {
    if (!user) return;
    const timer = window.setTimeout(function () {
      void loadAnalytics();
    }, 0);
    return function () {
      window.clearTimeout(timer);
    };
  }, [loadAnalytics, user]);

  const visibleCampaigns = useMemo(function () {
    const term = search.trim().toLowerCase();
    if (!term) return data?.campaigns || [];
    return (data?.campaigns || []).filter(function (campaign) {
      return [
        campaign.name,
        campaign.code,
        campaign.targetName,
        campaign.programName,
        campaign.campaignManagerName
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [data, search]);

  if (user?.role.code === "CAMPAIGNER") {
    return (
      <AppShell>
        <main className={styles.page}>
          <FeedbackMessage
            tone="error"
            message="Portfolio Analytics is available to Admin, Super Admin and Campaign Manager roles."
          />
        </main>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <main className={styles.loading}>
          <LoaderCircle size={25} className={styles.spin} />
          Preparing research intelligence…
        </main>
      </AppShell>
    );
  }

  const summary = data?.summary;
  const role = user?.role.code || "CAMPAIGN_MANAGER";
  const copy = analyticsCopy(role);
  const roleMetrics = summary ? analyticsMetrics(role, summary) : [];
  const lens = summary ? decisionLens(role, summary) : [];

  return (
    <AppShell>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <span>{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <button type="button" disabled={refreshing} onClick={function () { void loadAnalytics(true); }}>
            <RefreshCw size={16} className={refreshing ? styles.spin : ""} />
            {refreshing ? "Refreshing…" : "Refresh Analytics"}
          </button>
        </header>

        {error && <FeedbackMessage tone="error" message={error} />}

        {data && (
          <>
            <section className={styles.metrics}>
              {roleMetrics.map(function (metric) { return <Metric key={metric.label} {...metric} />; })}
            </section>

            <section className={roleStyles.roleLens}>
              <div className={roleStyles.roleLensIntro}>
                <span>YOUR DECISION LENS</span>
                <h2>{role === "SUPER_ADMIN" ? "Governance signals" : role === "ADMIN" ? "Administrative assurance" : "Campaign research signals"}</h2>
                <p>{role === "CAMPAIGN_MANAGER"
                  ? "Use these signals to decide whether execution is sufficient for directional interpretation and which Iteration needs attention."
                  : "Use these signals to identify lifecycle or evidence exceptions; detailed research interpretation remains in Campaign analysis."}</p>
              </div>
              <div className={roleStyles.lensGrid}>{lens.map(function (item) { return <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><p>{item.detail}</p></article>; })}</div>
            </section>

            <section className={styles.quality}>
              <div className={styles.sectionIntro}>
                <div><span>EVIDENCE QUALITY</span><h2>Analysis readiness</h2></div>
                <p>Coverage is measured independently so operational completion is not mistaken for complete research evidence.</p>
              </div>
              <div className={styles.qualityGrid}>
                <Quality
                  label="Provider callbacks"
                  value={summary?.callbackCoveragePct || 0}
                  detail={`${count(summary?.callbacksReceived || 0)} of ${count(summary?.callAttempts || 0)} attempts reconciled`}
                />
                <Quality
                  label="Connected transcripts"
                  value={summary?.transcriptCoveragePct || 0}
                  detail={`${count(summary?.transcriptsCaptured || 0)} of ${count(summary?.connectedCalls || 0)} connected calls`}
                />
                <Quality
                  label="Structured responses"
                  value={summary?.responseCoveragePct || 0}
                  detail={`${count(summary?.responsesCaptured || 0)} of ${count(summary?.connectedCalls || 0)} connected calls`}
                />
              </div>
            </section>

            <section className={styles.portfolio}>
              <div className={styles.portfolioHead}>
                <div className={styles.sectionIntro}>
                  <div><span>CAMPAIGN → ITERATION</span><h2>Analysis portfolio</h2></div>
                  <p>Select a Campaign to examine each Iteration before opening its detailed findings.</p>
                </div>
                <label className={styles.search}>
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={function (event) { setSearch(event.target.value); }}
                    placeholder="Search Campaign, target or manager"
                  />
                </label>
              </div>

              {!visibleCampaigns.length ? (
                <div className={styles.empty}>
                  <BarChart3 size={25} />
                  <strong>No Campaign analytics available</strong>
                  <span>Adjust the search or confirm that a Campaign is visible to your role.</span>
                </div>
              ) : (
                <div className={styles.campaigns}>
                  {visibleCampaigns.map(function (campaign) {
                    const expanded = campaign.id === expandedCampaignId;
                    return (
                      <article className={styles.campaign} key={campaign.id} data-expanded={expanded}>
                        <button
                          type="button"
                          className={styles.campaignSummary}
                          onClick={function () {
                            setExpandedCampaignId(expanded ? "" : campaign.id);
                          }}
                        >
                          <div className={styles.campaignIdentity}>
                            <div className={styles.campaignIcon}><BarChart3 size={18} /></div>
                            <div>
                              <span>{campaign.code} · {campaign.status}</span>
                              <strong>{campaign.name}</strong>
                              <small>{campaign.targetName}{campaign.targetCode ? ` · ${campaign.targetCode}` : ""}</small>
                            </div>
                          </div>
                          <div className={styles.campaignNumbers}>
                            <div><strong>{campaign.completedIterationCount}/{campaign.iterationCount}</strong><span>Iterations</span></div>
                            <div><strong>{campaign.closedRunCount}/{campaign.runCount}</strong><span>Runs</span></div>
                            <div><strong>{pct(campaign.successfulCoveragePct)}</strong><span>Success</span></div>
                            <div><strong>{pct(campaign.transcriptCoveragePct)}</strong><span>Transcripts</span></div>
                          </div>
                          {expanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}
                        </button>

                        {expanded && (
                          <div className={styles.campaignBody}>
                            <div className={styles.campaignContext}>
                              <span><Users size={14} />{campaign.campaignManagerName || "Manager not assigned"}</span>
                              <span><ShieldCheck size={14} />{campaign.programName || "Standalone Campaign"}</span>
                              <span><Gauge size={14} />{pct(campaign.callbackCoveragePct)} callbacks</span>
                              <Link href={`/analytics/campaigns/${campaign.id}`}>
                                Strategic Analysis <ChevronRight size={15} />
                              </Link>
                            </div>

                            {!campaign.iterations.length ? (
                              <div className={styles.emptyCompact}>No Iterations have been created for this Campaign.</div>
                            ) : (
                              <div className={styles.iterations}>
                                {campaign.iterations.map(function (iteration) {
                                  return (
                                    <article className={styles.iteration} key={iteration.id}>
                                      <div className={styles.iterationTop}>
                                        <div className={styles.iterationNumber}>{iteration.number}</div>
                                        <div>
                                          <span>{iteration.researchPhase} · {iteration.completed ? "COMPLETED" : iteration.status}</span>
                                          <strong>{iteration.name}</strong>
                                          <small>{iteration.questionnaire
                                            ? `${iteration.questionnaire.name} · ${iteration.questionnaire.code}`
                                            : "Questionnaire identity not recorded"}</small>
                                        </div>
                                        {iteration.completed && <CheckCircle2 size={18} className={styles.complete} />}
                                      </div>
                                      <div className={styles.iterationStats}>
                                        <div><strong>{iteration.closedRunCount}/{iteration.runCount}</strong><span>Runs closed</span></div>
                                        <div><strong>{iteration.successfulVoters}/{iteration.selectedVoters}</strong><span>Successful</span></div>
                                        <div><strong>{pct(iteration.callbackCoveragePct)}</strong><span>Callbacks</span></div>
                                        <div><strong>{pct(iteration.transcriptCoveragePct)}</strong><span>Transcripts</span></div>
                                      </div>
                                      <div className={styles.iterationFoot}>
                                        <span><Activity size={14} />Latest call: {dateTime(iteration.latestAttemptAt)}</span>
                                        <Link href={`/analytics/campaigns/${campaign.id}?iterationId=${iteration.id}`}>
                                          View Iteration Analysis <ChevronRight size={15} />
                                        </Link>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <footer className={styles.generated}>
              <FileQuestion size={14} />
              Operational snapshot generated {dateTime(data.generatedAt)}. Detailed pages retain question-level evidence and comparison safeguards.
            </footer>
          </>
        )}
      </main>
    </AppShell>
  );
}
