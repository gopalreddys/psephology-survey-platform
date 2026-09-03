"use client";

import {
  useEffect,
  useState
} from "react";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CircleDot,
  FileQuestion,
  Gauge,
  Layers3,
  RefreshCw,
  RotateCcw,
  Target,
  Users
} from "lucide-react";

import {
  useParams,
  useRouter
} from "next/navigation";

import AppShell
  from "@/components/AppShell";

import {
  apiFetch
} from "@/lib/api";


type Coverage = {
  iteration: {
    id: string;
    number: number;
    name: string;
    status: string;
  };

  targetVoters: number;
  selectedVoters: number;
  attemptedVoters: number;
  successfulSurveys: number;
  partialSurveys: number;
  retryPending: number;
  retryExhausted: number;
  terminalOutcomes: number;
  untouchedVoters: number;
  remainingVoters: number;
  attemptPct: number;
  coveragePct: number;
  completionPct: number;
};


type QuestionAnalysis = {
  questionId: string;
  questionOrder: number;
  questionCode: string;
  questionText: string;
  questionType: string;
  required: boolean;
  analysisCategory: string | null;
  respondentCount: number;
  evaluatedCount: number;
  answeredCount: number;
  answeredPct: number;
};


type QuestionnaireAnalysis = {
  iterationId: string;
  questionnaireId: string | null;
  respondentCount: number;
  questions: QuestionAnalysis[];
};


export default function AnalysisPage() {

  const params =
    useParams();

  const router =
    useRouter();

  const iterationId =
    params.id as string;


  const [
    coverage,
    setCoverage
  ] =
    useState<Coverage | null>(
      null
    );

  const [
    questionnaire,
    setQuestionnaire
  ] =
    useState<QuestionnaireAnalysis | null>(
      null
    );

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    error,
    setError
  ] =
    useState<string | null>(
      null
    );


  async function loadAnalysis() {

    setLoading(true);
    setError(null);

    try {

      const [
        coverageData,
        questionnaireData
      ] =
        await Promise.all([

          apiFetch(
            `/api/iterations/${iterationId}/coverage`
          ),

          apiFetch(
            `/api/iterations/${iterationId}/questionnaire-analysis`
          )
        ]);

      setCoverage(
        coverageData
      );

      setQuestionnaire(
        questionnaireData
      );

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load analysis"
      );

    } finally {

      setLoading(false);
    }
  }


  useEffect(
    function () {

      if (iterationId) {
        loadAnalysis();
      }

    },
    [iterationId]
  );


  if (loading) {

    return (
      <AppShell>

        <div className="analysis-workbench-loading">
          Loading analysis...
        </div>

      </AppShell>
    );
  }


  return (
    <AppShell>

      <div className="analysis-workbench-page">

        <button
          type="button"

          onClick={
            function () {
              router.push(
                `/iterations/${iterationId}`
              );
            }
          }

          className="analysis-workbench-back"
        >
          <ArrowLeft size={15} />
          Back to Iteration
        </button>


        <section className="analysis-workbench-header">

          <div>

            <div className="analysis-workbench-eyebrow">
              RESEARCH INTELLIGENCE
            </div>

            <h1>
              Survey Analysis
            </h1>

            {
              coverage && (

                <div className="analysis-workbench-context">

                  <span>
                    Iteration {coverage.iteration.number}
                  </span>

                  <strong>
                    {coverage.iteration.name}
                  </strong>

                  <span className="analysis-workbench-status">
                    {
                      formatLabel(
                        coverage.iteration.status
                      )
                    }
                  </span>

                </div>

              )
            }

            <p>
              Evaluate survey coverage and the
              question-level evidence captured from
              analyzed conversations.
            </p>

          </div>


          <button
            type="button"

            onClick={
              loadAnalysis
            }

            className="analysis-refresh-button"
          >
            <RefreshCw size={15} />
            Refresh Analysis
          </button>

        </section>


        {error && (

          <div className="analysis-workbench-error">
            {error}
          </div>

        )}


        {coverage && (

          <>

            <section className="analysis-primary-grid">

              <AnalysisMetric
                icon={Target}
                label="Target Voters"
                value={
                  coverage.targetVoters
                }
                detail={
                  `${coverage.selectedVoters} selected`
                }
              />

              <AnalysisMetric
                icon={Activity}
                label="Attempted"
                value={
                  coverage.attemptedVoters
                }
                detail={
                  `${coverage.attemptPct}% of target`
                }
              />

              <AnalysisMetric
                icon={CheckCircle2}
                label="Successful Surveys"
                value={
                  coverage.successfulSurveys
                }
                detail={
                  `${coverage.coveragePct}% coverage`
                }
                emphasis
              />

              <AnalysisMetric
                icon={Users}
                label="Remaining"
                value={
                  coverage.remainingVoters
                }
                detail="Target still to complete"
              />

            </section>


            <section className="analysis-health-panel">

              <div className="analysis-section-heading">

                <div>

                  <div className="analysis-workbench-eyebrow">
                    SURVEY HEALTH
                  </div>

                  <h2>
                    Iteration Coverage
                  </h2>

                  <p>
                    Operational progress across the
                    target population for this research iteration.
                  </p>

                </div>


                <div className="analysis-coverage-value">

                  <strong>
                    {coverage.coveragePct}%
                  </strong>

                  <span>
                    successful coverage
                  </span>

                </div>

              </div>


              <div className="analysis-progress-track">

                <div
                  className="analysis-progress-fill"

                  style={{
                    width:
                      `${Math.min(
                        coverage.coveragePct,
                        100
                      )}%`
                  }}
                />

              </div>


              <div className="analysis-progress-caption">

                <span>
                  {coverage.successfulSurveys}
                  {" of "}
                  {coverage.targetVoters}
                  {" target voters successfully surveyed"}
                </span>

                <span>
                  {coverage.remainingVoters}
                  {" remaining"}
                </span>

              </div>


              <div className="analysis-secondary-grid">

                <SmallMetric
                  icon={CircleDot}
                  label="Partial Surveys"
                  value={
                    coverage.partialSurveys
                  }
                />

                <SmallMetric
                  icon={RotateCcw}
                  label="Retry Pending"
                  value={
                    coverage.retryPending
                  }
                />

                <SmallMetric
                  icon={RotateCcw}
                  label="Retry Exhausted"
                  value={
                    coverage.retryExhausted
                  }
                />

                <SmallMetric
                  icon={Users}
                  label="Untouched"
                  value={
                    coverage.untouchedVoters
                  }
                />

                <SmallMetric
                  icon={Layers3}
                  label="Terminal Outcomes"
                  value={
                    coverage.terminalOutcomes
                  }
                />

                <SmallMetric
                  icon={Gauge}
                  label="Completion"
                  value={
                    `${coverage.completionPct}%`
                  }
                />

              </div>

            </section>


            <section className="analysis-evidence-panel">

              <div className="analysis-evidence-header">

                <div>

                  <div className="analysis-workbench-eyebrow">
                    QUESTION-LEVEL EVIDENCE
                  </div>

                  <h2>
                    Questionnaire Completion
                  </h2>

                  <p>
                    Evidence coverage derived from
                    analyzed survey conversations.
                  </p>

                </div>


                <div className="analysis-respondent-count">

                  <FileQuestion size={17} />

                  <div>
                    <span>Respondents analyzed</span>
                    <strong>
                      {
                        questionnaire
                          ?.respondentCount ||
                        0
                      }
                    </strong>
                  </div>

                </div>

              </div>


              <div className="analysis-question-table-wrap">

                <table className="analysis-question-table">

                  <thead>

                    <tr>

                      <th>
                        #
                      </th>

                      <th>
                        Research Question
                      </th>

                      <th>
                        Category
                      </th>

                      <th>
                        Type
                      </th>

                      <th className="numeric">
                        Answered
                      </th>

                      <th className="numeric">
                        Completion
                      </th>

                    </tr>

                  </thead>


                  <tbody>

                    {
                      questionnaire?.questions.map(
                        function (question) {

                          return (

                            <tr
                              key={
                                question.questionId
                              }
                            >

                              <td>

                                <span className="analysis-question-number">
                                  Q{question.questionOrder}
                                </span>

                              </td>


                              <td>

                                <div className="analysis-question-text">
                                  {question.questionText}
                                </div>

                                <div className="analysis-question-meta">

                                  <span>
                                    {question.questionCode}
                                  </span>

                                  <span>
                                    {
                                      question.required
                                        ? "Required"
                                        : "Optional"
                                    }
                                  </span>

                                </div>

                              </td>


                              <td>

                                <span className="analysis-category-badge">
                                  {
                                    formatLabel(
                                      question.analysisCategory ||
                                      "GENERAL"
                                    )
                                  }
                                </span>

                              </td>


                              <td>

                                <span className="analysis-type-label">
                                  {
                                    formatLabel(
                                      question.questionType
                                    )
                                  }
                                </span>

                              </td>


                              <td className="numeric">

                                <strong>
                                  {question.answeredCount}
                                </strong>

                                <span className="analysis-denominator">
                                  {" / "}
                                  {question.respondentCount}
                                </span>

                              </td>


                              <td className="numeric">

                                <CompletionBadge
                                  value={
                                    question.answeredPct
                                  }
                                />

                              </td>

                            </tr>

                          );
                        }
                      )
                    }

                  </tbody>

                </table>

              </div>

            </section>


            <section className="analysis-future-grid">

              <FutureModule
                icon={BarChart3}
                title="Voter Pulse"
                description="Aggregate mood, government evaluation and political signals."
              />

              <FutureModule
                icon={Layers3}
                title="Issue Intelligence"
                description="Rank concerns and development priorities by geography."
              />

              <FutureModule
                icon={Activity}
                title="Comparative Analysis"
                description="Compare iterations, Mandals, villages and demographic cohorts."
              />

            </section>


            <div className="analysis-future-note">
              Advanced intelligence modules will activate
              when their analysis datasets are available.
              Current metrics above are derived from live
              survey coverage and question-level evidence.
            </div>

          </>

        )}

      </div>

    </AppShell>
  );
}


function AnalysisMetric({
  icon: Icon,
  label,
  value,
  detail,
  emphasis = false
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  detail?: string;
  emphasis?: boolean;
}) {

  return (

    <div
      className={
        emphasis
          ? "analysis-primary-card emphasis"
          : "analysis-primary-card"
      }
    >

      <div className="analysis-primary-icon">
        <Icon size={17} />
      </div>

      <div className="analysis-primary-content">

        <span>
          {label}
        </span>

        <strong>
          {value}
        </strong>

        {
          detail && (
            <small>
              {detail}
            </small>
          )
        }

      </div>

    </div>
  );
}


function SmallMetric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {

  return (

    <div className="analysis-small-metric">

      <Icon size={15} />

      <div>

        <span>
          {label}
        </span>

        <strong>
          {value}
        </strong>

      </div>

    </div>
  );
}


function CompletionBadge({
  value
}: {
  value: number;
}) {

  let level =
    "low";

  if (value >= 80) {
    level = "high";
  } else if (value >= 50) {
    level = "medium";
  }

  return (

    <span
      className={
        `analysis-completion-badge ${level}`
      }
    >
      {value}%
    </span>
  );
}


function FutureModule({
  icon: Icon,
  title,
  description
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {

  return (

    <div className="analysis-future-module">

      <div className="analysis-future-icon">
        <Icon size={17} />
      </div>

      <div>

        <div className="analysis-future-title">

          <strong>
            {title}
          </strong>

          <span>
            Planned
          </span>

        </div>

        <p>
          {description}
        </p>

      </div>

    </div>
  );
}


function formatLabel(
  value: string
) {

  if (!value) {
    return "-";
  }

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(
      /\b\w/g,
      function (character) {
        return character.toUpperCase();
      }
    );
}
