"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  FileQuestion,
  Lightbulb,
  LoaderCircle,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp
} from "lucide-react";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./strategic.module.css";
import scopeStyles from "./scope.module.css";

type Distribution = {
  value: string;
  respondents: number;
  percentage: number;
};

type QuestionPerformance = {
  code: string;
  label: string;
  section: string;
  required: boolean;
  outputVariables: string[];
  answered: number;
  missing: number;
  answeredPct: number;
  structured: boolean;
  distribution: Distribution[];
  qualitativeAnswers: string[];
};

type IterationSummary = {
  id: string;
  number: number;
  name: string;
  connectedRespondents: number;
};

type RunSummary = {
  id: string;
  iterationId: string;
  number: number;
  name: string;
  status: string;
  selectedVoters: number;
  successfulVoters: number;
  retryEligibleVoters: number;
  callAttempts: number;
  callbacksReceived: number;
  connectedCalls: number;
  transcriptsCaptured: number;
  responsesCaptured: number;
  averageDurationSeconds: number;
  callbackCoveragePct: number;
  transcriptCoveragePct: number;
  responseCoveragePct: number;
};

type AnalysisIteration = IterationSummary & {
  status: string;
  completed: boolean;
  runs: RunSummary[];
};

type CampaignOption = { id: string; code: string; name: string };

type StrategicResponse = {
  campaign: {
    id: string;
    code: string;
    name: string;
    targetName: string;
    surveyStage: string;
    status: string;
  };
  scope: {
    level: "CAMPAIGN" | "ITERATION" | "RUN";
    iteration: IterationSummary | null;
    run: RunSummary | null;
    operations: null | {
      selectedVoters: number;
      successfulVoters: number;
      callAttempts: number;
      callbacksReceived: number;
      connectedCalls: number;
      transcriptsCaptured: number;
      responsesCaptured: number;
      averageDurationSeconds: number;
      callbackCoveragePct: number;
      transcriptCoveragePct: number;
      responseCoveragePct: number;
    };
    interpretation: string;
  };
  options: { iterations: AnalysisIteration[] };
  validity: {
    analysisMode: string;
    representative: boolean;
    predictiveReady: boolean;
    directionalOnly: boolean;
    questionnaireCompatible: boolean;
    minimumRespondentBase: number;
    latestRespondentBase: number;
    latestDemoRespondents: number;
    averageAnswerCoveragePct: number;
    researchDesign: string;
    warnings: string[];
  };
  latestIteration: IterationSummary | null;
  comparison: null | {
    previousIteration: IterationSummary;
    latestIteration: IterationSummary;
    movements: Array<{
      key: string;
      label: string;
      respondentBases: Array<{ iterationId: string; respondents: number }>;
      largestShift: {
        value: string;
        previousPercentage: number;
        latestPercentage: number;
        shiftPercentagePoints: number;
      };
    }>;
  };
  questionPerformance: QuestionPerformance[];
  issueAnalysis: { priorities: Distribution[] };
  candidateAnalysis: {
    awareness: Distribution[];
    criterionFit: Distribution[];
    impression: Distribution[];
    preferredCriterion: Distribution[];
  };
  partyAndInstitutionalAnalysis: {
    roleAwareness: Distribution[];
    incumbentAwareness: Distribution[];
    incumbentAssessment: Distribution[];
    unaidedPartySalience: Distribution[];
    aidedIssueLeader: Distribution[];
    associationInfluence: Distribution[];
    associations: Distribution[];
  };
  transcriptAnalysis: {
    transcriptRespondents: number;
    themes: Array<{
      key: string;
      label: string;
      respondents: number;
      mentions: number;
      evidence: Array<{
        executionId: string | null;
        iterationId: string;
        iterationNumber: number;
        snippet: string;
      }>;
    }>;
  };
  findings: Array<{
    type: string;
    title: string;
    evidence: string;
    caution: string;
  }>;
  generatedAt: string;
};

function pct(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function label(value: string) {
  return String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function DistributionList({ items, empty }: { items: Distribution[]; empty: string }) {
  if (!items.length) return <div className={styles.noSignal}>{empty}</div>;
  return (
    <div className={styles.distribution}>
      {items.slice(0, 7).map(function (item) {
        return (
          <div key={item.value} className={styles.distributionRow}>
            <div><span>{item.value}</span><strong>{pct(item.percentage)}</strong></div>
            <div className={styles.bar}><i style={{ width: `${Math.min(item.percentage, 100)}%` }} /></div>
            <small>{item.respondents} respondent{item.respondents === 1 ? "" : "s"}</small>
          </div>
        );
      })}
    </div>
  );
}

function SignalCard({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className={styles.signalCard}>
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

export default function StrategicCampaignAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const { user } = useCurrentUser();
  const [data, setData] = useState<StrategicResponse | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [iterationId, setIterationId] = useState("");
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStrategic = useCallback(async function (refresh = false) {
    if (!campaignId) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (iterationId) query.set("iterationId", iterationId);
      if (runId) query.set("runId", runId);
      const suffix = query.size ? `?${query.toString()}` : "";
      setData(await apiFetch(`/api/analytics/campaigns/${campaignId}${suffix}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load strategic Analytics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [campaignId, iterationId, runId]);

  useEffect(function () {
    if (!user || !campaignId) return;
    const timer = window.setTimeout(function () {
      void loadStrategic();
    }, 0);
    return function () { window.clearTimeout(timer); };
  }, [campaignId, loadStrategic, user]);

  useEffect(function () {
    if (!user) return;
    void apiFetch("/api/analytics").then(function (workspace) {
      const result = workspace as { campaigns: CampaignOption[] };
      setCampaigns(result.campaigns.map((campaign) => ({
        id: campaign.id,
        code: campaign.code,
        name: campaign.name
      })));
    }).catch(function () {
      setCampaigns([]);
    });
  }, [user]);

  if (loading) {
    return (
      <AppShell>
        <main className={styles.loading}><LoaderCircle className={styles.spin} />Preparing Phase 1 strategic analysis…</main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className={styles.page}>
        <div className={styles.backRow}>
          <Link href="/analytics"><ArrowLeft size={15} />Back to Analytics</Link>
        </div>

        {error && <FeedbackMessage tone="error" message={error} />}

        {data && (
          <>
            <header className={styles.hero}>
              <div>
                <span>STRATEGIC ANALYTICS · PHASE 1</span>
                <h1>{data.campaign.name}</h1>
                <p>{data.campaign.code} · {data.campaign.targetName} · {data.campaign.surveyStage} survey</p>
              </div>
              <div className={styles.heroActions}>
                <Link href={`/campaigns/${campaignId}/analysis`}>Comparative Analysis</Link>
                <button type="button" disabled={refreshing} onClick={function () { void loadStrategic(true); }}>
                  <RefreshCw size={15} className={refreshing ? styles.spin : ""} />
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </header>

            <section className={scopeStyles.scopeSelector}>
              <div className={scopeStyles.scopeIntro}>
                <span>ANALYSIS SCOPE</span>
                <h2>Campaign → Iteration → Run</h2>
                <p>{data.scope.interpretation}</p>
              </div>
              <div className={scopeStyles.scopeControls}>
                <label>
                  <span>Campaign</span>
                  <select value={campaignId} onChange={function (event) {
                    router.push(`/analytics/campaigns/${event.target.value}`);
                  }}>
                    {campaigns.length === 0 && <option value={campaignId}>{data.campaign.name}</option>}
                    {campaigns.map(function (campaign) {
                      return <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.code}</option>;
                    })}
                  </select>
                </label>
                <label>
                  <span>Iteration</span>
                  <select value={iterationId} onChange={function (event) {
                    setIterationId(event.target.value);
                    setRunId("");
                  }}>
                    <option value="">Campaign overview</option>
                    {data.options.iterations.map(function (iteration) {
                      return <option key={iteration.id} value={iteration.id}>Iteration {iteration.number} · {iteration.name}</option>;
                    })}
                  </select>
                </label>
                <label>
                  <span>Run</span>
                  <select value={runId} disabled={!iterationId} onChange={function (event) {
                    setRunId(event.target.value);
                  }}>
                    <option value="">All Runs · deduplicated</option>
                    {(data.options.iterations.find((iteration) => iteration.id === iterationId)?.runs || []).map(function (run) {
                      return <option key={run.id} value={run.id}>Run {run.number} · {run.status}</option>;
                    })}
                  </select>
                </label>
              </div>
            </section>

            {data.scope.operations && (
              <section className={scopeStyles.scopeMetrics} aria-label="Selected analysis scope">
                <article><PhoneCall size={18} /><span>Attempts</span><strong>{data.scope.operations.callAttempts}</strong></article>
                <article><Activity size={18} /><span>Connected</span><strong>{data.scope.operations.connectedCalls}</strong></article>
                <article><MessageSquareText size={18} /><span>Transcripts</span><strong>{pct(data.scope.operations.transcriptCoveragePct)}</strong></article>
                <article><FileQuestion size={18} /><span>Responses</span><strong>{pct(data.scope.operations.responseCoveragePct)}</strong></article>
                <article><Target size={18} /><span>Successful</span><strong>{data.scope.operations.successfulVoters}</strong></article>
                <article><Activity size={18} /><span>Avg duration</span><strong>{Math.round(data.scope.operations.averageDurationSeconds)}s</strong></article>
              </section>
            )}

            <section className={styles.validity}>
              <div className={styles.validityLead}>
                <ShieldAlert size={26} />
                <div>
                  <span>RESEARCH VALIDITY</span>
                  <h2>Directional demo evidence</h2>
                  <p>Use these findings to validate the research workflow and refine the next questionnaire—not to estimate constituency vote share.</p>
                </div>
              </div>
              <div className={styles.validityMetrics}>
                <div><strong>{data.validity.latestRespondentBase}</strong><span>Latest respondent base</span></div>
                <div><strong>{data.validity.latestDemoRespondents}</strong><span>Demo respondents</span></div>
                <div><strong>{pct(data.validity.averageAnswerCoveragePct)}</strong><span>Average answer coverage</span></div>
                <div><strong>{label(data.validity.researchDesign)}</strong><span>Research design</span></div>
              </div>
              <div className={styles.warnings}>
                {data.validity.warnings.map(function (warning) {
                  return <p key={warning}><AlertTriangle size={14} />{warning}</p>;
                })}
              </div>
            </section>

            <section className={styles.findingsSection}>
              <div className={styles.sectionHead}>
                <div><span>DECISION BRIEF</span><h2>Evidence-qualified findings</h2></div>
                <p>Automated summaries retain the respondent base and limitation beside every finding.</p>
              </div>
              {!data.findings.length ? (
                <div className={styles.noSignal}>No finding cards can be generated from the current respondent evidence.</div>
              ) : (
                <div className={styles.findings}>
                  {data.findings.map(function (finding) {
                    return (
                      <article key={`${finding.type}-${finding.title}`}>
                        <div><Lightbulb size={17} /><span>{finding.type}</span></div>
                        <h3>{finding.title}</h3>
                        <strong>{finding.evidence}</strong>
                        <p>{finding.caution}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={styles.signalsSection}>
              <div className={styles.sectionHead}>
                <div><span>{data.scope.level} EVIDENCE</span><h2>Strategic signal explorer</h2></div>
                <p>{data.scope.run
                  ? `Iteration ${data.scope.iteration?.number} · Run ${data.scope.run.number}`
                  : data.latestIteration ? `Iteration ${data.latestIteration.number} · ${data.latestIteration.name}` : "No Iteration evidence available"}</p>
              </div>
              <div className={styles.signals}>
                <SignalCard eyebrow="ISSUES" title="Graduate issue priority">
                  <DistributionList items={data.issueAnalysis.priorities} empty="No coded issue-priority answer is available." />
                </SignalCard>
                <SignalCard eyebrow="CANDIDATE" title="Veeresh prior awareness">
                  <DistributionList items={data.candidateAnalysis.awareness} empty="No candidate-awareness answer is available." />
                </SignalCard>
                <SignalCard eyebrow="CANDIDATE" title="Criterion fit">
                  <DistributionList items={data.candidateAnalysis.criterionFit} empty="No candidate criterion-fit answer is available." />
                </SignalCard>
                <SignalCard eyebrow="CANDIDATE" title="Preferred candidate quality">
                  <DistributionList items={data.candidateAnalysis.preferredCriterion} empty="No preferred-candidate criterion is available." />
                </SignalCard>
                <SignalCard eyebrow="INSTITUTION" title="MLC role awareness">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.roleAwareness} empty="No MLC role-awareness answer is available." />
                </SignalCard>
                <SignalCard eyebrow="INSTITUTION" title="Incumbent awareness">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.incumbentAwareness} empty="No incumbent-awareness answer is available." />
                </SignalCard>
                <SignalCard eyebrow="INSTITUTION" title="Incumbent assessment">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.incumbentAssessment} empty="No incumbent-assessment answer is available." />
                </SignalCard>
                <SignalCard eyebrow="PARTIES" title="Unaided party salience">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.unaidedPartySalience} empty="No unaided party-salience answer is available." />
                </SignalCard>
                <SignalCard eyebrow="PARTIES" title="Aided issue leadership">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.aidedIssueLeader} empty="No aided issue-leadership answer is available." />
                </SignalCard>
                <SignalCard eyebrow="INSTITUTIONS" title="Associations named">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.associations} empty="No student, teacher or graduate association was recorded." />
                </SignalCard>
                <SignalCard eyebrow="INSTITUTIONS" title="Association influence">
                  <DistributionList items={data.partyAndInstitutionalAnalysis.associationInfluence} empty="No association-influence answer is available." />
                </SignalCard>
              </div>
            </section>

            <section className={styles.movementSection}>
              <div className={styles.sectionHead}>
                <div><span>WAVE MOVEMENT</span><h2>Iteration-to-Iteration change</h2></div>
                <p>Only shared, structured variables are compared.</p>
              </div>
              {!data.comparison ? (
                <div className={styles.noSignal}>Two completed, comparable Iterations are required before movement can be assessed.</div>
              ) : !data.comparison.movements.length ? (
                <div className={styles.noSignal}>No shared structured response variable has a comparable respondent base.</div>
              ) : (
                <div className={styles.movements}>
                  {data.comparison.movements.map(function (movement) {
                    const shift = movement.largestShift.shiftPercentagePoints;
                    return (
                      <article key={movement.key}>
                        <div>
                          <TrendingUp size={16} />
                          <span>{movement.label}</span>
                          <em data-direction={shift > 0 ? "up" : shift < 0 ? "down" : "flat"}>{shift > 0 ? "+" : ""}{shift.toFixed(1)} pp</em>
                        </div>
                        <strong>{movement.largestShift.value}</strong>
                        <p>{pct(movement.largestShift.previousPercentage)} → {pct(movement.largestShift.latestPercentage)}</p>
                        <small>Bases: {movement.respondentBases.map((base) => base.respondents).join(" → ")}</small>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={styles.questionSection}>
              <div className={styles.sectionHead}>
                <div><span>QUESTIONNAIRE QUALITY</span><h2>Answer and missing-data performance</h2></div>
                <p>Low coverage indicates wording, conditional logic or agent probing that should be reviewed.</p>
              </div>
              {!data.questionPerformance.length ? (
                <div className={styles.noSignal}>No structured response variables were captured for the latest Iteration.</div>
              ) : (
                <div className={styles.questionTable}>
                  <div className={styles.questionHeader}><span>Question</span><span>Section</span><span>Answered</span><span>Missing</span><span>Coverage</span></div>
                  {data.questionPerformance.map(function (question) {
                    return (
                      <div className={styles.questionRow} key={question.code}>
                        <div><strong>{question.label}</strong><small>{question.code}{question.required ? " · Required" : " · Conditional"}</small></div>
                        <span>{question.section}</span>
                        <strong>{question.answered}</strong>
                        <strong>{question.missing}</strong>
                        <div className={styles.coverage}><strong>{pct(question.answeredPct)}</strong><div><i style={{ width: `${Math.min(question.answeredPct, 100)}%` }} /></div></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={styles.transcriptSection}>
              <div className={styles.sectionHead}>
                <div><span>TRANSCRIPT INTELLIGENCE</span><h2>Recurring evidence themes</h2></div>
                <p>{data.transcriptAnalysis.transcriptRespondents} respondent transcripts contributed to this deterministic theme scan.</p>
              </div>
              {!data.transcriptAnalysis.themes.length ? (
                <div className={styles.noSignal}>No configured theme was detected in the available transcripts.</div>
              ) : (
                <div className={styles.themes}>
                  {data.transcriptAnalysis.themes.map(function (theme) {
                    return (
                      <article key={theme.key}>
                        <header><div><MessageSquareText size={17} /><strong>{theme.label}</strong></div><span>{theme.respondents} respondents · {theme.mentions} mentions</span></header>
                        <div className={styles.evidence}>
                          {theme.evidence.map(function (item, index) {
                            const content = <><q>{item.snippet}</q><span>Iteration {item.iterationNumber} · Review evidence <ChevronRight size={13} /></span></>;
                            return item.executionId ? (
                              <Link key={`${theme.key}-${item.executionId}-${index}`} href={`/calls?executionId=${item.executionId}&iterationId=${item.iterationId}`}>{content}</Link>
                            ) : (
                              <div key={`${theme.key}-${item.iterationId}-${index}`}>{content}</div>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <nav className={styles.nextLinks}>
              <Link href={`/campaigns/${campaignId}/analysis`}><BarChart3 size={17} /><span><strong>Comparative Analysis</strong><small>Inspect question-level movement and readiness safeguards.</small></span><ChevronRight /></Link>
              {data.latestIteration && <Link href={`/iterations/${data.latestIteration.id}/analysis`}><Target size={17} /><span><strong>Iteration Analysis</strong><small>Inspect Run outcomes and questionnaire evidence.</small></span><ChevronRight /></Link>}
              <Link href="/calls"><Activity size={17} /><span><strong>Call Evidence</strong><small>Review individual attempts, transcripts and response variables.</small></span><ChevronRight /></Link>
            </nav>

            <footer className={styles.generated}><FileQuestion size={14} />Generated from stored platform evidence. No vote-choice prediction or individual propensity score is produced.</footer>
          </>
        )}
      </main>
    </AppShell>
  );
}
