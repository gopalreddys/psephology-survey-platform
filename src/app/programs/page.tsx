"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Globe2,
  Languages,
  MapPinned,
  Plus,
  Target,
  Users,
  X,
} from "lucide-react";

import {
  useRouter,
} from "next/navigation";

import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";


type JurisdictionType = {
  id: string;
  code: string;
  name: string;
  category: string;
};


type Jurisdiction = {
  id: string;
  name: string;
  code: string;
  type_code: string;
  type_name: string;
};


type ScopeResult = {
  jurisdiction: Jurisdiction;

  geographies: Array<{
    id: string;
    name: string;
    geo_type: string;
    coverage_type: string;
  }>;

  eligibleVoters: number;
};


type Program = {
  id: string;

  study_code: string;
  study_name: string;

  purpose: string | null;
  study_type: string;
  scope_mode: string | null;
  election_type: string | null;

  jurisdiction_name: string | null;
  jurisdiction_code: string | null;

  target_sample_size: number | null;
  primary_language: string | null;

  status: string;
  created_at: string;
};


export default function ProgramsPage() {

  const router =
    useRouter();


  const [
    programs,
    setPrograms,
  ] =
    useState<Program[]>([]);


  const [
    jurisdictionTypes,
    setJurisdictionTypes,
  ] =
    useState<JurisdictionType[]>([]);


  const [
    jurisdictions,
    setJurisdictions,
  ] =
    useState<Jurisdiction[]>([]);


  const [
    selectedJurisdictionId,
    setSelectedJurisdictionId,
  ] =
    useState("");


  const [
    scope,
    setScope,
  ] =
    useState<ScopeResult | null>(
      null
    );


  const [
    showCreate,
    setShowCreate,
  ] =
    useState(false);


  const [
    loading,
    setLoading,
  ] =
    useState(true);


  const [
    saving,
    setSaving,
  ] =
    useState(false);


  const [
    message,
    setMessage,
  ] =
    useState<string | null>(
      null
    );


  const [
    form,
    setForm,
  ] =
    useState({

      studyCode:
        "SER-2026-BASE",

      studyName:
        "Serilingampally Voter Pulse 2026",

      purpose:
        "Baseline voter pulse study",

      studyType:
        "OPINION_SURVEY",

      scopeMode:
        "ELECTORAL",

      electionType:
        "ASSEMBLY",

      targetPopulation:
        "Eligible voters in selected Assembly Constituency",

      samplingMethod:
        "DEMO_FULL_POPULATION",

      targetSampleSize:
        "30",

      fieldworkStartDate:
        "",

      fieldworkEndDate:
        "",

      primaryLanguage:
        "Telugu",

      methodologyNotes:
        "Demo V1 baseline study",
    });


  async function loadPrograms() {

    const data =
      await apiFetch(
        "/api/programs"
      );

    setPrograms(
      data
    );
  }


  async function loadJurisdictionTypes() {

    const data =
      await apiFetch(
        "/api/jurisdiction-types"
      );

    setJurisdictionTypes(
      data
    );
  }


  async function loadAssemblyJurisdictions() {

    const data =
      await apiFetch(
        "/api/jurisdictions?type=ASSEMBLY"
      );

    setJurisdictions(
      data
    );
  }


  async function loadInitialData() {

    setLoading(
      true
    );

    try {

      await Promise.all([
        loadPrograms(),
        loadJurisdictionTypes(),
        loadAssemblyJurisdictions(),
      ]);

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load program data"
      );

    } finally {

      setLoading(
        false
      );
    }
  }


  useEffect(
    function () {

      loadInitialData();

    },
    []
  );


  async function selectJurisdiction(
    jurisdictionId: string
  ) {

    setSelectedJurisdictionId(
      jurisdictionId
    );

    setScope(
      null
    );


    if (!jurisdictionId) {
      return;
    }


    try {

      const data =
        await apiFetch(
          `/api/jurisdictions/${jurisdictionId}/scope`
        );

      setScope(
        data
      );


      setForm(
        function (current) {

          return {
            ...current,

            targetSampleSize:
              String(
                data.eligibleVoters || 0
              ),
          };
        }
      );

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to resolve constituency scope"
      );
    }
  }


  function updateForm(
    key: keyof typeof form,
    value: string
  ) {

    setForm(
      function (current) {

        return {
          ...current,
          [key]: value,
        };
      }
    );
  }


  async function createProgram() {

    if (
      !form.studyCode.trim() ||
      !form.studyName.trim()
    ) {

      setMessage(
        "Program code and program name are required."
      );

      return;
    }


    if (
      form.scopeMode === "ELECTORAL" &&
      !selectedJurisdictionId
    ) {

      setMessage(
        "Select a constituency."
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
        "/api/programs",
        {
          method: "POST",

          body:
            JSON.stringify({

              studyCode:
                form.studyCode,

              studyName:
                form.studyName,

              description:
                form.purpose,

              studyType:
                form.studyType,

              purpose:
                form.purpose,

              scopeMode:
                form.scopeMode,

              electionType:
                form.electionType,

              jurisdictionId:
                selectedJurisdictionId ||
                null,

              targetPopulation:
                form.targetPopulation,

              samplingMethod:
                form.samplingMethod,

              targetSampleSize:
                Number(
                  form.targetSampleSize ||
                  0
                ),

              fieldworkStartDate:
                form.fieldworkStartDate ||
                null,

              fieldworkEndDate:
                form.fieldworkEndDate ||
                null,

              primaryLanguage:
                form.primaryLanguage,

              supportedLanguages: [
                form.primaryLanguage,
              ],

              weightingRequired:
                false,

              methodologyNotes:
                form.methodologyNotes,

              ownerUserId:
                null,
            }),
        }
      );


      setMessage(
        "Program created successfully."
      );


      setShowCreate(
        false
      );


      await loadPrograms();

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create program"
      );

    } finally {

      setSaving(
        false
      );
    }
  }


  const assemblyTypeName =
    useMemo(
      function () {

        return (
          jurisdictionTypes
            .find(
              function (item) {
                return (
                  item.code ===
                  "ASSEMBLY"
                );
              }
            )
            ?.name ||
          "Assembly Constituency"
        );

      },
      [
        jurisdictionTypes,
      ]
    );


  return (
    <AppShell>

      <div className="programs-page">

        {/* HEADER */}

        <section className="programs-header">

          <div>

            <div className="programs-eyebrow">
              RESEARCH MANAGEMENT
            </div>

            <h1>
              Programs
            </h1>

            <p>
              Create and manage structured psephology
              research programs from constituency scope
              through survey execution and analysis.
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

            className="programs-create-button"
          >
            <Plus size={16} />
            Create Program
          </button>

        </section>


        {/* SUMMARY */}

        <section className="programs-summary-grid">

          <SummaryCard
            icon={ClipboardList}
            label="Programs"
            value={
              String(
                programs.length
              )
            }
            detail="Research programs configured"
          />

          <SummaryCard
            icon={MapPinned}
            label="Research Scope"
            value={
              programs.length > 0
                ? String(
                    new Set(
                      programs
                        .map(
                          function (program) {
                            return program.jurisdiction_code;
                          }
                        )
                        .filter(Boolean)
                    ).size
                  )
                : "0"
            }
            detail="Constituencies represented"
          />

          <SummaryCard
            icon={Users}
            label="Target Sample"
            value={
              programs
                .reduce(
                  function (
                    total,
                    program
                  ) {
                    return (
                      total +
                      (
                        program.target_sample_size ||
                        0
                      )
                    );
                  },
                  0
                )
                .toLocaleString()
            }
            detail="Combined target contacts"
          />

          <SummaryCard
            icon={BarChart3}
            label="Research Model"
            value="Iterative"
            detail="Program → Iteration → Run"
          />

        </section>


        {message && (

          <div className="programs-message">
            <CheckCircle2 size={15} />
            {message}
          </div>

        )}


        {/* CREATE PROGRAM */}

        {showCreate && (

          <section className="program-create-panel">

            <div className="program-create-header">

              <div>

                <div className="programs-eyebrow">
                  NEW RESEARCH PROGRAM
                </div>

                <h2>
                  Create Survey Program
                </h2>

                <p>
                  Define the research identity,
                  electoral scope and target population.
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

                className="program-close-button"
                aria-label="Close"
              >
                <X size={18} />
              </button>

            </div>


            <div className="program-form-section">

              <div className="program-form-section-heading">

                <div className="program-section-icon">
                  <ClipboardList size={17} />
                </div>

                <div>
                  <h3>
                    Program Identity
                  </h3>

                  <p>
                    Define the research program
                    and survey methodology.
                  </p>
                </div>

              </div>


              <div className="program-form-grid">

                <Field
                  label="Program Code"
                  hint="Unique research program identifier"
                >
                  <input
                    value={
                      form.studyCode
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "studyCode",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  />
                </Field>


                <Field
                  label="Program Name"
                  hint="Human-readable research program name"
                >
                  <input
                    value={
                      form.studyName
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "studyName",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  />
                </Field>


                <Field
                  label="Survey Type"
                >
                  <select
                    value={
                      form.studyType
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "studyType",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  >
                    <option value="OPINION_SURVEY">
                      Opinion Survey
                    </option>

                    <option value="VOTER_PULSE">
                      Voter Pulse
                    </option>
                  </select>
                </Field>


                <Field
                  label="Primary Language"
                >
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

                    className="program-input"
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


            <div className="program-form-section">

              <div className="program-form-section-heading">

                <div className="program-section-icon">
                  <MapPinned size={17} />
                </div>

                <div>
                  <h3>
                    Electoral Scope
                  </h3>

                  <p>
                    Select the election and
                    geography covered by this research.
                  </p>
                </div>

              </div>


              <div className="program-form-grid">

                <Field
                  label="Scope Type"
                >
                  <select
                    value={
                      form.scopeMode
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "scopeMode",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  >
                    <option value="ELECTORAL">
                      Electoral Constituency
                    </option>

                    <option value="GENERAL_GEOGRAPHY">
                      General Geography
                    </option>
                  </select>
                </Field>


                <Field
                  label="Election Type"
                >
                  <select
                    value={
                      form.electionType
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "electionType",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  >
                    <option value="ASSEMBLY">
                      MLA / Assembly
                    </option>

                    <option value="PARLIAMENTARY">
                      MP / Parliamentary
                    </option>

                    <option value="MLC_GRADUATES">
                      MLC Graduate
                    </option>
                  </select>
                </Field>


                <Field
                  label={
                    assemblyTypeName
                  }
                  span
                >

                  <select
                    value={
                      selectedJurisdictionId
                    }

                    onChange={
                      function (event) {

                        selectJurisdiction(
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  >

                    <option value="">
                      Select Constituency
                    </option>


                    {jurisdictions.map(
                      function (item) {

                        return (
                          <option
                            key={
                              item.id
                            }

                            value={
                              item.id
                            }
                          >
                            {item.name}
                          </option>
                        );
                      }
                    )}

                  </select>

                </Field>

              </div>


              {scope && (

                <div className="program-scope-card">

                  <div className="program-scope-header">

                    <div>
                      <div className="program-scope-label">
                        RESOLVED RESEARCH SCOPE
                      </div>

                      <strong>
                        {scope.jurisdiction.name}
                      </strong>
                    </div>

                    <CheckCircle2 size={18} />
                  </div>


                  <div className="program-scope-grid">

                    <ScopeMetric
                      icon={MapPinned}
                      label="Constituency"
                      value={
                        scope
                          .jurisdiction
                          .name
                      }
                    />

                    <ScopeMetric
                      icon={Users}
                      label="Eligible Voters"
                      value={
                        scope
                          .eligibleVoters
                          .toLocaleString()
                      }
                    />

                    <ScopeMetric
                      icon={Globe2}
                      label="Mapped Geography"
                      value={
                        scope
                          .geographies
                          .map(
                            function (geo) {
                              return geo.name;
                            }
                          )
                          .join(", ") ||
                        "-"
                      }
                    />

                  </div>

                </div>

              )}

            </div>


            <div className="program-form-section">

              <div className="program-form-section-heading">

                <div className="program-section-icon">
                  <Target size={17} />
                </div>

                <div>
                  <h3>
                    Research Parameters
                  </h3>

                  <p>
                    Define sample requirements
                    and research context.
                  </p>
                </div>

              </div>


              <div className="program-form-grid">

                <Field
                  label="Target Sample"
                  hint="Number of survey contacts"
                >
                  <input
                    type="number"

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

                    className="program-input"
                  />
                </Field>


                <Field
                  label="Purpose"
                  span
                >
                  <textarea
                    rows={3}

                    value={
                      form.purpose
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "purpose",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  />
                </Field>


                <Field
                  label="Methodology Notes"
                  span
                >
                  <textarea
                    rows={3}

                    value={
                      form.methodologyNotes
                    }

                    onChange={
                      function (event) {

                        updateForm(
                          "methodologyNotes",
                          event.target.value
                        );
                      }
                    }

                    className="program-input"
                  />
                </Field>

              </div>

            </div>


            <div className="program-create-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowCreate(
                      false
                    );
                  }
                }

                className="program-cancel-button"
              >
                Cancel
              </button>


              <button
                type="button"

                disabled={
                  saving
                }

                onClick={
                  createProgram
                }

                className="program-submit-button"
              >

                {saving ? (
                  "Creating..."
                ) : (
                  <>
                    <Plus size={15} />
                    Create Program
                  </>
                )}

              </button>

            </div>

          </section>

        )}


        {/* PROGRAM LIST */}

        <section className="program-list-panel">

          <div className="program-list-header">

            <div>

              <div className="programs-eyebrow">
                RESEARCH PORTFOLIO
              </div>

              <h2>
                Survey Programs
              </h2>

              <p>
                Select a program to manage its
                research iterations and execution.
              </p>

            </div>


            <div className="program-count-pill">
              {programs.length}
              {" "}
              {programs.length === 1
                ? "Program"
                : "Programs"}
            </div>

          </div>


          {loading ? (

            <div className="program-empty-state">
              Loading programs...
            </div>

          ) : programs.length === 0 ? (

            <div className="program-empty-state">

              <div className="program-empty-icon">
                <ClipboardList size={22} />
              </div>

              <strong>
                No research programs yet
              </strong>

              <span>
                Create your first program
                to begin survey research.
              </span>

            </div>

          ) : (

            <div className="program-card-list">

              {programs.map(
                function (program) {

                  return (
                    <button
                      type="button"

                      key={
                        program.id
                      }

                      onClick={
                        function () {

                          router.push(
                            `/programs/${program.id}`
                          );
                        }
                      }

                      className="program-row-card"
                    >

                      <div className="program-row-main">

                        <div className="program-row-icon">
                          <ClipboardList size={19} />
                        </div>


                        <div className="program-row-title">

                          <div className="program-row-topline">

                            <h3>
                              {program.study_name}
                            </h3>

                            <StatusBadge
                              status={
                                program.status
                              }
                            />

                          </div>


                          <div className="program-code">
                            {program.study_code}
                          </div>


                          {program.purpose && (

                            <p>
                              {program.purpose}
                            </p>

                          )}

                        </div>

                      </div>


                      <div className="program-row-metrics">

                        <ProgramMetric
                          icon={MapPinned}
                          label="Scope"
                          value={
                            program.jurisdiction_name ||
                            program.scope_mode ||
                            "-"
                          }
                        />

                        <ProgramMetric
                          icon={Target}
                          label="Target"
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

                      </div>


                      <div className="program-row-open">
                        <span>
                          Open
                        </span>

                        <ChevronRight size={17} />
                      </div>

                    </button>
                  );
                }
              )}

            </div>

          )}

        </section>


        <div className="program-flow-note">

          <span>
            Research lifecycle
          </span>

          <strong>
            Program
          </strong>

          <ArrowRight size={12} />

          <strong>
            Iteration
          </strong>

          <ArrowRight size={12} />

          <strong>
            Run
          </strong>

          <ArrowRight size={12} />

          <strong>
            Evidence
          </strong>

          <ArrowRight size={12} />

          <strong>
            Analysis
          </strong>

        </div>

      </div>

    </AppShell>
  );
}


function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
}) {

  return (
    <div className="program-summary-card">

      <div className="program-summary-icon">
        <Icon size={17} />
      </div>

      <div>
        <div className="program-summary-label">
          {label}
        </div>

        <div className="program-summary-value">
          {value}
        </div>

        <div className="program-summary-detail">
          {detail}
        </div>
      </div>

    </div>
  );
}


function Field({
  label,
  children,
  span = false,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  span?: boolean;
  hint?: string;
}) {

  return (
    <div
      className={
        span
          ? "program-field program-field-span"
          : "program-field"
      }
    >

      <label>
        {label}
      </label>

      {hint && (
        <span className="program-field-hint">
          {hint}
        </span>
      )}

      {children}

    </div>
  );
}


function ScopeMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (
    <div className="program-scope-metric">

      <div className="program-scope-metric-icon">
        <Icon size={16} />
      </div>

      <div>
        <div className="program-scope-metric-label">
          {label}
        </div>

        <div className="program-scope-metric-value">
          {value}
        </div>
      </div>

    </div>
  );
}


function ProgramMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {

  return (
    <div className="program-row-metric">

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


function StatusBadge({
  status,
}: {
  status: string;
}) {

  const normalized =
    status
      .toUpperCase()
      .replaceAll("_", " ");

  return (
    <span
      className={
        status === "ACTIVE"
          ? "program-status program-status-active"
          : "program-status"
      }
    >
      {normalized}
    </span>
  );
}
