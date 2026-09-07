"use client";

import {
  useEffect,
  useState
} from "react";

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Flag,
  Languages,
  MapPinned,
  Plus,
  Target,
  Users,
  X
} from "lucide-react";

import {
  useParams,
  useRouter
} from "next/navigation";

import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { surveyStageOptions } from "@/lib/research-codes";


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
  run_count?: number;
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
    useState<Program | null>(null);


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
    useState<string | null>(null);


  const [
    form,
    setForm
  ] =
    useState({
      iterationNumber: "1",
      iterationName: "Base survey",
      researchPhase: "BASE",
      objective:
        "Understand the natural voter pulse before election-period influence intensifies.",
      sampleDesignType: "REPEATED_CROSS_SECTION",
      targetSampleSize: "30",
      plannedStartDate: "",
      plannedEndDate: ""
    });


  async function loadProgram() {

    const data =
      await apiFetch(
        `/api/programs/${programId}`
      );

    setProgram(data);

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

    const enriched = await Promise.all(data.map(async function (iteration: Iteration) {
      try {
        const runs = await apiFetch(`/api/iterations/${iteration.id}/runs`);
        return { ...iteration, run_count: Array.isArray(runs) ? runs.length : Number(runs?.total || runs?.count || 0) };
      } catch (_) {
        return { ...iteration, run_count: 0 };
      }
    }));
    setIterations(enriched);
  }


  async function loadData() {

    setLoading(true);

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

      setLoading(false);
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
          [key]: value
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


    setSaving(true);
    setMessage(null);


    try {

      await apiFetch(
        `/api/programs/${programId}/iterations`,
        {
          method: "POST",

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

      setShowCreate(false);

      await loadIterations();

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create iteration"
      );

    } finally {

      setSaving(false);
    }
  }


  if (loading) {

    return (
      <AppShell>

        <div className="program-detail-loading">
          Loading program...
        </div>

      </AppShell>
    );
  }


  if (!program) {

    return (
      <AppShell>

        <div className="program-detail-page">

          <div className="program-detail-error">
            Program not found.
          </div>

        </div>

      </AppShell>
    );
  }


  return (
    <AppShell>

      <div className="program-detail-page">

        <button
          type="button"

          onClick={
            function () {
              router.push(
                "/programs"
              );
            }
          }

          className="program-detail-back"
        >
          <ArrowLeft size={15} />
          Back to Programs
        </button>


        <section className="program-detail-header">

          <div>

            <div className="program-detail-eyebrow">
              RESEARCH PROGRAM
            </div>

            <h1>
              {program.study_name}
            </h1>

            <div className="program-detail-code">
              {program.study_code}
            </div>

          </div>


          <button
            type="button"

            onClick={
              function () {

                setShowCreate(true);

                setForm(
                  function (current) {

                    return {
                      ...current,
                      iterationNumber:
                        String(
                          iterations.length + 1
                        )
                    };
                  }
                );
              }
            }

            className="program-detail-create-button"
          >
            <Plus size={16} />
            Create Iteration
          </button>

        </section>


        {message && (

          <div className="program-detail-message">
            {message}
          </div>

        )}


        <section className="program-detail-metrics">

          <ProgramMetric
            icon={MapPinned}
            label="Constituency"
            value={
              program.jurisdiction_name ||
              "-"
            }
          />

          <ProgramMetric
            icon={Target}
            label="Target Sample"
            value={
              program.target_sample_size
                ?.toLocaleString() ||
              "-"
            }
          />

          <ProgramMetric
            icon={Languages}
            label="Language"
            value={
              program.primary_language ||
              "-"
            }
          />

          <ProgramMetric
            icon={ClipboardList}
            label="Iterations"
            value={
              String(
                iterations.length
              )
            }
          />

          <ProgramMetric
            icon={CheckCircle2}
            label="Iterations completed"
            value={String(iterations.filter(function (iteration) { return ["COMPLETED", "COMPLETE"].includes(String(iteration.status).toUpperCase()); }).length)}
          />

          <ProgramMetric
            icon={Target}
            label="Total runs"
            value={String(iterations.reduce(function (total, iteration) { return total + Number(iteration.run_count || 0); }, 0))}
          />

          <ProgramMetric
            icon={Flag}
            label="Status"
            value={
              program.status
            }
          />

        </section>


        <section className="program-purpose-card">

          <div className="program-purpose-icon">
            <ClipboardList size={19} />
          </div>

          <div>

            <div className="program-detail-eyebrow">
              RESEARCH PURPOSE
            </div>

            <h2>
              Program Objective
            </h2>

            <p>
              {
                program.purpose ||
                "No purpose defined."
              }
            </p>

          </div>

        </section>


        {showCreate && (

          <section className="iteration-create-panel">

            <div className="iteration-create-header">

              <div>

                <div className="program-detail-eyebrow">
                  NEW RESEARCH ITERATION
                </div>

                <h2>
                  Create Iteration
                </h2>

                <p>
                  Define the research objective,
                  phase, sample and planned timing
                  for this iteration.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(false);
                  }
                }

                className="iteration-close-button"
              >
                <X size={18} />
              </button>

            </div>


            <div className="iteration-form-section">

              <div className="iteration-form-heading">

                <div className="iteration-form-icon">
                  <ClipboardList size={17} />
                </div>

                <div>

                  <h3>
                    Research Definition
                  </h3>

                  <p>
                    Identify this research cycle
                    and the phase it represents.
                  </p>

                </div>

              </div>


              <div className="iteration-form-grid">

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

                    className="iteration-input"
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

                    className="iteration-input"
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

                    className="iteration-input"
                  >
                    {surveyStageOptions.map(function (option) {
                      return <option key={option.value} value={option.value}>{option.label}</option>;
                    })}
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

                    className="iteration-input"
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

              </div>

            </div>


            <div className="iteration-form-section">

              <div className="iteration-form-heading">

                <div className="iteration-form-icon">
                  <Target size={17} />
                </div>

                <div>

                  <h3>
                    Sampling & Schedule
                  </h3>

                  <p>
                    Set target size and planned
                    research period.
                  </p>

                </div>

              </div>


              <div className="iteration-form-grid">

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

                    className="iteration-input"
                  />
                </Field>


                <div />


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

                    className="iteration-input"
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

                    className="iteration-input"
                  />
                </Field>


                <Field
                  label="Research Objective"
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

                    className="iteration-input"
                  />
                </Field>

              </div>

            </div>


            <div className="iteration-create-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(false);
                  }
                }

                className="iteration-cancel-button"
              >
                Cancel
              </button>


              <button
                type="button"

                disabled={
                  saving
                }

                onClick={
                  createIteration
                }

                className="iteration-submit-button"
              >
                {
                  saving
                    ? "Creating..."
                    : (
                      <>
                        <Plus size={15} />
                        Create Iteration
                      </>
                    )
                }
              </button>

            </div>

          </section>

        )}


        <section className="iterations-panel">

          <div className="iterations-header">

            <div>

              <div className="program-detail-eyebrow">
                RESEARCH CYCLES
              </div>

              <h2>
                Iterations
              </h2>

              <p>
                Each iteration represents a distinct
                research objective within this Program.
              </p>

            </div>


            <div className="iterations-count">
              {iterations.length}
              {" "}
              {
                iterations.length === 1
                  ? "Iteration"
                  : "Iterations"
              }
            </div>

          </div>


          {
            iterations.length === 0
              ? (

                <div className="iterations-empty">

                  <ClipboardList size={24} />

                  <strong>
                    No research iterations yet
                  </strong>

                  <span>
                    Create an iteration to begin
                    research execution.
                  </span>

                </div>

              )
              : (

                <div className="iterations-list">

                  {
                    iterations.map(
                      function (iteration) {

                        return (

                          <button
                            type="button"

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

                            className="iteration-row"
                          >

                            <div className="iteration-row-main">

                              <div className="iteration-number">
                                {
                                  iteration.iteration_number
                                }
                              </div>


                              <div className="iteration-row-copy">

                                <div className="iteration-row-title">

                                  <h3>
                                    {
                                      iteration.iteration_name
                                    }
                                  </h3>

                                  <IterationStatus
                                    status={
                                      iteration.status
                                    }
                                  />

                                </div>


                                <div className="iteration-row-meta">

                                  <span>
                                    {
                                      surveyStageLabel(iteration.research_phase)
                                    }
                                  </span>

                                  <span>
                                    {
                                      formatLabel(
                                        iteration.sample_design_type
                                      )
                                    }
                                  </span>

                                </div>


                                {
                                  iteration.objective && (

                                    <p>
                                      {
                                        iteration.objective
                                      }
                                    </p>

                                  )
                                }

                              </div>

                            </div>


                            <div className="iteration-row-details">

                              <IterationDetail
                                icon={Target}
                                label="Target"
                                value={
                                  iteration.target_sample_size
                                    ?.toLocaleString() ||
                                  "-"
                                }
                              />


                              <IterationDetail
                                icon={CalendarDays}
                                label="Planned Start"
                                value={
                                  formatDate(
                                    iteration.planned_start_date
                                  )
                                }
                              />

                              <IterationDetail
                                icon={ClipboardList}
                                label="Runs"
                                value={String(iteration.run_count || 0)}
                              />

                            </div>


                            <div className="iteration-open">

                              <span>
                                Open
                              </span>

                              <ChevronRight size={17} />

                            </div>

                          </button>

                        );
                      }
                    )
                  }

                </div>

              )
          }

        </section>

      </div>

    </AppShell>
  );
}


function ProgramMetric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (
    <div className="program-detail-metric">

      <div className="program-detail-metric-icon">
        <Icon size={17} />
      </div>

      <div>

        <div className="program-detail-metric-label">
          {label}
        </div>

        <div className="program-detail-metric-value">
          {value}
        </div>

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
          ? "iteration-field iteration-field-span"
          : "iteration-field"
      }
    >

      <label>
        {label}
      </label>

      {children}

    </div>
  );
}


function IterationStatus({
  status
}: {
  status: string;
}) {

  return (
    <span className="iteration-status">
      {
        formatLabel(
          status
        )
      }
    </span>
  );
}


function IterationDetail({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (
    <div className="iteration-detail">

      <Icon size={14} />

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


function formatLabel(
  value: string | null
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

function surveyStageLabel(value: string | null) {
  const normalized = String(value || "").toUpperCase();
  const option = surveyStageOptions.find(function (item) { return item.value === normalized || `${item.value}_SURVEY` === normalized; });
  return option?.label || formatLabel(value);
}


function formatDate(
  value: string | null
) {

  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleDateString();
}
