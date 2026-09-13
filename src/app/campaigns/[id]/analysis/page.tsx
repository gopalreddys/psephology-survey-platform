"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  FlaskConical,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp,
  Users
} from "lucide-react";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./analysis.module.css";

type IterationEvidence = {
  id: string;
  number: number;
  name: string;
  researchPhase: string;
  status: string;
  completed: boolean;
  targetSample: number;
  questionnaireId: string | null;
  questionnaireCode: string | null;
  questionnaireName: string | null;
  runCount: number;
  closedRunCount: number;
  selectedVoters: number;
  successfulVoters: number;
  retryExhaustedVoters: number;
  pendingVoters: number;
  callAttempts: number;
  callbacksReceived: number;
  connectedRespondents: number;
  demoRespondents: number;
  transcriptsCaptured: number;
  responsesCaptured: number;
  averageDurationSeconds: number;
  successfulCoveragePct: number;
};

type DistributionValue = {
  value: string;
  respondents: number;
  percentage: number;
};

type QuestionIteration = {
  iterationId: string;
  totalRespondents: number;
  values: DistributionValue[];
};

type ComparisonQuestion = {
  key: string;
  label: string;
  comparable: boolean;
  structuredCategory: boolean;
  suppressionReason: string | null;
  distinctValueCount: number;
  iterations: QuestionIteration[];
  largestShift: {
    value: string;
    previousPercentage: number;
    latestPercentage: number;
    shiftPercentagePoints: number;
  } | null;
};

type CampaignAnalysis = {
  campaign: {
    id: string;
    code: string;
    name: string;
    programName: string | null;
    targetType: string;
    targetName: string;
    targetCode: string | null;
    surveyStage: string;
    status: string;
    campaignManagerName: string | null;
  };
  summary: {
    iterationCount: number;
    completedIterationCount: number;
    comparisonIterationCount: number;
    comparableQuestionCount: number;
    sentimentSignalCount: number;
  };
  readiness: {
    ready: boolean;
    analysisMode: string;
    representative: boolean;
    predictiveReady: boolean;
    questionnaireCompatible: boolean;
    comparableQuestionCount: number;
    minimumRespondentBase: number;
    demoRespondents: number;
    overlappingRespondents: number;
    researchDesign: string;
    warnings: string[];
  };
  iterations: IterationEvidence[];
  comparison: {
    previousIteration: IterationEvidence;
    latestIteration: IterationEvidence;
    questions: ComparisonQuestion[];
    sentimentSignals: string[];
  } | null;
  generatedAt: string;
};

export default function CampaignAnalysisPage() {
  const params = useParams();
  const campaignId = params.id as string;
  const { user } = useCurrentUser();
  const [analysis, setAnalysis] = useState<CampaignAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnalysis = useCallback(async function (refresh = false) {
    if (!campaignId) return;
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await apiFetch(
        `/api/campaigns/${campaignId}/analysis`
      );
      setAnalysis(result);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load Campaign comparative analysis"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [campaignId]);

  useEffect(function () {
    if (!user || !campaignId) return;

    const timer = window.setTimeout(function () {
      void loadAnalysis();
    }, 0);

    return function () {
      window.clearTimeout(timer);
    };
  }, [campaignId, loadAnalysis, user]);

  if (user?.role.code === "CAMPAIGNER") {
    return (
      <AppShell>
        <div className={styles.page}>
          <FeedbackMessage
            tone="error"
            message="Campaign comparative intelligence is available to Admin, Super Admin and the assigned Campaign Manager."
          />
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className={styles.loading}>Preparing Campaign comparison…</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <div className={styles.backRow}>
          <Link href={`/campaigns/${campaignId}`}>
            <ArrowLeft size={16} />
            Back to Campaign
          </Link>
        </div>

        {error && (
          <FeedbackMessage tone="error" message={error} />
        )}

        {analysis && (
          <>
            <header className={styles.hero}>
              <div>
                <span>CAMPAIGN RESEARCH INTELLIGENCE</span>
                <h1>Comparative Analysis</h1>
                <p>
                  {analysis.campaign.name} · {analysis.campaign.targetName}
                  {analysis.campaign.targetCode
                    ? ` · ${analysis.campaign.targetCode}`
                    : ""}
                </p>
              </div>

              <button
                type="button"
                disabled={refreshing}
                onClick={function () {
                  loadAnalysis(true);
                }}
              >
                <RefreshCw size={16} />
                {refreshing ? "Refreshing…" : "Refresh Analysis"}
              </button>
            </header>

            <section className={styles.modeBanner}>
              <div className={styles.modeIcon}>
                {analysis.readiness.analysisMode === "NOT_READY"
                  ? <ShieldAlert size={22} />
                  : <FlaskConical size={22} />}
              </div>
              <div>
                <span>RESEARCH INTERPRETATION</span>
                <strong>{analysisModeLabel(analysis.readiness.analysisMode)}</strong>
                <p>{researchDesignDescription(analysis.readiness.researchDesign)}</p>
              </div>
              <em>{formatLabel(analysis.readiness.researchDesign)}</em>
            </section>

            <section className={styles.metrics}>
              <Metric
                icon={CheckCircle2}
                label="Completed Iterations"
                value={`${analysis.summary.completedIterationCount} / ${analysis.summary.iterationCount}`}
              />
              <Metric
                icon={MessageSquareText}
                label="Comparable Signals"
                value={analysis.summary.comparableQuestionCount}
              />
              <Metric
                icon={Users}
                label="Minimum Base"
                value={analysis.readiness.minimumRespondentBase}
              />
              <Metric
                icon={Activity}
                label="Recontact Overlap"
                value={analysis.readiness.overlappingRespondents}
              />
              <Metric
                icon={TrendingUp}
                label="Predictive Status"
                value={analysis.readiness.predictiveReady ? "Ready" : "Not ready"}
              />
            </section>

            <section className={styles.guardrailPanel}>
              <div className={styles.sectionHeader}>
                <div>
                  <span>DATA READINESS AND COMPATIBILITY</span>
                  <h2>Evidence guardrails</h2>
                  <p>
                    Quality controls applied before any Iteration movement is interpreted.
                  </p>
                </div>
                <strong className={analysis.readiness.ready ? styles.ready : styles.blocked}>
                  {analysis.readiness.ready ? "Directional comparison ready" : "Comparison not ready"}
                </strong>
              </div>

              <div className={styles.checkGrid}>
                <ReadinessCheck
                  passed={analysis.summary.completedIterationCount >= 2}
                  label="Two completed Iterations"
                />
                <ReadinessCheck
                  passed={analysis.readiness.questionnaireCompatible}
                  label="Questionnaire identity matched"
                />
                <ReadinessCheck
                  passed={analysis.readiness.comparableQuestionCount > 0}
                  label="Shared structured variables"
                />
                <ReadinessCheck
                  passed={analysis.readiness.demoRespondents === 0}
                  label="Production respondent cohort"
                />
              </div>

              <div className={styles.warningList}>
                {analysis.readiness.warnings.map(function (warning) {
                  return (
                    <div key={warning}>
                      <ShieldAlert size={15} />
                      <span>{warning}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {analysis.comparison ? (
              <>
                <section className={styles.iterationPanel}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <span>ITERATION-TO-ITERATION MOVEMENT</span>
                      <h2>Coverage and evidence comparison</h2>
                      <p>The two most recent completed Iterations are compared.</p>
                    </div>
                  </div>

                  <div className={styles.iterationGrid}>
                    <IterationCard
                      label="Previous Iteration"
                      iteration={analysis.comparison.previousIteration}
                    />
                    <div className={styles.movementArrow}>
                      <TrendingUp size={22} />
                      <span>Movement</span>
                    </div>
                    <IterationCard
                      label="Latest Iteration"
                      iteration={analysis.comparison.latestIteration}
                    />
                  </div>
                </section>

                <section className={styles.movementPanel}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <span>STRUCTURED RESPONSE MOVEMENT</span>
                      <h2>Shared voter signals</h2>
                      <p>
                        Percentage-point movement is shown only for bounded,
                        comparable response variables.
                      </p>
                    </div>
                    <strong>
                      {analysis.readiness.comparableQuestionCount} signals
                    </strong>
                  </div>

                  {analysis.comparison.questions.some(
                    (question) => question.comparable
                  ) ? (
                    <div className={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Signal</th>
                            <th>Previous</th>
                            <th>Latest</th>
                            <th>Largest movement</th>
                            <th>Base</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.comparison.questions
                            .filter((question) => question.comparable)
                            .map(function (question) {
                              const previous = distributionFor(
                                question,
                                analysis.comparison!.previousIteration.id
                              );
                              const latest = distributionFor(
                                question,
                                analysis.comparison!.latestIteration.id
                              );
                              return (
                                <tr key={question.key}>
                                  <td>
                                    <strong>{question.label}</strong>
                                    <small>{question.key}</small>
                                  </td>
                                  <td>{topResponse(previous)}</td>
                                  <td>{topResponse(latest)}</td>
                                  <td>
                                    <MovementBadge movement={question.largestShift} />
                                  </td>
                                  <td>
                                    n={previous?.totalRespondents || 0} → n={latest?.totalRespondents || 0}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.emptyState}>
                      No shared categorical response variables are available yet.
                    </div>
                  )}
                </section>

                <section className={styles.intelligenceGrid}>
                  <article>
                    <BarChart3 size={21} />
                    <span>SENTIMENT READINESS</span>
                    <h3>
                      {analysis.summary.sentimentSignalCount
                        ? `${analysis.summary.sentimentSignalCount} structured sentiment signals`
                        : "No normalized sentiment signal"}
                    </h3>
                    <p>
                      {analysis.summary.sentimentSignalCount
                        ? "Sentiment movement is included above and remains directional under the present sample controls."
                        : "Add a bounded sentiment, mood, approval or trust output variable to the questionnaire before producing sentiment trends."}
                    </p>
                  </article>

                  <article>
                    <Target size={21} />
                    <span>PREDICTIVE READINESS</span>
                    <h3>Prediction remains intentionally locked</h3>
                    <p>
                      Activate only after representative sampling, weighting,
                      design-effect calculation, three or more comparable waves
                      and a validated outcome target are available.
                    </p>
                  </article>
                </section>
              </>
            ) : (
              <section className={styles.emptyState}>
                <BarChart3 size={28} />
                <strong>Two completed Iterations are required</strong>
                <span>
                  Complete another comparable Iteration before calculating movement.
                </span>
              </section>
            )}

            <footer className={styles.footer}>
              Generated from AWS-stored callbacks, transcripts and structured
              response variables at {new Date(analysis.generatedAt).toLocaleString()}.
            </footer>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className={styles.metric}>
      <span><Icon size={18} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function ReadinessCheck({ passed, label }: { passed: boolean; label: string }) {
  return (
    <div className={passed ? styles.checkPassed : styles.checkWarning}>
      {passed ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}
      <span>{label}</span>
    </div>
  );
}

function IterationCard({
  label,
  iteration
}: {
  label: string;
  iteration: IterationEvidence;
}) {
  return (
    <article className={styles.iterationCard}>
      <span>{label}</span>
      <h3>{iteration.name}</h3>
      <small>
        Iteration {iteration.number} · {formatLabel(iteration.researchPhase)} · {iteration.questionnaireCode || "Questionnaire not identified"}
      </small>
      <div className={styles.iterationFacts}>
        <div><span>Target</span><strong>{iteration.targetSample}</strong></div>
        <div><span>Successful</span><strong>{iteration.successfulVoters}</strong></div>
        <div><span>Coverage</span><strong>{iteration.successfulCoveragePct}%</strong></div>
        <div><span>Callbacks</span><strong>{iteration.callbacksReceived}/{iteration.callAttempts}</strong></div>
        <div><span>Transcripts</span><strong>{iteration.transcriptsCaptured}</strong></div>
        <div><span>Avg. duration</span><strong>{formatDuration(iteration.averageDurationSeconds)}</strong></div>
      </div>
      <div className={styles.coverageTrack}>
        <span style={{ width: `${Math.min(iteration.successfulCoveragePct, 100)}%` }} />
      </div>
    </article>
  );
}

function distributionFor(question: ComparisonQuestion, iterationId: string) {
  return question.iterations.find(
    (iteration) => iteration.iterationId === iterationId
  );
}

function topResponse(distribution?: QuestionIteration) {
  const top = distribution?.values[0];
  if (!top) return "—";
  return `${top.value} · ${top.percentage}%`;
}

function MovementBadge({
  movement
}: {
  movement: ComparisonQuestion["largestShift"];
}) {
  if (!movement) return <span>—</span>;
  const shift = movement.shiftPercentagePoints;
  return (
    <span className={shift === 0 ? styles.flat : shift > 0 ? styles.up : styles.down}>
      {movement.value} · {shift > 0 ? "+" : ""}{shift} pp
    </span>
  );
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function analysisModeLabel(mode: string) {
  if (mode === "DEMO_DIRECTIONAL") {
    return "Directional demo comparison";
  }
  if (mode === "UNWEIGHTED_DIRECTIONAL") {
    return "Directional unweighted comparison";
  }
  return "Comparison prerequisites not yet satisfied";
}

function researchDesignDescription(design: string) {
  if (design === "PANEL_RECONTACT") {
    return "The same successful respondents appear across both Iterations; interpret change as within-panel movement.";
  }
  if (design === "MIXED_RECONTACT") {
    return "The Iterations contain a mix of returning and new respondents; segment them before formal inference.";
  }
  if (design === "REPEATED_CROSS_SECTION") {
    return "No successful respondent overlap was detected between the two completed Iterations.";
  }
  return "Complete two Iterations with shared structured response variables to establish the comparison design.";
}
