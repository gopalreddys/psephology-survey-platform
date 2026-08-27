"use client";

import {
  useEffect,
  useState
} from "react";

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


  return (
    <AppShell>

      <div className="p-8">

        <div className="flex items-start justify-between">

          <div>

            <p className="text-sm font-medium text-indigo-600">
              Research Design
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Questionnaires
            </h1>

            <p className="mt-2 text-slate-500">
              Manage survey versions, questions,
              answer types and completion rules.
            </p>

          </div>

          <button
            type="button"

            onClick={
              function () {
                setShowCreate(true);
              }
            }

            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white"
          >
            + Create Questionnaire
          </button>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        {showCreate && (

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <h2 className="text-xl font-semibold text-slate-900">
              Create Questionnaire
            </h2>

            <div className="mt-6 grid gap-5 md:grid-cols-2">

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

                  className="input"
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

                  className="input"
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

                  className="input"
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

                  className="input"
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


              <div className="md:col-span-2">

                <Field label="Description">

                  <textarea
                    rows={3}

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
                    setShowCreate(false);
                  }
                }

                className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm"
              >
                Cancel
              </button>

              <button
                type="button"

                disabled={saving}

                onClick={
                  createQuestionnaire
                }

                className="rounded-lg bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? "Creating..."
                  : "Create"}
              </button>

            </div>

          </div>

        )}


        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold text-slate-900">
              Questionnaire Library
            </h2>

          </div>


          {loading ? (

            <div className="p-8 text-sm text-slate-500">
              Loading questionnaires...
            </div>

          ) : questionnaires.length === 0 ? (

            <div className="p-8 text-sm text-slate-500">
              No questionnaires available.
            </div>

          ) : (

            <div className="divide-y divide-slate-100">

              {questionnaires.map(
                function (item) {

                  return (

                    <div
                      key={item.id}

                      onClick={
                        function () {
                          router.push(
                            `/questionnaires/${item.id}`
                          );
                        }
                      }

                      className="cursor-pointer px-6 py-5 hover:bg-slate-50"
                    >

                      <div className="flex items-center justify-between">

                        <div>

                          <div className="font-semibold text-slate-900">
                            {item.questionnaire_name}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {item.questionnaire_code}
                            {" • Version "}
                            {item.version_number}
                          </div>

                        </div>


                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                          {item.status}
                        </span>

                      </div>


                      <div className="mt-4 grid gap-4 md:grid-cols-3">

                        <Metric
                          label="Questions"
                          value={
                            String(
                              item.question_count || 0
                            )
                          }
                        />

                        <Metric
                          label="Language"
                          value={
                            item.primary_language ||
                            "-"
                          }
                        />

                        <Metric
                          label="Version"
                          value={
                            String(
                              item.version_number
                            )
                          }
                        />

                      </div>

                    </div>

                  );
                }
              )}

            </div>

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
    <div className="rounded-xl bg-slate-50 p-4">

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
