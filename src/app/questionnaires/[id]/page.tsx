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


type Question = {
  id: string;
  question_order: number;
  question_code: string | null;
  question_text: string;
  question_type: string;
  options: any[];
  required: boolean;
  analysis_category: string | null;
  metadata: {
    question_text_telugu?: string;
    required_for_completion?: boolean;
    section?: string;
    adaptive?: boolean;
    allow_inferred_answer?: boolean;
  };
};


type Questionnaire = {
  id: string;
  questionnaire_code: string;
  questionnaire_name: string;
  description: string | null;
  version_number: number;
  primary_language: string | null;
  status: string;
  questions: Question[];
};


export default function QuestionnaireDetailPage() {

  const params =
    useParams();

  const router =
    useRouter();

  const questionnaireId =
    params.id as string;


  const [
    questionnaire,
    setQuestionnaire
  ] =
    useState<Questionnaire | null>(
      null
    );

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    showAdd,
    setShowAdd
  ] =
    useState(false);

  const [
    saving,
    setSaving
  ] =
    useState(false);

  const [
    message,
    setMessage
  ] =
    useState<string | null>(
      null
    );

  const [
    form,
    setForm
  ] =
    useState({
      questionOrder: "1",
      questionCode: "",
      questionText: "",
      questionTextTelugu: "",
      questionType: "OPEN_TEXT",
      required: true,
      requiredForCompletion: true,
      analysisCategory: "",
      section: "GENERAL",
      optionsText: ""
    });


  async function loadData() {

    setLoading(true);

    try {

      const data =
        await apiFetch(
          `/api/questionnaires/${questionnaireId}`
        );

      setQuestionnaire(
        data
      );

      setForm(
        function (current) {

          return {
            ...current,

            questionOrder:
              String(
                (data.questions?.length || 0) + 1
              )
          };
        }
      );

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load questionnaire"
      );

    } finally {

      setLoading(false);
    }
  }


  useEffect(
    function () {

      if (questionnaireId) {
        loadData();
      }

    },
    [questionnaireId]
  );


  function updateForm(
    key: keyof typeof form,
    value: string | boolean
  ) {

    setForm(
      function (current) {

        return {
          ...current,
          [key]: value
        };
      }
    );
  }


  function buildOptions() {

    if (
      !form.optionsText.trim()
    ) {
      return [];
    }

    return form.optionsText
      .split("\n")
      .map(
        function (line) {

          const trimmed =
            line.trim();

          return {
            value: trimmed,
            label: trimmed
          };
        }
      )
      .filter(
        function (item) {
          return item.value;
        }
      );
  }


  async function addQuestion() {

    if (
      !form.questionOrder ||
      !form.questionText
    ) {

      setMessage(
        "Question order and English text are required."
      );

      return;
    }

    setSaving(true);
    setMessage(null);

    try {

      await apiFetch(
        `/api/questionnaires/${questionnaireId}/questions`,
        {
          method: "POST",

          body:
            JSON.stringify({

              questionOrder:
                Number(
                  form.questionOrder
                ),

              questionCode:
                form.questionCode,

              questionText:
                form.questionText,

              questionTextTelugu:
                form.questionTextTelugu,

              questionType:
                form.questionType,

              options:
                buildOptions(),

              required:
                form.required,

              requiredForCompletion:
                form.requiredForCompletion,

              analysisCategory:
                form.analysisCategory,

              section:
                form.section
            })
        }
      );


      setMessage(
        "Question added successfully."
      );

      setShowAdd(false);

      setForm({
        questionOrder:
          String(
            (questionnaire?.questions.length || 0) + 2
          ),

        questionCode: "",
        questionText: "",
        questionTextTelugu: "",
        questionType: "OPEN_TEXT",
        required: true,
        requiredForCompletion: true,
        analysisCategory: "",
        section: "GENERAL",
        optionsText: ""
      });

      await loadData();

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to add question"
      );

    } finally {

      setSaving(false);
    }
  }


  if (loading) {

    return (
      <AppShell>
        <div className="p-8 text-sm text-slate-500">
          Loading questionnaire...
        </div>
      </AppShell>
    );
  }


  if (!questionnaire) {

    return (
      <AppShell>
        <div className="p-8">
          Questionnaire not found.
        </div>
      </AppShell>
    );
  }


  return (
    <AppShell>

      <div className="p-8">

        <button
          type="button"

          onClick={
            function () {
              router.push(
                "/questionnaires"
              );
            }
          }

          className="text-sm font-medium text-indigo-600"
        >
          ← Back to Questionnaires
        </button>


        <div className="mt-5 flex items-start justify-between">

          <div>

            <p className="text-sm font-medium text-indigo-600">
              Questionnaire
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              {questionnaire.questionnaire_name}
            </h1>

            <p className="mt-2 text-slate-500">
              {questionnaire.questionnaire_code}
              {" • Version "}
              {questionnaire.version_number}
            </p>

          </div>


          <button
            type="button"

            onClick={
              function () {
                setShowAdd(true);
              }
            }

            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white"
          >
            + Add Question
          </button>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        <div className="mt-8 grid gap-4 md:grid-cols-4">

          <Metric
            label="Questions"
            value={
              String(
                questionnaire.questions.length
              )
            }
          />

          <Metric
            label="Language"
            value={
              questionnaire.primary_language ||
              "-"
            }
          />

          <Metric
            label="Version"
            value={
              String(
                questionnaire.version_number
              )
            }
          />

          <Metric
            label="Status"
            value={
              questionnaire.status
            }
          />

        </div>


        {showAdd && (

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <h2 className="text-xl font-semibold text-slate-900">
              Add Question
            </h2>


            <div className="mt-6 grid gap-5 md:grid-cols-2">

              <Field label="Question Order">

                <input
                  type="number"
                  min={1}

                  value={
                    form.questionOrder
                  }

                  onChange={
                    function (event) {
                      updateForm(
                        "questionOrder",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field label="Question Code">

                <input
                  value={
                    form.questionCode
                  }

                  onChange={
                    function (event) {
                      updateForm(
                        "questionCode",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field label="Question Type">

                <select
                  value={
                    form.questionType
                  }

                  onChange={
                    function (event) {
                      updateForm(
                        "questionType",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                >

                  <option value="OPEN_TEXT">
                    Open Text
                  </option>

                  <option value="YES_NO">
                    Yes / No
                  </option>

                  <option value="SINGLE_CHOICE">
                    Single Choice
                  </option>

                  <option value="MULTI_CHOICE">
                    Multi Choice
                  </option>

                  <option value="RATING">
                    Rating
                  </option>

                  <option value="NUMERIC">
                    Numeric
                  </option>

                </select>

              </Field>


              <Field label="Analysis Category">

                <input
                  value={
                    form.analysisCategory
                  }

                  onChange={
                    function (event) {
                      updateForm(
                        "analysisCategory",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field label="Section">

                <input
                  value={
                    form.section
                  }

                  onChange={
                    function (event) {
                      updateForm(
                        "section",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <div className="flex items-center gap-6 pt-7">

                <label className="flex items-center gap-2 text-sm">

                  <input
                    type="checkbox"

                    checked={
                      form.required
                    }

                    onChange={
                      function (event) {
                        updateForm(
                          "required",
                          event.target.checked
                        );
                      }
                    }
                  />

                  Required

                </label>


                <label className="flex items-center gap-2 text-sm">

                  <input
                    type="checkbox"

                    checked={
                      form.requiredForCompletion
                    }

                    onChange={
                      function (event) {
                        updateForm(
                          "requiredForCompletion",
                          event.target.checked
                        );
                      }
                    }
                  />

                  Required for Completion

                </label>

              </div>


              <div className="md:col-span-2">

                <Field label="English Question">

                  <textarea
                    rows={3}

                    value={
                      form.questionText
                    }

                    onChange={
                      function (event) {
                        updateForm(
                          "questionText",
                          event.target.value
                        );
                      }
                    }

                    className="input"
                  />

                </Field>

              </div>


              <div className="md:col-span-2">

                <Field label="Telugu Question">

                  <textarea
                    rows={3}

                    value={
                      form.questionTextTelugu
                    }

                    onChange={
                      function (event) {
                        updateForm(
                          "questionTextTelugu",
                          event.target.value
                        );
                      }
                    }

                    className="input"
                  />

                </Field>

              </div>


              <div className="md:col-span-2">

                <Field label="Options — one per line">

                  <textarea
                    rows={5}

                    value={
                      form.optionsText
                    }

                    onChange={
                      function (event) {
                        updateForm(
                          "optionsText",
                          event.target.value
                        );
                      }
                    }

                    placeholder={
                      "Satisfied\nNeutral\nDissatisfied"
                    }

                    className="input"
                  />

                </Field>

              </div>

            </div>


            <div className="mt-6 flex justify-end gap-3">

              <button
                type="button"

                onClick={
                  function () {
                    setShowAdd(false);
                  }
                }

                className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm"
              >
                Cancel
              </button>

              <button
                type="button"

                disabled={
                  saving
                }

                onClick={
                  addQuestion
                }

                className="rounded-lg bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : "Add Question"}
              </button>

            </div>

          </div>

        )}


        <div className="mt-8 space-y-4">

          {questionnaire.questions.map(
            function (question) {

              return (

                <div
                  key={question.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >

                  <div className="flex items-start justify-between">

                    <div className="flex gap-4">

                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 font-bold text-indigo-600">
                        {question.question_order}
                      </div>

                      <div>

                        <div className="text-xs font-medium uppercase text-indigo-600">
                          {question.analysis_category ||
                            "GENERAL"}
                        </div>

                        <div className="mt-1 text-lg font-semibold text-slate-900">
                          {question.question_text}
                        </div>

                        {question.metadata
                          ?.question_text_telugu && (

                          <div className="mt-2 text-sm text-slate-600">
                            {
                              question.metadata
                                .question_text_telugu
                            }
                          </div>

                        )}

                      </div>

                    </div>


                    <div className="text-right">

                      <div className="text-xs font-medium text-slate-500">
                        {question.question_type}
                      </div>

                      <div className="mt-2 flex gap-2">

                        {question.required && (

                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                            Required
                          </span>

                        )}

                        {question.metadata
                          ?.required_for_completion && (

                          <span className="rounded-full bg-green-50 px-2 py-1 text-xs text-green-700">
                            Completion
                          </span>

                        )}

                      </div>

                    </div>

                  </div>


                  {Array.isArray(
                    question.options
                  ) &&
                    question.options.length > 0 && (

                    <div className="mt-4 flex flex-wrap gap-2">

                      {question.options.map(
                        function (
                          option,
                          index
                        ) {

                          return (
                            <span
                              key={index}
                              className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600"
                            >
                              {option.label ||
                                option.value}
                            </span>
                          );
                        }
                      )}

                    </div>

                  )}

                </div>

              );
            }
          )}

        </div>


        <style jsx global>{`
          .input {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 0.5rem;
            padding: 0.65rem 0.75rem;
            font-size: 0.875rem;
            background: white;
            color: #0f172a;
            outline: none;
          }

          .input:focus {
            border-color: #6366f1;
            box-shadow:
              0 0 0 2px
              rgba(99, 102, 241, 0.12);
          }
        `}</style>

      </div>

    </AppShell>
  );
}


function Metric({
  label,
  value
}: {
  label: string;
  value: string;
}) {

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">

      <div className="text-xs uppercase text-slate-400">
        {label}
      </div>

      <div className="mt-1 font-semibold text-slate-900">
        {value}
      </div>

    </div>
  );
}


function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {

  return (
    <div>

      <label className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </label>

      {children}

    </div>
  );
}
