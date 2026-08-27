"use client";

import {
  useEffect,
  useState
} from "react";

import AppShell
  from "@/components/AppShell";

import {
  apiFetch
} from "@/lib/api";


type Summary = {
  total_voters: number;
  active_voters: number;
  voters_with_phone: number;
  geography_mapped: number;
  jurisdiction_mapped: number;
};


type Voter = {
  id: string;

  epic_number:
    string | null;

  app_id:
    string | null;

  full_name:
    string;

  gender:
    string | null;

  age:
    number | null;

  phone_number:
    string | null;

  qualification:
    string | null;

  occupation:
    string | null;

  mandal_name_source:
    string | null;

  assembly_constituency_no:
    string | null;

  assembly_constituency_name:
    string | null;

  geography_name:
    string | null;

  preferred_language:
    string | null;

  contact_status:
    string;
};


export default function VotersPage() {

  const [
    summary,
    setSummary
  ] =
    useState<Summary | null>(
      null
    );


  const [
    voters,
    setVoters
  ] =
    useState<Voter[]>([]);


  const [
    file,
    setFile
  ] =
    useState<File | null>(
      null
    );


  const [
    loading,
    setLoading
  ] =
    useState(true);


  const [
    uploading,
    setUploading
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
    uploadResult,
    setUploadResult
  ] =
    useState<any>(
      null
    );


  async function loadData() {

    setLoading(
      true
    );


    try {

      const [
        summaryData,
        voterData
      ] =
        await Promise.all([

          apiFetch(
            "/api/voters/summary"
          ),

          apiFetch(
            "/api/voters?limit=100"
          )
        ]);


      setSummary(
        summaryData
      );


      setVoters(
        voterData
      );


    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load voter data"
      );

    } finally {

      setLoading(
        false
      );
    }
  }


  useEffect(
    function () {

      loadData();

    },
    []
  );


  async function uploadFile() {

    if (!file) {

      setMessage(
        "Select a voter file first."
      );

      return;
    }


    setUploading(
      true
    );

    setMessage(
      null
    );

    setUploadResult(
      null
    );


    try {

      const formData =
        new FormData();


      formData.append(
        "file",
        file
      );


      const result =
        await apiFetch(
          "/api/voters/upload",
          {
            method:
              "POST",

            body:
              formData
          }
        );


      setUploadResult(
        result.summary
      );


      setMessage(
        "Voter file processed successfully."
      );


      setFile(
        null
      );


      await loadData();


    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Upload failed"
      );

    } finally {

      setUploading(
        false
      );
    }
  }


  return (
    <AppShell>

      <div className="p-8">

        <div>

          <p className="text-sm font-medium text-indigo-600">
            Voter Data
          </p>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Voter Master
          </h1>

          <p className="mt-2 text-slate-500">
            Manage the canonical voter database
            used for survey programs and campaigns.
          </p>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        <div className="mt-8 grid gap-4 md:grid-cols-5">

          <Metric
            title="Total Voters"
            value={
              summary?.total_voters ?? 0
            }
          />

          <Metric
            title="Active"
            value={
              summary?.active_voters ?? 0
            }
          />

          <Metric
            title="With Phone"
            value={
              summary?.voters_with_phone ?? 0
            }
          />

          <Metric
            title="Geo Mapped"
            value={
              summary?.geography_mapped ?? 0
            }
          />

          <Metric
            title="Constituency Mapped"
            value={
              summary?.jurisdiction_mapped ?? 0
            }
          />

        </div>


        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

          <h2 className="text-lg font-semibold text-slate-900">
            Upload Voter Data
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Supported formats:
            XLSX, XLS and CSV
          </p>


          <div className="mt-5 flex items-center gap-4">

            <input
              type="file"

              accept=".xlsx,.xls,.csv"

              onChange={
                function (event) {

                  setFile(
                    event.target
                      .files?.[0] ||
                    null
                  );
                }
              }

              className="block text-sm"
            />


            <button
              type="button"

              disabled={
                !file ||
                uploading
              }

              onClick={
                uploadFile
              }

              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            >

              {uploading
                ? "Processing..."
                : "Validate & Upload"}

            </button>

          </div>


          {uploadResult && (

            <div className="mt-6 grid gap-3 md:grid-cols-4">

              <Result
                label="Received"
                value={
                  uploadResult.received
                }
              />

              <Result
                label="Valid"
                value={
                  uploadResult.valid
                }
              />

              <Result
                label="Inserted"
                value={
                  uploadResult.inserted
                }
              />

              <Result
                label="Updated"
                value={
                  uploadResult.updated
                }
              />

              <Result
                label="Duplicates"
                value={
                  uploadResult.duplicates
                }
              />

              <Result
                label="Rejected"
                value={
                  uploadResult.rejected
                }
              />

              <Result
                label="Geo Unmapped"
                value={
                  uploadResult
                    .unmappedGeography
                }
              />

              <Result
                label="Jurisdiction Unmapped"
                value={
                  uploadResult
                    .unmappedJurisdiction
                }
              />

            </div>

          )}

        </div>


        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold text-slate-900">
              Voter Records
            </h2>

          </div>


          {loading ? (

            <div className="p-8 text-sm text-slate-500">
              Loading voters...
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left">

                <thead className="bg-slate-50 text-xs uppercase text-slate-500">

                  <tr>

                    <th className="px-5 py-3">
                      EPIC
                    </th>

                    <th className="px-5 py-3">
                      Name
                    </th>

                    <th className="px-5 py-3">
                      Age / Gender
                    </th>

                    <th className="px-5 py-3">
                      Mandal
                    </th>

                    <th className="px-5 py-3">
                      Assembly
                    </th>

                    <th className="px-5 py-3">
                      Qualification
                    </th>

                    <th className="px-5 py-3">
                      Phone
                    </th>

                  </tr>

                </thead>


                <tbody>

                  {voters.map(
                    function (voter) {

                      return (
                        <tr
                          key={
                            voter.id
                          }
                          className="border-t border-slate-100"
                        >

                          <td className="px-5 py-4 text-sm">
                            {
                              voter.epic_number ||
                              "-"
                            }
                          </td>

                          <td className="px-5 py-4 text-sm font-medium">
                            {
                              voter.full_name
                            }
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {
                              voter.age ??
                              "-"
                            }
                            {" / "}
                            {
                              voter.gender ||
                              "-"
                            }
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {
                              voter.mandal_name_source ||
                              "-"
                            }
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {
                              voter.assembly_constituency_name ||
                              "-"
                            }
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {
                              voter.qualification ||
                              "-"
                            }
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {
                              voter.phone_number ||
                              "-"
                            }
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

    </AppShell>
  );
}


function Metric({
  title,
  value
}: {
  title: string;
  value: number;
}) {

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="text-sm text-slate-500">
        {title}
      </div>

      <div className="mt-2 text-2xl font-bold text-slate-900">
        {value.toLocaleString()}
      </div>

    </div>
  );
}


function Result({
  label,
  value
}: {
  label: string;
  value: number;
}) {

  return (
    <div className="rounded-lg bg-slate-50 p-3">

      <div className="text-xs text-slate-500">
        {label}
      </div>

      <div className="mt-1 text-lg font-semibold">
        {value ?? 0}
      </div>

    </div>
  );
}
