"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  Building2,
  ChevronRight,
  Database,
  Home,
  Landmark,
  Map,
  MapPin,
  Users
} from "lucide-react";

import AppShell
  from "@/components/AppShell";

import {
  apiFetch
} from "@/lib/api";

import styles
  from "./geography-v2.module.css";


export type GeographyDimension =
  | "ADMINISTRATIVE"
  | "ELECTORAL"
  | "LOCAL_BODY";


type Overview = {
  electoral: {
    total_constituencies: number;
    parliamentary: number;
    assembly: number;
    mlc_graduates: number;
    mlc_teachers: number;
    mlc_local_authorities: number;
    mapped_constituencies: number;
  };

  localBody: {
    total_bodies: number;
    zilla_parishads: number;
    mandal_praja_parishads: number;
    gram_panchayats: number;
    municipal_corporations: number;
    municipalities: number;
    total_areas: number;
    zptcs: number;
    mptcs: number;
    sarpanch_areas: number;
    gram_panchayat_wards: number;
    urban_wards: number;
  };

  crosswalk: {
    total_mappings: number;
    verified_mappings: number;
    review_required: number;
    electoral_mappings: number;
    local_body_mappings: number;
    local_body_area_mappings: number;
  };
};


type Jurisdiction = {
  id: string;
  name: string;
  code: string | null;
  type_code: string;
  type_name: string;
  parent_jurisdiction_id: string | null;
};


export function DimensionTabs({
  active,
  onChange
}: {
  active: GeographyDimension;
  onChange:
    (dimension: GeographyDimension) => void;
}) {

  const dimensions = [
    {
      code:
        "ADMINISTRATIVE" as GeographyDimension,
      label:
        "Administrative",
      description:
        "State, District, Mandal and Village",
      icon:
        Map
    },
    {
      code:
        "ELECTORAL" as GeographyDimension,
      label:
        "Legislative / Electoral",
      description:
        "Parliamentary, Assembly and MLC",
      icon:
        Landmark
    },
    {
      code:
        "LOCAL_BODY" as GeographyDimension,
      label:
        "Local Body",
      description:
        "Urban and Rural electoral areas",
      icon:
        Building2
    }
  ];


  return (
    <section className={styles.dimensionTabs}>

      {dimensions.map(
        function (dimension) {

          const Icon =
            dimension.icon;

          const selected =
            active ===
            dimension.code;


          return (
            <button
              key={dimension.code}
              type="button"

              onClick={
                function () {
                  onChange(
                    dimension.code
                  );
                }
              }

              className={
                selected
                  ? styles.dimensionTabActive
                  : styles.dimensionTab
              }
            >

              <span className={styles.dimensionIcon}>
                <Icon size={19} />
              </span>

              <span>
                <strong>
                  {dimension.label}
                </strong>

                <small>
                  {dimension.description}
                </small>
              </span>

            </button>
          );
        }
      )}

    </section>
  );
}


export function AlternativeGeographyPage({
  dimension,
  onDimensionChange
}: {
  dimension: Exclude<
    GeographyDimension,
    "ADMINISTRATIVE"
  >;
  onDimensionChange:
    (dimension: GeographyDimension) => void;
}) {

  const [
    overview,
    setOverview
  ] =
    useState<Overview | null>(
      null
    );

  const [
    jurisdictions,
    setJurisdictions
  ] =
    useState<Jurisdiction[]>([]);

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    message,
    setMessage
  ] =
    useState<string | null>(
      null
    );


  useEffect(
    function () {

      async function load() {

        setLoading(true);
        setMessage(null);

        try {

          const [
            overviewData,
            jurisdictionData
          ] =
            await Promise.all([
              apiFetch(
                "/api/geography/overview"
              ),

              apiFetch(
                "/api/jurisdictions"
              )
            ]);

          setOverview(
            overviewData
          );

          setJurisdictions(
            jurisdictionData
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

      load();

    },
    []
  );


  const jurisdictionById =
    useMemo(
      function () {

        return new globalThis.Map<
          string,
          Jurisdiction
        >(
          jurisdictions.map(
            function (jurisdiction) {

              return [
                jurisdiction.id,
                jurisdiction
              ] as const;
            }
          )
        );

      },
      [
        jurisdictions
      ]
    );


  const isElectoral =
    dimension === "ELECTORAL";

  const ruralBodies =
    (overview?.localBody
      .zilla_parishads || 0) +
    (overview?.localBody
      .mandal_praja_parishads || 0) +
    (overview?.localBody
      .gram_panchayats || 0);

  const urbanBodies =
    (overview?.localBody
      .municipal_corporations || 0) +
    (overview?.localBody
      .municipalities || 0);


  return (
    <AppShell>

      <div className="geography-page">

        <section className="geography-header">

          <div>

            <div className="geography-eyebrow">
              {
                isElectoral
                  ? "ELECTORAL GEOGRAPHY"
                  : "LOCAL BODY GEOGRAPHY"
              }
            </div>

            <h1>
              {
                isElectoral
                  ? "Legislative & Electoral"
                  : "Urban & Rural Local Bodies"
              }
            </h1>

            <p>
              {
                isElectoral
                  ? "Parliamentary, Assembly and geographic Legislative Council constituencies connected to the Administrative master."
                  : "Local body institutions, contested electoral areas and their verified Administrative crosswalks."
              }
            </p>

          </div>

        </section>


        <DimensionTabs
          active={dimension}
          onChange={
            onDimensionChange
          }
        />


        {message && (
          <div className="geography-message">
            {message}
          </div>
        )}


        <section className={styles.metrics}>

          {isElectoral ? (
            <>

              <Metric
                icon={Map}
                label="Constituencies"
                value={
                  overview?.electoral
                    .total_constituencies || 0
                }
              />

              <Metric
                icon={Landmark}
                label="Parliamentary"
                value={
                  overview?.electoral
                    .parliamentary || 0
                }
              />

              <Metric
                icon={MapPin}
                label="Assembly"
                value={
                  overview?.electoral
                    .assembly || 0
                }
              />

              <Metric
                icon={Users}
                label="MLC Constituencies"
                value={
                  (overview?.electoral
                    .mlc_graduates || 0) +
                  (overview?.electoral
                    .mlc_teachers || 0) +
                  (overview?.electoral
                    .mlc_local_authorities || 0)
                }
              />

              <Metric
                icon={Database}
                label="Mapped"
                value={
                  overview?.electoral
                    .mapped_constituencies || 0
                }
              />

            </>
          ) : (
            <>

              <Metric
                icon={Building2}
                label="Local Bodies"
                value={
                  overview?.localBody
                    .total_bodies || 0
                }
              />

              <Metric
                icon={Home}
                label="Rural Bodies"
                value={ruralBodies}
              />

              <Metric
                icon={Landmark}
                label="Urban Bodies"
                value={urbanBodies}
              />

              <Metric
                icon={MapPin}
                label="Electoral Areas"
                value={
                  overview?.localBody
                    .total_areas || 0
                }
              />

              <Metric
                icon={Database}
                label="Crosswalks"
                value={
                  (overview?.crosswalk
                    .local_body_mappings || 0) +
                  (overview?.crosswalk
                    .local_body_area_mappings || 0)
                }
              />

            </>
          )}

        </section>


        <section className={styles.hierarchyPanel}>

          {isElectoral ? (
            <>

              <Hierarchy
                level="Lok Sabha"
                geography="Parliamentary Constituency"
                office="MP"
              />

              <Hierarchy
                level="Legislative Assembly"
                geography="Assembly Constituency"
                office="MLA"
              />

              <Hierarchy
                level="Legislative Council"
                geography="Graduates / Teachers / Local Authorities"
                office="MLC"
              />

            </>
          ) : (
            <>

              <Hierarchy
                level="Rural"
                geography="Zilla Parishad → ZPTC"
                office="ZPTC Member"
              />

              <Hierarchy
                level="Rural"
                geography="Mandal Praja Parishad → MPTC"
                office="MPTC Member"
              />

              <Hierarchy
                level="Village"
                geography="Gram Panchayat → GP Ward"
                office="Sarpanch / Ward Member"
              />

              <Hierarchy
                level="Urban"
                geography="Corporation / Municipality → Ward"
                office="Corporator / Councillor"
              />

            </>
          )}

        </section>


        <section className="geography-master-panel">

          <div className="geography-master-toolbar">

            <div>

              <div className="geography-eyebrow">
                {
                  isElectoral
                    ? "ELECTORAL MASTER"
                    : "LOCAL BODY MASTER"
                }
              </div>

              <h2>
                {
                  isElectoral
                    ? "Constituencies"
                    : "Local Body Institutions"
                }
              </h2>

              <p>
                {
                  isElectoral
                    ? "PC, AC and MLC constituencies with their parent relationships."
                    : "The Geography V2 schema is ready for the Telangana local-body dataset."
                }
              </p>

            </div>

          </div>


          {loading ? (

            <div className="geography-loading">
              Loading geography...
            </div>

          ) : isElectoral ? (

            jurisdictions.length === 0 ? (

              <EmptyState
                icon={Landmark}
                title="No electoral geography"
                description="Import the legislative master to populate this dimension."
              />

            ) : (

              <div className="geography-table-wrap">

                <table className="geography-table">

                  <thead>
                    <tr>
                      <th>Constituency</th>
                      <th>Type</th>
                      <th>Code</th>
                      <th>Parent</th>
                    </tr>
                  </thead>

                  <tbody>

                    {jurisdictions.map(
                      function (jurisdiction) {

                        const parent =
                          jurisdiction
                            .parent_jurisdiction_id
                            ? jurisdictionById.get(
                                jurisdiction
                                  .parent_jurisdiction_id
                              )
                            : null;


                        return (
                          <tr key={jurisdiction.id}>

                            <td>
                              <div className="geography-name-cell">

                                <div className="geography-row-icon">
                                  <Landmark size={16} />
                                </div>

                                <strong>
                                  {jurisdiction.name}
                                </strong>

                              </div>
                            </td>

                            <td>
                              <span className="geography-type-badge">
                                {jurisdiction.type_name}
                              </span>
                            </td>

                            <td>
                              {jurisdiction.code || "—"}
                            </td>

                            <td>
                              {parent?.name || "Independent"}
                            </td>

                          </tr>
                        );
                      }
                    )}

                  </tbody>

                </table>

              </div>
            )

          ) : (

            <EmptyState
              icon={Building2}
              title="Local Body foundation ready"
              description="Import ZP, MPP, GP, ULB and electoral-area records next."
            />

          )}

        </section>

      </div>

    </AppShell>
  );
}


function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {

  return (
    <div className={styles.metric}>

      <div className={styles.metricIcon}>
        <Icon size={18} />
      </div>

      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>

    </div>
  );
}


function Hierarchy({
  level,
  geography,
  office
}: {
  level: string;
  geography: string;
  office: string;
}) {

  return (
    <div className={styles.hierarchyRow}>

      <strong>{level}</strong>

      <ChevronRight size={15} />

      <span>{geography}</span>

      <ChevronRight size={15} />

      <span>{office}</span>

    </div>
  );
}


function EmptyState({
  icon: Icon,
  title,
  description
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {

  return (
    <div className="geography-empty">

      <Icon size={24} />

      <strong>{title}</strong>

      <span>{description}</span>

    </div>
  );
}
