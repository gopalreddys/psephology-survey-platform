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


type Program = {
  id: string;
  study_code: string;
  study_name: string;
  purpose: string | null;
  study_type: string;
  scope_mode: string | null;
  election_type: string | null;
  jurisdiction_id: string | null;
  jurisdiction_name: string | null;
  jurisdiction_code: string | null;
  target_sample_size: number | null;
  primary_language: string | null;
  status: string;
};


type Iteration = {
  id: string;
  study_id: string;
  iteration_number: number;
  iteration_name: string;
  research_phase: string;
  objective: string | null;
  sample_design_type: string | null;
  target_sample_size: number | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  questionnaire_name: string | null;
  version_number: number | null;
  status: string;
};


export default function ProgramDetailPage() {

  const params =
    useParams();

  const router =
    useRouter();


  const programId =
    params.id as string;


  const [
    program,
    setProgram
  ] =
    useState<Program | null>(
      null
    );


  const [
    iterations,
    setIterations
  ] =
    useState<Iteration[]>([]);


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

      iterationNumber:
        "1",

      iterationName:
        "Baseline / Natural Pulse",

      researchPhase:
        "BASELINE",

      objective:
        "Understand the natural voter pulse before election-period influence intensifies.",

      sampleDesignType:
        "REPEATED_CROSS_SECTION",

      targetSampleSize:
        "30",

      plannedStartDate:
        "",

      plannedEndDate:
        ""

    });


  async function loadProgram() {

    const data =
      await apiFetch(
        `/api/programs/${programId}`
      );

    setProgram(
      data
    );


    setForm(
      function (current) {

        return {
          ...current,

          targetSampleSize:
            String(
              data.target_sample_size ||
              0
            )
        };
      }
    );
  }


  async function loadIterations() {

    const data =
      await apiFetch(
        `/api/programs/${programId}/iterations`
      );

    setIterations(
      data
    );
  }


  async function loadData() {

    setLoading(
      true
    );

    try {

      await Promise.all([
        loadProgram(),
        loadIterations()
      ]);

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load program"
      );

    } finally {

      setLoading(
        false
      );
    }
  }


  useEffect(
    function () {

      if (programId) {
        loadData();
      }

    },
    [
      programId
    ]
  );


  function updateForm(
    key: keyof typeof form,
    value: string
  ) {

    setForm(
      function (current) {

        return {
          ...current,
          [key]:
            value
        };
      }
    );
  }


  async function createIteration() {

    if (
      !form.iterationNumber ||
      !form.iterationName ||
      !form.researchPhase
    ) {

      setMessage(
        "Iteration number, name and research phase are required."
      );

      return;
    }


    setSaving(
      true
    );

    setMessage(
      null
    );


    try {

      await apiFetch(
        `/api/programs/${programId}/iterations`,
        {
          method:
            "POST",

          body:
            JSON.stringify({

              iterationNumber:
                Number(
                  form.iterationNumber
                ),

              iterationName:
                form.iterationName,

              researchPhase:
                form.researchPhase,

              objective:
                form.objective,

              sampleDesignType:
                form.sampleDesignType,

              targetSampleSize:
                Number(
                  form.targetSampleSize ||
                  0
                ),

              plannedStartDate:
                form.plannedStartDate ||
                null,

              plannedEndDate:
                form.plannedEndDate ||
                null,

              questionnaireId:
                null,

              agentConfig:
                {},

              callingProfile:
                {}

            })
        }
      );


      setMessage(
        "Iteration created successfully."
      );


      setShowCreate(
        false
      );


      await loadIterations();


    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create iteration"
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
          Loading program...
        </div>

      </AppShell>
    );
  }


  if (!program) {

    return (
      <AppShell>

        <div className="p-8">

          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Program not found.
          </div>

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
                "/programs"
              );
            }
          }

          className="text-sm font-medium text-indigo-600"
        >
          ← Back to Programs
        </button>


        <div className="mt-5 flex items-start justify-between">

          <div>

            <p className="text-sm font-medium text-indigo-600">
              Program
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              {program.study_name}
            </h1>

            <p className="mt-2 text-slate-500">
              {program.study_code}
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
            + Create Iteration
          </button>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        <div className="mt-8 grid gap-4 md:grid-cols-5">

          <Metric
            label="Constituency"
            value={
              program.jurisdiction_name ||
              "-"
            }
          />

          <Metric
            label="Target Sample"
            value={
              String(
                program.target_sample_size ??
                "-"
              )
            }
          />

          <Metric
            label="Language"
            value={
              program.primary_language ||
              "-"
            }
          />

          <Metric
            label="Iterations"
            value={
              String(
                iterations.length
              )
            }
          />

          <Metric
            label="Status"
            value={
              program.status
            }
          />

        </div>


        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

          <h2 className="font-semibold text-slate-900">
            Research Purpose
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            {
              program.purpose ||
              "No purpose defined."
            }
          </p>

        </div>


        {showCreate && (

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <div className="flex items-start justify-between">

              <div>

                <h2 className="text-xl font-semibold text-slate-900">
                  Create Iteration
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Define the research wave
                  within this Program.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {

                    setShowCreate(
                      false
                    );
                  }
                }

                className="text-sm text-slate-500"
              >
                Close
              </button>

            </div>


            <div className="mt-6 grid gap-5 md:grid-cols-2">

              <Field
                label="Iteration Number"
              >

                <input
                  type="number"

                  min={1}

                  value={
                    form.iterationNumber
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "iterationNumber",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field
                label="Iteration Name"
              >

                <input
                  value={
                    form.iterationName
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "iterationName",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field
                label="Research Phase"
              >

                <select
                  value={
                    form.researchPhase
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "researchPhase",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                >

                  <option value="BASELINE">
                    Baseline / Natural Pulse
                  </option>

                  <option value="TRACKING">
                    Tracking
                  </option>

                  <option value="PRE_ELECTION">
                    Pre-Election
                  </option>

                  <option value="FINAL_PULSE">
                    Final Pulse
                  </option>

                  <option value="POST_ELECTION">
                    Post-Election
                  </option>

                  <option value="CUSTOM">
                    Custom
                  </option>

                </select>

              </Field>


              <Field
                label="Sample Design"
              >

                <select
                  value={
                    form.sampleDesignType
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "sampleDesignType",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                >

                  <option value="REPEATED_CROSS_SECTION">
                    Repeated Cross Section
                  </option>

                  <option value="PANEL">
                    Panel
                  </option>

                  <option value="HYBRID">
                    Hybrid
                  </option>

                </select>

              </Field>


              <Field
                label="Target Sample"
              >

                <input
                  type="number"

                  min={1}

                  value={
                    form.targetSampleSize
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "targetSampleSize",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field
                label="Planned Start Date"
              >

                <input
                  type="date"

                  value={
                    form.plannedStartDate
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "plannedStartDate",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field
                label="Planned End Date"
              >

                <input
                  type="date"

                  value={
                    form.plannedEndDate
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "plannedEndDate",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>


              <Field
                label="Objective"
                span
              >

                <textarea
                  rows={4}

                  value={
                    form.objective
                  }

                  onChange={
                    function (event) {

                      updateForm(
                        "objective",
                        event.target.value
                      );
                    }
                  }

                  className="input"
                />

              </Field>

            </div>


            <div className="mt-6 flex justify-end">

              <button
                type="button"

                disabled={
                  saving
                }

                onClick={
                  createIteration
                }

                className="rounded-lg bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >

                {
                  saving
                    ? "Creating..."
                    : "Create Iteration"
                }

              </button>

            </div>

          </div>

        )}


        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold text-slate-900">
              Iterations
            </h2>

          </div>


          {
            iterations.length === 0
              ? (

                <div className="p-8 text-sm text-slate-500">
                  No iterations created yet.
                </div>

              )
              : (

                <div className="divide-y divide-slate-100">

                  {
                    iterations.map(
                      function (iteration) {

                        return (

                          <div
  key={
    iteration.id
  }

  onClick={
    function () {

      router.push(
        `/iterations/${iteration.id}`
      );
    }
  }

  className="cursor-pointer flex items-center justify-between px-6 py-5 hover:bg-slate-50"
>

                            <div>

                              <div className="flex items-center gap-3">

                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-600">

                                  {
                                    iteration.iteration_number
                                  }

                                </div>

                                <div>

                                  <div className="font-semibold text-slate-900">

                                    {
                                      iteration.iteration_name
                                    }

                                  </div>

                                  <div className="mt-1 text-xs text-slate-500">

                                    {
                                      iteration.research_phase
                                    }

                                    {" • "}

                                    {
                                      iteration.sample_design_type
                                    }

                                  </div>

                                </div>

                              </div>


                              {
                                iteration.objective && (

                                  <p className="mt-3 max-w-3xl text-sm text-slate-600">

                                    {
                                      iteration.objective
                                    }

                                  </p>

                                )
                              }

                            </div>


                            <div className="flex items-center gap-6">

                              <div className="text-right">

                                <div className="text-xs uppercase text-slate-400">
                                  Target
                                </div>

                                <div className="mt-1 font-semibold">
                                  {
                                    iteration.target_sample_size ??
                                    "-"
                                  }
                                </div>

                              </div>


                              <div>

                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">

                                  {
                                    iteration.status
                                  }

                                </span>

                              </div>

                            </div>

                          </div>

                        );
                      }
                    )
                  }

                </div>

              )
          }

        </div>

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

    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="text-xs font-medium uppercase text-slate-400">
        {label}
      </div>

      <div className="mt-2 font-semibold text-slate-900">
        {value}
      </div>

    </div>

  );
}


function Field({
  label,
  children,
  span = false
}: {
  label: string;
  children: React.ReactNode;
  span?: boolean;
}) {

  return (

    <div
      className={
        span
          ? "md:col-span-2"
          : ""
      }
    >

      <label className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </label>

      {children}

    </div>

  );
}
