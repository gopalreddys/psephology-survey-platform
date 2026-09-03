"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  useParams,
  useRouter
} from "next/navigation";

import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Languages,
  ListChecks,
  Plus,
  Search,
  Settings2,
  Tag,
  X
} from "lucide-react";

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
    search,
    setSearch
  ] =
    useState("");

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

      setQuestionnaire(data);

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

    if (!form.optionsText.trim()) {
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


  const filteredQuestions =
    useMemo(
      function () {

        if (!questionnaire) {
          return [];
        }

        const query =
          search
            .trim()
            .toLowerCase();

        if (!query) {
          return questionnaire.questions;
        }

        return questionnaire.questions.filter(
          function (question) {

            return [
              question.question_code,
              question.question_text,
              question.metadata?.question_text_telugu,
              question.analysis_category,
              question.metadata?.section,
              question.question_type
            ]
              .filter(Boolean)
              .some(
                function (value) {

                  return String(value)
                    .toLowerCase()
                    .includes(query);
                }
              );
          }
        );

      },
      [
        questionnaire,
        search
      ]
    );


  if (loading) {

    return (
      <AppShell>
        <div className="question-detail-loading">
          Loading questionnaire...
        </div>
      </AppShell>
    );
  }


  if (!questionnaire) {

    return (
      <AppShell>
        <div className="question-detail-loading">
          Questionnaire not found.
        </div>
      </AppShell>
    );
  }


  const requiredCount =
    questionnaire.questions.filter(
      function (question) {
        return question.required;
      }
    ).length;


  const completionCount =
    questionnaire.questions.filter(
      function (question) {
        return Boolean(
          question.metadata
            ?.required_for_completion
        );
      }
    ).length;


  return (
    <AppShell>

      <div className="question-detail-page">

        <button
          type="button"

          onClick={
            function () {
              router.push(
                "/questionnaires"
              );
            }
          }

          className="question-detail-back"
        >
          <ArrowLeft size={15} />
          Back to Questionnaires
        </button>


        <section className="question-detail-header">

          <div>

            <div className="question-detail-eyebrow">
              RESEARCH INSTRUMENT
            </div>

            <h1>
              {questionnaire.questionnaire_name}
            </h1>

            <div className="question-detail-meta">

              <span>
                {questionnaire.questionnaire_code}
              </span>

              <span className="question-detail-dot" />

              <span>
                Version {questionnaire.version_number}
              </span>

              <span className="question-detail-dot" />

              <span>
                {questionnaire.primary_language || "Language not set"}
              </span>

              <span
                className="question-detail-status"
              >
                {formatLabel(
                  questionnaire.status
                )}
              </span>

            </div>

            {questionnaire.description && (

              <p className="question-detail-description">
                {questionnaire.description}
              </p>

            )}

          </div>


          <button
            type="button"

            onClick={
              function () {
                setShowAdd(true);
              }
            }

            className="question-detail-add-button"
          >
            <Plus size={16} />
            Add Question
          </button>

        </section>


        {message && (

          <div className="question-detail-message">
            {message}
          </div>

        )}


        <section className="question-detail-metrics">

          <QuestionMetric
            icon={ListChecks}
            label="Questions"
            value={
              String(
                questionnaire.questions.length
              )
            }
          />

          <QuestionMetric
            icon={CheckCircle2}
            label="Required"
            value={
              String(requiredCount)
            }
          />

          <QuestionMetric
            icon={Settings2}
            label="Completion Themes"
            value={
              String(completionCount)
            }
            emphasis
          />

          <QuestionMetric
            icon={Languages}
            label="Primary Language"
            value={
              questionnaire.primary_language ||
              "-"
            }
          />

        </section>


        {showAdd && (

          <section className="question-add-panel">

            <div className="question-add-header">

              <div>

                <div className="question-detail-eyebrow">
                  QUESTION MANAGEMENT
                </div>

                <h2>
                  Add Survey Question
                </h2>

                <p>
                  Define question structure, wording
                  and completion requirements.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {
                    setShowAdd(false);
                  }
                }

                className="question-add-close"
              >
                <X size={18} />
              </button>

            </div>


            <div className="question-add-body">

              <QuestionFormSection
                icon={Settings2}
                title="Question Structure"
                description="Configure sequence, type and analytical classification."
              >

                <div className="question-form-grid">

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

                      className="question-input"
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

                      placeholder="Q_GENERAL_CONCERN"

                      className="question-input"
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

                      className="question-input"
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

                      className="question-input"
                    />

                  </Field>


                  <div className="question-field-wide">

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

                        placeholder="GENERAL_CONCERN"

                        className="question-input"
                      />

                    </Field>

                  </div>

                </div>

              </QuestionFormSection>


              <QuestionFormSection
                icon={FileText}
                title="Question Wording"
                description="Maintain the research question in English and Telugu."
              >

                <div className="question-form-stack">

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

                      className="question-input"
                    />

                  </Field>


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

                      className="question-input"
                    />

                  </Field>

                </div>

              </QuestionFormSection>


              <QuestionFormSection
                icon={CheckCircle2}
                title="Completion & Response Rules"
                description="Define survey completion requirements and available response choices."
              >

                <div className="question-rule-grid">

                  <label className="question-rule-card">

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

                    <div>

                      <strong>
                        Required Question
                      </strong>

                      <span>
                        Expected during the survey conversation.
                      </span>

                    </div>

                  </label>


                  <label className="question-rule-card">

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

                    <div>

                      <strong>
                        Required for Completion
                      </strong>

                      <span>
                        Contributes to questionnaire completion coverage.
                      </span>

                    </div>

                  </label>

                </div>


                <div className="question-options-field">

                  <Field label="Answer Options — one per line">

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

                      className="question-input"
                    />

                  </Field>

                </div>

              </QuestionFormSection>

            </div>


            <div className="question-add-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowAdd(false);
                  }
                }

                className="question-cancel-button"
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

                className="question-save-button"
              >

                {saving
                  ? "Saving..."
                  : (
                    <>
                      <Plus size={15} />
                      Add Question
                    </>
                  )}

              </button>

            </div>

          </section>

        )}


        <section className="question-list-panel">

          <div className="question-list-toolbar">

            <div>

              <div className="question-detail-eyebrow">
                SURVEY QUESTIONS
              </div>

              <h2>
                Question Framework
              </h2>

              <p>
                Review question wording, analytical
                categories and completion rules.
              </p>

            </div>


            <div className="question-detail-search">

              <Search size={15} />

              <input
                value={
                  search
                }

                onChange={
                  function (event) {
                    setSearch(
                      event.target.value
                    );
                  }
                }

                placeholder="Search questions"
              />

            </div>

          </div>


          <div className="question-list-content">

            {filteredQuestions.length === 0
              ? (

                <div className="question-empty-state">

                  <ListChecks size={28} />

                  <strong>
                    No matching questions
                  </strong>

                  <span>
                    Try another question, category or section.
                  </span>

                </div>

              )
              : filteredQuestions.map(
                function (question) {

                  return (

                    <article
                      key={question.id}
                      className="question-card"
                    >

                      <div className="question-card-number">
                        {question.question_order}
                      </div>


                      <div className="question-card-main">

                        <div className="question-card-labels">

                          <span className="question-category-badge">
                            <Tag size={11} />
                            {formatLabel(
                              question.analysis_category ||
                              "GENERAL"
                            )}
                          </span>

                          {question.metadata?.section && (

                            <span className="question-section-badge">
                              {formatLabel(
                                question.metadata.section
                              )}
                            </span>

                          )}

                        </div>


                        <h3>
                          {question.question_text}
                        </h3>


                        {question.metadata
                          ?.question_text_telugu && (

                          <p className="question-telugu">
                            {
                              question.metadata
                                .question_text_telugu
                            }
                          </p>

                        )}


                        <div className="question-card-code">

                          <span>
                            Code
                          </span>

                          <strong>
                            {question.question_code || "-"}
                          </strong>

                        </div>


                        {Array.isArray(
                          question.options
                        ) &&
                          question.options.length > 0 && (

                          <div className="question-option-list">

                            {question.options.map(
                              function (
                                option,
                                index
                              ) {

                                return (

                                  <span key={index}>
                                    {option.label ||
                                      option.value}
                                  </span>

                                );
                              }
                            )}

                          </div>

                        )}

                      </div>


                      <div className="question-card-rules">

                        <span className="question-type-badge">
                          {formatLabel(
                            question.question_type
                          )}
                        </span>


                        {question.required && (

                          <span className="question-required-badge">
                            Required
                          </span>

                        )}


                        {question.metadata
                          ?.required_for_completion && (

                          <span className="question-completion-badge">
                            <CheckCircle2 size={11} />
                            Completion
                          </span>

                        )}

                      </div>

                    </article>

                  );
                }
              )}

          </div>


          <div className="question-lifecycle">

            <span>
              Research Objective
            </span>

            <strong>→</strong>

            <span>
              Questionnaire
            </span>

            <strong>→</strong>

            <span>
              Questions & Completion Rules
            </span>

            <strong>→</strong>

            <span>
              AI Interview
            </span>

            <strong>→</strong>

            <span>
              Evidence
            </span>

          </div>

        </section>

      </div>

    </AppShell>
  );
}


function QuestionMetric({
  icon: Icon,
  label,
  value,
  emphasis = false
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  emphasis?: boolean;
}) {

  return (

    <div
      className={
        emphasis
          ? "question-detail-metric emphasis"
          : "question-detail-metric"
      }
    >

      <div className="question-metric-icon">
        <Icon size={17} />
      </div>

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


function QuestionFormSection({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {

  return (

    <section className="question-form-section">

      <div className="question-form-section-header">

        <div className="question-form-section-icon">
          <Icon size={16} />
        </div>

        <div>

          <h3>
            {title}
          </h3>

          <p>
            {description}
          </p>

        </div>

      </div>

      {children}

    </section>
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

    <label className="question-field">

      <span>
        {label}
      </span>

      {children}

    </label>
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
