"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import AppShell
  from "@/components/AppShell";

import {
  apiFetch
} from "@/lib/api";


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

  purpose:
    string | null;

  study_type:
    string;

  scope_mode:
    string | null;

  election_type:
    string | null;

  jurisdiction_name:
    string | null;

  jurisdiction_code:
    string | null;

  target_sample_size:
    number | null;

  primary_language:
    string | null;

  status:
    string;

  created_at:
    string;
};


export default function ProgramsPage() {

  const [
    programs,
    setPrograms
  ] =
    useState<Program[]>([]);


  const [
    jurisdictionTypes,
    setJurisdictionTypes
  ] =
    useState<JurisdictionType[]>([]);


  const [
    jurisdictions,
    setJurisdictions
  ] =
    useState<Jurisdiction[]>([]);


  const [
    selectedJurisdictionId,
    setSelectedJurisdictionId
  ] =
    useState("");


  const [
    scope,
    setScope
  ] =
    useState<ScopeResult | null>(
      null
    );


  const [
    showCreate,
    setShowCreate
  ] =
    useState(false);


  const [
    loading,
    setLoading
  ] =
    useState(true);


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
        "Demo V1 baseline study"

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
        loadAssemblyJurisdictions()
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
              )
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
          [key]:
            value
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
          method:
            "POST",

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
                form.primaryLanguage
              ],

              weightingRequired:
                false,

              methodologyNotes:
                form.methodologyNotes,

              ownerUserId:
                null

            })
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

        return jurisdictionTypes
          .find(
            function (item) {

              return (
                item.code ===
                "ASSEMBLY"
              );
            }
          )
          ?.name ||
          "Assembly Constituency";

      },
      [
        jurisdictionTypes
      ]
    );


  return (
    <AppShell>

      <div className="p-8">

        <div className="flex items-start justify-between">

          <div>

            <p className="text-sm font-medium text-indigo-600">
              Research
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Programs
            </h1>

            <p className="mt-2 text-slate-500">
              Create and manage psephology
              survey programs.
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
            + Create Program
          </button>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        {showCreate && (

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <div className="flex items-center justify-between">

              <div>

                <h2 className="text-xl font-semibold text-slate-900">
                  Create Survey Program
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Define the research purpose,
                  election scope and target population.
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
                label="Program Code"
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

                  className="input"
                />
              </Field>


              <Field
                label="Program Name"
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

                  className="input"
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

                  className="input"
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

                  className="input"
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

                  className="input"
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
                label={assemblyTypeName}
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

                  className="input"
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


              {scope && (

                <div className="md:col-span-2 rounded-xl bg-indigo-50 p-5">

                  <div className="grid gap-4 md:grid-cols-3">

                    <ScopeMetric
                      label="Constituency"
                      value={
                        scope
                          .jurisdiction
                          .name
                      }
                    />

                    <ScopeMetric
                      label="Eligible Voters"
                      value={
                        scope
                          .eligibleVoters
                          .toLocaleString()
                      }
                    />

                    <ScopeMetric
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


              <Field
                label="Target Sample"
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

                  className="input"
                />
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

                  className="input"
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
                  createProgram
                }

                className="rounded-lg bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >

                {saving
                  ? "Creating..."
                  : "Create Program"}

              </button>

            </div>

          </div>

        )}


        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold text-slate-900">
              Survey Programs
            </h2>

          </div>


          {loading ? (

            <div className="p-8 text-sm text-slate-500">
              Loading programs...
            </div>

          ) : programs.length === 0 ? (

            <div className="p-8 text-sm text-slate-500">
              No programs created yet.
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left">

                <thead className="bg-slate-50 text-xs uppercase text-slate-500">

                  <tr>

                    <th className="px-5 py-3">
                      Program
                    </th>

                    <th className="px-5 py-3">
                      Scope
                    </th>

                    <th className="px-5 py-3">
                      Target
                    </th>

                    <th className="px-5 py-3">
                      Language
                    </th>

                    <th className="px-5 py-3">
                      Status
                    </th>

                  </tr>

                </thead>


                <tbody>

                  {programs.map(
                    function (program) {

                      return (
                        <tr
                          key={
                            program.id
                          }
                          className="border-t border-slate-100"
                        >

                          <td className="px-5 py-4">

                            <div className="font-medium text-slate-900">
                              {
                                program.study_name
                              }
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              {
                                program.study_code
                              }
                            </div>

                          </td>


                          <td className="px-5 py-4 text-sm">

                            {
                              program
                                .jurisdiction_name ||
                              program
                                .scope_mode ||
                              "-"
                            }

                          </td>


                          <td className="px-5 py-4 text-sm">

                            {
                              program
                                .target_sample_size ??
                              "-"
                            }

                          </td>


                          <td className="px-5 py-4 text-sm">

                            {
                              program
                                .primary_language ||
                              "-"
                            }

                          </td>


                          <td className="px-5 py-4">

                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">

                              {
                                program.status
                              }

                            </span>

                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

          )}

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
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
        }
      `}</style>

    </AppShell>
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


function ScopeMetric({
  label,
  value
}: {
  label: string;
  value: string;
}) {

  return (
    <div>

      <div className="text-xs font-medium uppercase text-indigo-600">
        {label}
      </div>

      <div className="mt-1 font-semibold text-slate-900">
        {value}
      </div>

    </div>
  );
}
