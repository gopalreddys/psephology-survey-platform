"use client";

import {
  useEffect,
  useState
} from "react";

import {
  CheckCircle2,
  Database,
  FileSpreadsheet,
  MapPinned,
  Phone,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserCheck,
  Users
} from "lucide-react";

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

      <div className="voter-master-page">

        <section className="voter-master-header">

          <div>

            <div className="voter-master-eyebrow">
              VOTER DATA MANAGEMENT
            </div>

            <h1>
              Voter Master
            </h1>

            <p>
              Manage the canonical voter database used for
              survey sampling, geography mapping and
              AI voice survey execution.
            </p>

          </div>


          <button
            type="button"

            onClick={
              loadData
            }

            className="voter-refresh-button"
          >
            <RefreshCw size={15} />
            Refresh
          </button>

        </section>


        {message && (

          <div className="voter-message">
            {message}
          </div>

        )}


        <section className="voter-summary-grid">

          <SummaryMetric
            icon={Database}
            title="Total Voters"
            value={
              summary?.total_voters ?? 0
            }
          />

          <SummaryMetric
            icon={UserCheck}
            title="Active"
            value={
              summary?.active_voters ?? 0
            }
          />

          <SummaryMetric
            icon={Phone}
            title="With Phone"
            value={
              summary?.voters_with_phone ?? 0
            }
          />

          <SummaryMetric
            icon={MapPinned}
            title="Geo Mapped"
            value={
              summary?.geography_mapped ?? 0
            }
          />

          <SummaryMetric
            icon={ShieldCheck}
            title="Constituency Mapped"
            value={
              summary?.jurisdiction_mapped ?? 0
            }
          />

        </section>


        <section className="voter-upload-panel">

          <div className="voter-upload-header">

            <div className="voter-upload-icon">
              <FileSpreadsheet size={19} />
            </div>


            <div>

              <div className="voter-master-eyebrow">
                DATA INGESTION
              </div>

              <h2>
                Upload Voter Data
              </h2>

              <p>
                Validate and load voter records into the
                canonical voter master.
              </p>

            </div>

          </div>


          <div className="voter-upload-content">

            <div className="voter-upload-zone">

              <div>

                <strong>
                  Select voter data file
                </strong>

                <span>
                  Supported formats: XLSX, XLS and CSV
                </span>

              </div>


              <input
                id="voter-file-input"

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

                className="voter-file-input"
              />


              <label
                htmlFor="voter-file-input"
                className="voter-file-button"
              >
                <Upload size={15} />

                {
                  file
                    ? "Change File"
                    : "Choose File"
                }
              </label>

            </div>


            {file && (

              <div className="voter-selected-file">

                <FileSpreadsheet size={16} />

                <span>
                  {file.name}
                </span>

              </div>

            )}


            <div className="voter-upload-actions">

              <div className="voter-upload-note">
                Uploaded records are validated before
                insertion or update.
              </div>


              <button
                type="button"

                disabled={
                  !file ||
                  uploading
                }

                onClick={
                  uploadFile
                }

                className="voter-upload-submit"
              >

                {
                  uploading
                    ? (
                      <>
                        <RefreshCw
                          size={15}
                          className="voter-spin"
                        />
                        Processing...
                      </>
                    )
                    : (
                      <>
                        <CheckCircle2 size={15} />
                        Validate & Upload
                      </>
                    )
                }

              </button>

            </div>

          </div>


          {uploadResult && (

            <div className="voter-upload-results">

              <div className="voter-upload-results-title">
                Upload Processing Summary
              </div>


              <div className="voter-result-grid">

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

            </div>

          )}

        </section>


        <section className="voter-records-panel">

          <div className="voter-records-header">

            <div>

              <div className="voter-master-eyebrow">
                MASTER RECORDS
              </div>

              <h2>
                Voter Records
              </h2>

              <p>
                Showing up to 100 records from the
                canonical voter master.
              </p>

            </div>


            <div className="voter-record-count">
              <Users size={14} />
              {voters.length} Loaded
            </div>

          </div>


          {
            loading
              ? (

                <div className="voter-loading">
                  Loading voters...
                </div>

              )
              : voters.length === 0
                ? (

                  <div className="voter-empty">

                    <Users size={24} />

                    <strong>
                      No voter records available
                    </strong>

                    <span>
                      Upload a voter dataset to begin.
                    </span>

                  </div>

                )
                : (

                  <div className="voter-table-wrap">

                    <table className="voter-table">

                      <thead>

                        <tr>

                          <th>
                            EPIC
                          </th>

                          <th>
                            Voter
                          </th>

                          <th>
                            Age / Gender
                          </th>

                          <th>
                            Mandal
                          </th>

                          <th>
                            Assembly
                          </th>

                          <th>
                            Qualification
                          </th>

                          <th>
                            Phone
                          </th>

                        </tr>

                      </thead>


                      <tbody>

                        {
                          voters.map(
                            function (voter) {

                              return (

                                <tr
                                  key={
                                    voter.id
                                  }
                                >

                                  <td>

                                    <span className="voter-epic">
                                      {
                                        voter.epic_number ||
                                        voter.app_id ||
                                        "-"
                                      }
                                    </span>

                                  </td>


                                  <td>

                                    <div className="voter-name">
                                      {voter.full_name}
                                    </div>

                                    <div className="voter-secondary">
                                      {
                                        voter.preferred_language ||
                                        "Language not set"
                                      }
                                    </div>

                                  </td>


                                  <td>

                                    <div className="voter-cell-primary">
                                      {
                                        voter.age ??
                                        "-"
                                      }
                                      {" / "}
                                      {
                                        voter.gender ||
                                        "-"
                                      }
                                    </div>

                                  </td>


                                  <td>

                                    <div className="voter-cell-primary">
                                      {
                                        voter.mandal_name_source ||
                                        "-"
                                      }
                                    </div>

                                    {
                                      voter.geography_name &&
                                      voter.geography_name !==
                                      voter.mandal_name_source
                                        ? (

                                          <div className="voter-secondary">
                                            {voter.geography_name}
                                          </div>

                                        )
                                        : null
                                    }

                                  </td>


                                  <td>

                                    <div className="voter-cell-primary">
                                      {
                                        voter.assembly_constituency_name ||
                                        "-"
                                      }
                                    </div>

                                    {
                                      voter.assembly_constituency_no
                                        ? (

                                          <div className="voter-secondary">
                                            AC-
                                            {
                                              voter.assembly_constituency_no
                                            }
                                          </div>

                                        )
                                        : null
                                    }

                                  </td>


                                  <td>

                                    <div className="voter-cell-primary">
                                      {
                                        voter.qualification ||
                                        "-"
                                      }
                                    </div>

                                    {
                                      voter.occupation
                                        ? (

                                          <div className="voter-secondary">
                                            {voter.occupation}
                                          </div>

                                        )
                                        : null
                                    }

                                  </td>


                                  <td>

                                    <div className="voter-phone">
                                      <Phone size={13} />

                                      {
                                        voter.phone_number ||
                                        "-"
                                      }
                                    </div>

                                  </td>

                                </tr>
                              );
                            }
                          )
                        }

                      </tbody>

                    </table>

                  </div>

                )
          }

        </section>

      </div>

    </AppShell>
  );
}


function SummaryMetric({
  icon: Icon,
  title,
  value
}: {
  icon: React.ElementType;
  title: string;
  value: number;
}) {

  return (

    <div className="voter-summary-card">

      <div className="voter-summary-icon">
        <Icon size={17} />
      </div>


      <div>

        <span>
          {title}
        </span>

        <strong>
          {value.toLocaleString()}
        </strong>

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

    <div className="voter-result-card">

      <span>
        {label}
      </span>

      <strong>
        {value ?? 0}
      </strong>

    </div>
  );
}
