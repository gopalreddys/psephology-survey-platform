"use client";

import {
  useEffect,
  useState
} from "react";

import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  ClipboardList,
  Languages,
  MapPinned,
  PhoneCall,
  Plus,
  RotateCcw,
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
    launchingRunId,
    setLaunchingRunId
  ] =
    useState<string | null>(
      null
    );


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
      maxAttemptsPerVoter: "3",
      sourceName: ""
    });


  async function loadIteration() {

    const data =
      await apiFetch(
        `/api/iterations/${iterationId}`
      );

    setIteration(data);

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

    setRuns(data);
  }


  async function loadData() {

    setLoading(true);

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

      setLoading(false);
    }
  }


  useEffect(
    function () {

      if (iterationId) {
        loadData();
      }

    },
    [
      iterationId
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


  function openCreateRun() {

    const nextRunNumber =
      runs.length + 1;

    setForm(
      function (current) {

        return {
          ...current,
          runNumber:
            String(
              nextRunNumber
            ),

          runName:
            `Run ${nextRunNumber}`
        };
      }
    );

    setShowCreate(true);
  }


  async function createRun() {

    setSaving(true);
    setMessage(null);

    try {

      const result =
        await apiFetch(
          `/api/iterations/${iterationId}/runs`,
          {
            method: "POST",

            body:
              JSON.stringify({

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
                  ),

                sourceName:
                  form.sourceName ||
                  null
              })
          }
        );


      setMessage(
        `Run created successfully. ${result.run.selected_contacts} voters selected.`
      );

      setShowCreate(false);

      await loadRuns();

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create Run"
      );

    } finally {

      setSaving(false);
    }
  }


  async function launchSingleCall(
    run: Run
  ) {

    const confirmed =
      window.confirm(
        `Launch exactly 1 call from "${run.run_name || `Run ${run.run_number}`}"?`
      );


    if (!confirmed) {
      return;
    }


    setLaunchingRunId(
      run.id
    );

    setMessage(null);


    try {

      const result =
        await apiFetch(
          `/api/runs/${run.id}/launch`,
          {
            method: "POST",

            body:
              JSON.stringify({
                limit: 1
              })
          }
        );


      if (
        result.submitted === 1
      ) {

        setMessage(
          "1 voter call submitted successfully."
        );

      } else if (
        result.selected === 0
      ) {

        setMessage(
          "No eligible pending voter was available for this Run."
        );

      } else {

        setMessage(
          `Launch completed. Submitted: ${result.submitted || 0}, Failed: ${result.failed || 0}.`
        );
      }


      await loadRuns();


    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to launch call"
      );


    } finally {

      setLaunchingRunId(
        null
      );
    }
  }


  if (loading) {

    return (
      <AppShell>

        <div className="iteration-detail-loading">
          Loading iteration...
        </div>

      </AppShell>
    );
  }


  if (!iteration) {

    return (
      <AppShell>

        <div className="iteration-detail-page">

          <div className="iteration-detail-error">
            Iteration not found.
          </div>

        </div>

      </AppShell>
    );
  }


  return (
    <AppShell>

      <div className="iteration-detail-page">

        <button
          type="button"

          onClick={
            function () {

              router.push(
                `/programs/${iteration.study_id}`
              );
            }
          }

          className="iteration-detail-back"
        >
          <ArrowLeft size={15} />
          Back to Program
        </button>


        <section className="iteration-detail-header">

          <div>

            <div className="iteration-detail-eyebrow">
              ITERATION {iteration.iteration_number}
            </div>

            <h1>
              {iteration.iteration_name}
            </h1>

            <div className="iteration-detail-program">
              {iteration.study_name}
              {" · "}
              {iteration.study_code}
            </div>

          </div>


          <div className="iteration-detail-actions">

            <button
              type="button"

              onClick={
                function () {

                  router.push(
                    `/iterations/${iterationId}/analysis`
                  );
                }
              }

              className="iteration-analysis-button"
            >
              <BarChart3 size={16} />
              View Analysis
            </button>


            <button
              type="button"

              onClick={
                openCreateRun
              }

              className="iteration-create-run-button"
            >
              <Plus size={16} />
              Create Run
            </button>

          </div>

        </section>


        {message && (

          <div className="iteration-detail-message">
            {message}
          </div>

        )}


        <section className="iteration-detail-metrics">

          <IterationMetric
            icon={ClipboardList}
            label="Research Phase"
            value={
              formatLabel(
                iteration.research_phase
              )
            }
          />

          <IterationMetric
            icon={Target}
            label="Target Sample"
            value={
              iteration.target_sample_size
                ?.toLocaleString() ||
              "-"
            }
          />

          <IterationMetric
            icon={MapPinned}
            label="Constituency"
            value={
              iteration.jurisdiction_name ||
              "-"
            }
          />

          <IterationMetric
            icon={PhoneCall}
            label="Runs"
            value={
              String(
                runs.length
              )
            }
          />

        </section>


        <section className="iteration-objective-card">

          <div className="iteration-objective-icon">
            <Target size={19} />
          </div>

          <div>

            <div className="iteration-detail-eyebrow">
              RESEARCH OBJECTIVE
            </div>

            <h2>
              What this iteration is designed to learn
            </h2>

            <p>
              {
                iteration.objective ||
                "No research objective defined."
              }
            </p>


            <div className="iteration-objective-meta">

              <span>
                <ClipboardList size={13} />

                {
                  formatLabel(
                    iteration.sample_design_type
                  )
                }
              </span>

              <span>
                <Languages size={13} />
                Research configuration
              </span>

            </div>

          </div>

        </section>


        {showCreate && (

          <section className="run-create-panel">

            <div className="run-create-header">

              <div>

                <div className="iteration-detail-eyebrow">
                  NEW EXECUTION RUN
                </div>

                <h2>
                  Create Run
                </h2>

                <p>
                  Freeze the eligible voter cohort
                  and execution limits for this
                  research iteration.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(false);
                  }
                }

                className="run-close-button"
              >
                <X size={18} />
              </button>

            </div>


            <div className="run-form-section">

              <div className="run-form-heading">

                <div className="run-form-icon">
                  <PhoneCall size={17} />
                </div>

                <div>

                  <h3>
                    Run Identity
                  </h3>

                  <p>
                    Identify this execution cycle
                    within the iteration.
                  </p>

                </div>

              </div>


              <div className="run-form-grid">

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

                    className="run-input"
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

                    className="run-input"
                  />

                </Field>

              </div>

            </div>


            <div className="run-form-section">

              <div className="run-form-heading">

                <div className="run-form-icon">
                  <Users size={17} />
                </div>

                <div>

                  <h3>
                    Voter Cohort
                  </h3>

                  <p>
                    Define which eligible contacts
                    will be frozen into this Run.
                  </p>

                </div>

              </div>


              <div className="run-form-grid">

                <Field label="Contact Cohort">

                  <select
                    value={
                      form.sourceName
                    }

                    onChange={
                      function (event) {

                        const value =
                          event.target.value;

                        updateForm(
                          "sourceName",
                          value
                        );

                        if (
                          value ===
                          "PSEPHOLOGY_DEMO_CONTACTS"
                        ) {

                          updateForm(
                            "targetContacts",
                            "10"
                          );
                        }
                      }
                    }

                    className="run-input"
                  >

                    <option value="">
                      All Eligible Voters
                    </option>

                    <option value="PSEPHOLOGY_DEMO_CONTACTS">
                      Controlled Demo Contacts
                    </option>

                  </select>

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

                    className="run-input"
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

                    className="run-input"
                  />

                </Field>

              </div>


              <div className="run-policy-note">

                <RotateCcw size={17} />

                <div>

                  <strong>
                    Retry policy
                  </strong>

                  <span>
                    This Run freezes the selected voter cohort.
                    Successful or terminal voters remain excluded
                    from later retry cycles within the same Run.
                  </span>

                </div>

              </div>

            </div>


            <div className="run-create-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(false);
                  }
                }

                className="run-cancel-button"
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

                className="run-submit-button"
              >

                {
                  saving
                    ? "Creating..."
                    : (
                      <>
                        <Plus size={15} />
                        Create Run
                      </>
                    )
                }

              </button>

            </div>

          </section>

        )}


        <section className="runs-panel">

          <div className="runs-header">

            <div>

              <div className="iteration-detail-eyebrow">
                EXECUTION MANAGEMENT
              </div>

              <h2>
                Runs
              </h2>

              <p>
                Runs manage voter reach and retry
                execution within the same research iteration.
              </p>

            </div>


            <div className="runs-count">
              {runs.length}
              {" "}
              {
                runs.length === 1
                  ? "Run"
                  : "Runs"
              }
            </div>

          </div>


          {
            runs.length === 0
              ? (

                <div className="runs-empty">

                  <PhoneCall size={25} />

                  <strong>
                    No Runs created yet
                  </strong>

                  <span>
                    Create a Run to freeze the voter
                    cohort for survey execution.
                  </span>

                </div>

              )
              : (

                <div className="runs-list">

                  {
                    runs.map(
                      function (run) {

                        const selected =
                          run.total_contacts ??
                          run.selected_contacts ??
                          0;

                        return (

                          <div
                            key={
                              run.id
                            }

                            className="run-card"
                          >

                            <div className="run-card-header">

                              <div className="run-card-identity">

                                <div className="run-number">
                                  {
                                    run.run_number
                                  }
                                </div>


                                <div>

                                  <div className="run-title-row">

                                    <h3>
                                      {
                                        run.run_name ||
                                        `Run ${run.run_number}`
                                      }
                                    </h3>

                                    <RunStatus
                                      status={
                                        run.status
                                      }
                                    />

                                  </div>


                                  <div className="run-card-meta">

                                    <span>
                                      {
                                        formatLabel(
                                          run.run_type
                                        )
                                      }
                                    </span>

                                    <span>
                                      Max attempts:
                                      {" "}
                                      {
                                        run.max_attempts_per_voter
                                      }
                                    </span>

                                  </div>

                                </div>

                              </div>


                              <button
                                type="button"

                                onClick={
                                  function () {

                                    launchSingleCall(
                                      run
                                    );
                                  }
                                }

                                disabled={
                                  launchingRunId ===
                                  run.id
                                }

                                className="iteration-analysis-button"
                              >
                                <PhoneCall size={15} />

                                {
                                  launchingRunId ===
                                  run.id
                                    ? "Launching..."
                                    : "Launch 1 Call"
                                }
                              </button>

                            </div>


                            <div className="run-stat-grid">

                              <RunStat
                                icon={Users}
                                label="Selected"
                                value={
                                  String(
                                    selected
                                  )
                                }
                              />

                              <RunStat
                                icon={Target}
                                label="Successful"
                                value={
                                  String(
                                    run.successful_contacts ??
                                    0
                                  )
                                }
                              />

                              <RunStat
                                icon={RotateCcw}
                                label="Retry Eligible"
                                value={
                                  String(
                                    run.retry_eligible_contacts ??
                                    0
                                  )
                                }
                              />

                              <RunStat
                                icon={PhoneCall}
                                label="Max Attempts"
                                value={
                                  String(
                                    run.max_attempts_per_voter
                                  )
                                }
                              />

                            </div>


                            <div className="run-progress-row">

                              <div>

                                <span>
                                  Successful survey coverage
                                </span>

                                <strong>
                                  {
                                    selected > 0
                                      ? Math.round(
                                          (
                                            (
                                              run.successful_contacts ||
                                              0
                                            ) /
                                            selected
                                          ) *
                                          100
                                        )
                                      : 0
                                  }
                                  %
                                </strong>

                              </div>


                              <div className="run-progress-track">

                                <div
                                  className="run-progress-fill"

                                  style={{
                                    width:
                                      `${
                                        selected > 0
                                          ? Math.min(
                                              100,
                                              Math.round(
                                                (
                                                  (
                                                    run.successful_contacts ||
                                                    0
                                                  ) /
                                                  selected
                                                ) *
                                                100
                                              )
                                            )
                                          : 0
                                      }%`
                                  }}
                                />

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


          <div className="runs-lifecycle">

            <span>
              Iteration
            </span>

            <ChevronRight size={13} />

            <span>
              Run
            </span>

            <ChevronRight size={13} />

            <span>
              Retry Cycles
            </span>

            <ChevronRight size={13} />

            <span>
              Successful Evidence
            </span>

            <ChevronRight size={13} />

            <span>
              Analysis
            </span>

          </div>

        </section>

      </div>

    </AppShell>
  );
}


function IterationMetric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (

    <div className="iteration-detail-metric">

      <div className="iteration-detail-metric-icon">
        <Icon size={17} />
      </div>

      <div>

        <div className="iteration-detail-metric-label">
          {label}
        </div>

        <div className="iteration-detail-metric-value">
          {value}
        </div>

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

    <div className="run-field">

      <label>
        {label}
      </label>

      {children}

    </div>
  );
}


function RunStatus({
  status
}: {
  status: string;
}) {

  return (

    <span className="run-status">
      {
        formatLabel(
          status
        )
      }
    </span>
  );
}


function RunStat({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (

    <div className="run-stat">

      <div className="run-stat-icon">
        <Icon size={15} />
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


function formatLabel(
  value: string | null
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
