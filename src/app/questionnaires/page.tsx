"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  BookOpen,
  ChevronRight,
  FileText,
  Languages,
  Layers3,
  Plus,
  Search,
  Sparkles,
  X
} from "lucide-react";

import {
  useRouter
} from "next/navigation";

import AppShell
  from "@/components/AppShell";

import {
  apiFetch
} from "@/lib/api";


type Questionnaire = {
  id: string;
  questionnaire_code: string;
  questionnaire_name: string;
  description: string | null;
  version_number: number;
  primary_language: string | null;
  status: string;
  question_count: number;
};


export default function QuestionnairesPage() {

  const router =
    useRouter();

  const [
    questionnaires,
    setQuestionnaires
  ] =
    useState<Questionnaire[]>([]);

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    showCreate,
    setShowCreate
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
      questionnaireCode: "",
      questionnaireName: "",
      description: "",
      versionNumber: "1",
      primaryLanguage: "Telugu"
    });


  async function loadData() {

    setLoading(true);

    try {

      const data =
        await apiFetch(
          "/api/questionnaires"
        );

      setQuestionnaires(
        data
      );

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load questionnaires"
      );

    } finally {

      setLoading(false);
    }
  }


  useEffect(
    function () {
      loadData();
    },
    []
  );


  function updateForm(
    key: keyof typeof form,
    value: string
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


  async function createQuestionnaire() {

    if (
      !form.questionnaireCode ||
      !form.questionnaireName
    ) {

      setMessage(
        "Questionnaire code and name are required."
      );

      return;
    }

    setSaving(true);
    setMessage(null);

    try {

      const result =
        await apiFetch(
          "/api/questionnaires",
          {
            method: "POST",

            body:
              JSON.stringify({
                questionnaireCode:
                  form.questionnaireCode,

                questionnaireName:
                  form.questionnaireName,

                description:
                  form.description,

                versionNumber:
                  Number(
                    form.versionNumber
                  ),

                primaryLanguage:
                  form.primaryLanguage
              })
          }
        );

      setShowCreate(false);

      router.push(
        `/questionnaires/${result.id}`
      );

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create questionnaire"
      );

    } finally {

      setSaving(false);
    }
  }


  const filteredQuestionnaires =
    useMemo(
      function () {

        const query =
          search
            .trim()
            .toLowerCase();

        if (!query) {
          return questionnaires;
        }

        return questionnaires.filter(
          function (item) {

            return [
              item.questionnaire_name,
              item.questionnaire_code,
              item.primary_language,
              item.status,
              item.description
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
        questionnaires,
        search
      ]
    );


  const totalQuestions =
    questionnaires.reduce(
      function (sum, item) {

        return (
          sum +
          Number(
            item.question_count ||
            0
          )
        );
      },
      0
    );


  return (
    <AppShell>

      <div className="questionnaire-library-page">

        <section className="questionnaire-library-header">

          <div>

            <div className="questionnaire-eyebrow">
              RESEARCH DESIGN
            </div>

            <h1>
              Questionnaires
            </h1>

            <p>
              Design and manage survey instruments,
              versions, questions, languages and
              completion structures.
            </p>

          </div>


          <button
            type="button"

            onClick={
              function () {
                setShowCreate(true);
              }
            }

            className="questionnaire-create-button"
          >
            <Plus size={16} />
            Create Questionnaire
          </button>

        </section>


        {message && (

          <div className="questionnaire-message">
            {message}
          </div>

        )}


        <section className="questionnaire-summary-grid">

          <SummaryCard
            icon={BookOpen}
            label="Questionnaires"
            value={
              String(
                questionnaires.length
              )
            }
          />

          <SummaryCard
            icon={FileText}
            label="Questions"
            value={
              String(
                totalQuestions
              )
            }
          />

          <SummaryCard
            icon={Layers3}
            label="Versioned Instruments"
            value={
              String(
                questionnaires.length
              )
            }
          />

          <SummaryCard
            icon={Languages}
            label="Languages"
            value={
              String(
                new Set(
                  questionnaires
                    .map(
                      function (item) {
                        return item.primary_language;
                      }
                    )
                    .filter(Boolean)
                ).size
              )
            }
          />

        </section>


        {showCreate && (

          <section className="questionnaire-create-panel">

            <div className="questionnaire-create-header">

              <div>

                <div className="questionnaire-eyebrow">
                  NEW RESEARCH INSTRUMENT
                </div>

                <h2>
                  Create Questionnaire
                </h2>

                <p>
                  Create the questionnaire shell first.
                  Questions can be configured after creation.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(false);
                  }
                }

                className="questionnaire-close-button"
              >
                <X size={18} />
              </button>

            </div>


            <div className="questionnaire-create-body">

              <div className="questionnaire-form-section">

                <div className="questionnaire-form-heading">

                  <div className="questionnaire-form-icon">
                    <FileText size={17} />
                  </div>

                  <div>

                    <h3>
                      Instrument Identity
                    </h3>

                    <p>
                      Define the questionnaire code,
                      name and version.
                    </p>

                  </div>

                </div>


                <div className="questionnaire-form-grid">

                  <Field label="Questionnaire Code">

                    <input
                      value={
                        form.questionnaireCode
                      }

                      onChange={
                        function (event) {
                          updateForm(
                            "questionnaireCode",
                            event.target.value
                          );
                        }
                      }

                      className="questionnaire-input"
                    />

                  </Field>


                  <Field label="Questionnaire Name">

                    <input
                      value={
                        form.questionnaireName
                      }

                      onChange={
                        function (event) {
                          updateForm(
                            "questionnaireName",
                            event.target.value
                          );
                        }
                      }

                      className="questionnaire-input"
                    />

                  </Field>


                  <Field label="Version">

                    <input
                      type="number"
                      min={1}

                      value={
                        form.versionNumber
                      }

                      onChange={
                        function (event) {
                          updateForm(
                            "versionNumber",
                            event.target.value
                          );
                        }
                      }

                      className="questionnaire-input"
                    />

                  </Field>


                  <Field label="Primary Language">

                    <select
                      value={
                        form.primaryLanguage
                      }

                      onChange={
                        function (event) {
                          updateForm(
                            "primaryLanguage",
                            event.target.value
                          );
                        }
                      }

                      className="questionnaire-input"
                    >

                      <option value="Telugu">
                        Telugu
                      </option>

                      <option value="English">
                        English
                      </option>

                      <option value="Hindi">
                        Hindi
                      </option>

                    </select>

                  </Field>

                </div>

              </div>


              <div className="questionnaire-form-section">

                <div className="questionnaire-form-heading">

                  <div className="questionnaire-form-icon">
                    <Sparkles size={17} />
                  </div>

                  <div>

                    <h3>
                      Research Description
                    </h3>

                    <p>
                      Document the purpose and intended
                      use of this questionnaire version.
                    </p>

                  </div>

                </div>


                <Field label="Description">

                  <textarea
                    rows={4}

                    value={
                      form.description
                    }

                    onChange={
                      function (event) {
                        updateForm(
                          "description",
                          event.target.value
                        );
                      }
                    }

                    className="questionnaire-input questionnaire-textarea"
                  />

                </Field>

              </div>

            </div>


            <div className="questionnaire-create-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(false);
                  }
                }

                className="questionnaire-cancel-button"
              >
                Cancel
              </button>


              <button
                type="button"

                disabled={saving}

                onClick={
                  createQuestionnaire
                }

                className="questionnaire-submit-button"
              >

                {
                  saving
                    ? "Creating..."
                    : (
                      <>
                        <Plus size={15} />
                        Create Questionnaire
                      </>
                    )
                }

              </button>

            </div>

          </section>

        )}


        <section className="questionnaire-library-panel">

          <div className="questionnaire-library-toolbar">

            <div>

              <div className="questionnaire-eyebrow">
                RESEARCH INSTRUMENT LIBRARY
              </div>

              <h2>
                Questionnaire Library
              </h2>

              <p>
                Select an instrument to manage its
                questions and configuration.
              </p>

            </div>


            <div className="questionnaire-search">

              <Search size={15} />

              <input
                value={search}

                onChange={
                  function (event) {
                    setSearch(
                      event.target.value
                    );
                  }
                }

                placeholder="Search questionnaires"
              />

            </div>

          </div>


          {
            loading
              ? (

                <div className="questionnaire-loading">
                  Loading questionnaires...
                </div>

              )
              : filteredQuestionnaires.length === 0
                ? (

                  <div className="questionnaire-empty">

                    <BookOpen size={26} />

                    <strong>
                      {
                        search
                          ? "No matching questionnaires"
                          : "No questionnaires available"
                      }
                    </strong>

                    <span>
                      {
                        search
                          ? "Try a different search term."
                          : "Create your first research instrument."
                      }
                    </span>

                  </div>

                )
                : (

                  <div className="questionnaire-list">

                    {
                      filteredQuestionnaires.map(
                        function (item) {

                          return (

                            <button
                              type="button"

                              key={item.id}

                              onClick={
                                function () {
                                  router.push(
                                    `/questionnaires/${item.id}`
                                  );
                                }
                              }

                              className="questionnaire-card"
                            >

                              <div className="questionnaire-card-main">

                                <div className="questionnaire-card-icon">
                                  <FileText size={18} />
                                </div>


                                <div className="questionnaire-card-content">

                                  <div className="questionnaire-card-title-row">

                                    <h3>
                                      {
                                        item.questionnaire_name
                                      }
                                    </h3>

                                    <span className="questionnaire-status">
                                      {
                                        formatLabel(
                                          item.status
                                        )
                                      }
                                    </span>

                                  </div>


                                  <div className="questionnaire-card-code">
                                    {
                                      item.questionnaire_code
                                    }
                                    {" · Version "}
                                    {
                                      item.version_number
                                    }
                                  </div>


                                  {
                                    item.description
                                      ? (

                                        <p>
                                          {item.description}
                                        </p>

                                      )
                                      : null
                                  }

                                </div>


                                <ChevronRight
                                  size={18}
                                  className="questionnaire-card-arrow"
                                />

                              </div>


                              <div className="questionnaire-card-stats">

                                <QuestionnaireMetric
                                  label="Questions"
                                  value={
                                    String(
                                      item.question_count ||
                                      0
                                    )
                                  }
                                />

                                <QuestionnaireMetric
                                  label="Language"
                                  value={
                                    item.primary_language ||
                                    "-"
                                  }
                                />

                                <QuestionnaireMetric
                                  label="Version"
                                  value={
                                    String(
                                      item.version_number
                                    )
                                  }
                                />

                              </div>

                            </button>

                          );
                        }
                      )
                    }

                  </div>

                )
          }


          <div className="questionnaire-lifecycle">

            <span>
              Research Objective
            </span>

            <ChevronRight size={13} />

            <span>
              Questionnaire
            </span>

            <ChevronRight size={13} />

            <span>
              Questions
            </span>

            <ChevronRight size={13} />

            <span>
              AI Interview Context
            </span>

            <ChevronRight size={13} />

            <span>
              Response Evidence
            </span>

          </div>

        </section>

      </div>

    </AppShell>
  );
}


function SummaryCard({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (

    <div className="questionnaire-summary-card">

      <div className="questionnaire-summary-icon">
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


function QuestionnaireMetric({
  label,
  value
}: {
  label: string;
  value: string;
}) {

  return (

    <div className="questionnaire-metric">

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

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

    <div className="questionnaire-field">

      <label>
        {label}
      </label>

      {children}

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
    .replaceAll(
      "_",
      " "
    )
    .toLowerCase()
    .replace(
      /\b\w/g,
      function (character) {
        return character.toUpperCase();
      }
    );
}
