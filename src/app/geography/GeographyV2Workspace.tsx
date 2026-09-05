"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2, CheckCircle2, ChevronRight, Database, Home,
  Landmark, Map, MapPin, Search, Users
} from "lucide-react";

import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import styles from "./geography-v2.module.css";
import {
  datasetProfile,
  legislativeProfile,
  legislativeRecords,
  localBodyDatasets,
  type LegislativeRecord
} from "./telangana-geography-data";

export type GeographyDimension =
  | "ADMINISTRATIVE"
  | "ELECTORAL"
  | "LOCAL_BODY";

type Overview = {
  electoral: {
    total_constituencies: number;
    mapped_constituencies: number;
  };
  localBody: {
    total_bodies: number;
    total_areas: number;
  };
  crosswalk: {
    local_body_mappings: number;
    local_body_area_mappings: number;
  };
};

type Jurisdiction = {
  id: string;
  type_code: string;
};

export function DimensionTabs({
  active,
  onChange
}: {
  active: GeographyDimension;
  onChange: (dimension: GeographyDimension) => void;
}) {
  const dimensions = [
    {
      code: "ADMINISTRATIVE" as GeographyDimension,
      label: "Administrative",
      description: "State, District, Mandal and Village",
      icon: Map
    },
    {
      code: "ELECTORAL" as GeographyDimension,
      label: "Legislative / Electoral",
      description: "Parliamentary, Assembly and MLC",
      icon: Landmark
    },
    {
      code: "LOCAL_BODY" as GeographyDimension,
      label: "Local Body",
      description: "Urban and Rural electoral areas",
      icon: Building2
    }
  ];

  return (
    <section className={styles.dimensionTabs}>
      {dimensions.map(function (dimension) {
        const Icon = dimension.icon;
        const selected = active === dimension.code;

        return (
          <button
            key={dimension.code}
            type="button"
            onClick={function () { onChange(dimension.code); }}
            className={selected ? styles.dimensionTabActive : styles.dimensionTab}
          >
            <span className={styles.dimensionIcon}><Icon size={19} /></span>
            <span>
              <strong>{dimension.label}</strong>
              <small>{dimension.description}</small>
            </span>
          </button>
        );
      })}
    </section>
  );
}

export function AlternativeGeographyPage({
  dimension,
  onDimensionChange
}: {
  dimension: Exclude<GeographyDimension, "ADMINISTRATIVE">;
  onDimensionChange: (dimension: GeographyDimension) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [recordType, setRecordType] = useState("ALL");
  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(function () {
    async function loadLiveStatus() {
      const results = await Promise.allSettled([
        apiFetch("/api/geography/overview"),
        apiFetch("/api/jurisdictions")
      ]);

      if (results[0].status === "fulfilled") {
        setOverview(results[0].value);
      }
      if (results[1].status === "fulfilled") {
        setJurisdictions(results[1].value);
      }
      if (results.every(function (result) { return result.status === "rejected"; })) {
        setMessage("Official master is available. Live database status could not be loaded.");
      }
    }

    loadLiveStatus();
  }, []);

  const isElectoral = dimension === "ELECTORAL";
  const filteredRecords = useMemo(function () {
    const query = search.trim().toLowerCase();

    return legislativeRecords.filter(function (record) {
      if (recordType !== "ALL" && record.type !== recordType) return false;
      if (!query) return true;

      return [record.id, record.name, record.typeLabel, record.parent, record.office, record.reservation]
        .filter(Boolean)
        .some(function (value) {
          return String(value).toLowerCase().includes(query);
        });
    });
  }, [recordType, search]);

  const visibleRecords = filteredRecords.slice(0, visibleCount);
  const liveElectoralCount = overview?.electoral.total_constituencies || jurisdictions.length;
  const liveLocalBodyCount = overview?.localBody.total_bodies || 0;
  const liveLocalAreaCount = overview?.localBody.total_areas || 0;

  return (
    <AppShell>
      <div className="geography-page">
        <section className="geography-header">
          <div>
            <div className="geography-eyebrow">
              {isElectoral ? "ELECTORAL GEOGRAPHY" : "LOCAL BODY GEOGRAPHY"}
            </div>
            <h1>{isElectoral ? "Legislative & Electoral" : "Urban & Rural Local Bodies"}</h1>
            <p>
              {isElectoral
                ? "The official Telangana PC, AC and geographic Legislative Council master connected through Administrative crosswalks."
                : "Telangana local body institutions, contested electoral areas and their Administrative crosswalks."}
            </p>
          </div>
        </section>

        <DimensionTabs active={dimension} onChange={onDimensionChange} />

        {message && <div className="geography-message">{message}</div>}

        <DatasetStatus
          masterCount={isElectoral ? legislativeProfile.totalConstituencies : datasetProfile.localBody.totalBodies}
          liveCount={isElectoral ? liveElectoralCount : liveLocalBodyCount}
          noun={isElectoral ? "constituencies" : "local bodies"}
        />

        <section className={styles.metrics}>
          {isElectoral ? (
            <>
              <Metric icon={Map} label="Constituencies" value={legislativeProfile.totalConstituencies} />
              <Metric icon={Landmark} label="Parliamentary" value={legislativeProfile.parliamentary} />
              <Metric icon={MapPin} label="Assembly" value={legislativeProfile.assembly} />
              <Metric icon={Users} label="MLC Constituencies" value={legislativeProfile.mlcConstituencies} />
              <Metric icon={Database} label="Geographic MLC Seats" value={legislativeProfile.mlcSeats} />
            </>
          ) : (
            <>
              <Metric icon={Building2} label="Local Bodies" value={datasetProfile.localBody.totalBodies} />
              <Metric icon={Home} label="Rural Bodies" value={datasetProfile.localBody.ruralBodies} />
              <Metric icon={Landmark} label="Urban Bodies" value={datasetProfile.localBody.urbanBodies} />
              <Metric icon={MapPin} label="Urban Divisions / Wards" value={datasetProfile.localBody.urbanWards} />
              <Metric icon={Database} label="Synced Electoral Areas" value={liveLocalAreaCount} />
            </>
          )}
        </section>

        <section className={styles.hierarchyPanel}>
          {isElectoral ? (
            <>
              <Hierarchy level="Lok Sabha" geography="Parliamentary Constituency" office="MP" />
              <Hierarchy level="Legislative Assembly" geography="Assembly Constituency" office="MLA" />
              <Hierarchy level="Legislative Council" geography="Local Authorities / Graduates / Teachers" office="MLC" />
            </>
          ) : (
            <>
              <Hierarchy level="Rural" geography="Zilla Parishad → ZPTC" office="ZPTC Member" />
              <Hierarchy level="Rural" geography="Mandal Praja Parishad → MPTC" office="MPTC Member" />
              <Hierarchy level="Village" geography="Gram Panchayat → GP / GP Ward" office="Sarpanch / Ward Member" />
              <Hierarchy level="Urban" geography="Municipal Corporation → Division" office="Corporator" />
              <Hierarchy level="Urban" geography="Municipality → Ward" office="Councillor" />
            </>
          )}
        </section>

        <section className="geography-master-panel">
          <div className="geography-master-toolbar">
            <div>
              <div className="geography-eyebrow">
                {isElectoral ? "ELECTORAL MASTER" : "LOCAL BODY DATASETS"}
              </div>
              <h2>{isElectoral ? "Telangana Constituencies" : "Institutions and Electoral Areas"}</h2>
              <p>
                {isElectoral
                  ? "Official PC, AC and geographic MLC catalog. MP, MLA and MLC are represented as offices."
                  : "Source totals are shown separately from records synchronized to the database."}
              </p>
            </div>

            {isElectoral && (
              <div className="geography-toolbar-actions">
                <label className="geography-search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={function (event) {
                      setSearch(event.target.value);
                      setVisibleCount(30);
                    }}
                    placeholder="Search constituency"
                  />
                </label>
                <select
                  value={recordType}
                  onChange={function (event) {
                    setRecordType(event.target.value);
                    setVisibleCount(30);
                  }}
                  className="geography-type-filter"
                  aria-label="Constituency type"
                >
                  <option value="ALL">All Types</option>
                  <option value="PC">Parliamentary</option>
                  <option value="AC">Assembly</option>
                  <option value="MLC">MLC</option>
                </select>
              </div>
            )}
          </div>

          <div className="geography-table-wrap">
            {isElectoral ? <LegislativeTable records={visibleRecords} /> : <LocalBodyTable />}
          </div>

          {isElectoral && visibleRecords.length < filteredRecords.length && (
            <div className={styles.tableFooter}>
              <span>Showing {visibleRecords.length} of {filteredRecords.length}</span>
              <button type="button" onClick={function () { setVisibleCount(visibleCount + 30); }}>
                Show more
              </button>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export function DatasetStatus({ masterCount, liveCount, noun }: {
  masterCount: number;
  liveCount: number;
  noun: string;
}) {
  const synchronized = masterCount === liveCount;

  return (
    <section className={styles.datasetStatus}>
      <span className={styles.datasetStatusIcon}><CheckCircle2 size={18} /></span>
      <div>
        <strong>Telangana source master loaded</strong>
        <span>{masterCount.toLocaleString()} {noun} in source · {liveCount.toLocaleString()} synchronized to database</span>
      </div>
      <em className={synchronized ? styles.synced : styles.pending}>
        {synchronized ? "Synchronized" : "Import pending"}
      </em>
    </section>
  );
}

function LegislativeTable({ records }: { records: LegislativeRecord[] }) {
  return (
    <table className="geography-table">
      <thead>
        <tr>
          <th>Constituency</th><th>Type</th><th>Reservation</th>
          <th>Parent / Extent</th><th>Office</th><th className="numeric">Seats</th>
        </tr>
      </thead>
      <tbody>
        {records.map(function (record) {
          return (
            <tr key={record.id}>
              <td>
                <div className="geography-name-cell">
                  <div className="geography-row-icon"><Landmark size={16} /></div>
                  <div><strong>{record.name}</strong><span>{record.id}</span></div>
                </div>
              </td>
              <td><span className="geography-type-badge">{record.typeLabel}</span></td>
              <td>{record.reservation || "—"}</td>
              <td>{record.parent}</td>
              <td>{record.office}</td>
              <td className="numeric">{record.seats}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LocalBodyTable() {
  return (
    <table className="geography-table">
      <thead>
        <tr>
          <th>Dataset</th><th>Level</th><th>Administrative Link</th>
          <th className="numeric">Source Records</th><th>Import Status</th>
        </tr>
      </thead>
      <tbody>
        {localBodyDatasets.map(function (dataset) {
          return (
            <tr key={dataset.name}>
              <td>
                <div className="geography-name-cell">
                  <div className="geography-row-icon"><Building2 size={16} /></div>
                  <strong>{dataset.name}</strong>
                </div>
              </td>
              <td>{dataset.level}</td>
              <td>{dataset.geography}</td>
              <td className="numeric">{dataset.count === null ? "—" : dataset.count.toLocaleString()}</td>
              <td><span className={styles.statusText}>{dataset.status}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Metric({ icon: Icon, label, value }: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricIcon}><Icon size={18} /></div>
      <span>{label}</span><strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function Hierarchy({ level, geography, office }: {
  level: string;
  geography: string;
  office: string;
}) {
  return (
    <div className={styles.hierarchyRow}>
      <strong>{level}</strong><ChevronRight size={15} />
      <span>{geography}</span><ChevronRight size={15} /><span>{office}</span>
    </div>
  );
}
