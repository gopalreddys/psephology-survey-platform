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


type Iteration = {
  id: string;
  study_id: string;
  iteration_number: number;
  iteration_name: string;
  research_phase: string;
  objective: string | null;
  sample_design_type: string | null;
  target_sample_size: number | null;
  status: string;
  study_name: string;
  study_code: string;
  jurisdiction_name: string | null;
  jurisdiction_code: string | null;
};


type Run = {
  id: string;
  iteration_id: string;
  run_number: number;
  run_name: string | null;
  run_type: string;
  target_contacts: number | null;
  selected_contacts: number;
  max_attempts_per_voter: number;
  total_contacts: number;
  successful_contacts: number;
  retry_eligible_contacts: number;
  status: string;
};


export default function IterationPage() {

  const params =
    useParams();

  const router =
    useRouter();

  const iterationId =
    params.id as string;


  const [
    iteration,
    setIteration
  ] =
    useState<Iteration | null>(
      null
    );


  const [
    runs,
    setRuns
  ] =
    useState<Run[]>([]);


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
      runNumber: "1",
      runName: "Run 1 - Initial",
      targetContacts: "30",
      maxAttemptsPerVoter: "3"
    });


  async function loadIteration() {

    const data =
      await apiFetch(
        `/api/iterations/${iterationId}`
      );

    setIteration(
      data
    );

    setForm(
      function (current) {

        return {
          ...current,

          targetContacts:
            String(
              data.target_sample_size ||
              0
            )
        };
      }
    );
  }


  async function loadRuns() {

    const data =
      await apiFetch(
        `/api/iterations/${iterationId}/runs`
      );

    setRuns(
      data
    );
  }


  async function loadData() {

    setLoading(
      true
    );

    try {

      await Promise.all([
        loadIteration(),
        loadRuns()
      ]);

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load iteration"
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
        loadData();
      }

    },
    [iterationId]
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


  async function createRun() {

    setSaving(
      true
    );

    setMessage(
      null
    );

    try {

      const result =
        await apiFetch(
          `/api/iterations/${iterationId}/runs`,
          {
            method: "POST",

            body: JSON.stringify({
              runNumber:
                Number(
                  form.runNumber
                ),

              runName:
                form.runName,

              targetContacts:
                Number(
                  form.targetContacts
                ),

              maxAttemptsPerVoter:
                Number(
                  form.maxAttemptsPerVoter
                )
            })
          }
        );


      setMessage(
        `Run created successfully. ${result.run.selected_contacts} voters selected.`
      );

      setShowCreate(
        false
      );

      await loadRuns();

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create Run"
      );

    } finally {

      setSaving(
        false
      );
    }
  }


  if (loading) {

    return (
      <AppShell>

        <div className="p-8 text-sm text-slate-500">
          Loading iteration...
        </div>

      </AppShell>
    );
  }


  if (!iteration) {

    return (
      <AppShell>

        <div className="p-8">
          Iteration not found.
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
                `/programs/${iteration.study_id}`
              );
            }
          }

          className="text-sm font-medium text-indigo-600"
        >
          ← Back to Program
        </button>


        <div className="mt-5 flex items-start justify-between">

          <div>

            <p className="text-sm font-medium text-indigo-600">
              Iteration {iteration.iteration_number}
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              {iteration.iteration_name}
            </h1>

            <p className="mt-2 text-slate-500">
              {iteration.study_name}
            </p>

          </div>


          <button
            type="button"

            onClick={
              function () {

                setShowCreate(
                  true
                );
              }
            }

            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white"
          >
            + Create Run
          </button>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        <div className="mt-8 grid gap-4 md:grid-cols-4">

          <Metric
            label="Research Phase"
            value={
              iteration.research_phase
            }
          />

          <Metric
            label="Target Sample"
            value={
              String(
                iteration.target_sample_size ??
                "-"
              )
            }
          />

          <Metric
            label="Constituency"
            value={
              iteration.jurisdiction_name ||
              "-"
            }
          />

          <Metric
            label="Runs"
            value={
              String(
                runs.length
              )
            }
          />

        </div>


        {showCreate && (

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <h2 className="text-xl font-semibold text-slate-900">
              Create Run
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Freeze the operational voter sample for this research iteration.
            </p>


            <div className="mt-6 grid gap-5 md:grid-cols-2">

              <Field label="Run Number">

                <input
                  type="number"
                  min={1}

                  value={
                    form.runNumber
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "runNumber",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field label="Run Name">

                <input
                  value={
                    form.runName
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "runName",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field label="Target Voters">

                <input
                  type="number"
                  min={1}

                  value={
                    form.targetContacts
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "targetContacts",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field label="Maximum Attempts / Voter">

                <input
                  type="number"
                  min={1}
                  max={10}

                  value={
                    form.maxAttemptsPerVoter
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "maxAttemptsPerVoter",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>

            </div>


            <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">

              Run 1 will freeze the currently eligible voters.
              Successful or terminal voters will automatically be excluded
              from later retry cycles.

            </div>


            <div className="mt-6 flex justify-end gap-3">

              <button
                type="button"

                onClick={
                  function () {

                    setShowCreate(
                      false
                    );
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
                  createRun
                }

                className="rounded-lg bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? "Creating..."
                  : "Create Run"}
              </button>

            </div>

          </div>

        )}


        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold text-slate-900">
              Runs
            </h2>

          </div>


          {runs.length === 0 ? (

            <div className="p-8 text-sm text-slate-500">
              No Runs created yet.
            </div>

          ) : (

            <div className="divide-y divide-slate-100">

              {runs.map(
                function (run) {

                  return (
                    <div
                      key={
                        run.id
                      }

                      className="px-6 py-5"
                    >

                      <div className="flex items-center justify-between">

                        <div>

                          <div className="font-semibold text-slate-900">
                            {run.run_name ||
                              `Run ${run.run_number}`}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {run.run_type}
                            {" • Max Attempts "}
                            {run.max_attempts_per_voter}
                          </div>

                        </div>


                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                          {run.status}
                        </span>

                      </div>


                      <div className="mt-5 grid gap-4 md:grid-cols-4">

                        <Metric
                          label="Selected"
                          value={
                            String(
                              run.total_contacts ??
                              run.selected_contacts ??
                              0
                            )
                          }
                        />

                        <Metric
                          label="Successful"
                          value={
                            String(
                              run.successful_contacts ??
                              0
                            )
                          }
                        />

                        <Metric
                          label="Retry Eligible"
                          value={
                            String(
                              run.retry_eligible_contacts ??
                              0
                            )
                          }
                        />

                        <Metric
                          label="Max Attempts"
                          value={
                            String(
                              run.max_attempts_per_voter
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">

      <div className="text-xs font-medium uppercase text-slate-400">
        {label}
      </div>

      <div className="mt-2 text-lg font-semibold text-slate-900">
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
