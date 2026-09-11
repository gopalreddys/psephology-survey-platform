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
import FeedbackMessage from "@/components/FeedbackMessage";
import { apiFetch } from "@/lib/api";
import { surveyStageOptions } from "@/lib/research-codes";
import { useCurrentUser } from "@/hooks/useCurrentUser";


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


type PendingRunContact = {
  runContactId: string;
  voterId: string;
  fullName: string;
  phoneEnding: string;
  preferredLanguage: string | null;
  geographyName: string | null;
  attemptCount: number;
};


type RunLaunchPreview = {
  run: Run;
  items: PendingRunContact[];
  total: number;
  cycle: {
    id: string;
    number: number;
    type: string;
  } | null;
};


export default function IterationPage() {

  const params =
    useParams();

  const router =
    useRouter();

  const { user } = useCurrentUser();

  const iterationId =
    params.id as string;

  const canCreateRuns =
    user?.role.code === "CAMPAIGNER";


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
    previewingRunId,
    setPreviewingRunId
  ] =
    useState<string | null>(
      null
    );


  const [
    launchPreview,
    setLaunchPreview
  ] =
    useState<RunLaunchPreview | null>(
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

    const result =
      await apiFetch(
        `/api/iterations/${iterationId}`
      );

    const data = result?.iteration || result?.data?.iteration || result;

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

    setRuns(
      Array.isArray(data)
        ? data
        : data.runs || data.items || data.data?.runs || data.data?.items || []
    );
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

    const runNumber = Number(form.runNumber);
    const targetContacts = Number(form.targetContacts);
    const maxAttemptsPerVoter = Number(form.maxAttemptsPerVoter);

    if (!Number.isInteger(runNumber) || runNumber < 1) {
      setMessage("Run number must be a whole number greater than zero.");
      return;
    }

    if (!Number.isInteger(targetContacts) || targetContacts < 1) {
      setMessage("This iteration has no valid target sample. Ask the Campaign Manager to update the iteration target before creating a Run.");
      return;
    }

    if (!Number.isInteger(maxAttemptsPerVoter) || maxAttemptsPerVoter < 1 || maxAttemptsPerVoter > 10) {
      setMessage("Maximum attempts per voter must be between 1 and 10.");
      return;
    }

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
                  runNumber,

                runName:
                  form.runName,

                targetContacts:
                  targetContacts,

                maxAttemptsPerVoter:
                  maxAttemptsPerVoter,

                sourceName:
                  form.sourceName ||
                  null
              })
          }
        );


      const createdRun = result?.run || result?.data?.run || result;
      const selectedContacts = Number(
        createdRun?.selected_contacts ??
        result?.selected_contacts ??
        createdRun?.total_contacts ??
        0
      );

      setMessage(
        `Run created successfully. ${selectedContacts.toLocaleString()} voters selected.`
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


  async function reviewPendingCalls(
    run: Run
  ) {
    setPreviewingRunId(
      run.id
    );
    setMessage(null);

    try {
      const result =
        await apiFetch(
          `/api/runs/${run.id}/pending-contacts?limit=50`
        );

      const items = Array.isArray(result?.items)
        ? result.items
        : [];

      if (items.length === 0) {
        setMessage(
          "No eligible pending demo voter is available for this Run."
        );
        setLaunchPreview(null);
        return;
      }

      setLaunchPreview({
        run,
        items,
        total: Number(result?.total || items.length),
        cycle: result?.cycle || null
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to preview pending voters"
      );
    } finally {
      setPreviewingRunId(
        null
      );
    }
  }


  async function launchPendingCalls() {
    if (!launchPreview || launchPreview.items.length === 0) {
      return;
    }

    const run = launchPreview.run;
    const launchCount = launchPreview.items.length;
    const confirmed = window.confirm(
      `Submit ${launchCount} approved demo calls from "${run.run_name || `Run ${run.run_number}`}"? Only the voters shown in the preview will be eligible.`
    );

    if (!confirmed) {
      return;
    }

    setLaunchingRunId(run.id);
    setMessage(null);

    try {
      const result = await apiFetch(
        `/api/runs/${run.id}/launch`,
        {
          method: "POST",
          body: JSON.stringify({
            limit: launchCount
          })
        }
      );

      const submitted = Number(result?.submitted || 0);
      const failed = Number(result?.failed || 0);

      if (submitted > 0) {
        setMessage(
          `${submitted} demo ${submitted === 1 ? "call was" : "calls were"} submitted successfully${failed > 0 ? `; ${failed} could not be submitted.` : "."}`
        );
      } else if (Number(result?.selected || 0) === 0) {
        setMessage(
          "No eligible pending demo voter was available when the launch was submitted."
        );
      } else {
        setMessage(
          `No calls were submitted. ${failed} submission ${failed === 1 ? "failure" : "failures"} recorded.`
        );
      }

      setLaunchPreview(null);
      await loadRuns();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to launch pending demo calls"
      );
    } finally {
      setLaunchingRunId(null);
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
              if (canCreateRuns) {
                if (window.history.length > 1) {
                  router.back();
                } else {
                  router.push("/campaigns");
                }
                return;
              }

              router.push(`/programs/${iteration.study_id}`);
            }
          }

          className="iteration-detail-back"
        >
          <ArrowLeft size={15} />
          {canCreateRuns ? "Back to Iterations" : "Back to Program"}
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


            {canCreateRuns && (
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
            )}

          </div>

        </section>


        {message && <FeedbackMessage message={message} className="iteration-detail-message" />}


        <section className="iteration-detail-metrics">

          <IterationMetric
            icon={ClipboardList}
            label="Survey iteration"
            value={
              surveyStageLabel(iteration.research_phase)
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


        {canCreateRuns && showCreate && (

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
                    {canCreateRuns
                      ? "Create a Run to freeze the voter cohort for survey execution."
                      : "Runs are created by assigned Campaigners. You can review the execution status here."}
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


                              {canCreateRuns && (
                                <button
                                  type="button"

                                  onClick={
                                    function () {
                                      reviewPendingCalls(run);
                                    }
                                  }

                                  disabled={
                                    launchingRunId === run.id ||
                                    previewingRunId === run.id
                                  }

                                  className="iteration-analysis-button"
                                >
                                  <PhoneCall size={15} />

                                  {
                                    launchingRunId === run.id
                                      ? "Launching..."
                                      : previewingRunId === run.id
                                        ? "Loading voters..."
                                        : "Review & Launch"
                                  }
                                </button>
                              )}

                            </div>


                            {launchPreview?.run.id === run.id && (
                              <div className="run-launch-preview">

                                <div className="run-launch-preview-header">
                                  <div>
                                    <strong>
                                      Pending demo voters
                                    </strong>

                                    <span>
                                      Review every recipient before submitting this batch.
                                      {launchPreview.total > launchPreview.items.length
                                        ? ` Showing the next ${launchPreview.items.length} of ${launchPreview.total}.`
                                        : ` ${launchPreview.items.length} ${launchPreview.items.length === 1 ? "call" : "calls"} ready.`}
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    className="run-launch-preview-close"
                                    onClick={function () {
                                      setLaunchPreview(null);
                                    }}
                                    aria-label="Close voter preview"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>

                                <div className="run-launch-contact-list">
                                  {launchPreview.items.map(function (contact) {
                                    return (
                                      <div
                                        key={contact.runContactId}
                                        className="run-launch-contact"
                                      >
                                        <div>
                                          <strong>{contact.fullName}</strong>
                                          <span>
                                            {contact.geographyName || "Assigned geography"}
                                            {contact.preferredLanguage
                                              ? ` · ${contact.preferredLanguage}`
                                              : ""}
                                          </span>
                                        </div>

                                        <span className="run-launch-phone">
                                          •••• {contact.phoneEnding}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>

                                <div className="run-launch-preview-actions">
                                  <span>
                                    Only approved demo contacts can pass the server-side launch check.
                                  </span>

                                  <button
                                    type="button"
                                    className="run-submit-button"
                                    disabled={launchingRunId === run.id}
                                    onClick={launchPendingCalls}
                                  >
                                    <PhoneCall size={15} />
                                    {launchingRunId === run.id
                                      ? "Submitting calls..."
                                      : `Launch ${launchPreview.items.length === launchPreview.total ? "All " : "Next "}${launchPreview.items.length} Calls`}
                                  </button>
                                </div>

                              </div>
                            )}


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

function surveyStageLabel(value: string | null) {
  const normalized = String(value || "").toUpperCase();
  const option = surveyStageOptions.find(function (item) {
    return item.value === normalized || `${item.value}_SURVEY` === normalized;
  });
  return option?.label || formatLabel(value);
}
