"use client";

import {
  useEffect,
  useState
} from "react";

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


function MetricCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {

  return (
    <div
      className="
        rounded-xl
        border
        border-slate-200
        bg-white
        p-5
        shadow-sm
      "
    >
      <div
        className="
          text-sm
          font-medium
          text-slate-500
        "
      >
        {label}
      </div>

      <div
        className="
          mt-2
          text-3xl
          font-semibold
          text-slate-900
        "
      >
        {value}
      </div>

      {detail && (
        <div
          className="
            mt-1
            text-xs
            text-slate-500
          "
        >
          {detail}
        </div>
      )}
    </div>
  );
}


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

    setLoading(
      true
    );

    setError(
      null
    );

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

      setLoading(
        false
      );
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

        <div
          className="
            p-8
            text-sm
            text-slate-500
          "
        >
          Loading analysis...
        </div>

      </AppShell>
    );
  }


  return (
    <AppShell>

      <div
        className="
          mx-auto
          max-w-7xl
          p-8
        "
      >

        <div
          className="
            flex
            items-start
            justify-between
            gap-6
          "
        >

          <div>

            <button
              onClick={
                () =>
                  router.push(
                    `/iterations/${iterationId}`
                  )
              }
              className="
                mb-3
                text-sm
                text-slate-500
                hover:text-slate-900
              "
            >
              ← Back to Iteration
            </button>

            <h1
              className="
                text-3xl
                font-semibold
                text-slate-900
              "
            >
              Survey Analysis
            </h1>

            {coverage && (
              <p
                className="
                  mt-2
                  text-sm
                  text-slate-500
                "
              >
                Iteration {coverage.iteration.number}
                {" · "}
                {coverage.iteration.name}
              </p>
            )}

          </div>


          <button
            onClick={
              loadAnalysis
            }
            className="
              rounded-lg
              border
              border-slate-300
              bg-white
              px-4
              py-2
              text-sm
              font-medium
              text-slate-700
              hover:bg-slate-50
            "
          >
            Refresh
          </button>

        </div>


        {error && (

          <div
            className="
              mt-6
              rounded-lg
              border
              border-red-200
              bg-red-50
              p-4
              text-sm
              text-red-700
            "
          >
            {error}
          </div>
        )}


        {coverage && (

          <>
            <section
              className="mt-8"
            >

              <div
                className="
                  mb-4
                  flex
                  items-end
                  justify-between
                "
              >

                <div>

                  <h2
                    className="
                      text-xl
                      font-semibold
                      text-slate-900
                    "
                  >
                    Survey Health
                  </h2>

                  <p
                    className="
                      mt-1
                      text-sm
                      text-slate-500
                    "
                  >
                    Operational progress for this iteration
                  </p>

                </div>

              </div>


              <div
                className="
                  grid
                  grid-cols-1
                  gap-4
                  md:grid-cols-2
                  xl:grid-cols-4
                "
              >

                <MetricCard
                  label="Target Voters"
                  value={
                    coverage.targetVoters
                  }
                  detail={
                    `${coverage.selectedVoters} selected`
                  }
                />

                <MetricCard
                  label="Attempted"
                  value={
                    coverage.attemptedVoters
                  }
                  detail={
                    `${coverage.attemptPct}% of target`
                  }
                />

                <MetricCard
                  label="Successful Surveys"
                  value={
                    coverage.successfulSurveys
                  }
                  detail={
                    `${coverage.coveragePct}% coverage`
                  }
                />

                <MetricCard
                  label="Remaining"
                  value={
                    coverage.remainingVoters
                  }
                  detail="Target still to complete"
                />

              </div>


              <div
                className="
                  mt-4
                  grid
                  grid-cols-1
                  gap-4
                  md:grid-cols-2
                  xl:grid-cols-4
                "
              >

                <MetricCard
                  label="Partial Surveys"
                  value={
                    coverage.partialSurveys
                  }
                />

                <MetricCard
                  label="Retry Pending"
                  value={
                    coverage.retryPending
                  }
                />

                <MetricCard
                  label="Retry Exhausted"
                  value={
                    coverage.retryExhausted
                  }
                />

                <MetricCard
                  label="Untouched"
                  value={
                    coverage.untouchedVoters
                  }
                />

              </div>


              <div
                className="
                  mt-4
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  p-5
                  shadow-sm
                "
              >

                <div
                  className="
                    flex
                    items-center
                    justify-between
                  "
                >

                  <span
                    className="
                      text-sm
                      font-medium
                      text-slate-700
                    "
                  >
                    Iteration Coverage
                  </span>

                  <span
                    className="
                      text-sm
                      font-semibold
                      text-slate-900
                    "
                  >
                    {coverage.coveragePct}%
                  </span>

                </div>


                <div
                  className="
                    mt-3
                    h-3
                    overflow-hidden
                    rounded-full
                    bg-slate-100
                  "
                >

                  <div
                    className="
                      h-full
                      rounded-full
                      bg-slate-900
                    "
                    style={{
                      width:
                        `${Math.min(
                          coverage.coveragePct,
                          100
                        )}%`
                    }}
                  />

                </div>

                <div
                  className="
                    mt-2
                    text-xs
                    text-slate-500
                  "
                >
                  {coverage.successfulSurveys}
                  {" of "}
                  {coverage.targetVoters}
                  {" target voters successfully surveyed"}
                </div>

              </div>

            </section>


            <section
              className="mt-10"
            >

              <div>

                <h2
                  className="
                    text-xl
                    font-semibold
                    text-slate-900
                  "
                >
                  Questionnaire Completion
                </h2>

                <p
                  className="
                    mt-1
                    text-sm
                    text-slate-500
                  "
                >
                  Question-level evidence captured from analyzed conversations
                </p>

              </div>


              <div
                className="
                  mt-4
                  overflow-hidden
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  shadow-sm
                "
              >

                <div
                  className="
                    border-b
                    border-slate-200
                    px-5
                    py-4
                    text-sm
                    text-slate-600
                  "
                >
                  Respondents analyzed:
                  {" "}
                  <span
                    className="
                      font-semibold
                      text-slate-900
                    "
                  >
                    {questionnaire?.respondentCount || 0}
                  </span>
                </div>


                <div
                  className="overflow-x-auto"
                >

                  <table
                    className="
                      min-w-full
                      divide-y
                      divide-slate-200
                    "
                  >

                    <thead
                      className="bg-slate-50"
                    >

                      <tr>

                        <th
                          className="
                            px-5
                            py-3
                            text-left
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wide
                            text-slate-500
                          "
                        >
                          #
                        </th>

                        <th
                          className="
                            px-5
                            py-3
                            text-left
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wide
                            text-slate-500
                          "
                        >
                          Question
                        </th>

                        <th
                          className="
                            px-5
                            py-3
                            text-left
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wide
                            text-slate-500
                          "
                        >
                          Type
                        </th>

                        <th
                          className="
                            px-5
                            py-3
                            text-right
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wide
                            text-slate-500
                          "
                        >
                          Answered
                        </th>

                        <th
                          className="
                            px-5
                            py-3
                            text-right
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wide
                            text-slate-500
                          "
                        >
                          Completion
                        </th>

                      </tr>

                    </thead>


                    <tbody
                      className="
                        divide-y
                        divide-slate-100
                      "
                    >

                      {questionnaire?.questions.map(
                        function (question) {

                          return (

                            <tr
                              key={
                                question.questionId
                              }
                              className="
                                hover:bg-slate-50
                              "
                            >

                              <td
                                className="
                                  whitespace-nowrap
                                  px-5
                                  py-4
                                  text-sm
                                  font-medium
                                  text-slate-700
                                "
                              >
                                Q{question.questionOrder}
                              </td>


                              <td
                                className="
                                  px-5
                                  py-4
                                "
                              >

                                <div
                                  className="
                                    text-sm
                                    font-medium
                                    text-slate-900
                                  "
                                >
                                  {question.questionText}
                                </div>

                                <div
                                  className="
                                    mt-1
                                    text-xs
                                    text-slate-500
                                  "
                                >
                                  {question.questionCode}

                                  {question.required
                                    ? " · Required"
                                    : " · Optional"}
                                </div>

                              </td>


                              <td
                                className="
                                  whitespace-nowrap
                                  px-5
                                  py-4
                                  text-sm
                                  text-slate-600
                                "
                              >
                                {question.questionType}
                              </td>


                              <td
                                className="
                                  whitespace-nowrap
                                  px-5
                                  py-4
                                  text-right
                                  text-sm
                                  text-slate-700
                                "
                              >
                                {question.answeredCount}
                                {" / "}
                                {question.respondentCount}
                              </td>


                              <td
                                className="
                                  whitespace-nowrap
                                  px-5
                                  py-4
                                  text-right
                                "
                              >

                                <span
                                  className="
                                    text-sm
                                    font-semibold
                                    text-slate-900
                                  "
                                >
                                  {question.answeredPct}%
                                </span>

                              </td>

                            </tr>
                          );
                        }
                      )}

                    </tbody>

                  </table>

                </div>

              </div>

            </section>
          </>
        )}

      </div>

    </AppShell>
  );
}
