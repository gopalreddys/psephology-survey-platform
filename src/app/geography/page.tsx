"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  Home,
  Landmark,
  Map,
  MapPin,
  Plus,
  Users,
  X
} from "lucide-react";

import AppShell
  from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";

import {
  apiFetch
} from "@/lib/api";

import {
  AdministrativeHierarchyExplorer,
  AlternativeGeographyPage,
  DatasetStatus,
  DimensionTabs,
  type GeographyDimension
} from "./GeographyV2Workspace";

import {
  datasetProfile
} from "./telangana-geography-data";


type Geography = {
  id: string;
  parent_id: string | null;
  name: string;
  geo_type: string;
  code: string | null;
  urban_rural: string | null;
  population: number | null;
  registered_voters: number | null;
};


const geoTypes = [
  "STATE",
  "DISTRICT",
  "MANDAL",
  "VILLAGE"
];


const parentRules:
  Record<string, string | null> = {

  STATE: null,
  DISTRICT: "STATE",
  MANDAL: "DISTRICT",
  VILLAGE: "MANDAL"
};


export default function GeographyPage() {

  const [
    geographies,
    setGeographies
  ] =
    useState<Geography[]>([]);

  const [
    activeDimension,
    setActiveDimension
  ] =
    useState<GeographyDimension>(
      "ADMINISTRATIVE"
    );

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    showForm,
    setShowForm
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

      name: "",
      geoType: "STATE",
      parentId: "",
      code: "",
      urbanRural: "MIXED",
      population: "",
      registeredVoters: ""
    });


  async function load() {

    setLoading(true);

    try {

      const data =
        await apiFetch(
          "/api/geographies"
        );

      setGeographies(
        data
      );

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load geography"
      );

    } finally {

      setLoading(false);
    }
  }


  useEffect(
    function () {
      let active = true;

      apiFetch(
        "/api/geographies"
      )
        .then(
          function (data) {
            if (active) {
              setGeographies(data);
            }
          }
        )
        .catch(
          function (error) {
            if (active) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Unable to load geography"
              );
            }
          }
        )
        .finally(
          function () {
            if (active) {
              setLoading(false);
            }
          }
        );

      return function () {
        active = false;
      };
    },
    []
  );


  const requiredParentType =
    parentRules[
      form.geoType
    ];


  const parentOptions =
    useMemo(
      function () {

        if (!requiredParentType) {
          return [];
        }

        return geographies.filter(
          function (geo) {

            return (
              geo.geo_type ===
              requiredParentType
            );
          }
        );

      },
      [
        geographies,
        requiredParentType
      ]
    );




  async function createGeography(
    event: React.FormEvent
  ) {

    event.preventDefault();

    setSaving(true);
    setMessage(null);

    try {

      await apiFetch(
        "/api/geographies",
        {
          method: "POST",

          body:
            JSON.stringify({

              name:
                form.name,

              geoType:
                form.geoType,

              parentId:
                form.parentId ||
                null,

              code:
                form.code ||
                null,

              urbanRural:
                form.urbanRural,

              population:
                form.population
                  ? Number(
                      form.population
                    )
                  : null,

              registeredVoters:
                form.registeredVoters
                  ? Number(
                      form.registeredVoters
                    )
                  : null
            })
        }
      );


      setForm({
        name: "",
        geoType: "STATE",
        parentId: "",
        code: "",
        urbanRural: "MIXED",
        population: "",
        registeredVoters: ""
      });

      setShowForm(false);

      setMessage(
        "Geography created successfully."
      );

      await load();

    } catch (error) {

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create geography"
      );

    } finally {

      setSaving(false);
    }
  }


  const registeredVoters =
    geographies
      .filter(
        function (geo) {
          return geo.geo_type === "VILLAGE";
        }
      )
      .reduce(
        function (sum, geo) {
          return (
            sum +
            Number(
              geo.registered_voters ||
              0
            )
          );
        },
        0
      );

  const liveAdministrativeCount =
    geographies.filter(
      function (geo) {
        return geoTypes.includes(
          geo.geo_type
        );
      }
    ).length;


  if (
    activeDimension !==
    "ADMINISTRATIVE"
  ) {
    return (
      <AlternativeGeographyPage
        dimension={activeDimension}
        onDimensionChange={
          setActiveDimension
        }
      />
    );
  }


  return (
    <AppShell>

      <div className="geography-page">

        <section className="geography-header">

          <div>

            <div className="geography-eyebrow">
              ADMINISTRATIVE GEOGRAPHY
            </div>

            <h1>
              Telangana Geography
            </h1>

            <p>
              Maintain the canonical State, District,
              Mandal and Village hierarchy used by
              every campaign and crosswalk.
            </p>

          </div>


          <button
            type="button"

            onClick={
              function () {
                setShowForm(
                  !showForm
                );
              }
            }

            className="geography-add-button"
          >
            <Plus size={16} />
            Add Administrative Unit
          </button>

        </section>


        <DimensionTabs
          active={activeDimension}
          onChange={
            setActiveDimension
          }
        />


        <DatasetStatus
          masterCount={
            datasetProfile
              .administrative
              .totalUnits
          }
          liveCount={
            liveAdministrativeCount
          }
          noun="administrative units"
        />


        {message && (

          <FeedbackMessage message={message} className="geography-message" />

        )}


        <section className="geography-summary-grid">

          <SummaryCard
            icon={Map}
            label="Geography Records"
            value={
              String(
                datasetProfile
                  .administrative
                  .totalUnits
              )
            }
          />

          <SummaryCard
            icon={Landmark}
            label="Districts"
            value={
              String(
                datasetProfile
                  .administrative
                  .districts
              )
            }
          />

          <SummaryCard
            icon={MapPin}
            label="Mandals"
            value={
              String(
                datasetProfile
                  .administrative
                  .mandals
              )
            }
            emphasis
          />

          <SummaryCard
            icon={Home}
            label="Villages"
            value={
              String(
                datasetProfile
                  .administrative
                  .villages
              )
            }
          />

          <SummaryCard
            icon={Users}
            label="Village Voter Base"
            value={
              registeredVoters
                ? registeredVoters
                    .toLocaleString()
                : "—"
            }
          />

        </section>


        <AdministrativeHierarchyExplorer
          geographies={geographies}
          loading={loading}
        />


        {showForm && (

          <form
            onSubmit={
              createGeography
            }

            className="geography-create-panel"
          >

            <div className="geography-create-header">

              <div>

                <div className="geography-eyebrow">
                  GEOGRAPHY MASTER
                </div>

                <h2>
                  Add Geography
                </h2>

                <p>
                  Add a geographic unit and place it
                  within the correct parent hierarchy.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {
                    setShowForm(false);
                  }
                }

                className="geography-close-button"
              >
                <X size={18} />
              </button>

            </div>


            <div className="geography-create-body">

              <div className="geography-form-heading">

                <div className="geography-form-icon">
                  <MapPin size={17} />
                </div>

                <div>
                  <h3>
                    Geographic Identity
                  </h3>
                  <p>
                    Define the unit, hierarchy,
                    classification and voter base.
                  </p>
                </div>

              </div>


              <div className="geography-form-grid">

                <Field label="Name">

                  <input
                    required

                    value={
                      form.name
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          name:
                            event.target.value
                        });
                      }
                    }

                    className="geography-input"
                  />

                </Field>


                <Field label="Type">

                  <select
                    value={
                      form.geoType
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          geoType:
                            event.target.value,
                          parentId:
                            ""
                        });
                      }
                    }

                    className="geography-input"
                  >

                    {
                      geoTypes.map(
                        function (type) {

                          return (

                            <option
                              key={type}
                              value={type}
                            >
                              {
                                formatLabel(
                                  type
                                )
                              }
                            </option>

                          );
                        }
                      )
                    }

                  </select>

                </Field>


                {requiredParentType && (

                  <Field
                    label={
                      `Parent ${formatLabel(
                        requiredParentType
                      )}`
                    }
                  >

                    <select
                      required

                      value={
                        form.parentId
                      }

                      onChange={
                        function (event) {

                          setForm({
                            ...form,
                            parentId:
                              event.target.value
                          });
                        }
                      }

                      className="geography-input"
                    >

                      <option value="">
                        Select parent
                      </option>

                      {
                        parentOptions.map(
                          function (geo) {

                            return (

                              <option
                                key={geo.id}
                                value={geo.id}
                              >
                                {geo.name}
                              </option>

                            );
                          }
                        )
                      }

                    </select>

                  </Field>

                )}


                <Field label="Code">

                  <input
                    value={
                      form.code
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          code:
                            event.target.value
                        });
                      }
                    }

                    className="geography-input"
                  />

                </Field>


                <Field label="Urban / Rural">

                  <select
                    value={
                      form.urbanRural
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          urbanRural:
                            event.target.value
                        });
                      }
                    }

                    className="geography-input"
                  >

                    <option value="URBAN">
                      Urban
                    </option>

                    <option value="RURAL">
                      Rural
                    </option>

                    <option value="MIXED">
                      Mixed
                    </option>

                  </select>

                </Field>


                <Field label="Population">

                  <input
                    type="number"

                    value={
                      form.population
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          population:
                            event.target.value
                        });
                      }
                    }

                    className="geography-input"
                  />

                </Field>


                <Field label="Registered Voters">

                  <input
                    type="number"

                    value={
                      form.registeredVoters
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          registeredVoters:
                            event.target.value
                        });
                      }
                    }

                    className="geography-input"
                  />

                </Field>

              </div>

            </div>


            <div className="geography-create-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowForm(false);
                  }
                }

                className="geography-cancel-button"
              >
                Cancel
              </button>


              <button
                disabled={
                  saving
                }

                type="submit"

                className="geography-save-button"
              >
                {
                  saving
                    ? "Saving..."
                    : (
                      <>
                        <Plus size={15} />
                        Create Geography
                      </>
                    )
                }
              </button>

            </div>

          </form>

        )}



      </div>

    </AppShell>
  );
}


function SummaryCard({
  icon: Icon,
  label,
  value,
  emphasis = false
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  emphasis?: boolean;
}) {

  return (

    <div
      className={
        emphasis
          ? "geography-summary-card emphasis"
          : "geography-summary-card"
      }
    >

      <div className="geography-summary-icon">
        <Icon size={17} />
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


function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {

  return (

    <label className="geography-field">

      <span>
        {label}
      </span>

      {children}

    </label>
  );
}




function formatLabel(
  value: string
) {

  if (!value || value === "-") {
    return value || "-";
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
