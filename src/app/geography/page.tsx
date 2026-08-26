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
  "VILLAGE",
  "CORPORATION",
  "DIVISION",
  "WARD"
];


const parentRules:
  Record<
    string,
    string | null
  > = {

  STATE: null,

  DISTRICT:
    "STATE",

  MANDAL:
    "DISTRICT",

  VILLAGE:
    "MANDAL",

  CORPORATION:
    "DISTRICT",

  DIVISION:
    "CORPORATION",

  WARD:
    "DIVISION"
};


export default function GeographyPage() {

  const [
    geographies,
    setGeographies
  ] =
    useState<
      Geography[]
    >([]);


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
    useState<
      string |
      null
    >(null);


  const [
    form,
    setForm
  ] =
    useState({

      name:
        "",

      geoType:
        "STATE",

      parentId:
        "",

      code:
        "",

      urbanRural:
        "MIXED",

      population:
        "",

      registeredVoters:
        ""
    });


  async function load() {

    setLoading(
      true
    );


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

      setLoading(
        false
      );
    }
  }


  useEffect(
    function () {

      load();

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

        if (
          !requiredParentType
        ) {

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
    event:
      React.FormEvent
  ) {

    event.preventDefault();

    setSaving(
      true
    );

    setMessage(
      null
    );


    try {

      await apiFetch(
        "/api/geographies",
        {
          method:
            "POST",

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

        name:
          "",

        geoType:
          "STATE",

        parentId:
          "",

        code:
          "",

        urbanRural:
          "MIXED",

        population:
          "",

        registeredVoters:
          ""
      });


      setShowForm(
        false
      );


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

      setSaving(
        false
      );
    }
  }


  return (
    <AppShell>

      <div className="p-8">

        <div className="flex items-start justify-between">

          <div>

            <p className="text-sm font-medium text-indigo-600">
              Administration
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Geography Management
            </h1>

            <p className="mt-2 text-slate-500">
              Manage state, district, mandal,
              village, corporation, division
              and ward hierarchy.
            </p>

          </div>


          <button
            onClick={
              function () {

                setShowForm(
                  !showForm
                );
              }
            }
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white"
          >
            + Add Geography
          </button>

        </div>


        {message && (

          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {message}
          </div>

        )}


        {showForm && (

          <form
            onSubmit={
              createGeography
            }
            className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >

            <h2 className="text-lg font-semibold">
              Add Geography
            </h2>


            <div className="mt-6 grid gap-5 md:grid-cols-2">

              <Field
                label="Name"
              >

                <input
                  required

                  value={
                    form.name
                  }

                  onChange={
                    function (e) {

                      setForm({
                        ...form,
                        name:
                          e.target.value
                      });
                    }
                  }

                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />

              </Field>


              <Field
                label="Type"
              >

                <select
                  value={
                    form.geoType
                  }

                  onChange={
                    function (e) {

                      setForm({
                        ...form,
                        geoType:
                          e.target.value,
                        parentId:
                          ""
                      });
                    }
                  }

                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >

                  {geoTypes.map(
                    function (type) {

                      return (
                        <option
                          key={
                            type
                          }
                          value={
                            type
                          }
                        >
                          {type}
                        </option>
                      );
                    }
                  )}

                </select>

              </Field>


              {requiredParentType && (

                <Field
                  label={
                    `Parent ${requiredParentType}`
                  }
                >

                  <select
                    required

                    value={
                      form.parentId
                    }

                    onChange={
                      function (e) {

                        setForm({
                          ...form,
                          parentId:
                            e.target.value
                        });
                      }
                    }

                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >

                    <option value="">
                      Select parent
                    </option>

                    {parentOptions.map(
                      function (geo) {

                        return (
                          <option
                            key={
                              geo.id
                            }
                            value={
                              geo.id
                            }
                          >
                            {geo.name}
                          </option>
                        );
                      }
                    )}

                  </select>

                </Field>

              )}


              <Field
                label="Code"
              >

                <input
                  value={
                    form.code
                  }

                  onChange={
                    function (e) {

                      setForm({
                        ...form,
                        code:
                          e.target.value
                      });
                    }
                  }

                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />

              </Field>


              <Field
                label="Urban / Rural"
              >

                <select
                  value={
                    form.urbanRural
                  }

                  onChange={
                    function (e) {

                      setForm({
                        ...form,
                        urbanRural:
                          e.target.value
                      });
                    }
                  }

                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
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


              <Field
                label="Population"
              >

                <input
                  type="number"

                  value={
                    form.population
                  }

                  onChange={
                    function (e) {

                      setForm({
                        ...form,
                        population:
                          e.target.value
                      });
                    }
                  }

                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />

              </Field>


              <Field
                label="Registered Voters"
              >

                <input
                  type="number"

                  value={
                    form.registeredVoters
                  }

                  onChange={
                    function (e) {

                      setForm({
                        ...form,
                        registeredVoters:
                          e.target.value
                      });
                    }
                  }

                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />

              </Field>

            </div>


            <div className="mt-6 flex justify-end gap-3">

              <button
                type="button"

                onClick={
                  function () {

                    setShowForm(
                      false
                    );
                  }
                }

                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>


              <button
                disabled={
                  saving
                }

                type="submit"

                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : "Create"}
              </button>

            </div>

          </form>

        )}


        <div className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold">
              Geography Master
            </h2>

          </div>


          {loading ? (

            <div className="p-8 text-sm text-slate-500">
              Loading geography...
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left">

                <thead className="bg-slate-50 text-xs uppercase text-slate-500">

                  <tr>

                    <th className="px-6 py-3">
                      Name
                    </th>

                    <th className="px-6 py-3">
                      Type
                    </th>

                    <th className="px-6 py-3">
                      Code
                    </th>

                    <th className="px-6 py-3">
                      Area
                    </th>

                    <th className="px-6 py-3">
                      Registered Voters
                    </th>

                  </tr>

                </thead>


                <tbody>

                  {geographies.map(
                    function (geo) {

                      return (
                        <tr
                          key={
                            geo.id
                          }
                          className="border-t border-slate-100"
                        >

                          <td className="px-6 py-4 text-sm font-medium">
                            {geo.name}
                          </td>

                          <td className="px-6 py-4 text-sm">
                            {geo.geo_type}
                          </td>

                          <td className="px-6 py-4 text-sm">
                            {geo.code || "-"}
                          </td>

                          <td className="px-6 py-4 text-sm">
                            {geo.urban_rural || "-"}
                          </td>

                          <td className="px-6 py-4 text-sm">
                            {geo.registered_voters ?? "-"}
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


function Field({
  label,
  children
}: {
  label: string;
  children:
    React.ReactNode;
}) {

  return (
    <label className="block">

      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </span>

      {children}

    </label>
  );
}
