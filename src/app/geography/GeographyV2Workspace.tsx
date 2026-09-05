"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Building2, CheckCircle2, Database, Home, Landmark, Map as MapIcon, MapPin, Search, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import styles from "./geography-v2.module.css";
import { assemblyConstituencies, datasetProfile, legislativeProfile, mlcConstituencies, parliamentaryConstituencies, type LegislativeRecord } from "./telangana-geography-data";

export type GeographyDimension = "ADMINISTRATIVE" | "ELECTORAL" | "LOCAL_BODY";
type Overview = {
  electoral: { total_constituencies: number | string };
  localBody: { total_bodies: number | string; total_areas: number | string };
};
type Geography = { id: string; parent_id: string | null; name: string; geo_type: string; code: string | null };
type Jurisdiction = { id: string; name: string; code: string | null; type_code: string; parent_jurisdiction_id: string | null };
type LocalBody = {
  id: string; parent_local_body_id: string | null; name: string; code: string | null;
  body_type: string; governance_level: string; verification_status: string;
  administrative_units?: Array<{ id: string; name: string; geo_type: string; code: string | null }>;
  electoral_area_count?: number | string;
};
type LocalArea = { id: string; name: string; code: string | null; area_type: string; display_label?: string | null; contested_office_type?: string | null; verification_status: string };
type LegislativeMode = "MP" | "MLA" | "MLC";
type LocalMode = "ZPTC" | "PANCHAYAT" | "CORPORATION" | "MUNICIPALITY";

function asCount(value: number | string | null | undefined) { const count = Number(value); return Number.isFinite(count) ? count : 0; }
function itemsOf<T>(response: { items: T[] } | T[] | null): T[] { return !response ? [] : Array.isArray(response) ? response : response.items; }

export function DimensionTabs({ active, onChange }: { active: GeographyDimension; onChange: (dimension: GeographyDimension) => void }) {
  const dimensions = [
    { code: "ADMINISTRATIVE" as const, label: "Administrative", description: "State, District, Mandal and Village", icon: MapIcon },
    { code: "ELECTORAL" as const, label: "Legislative / Electoral", description: "Parliamentary, Assembly and MLC", icon: Landmark },
    { code: "LOCAL_BODY" as const, label: "Local Body", description: "Urban and Rural electoral areas", icon: Building2 }
  ];
  return <section className={styles.dimensionTabs}>{dimensions.map(function (dimension) {
    const Icon = dimension.icon;
    return <button key={dimension.code} type="button" onClick={function () { onChange(dimension.code); }} className={active === dimension.code ? styles.dimensionTabActive : styles.dimensionTab}>
      <span className={styles.dimensionIcon}><Icon size={19} /></span><span><strong>{dimension.label}</strong><small>{dimension.description}</small></span>
    </button>;
  })}</section>;
}

export function AlternativeGeographyPage({ dimension, onDimensionChange }: {
  dimension: Exclude<GeographyDimension, "ADMINISTRATIVE">; onDimensionChange: (dimension: GeographyDimension) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [geographies, setGeographies] = useState<Geography[]>([]);
  const [localBodies, setLocalBodies] = useState<LocalBody[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [localApiAvailable, setLocalApiAvailable] = useState(true);

  useEffect(function () {
    async function loadLiveData() {
      const results = await Promise.allSettled([apiFetch("/api/geography/overview"), apiFetch("/api/jurisdictions"), apiFetch("/api/geographies"), apiFetch("/api/local-bodies?limit=10000")]);
      if (results[0].status === "fulfilled") setOverview(results[0].value);
      if (results[1].status === "fulfilled") setJurisdictions(results[1].value);
      if (results[2].status === "fulfilled") setGeographies(results[2].value);
      if (results[3].status === "fulfilled") setLocalBodies(itemsOf(results[3].value)); else setLocalApiAvailable(false);
      if (results.slice(0, 3).every(function (result) { return result.status === "rejected"; })) setMessage("Official master is available. Live database status could not be loaded.");
    }
    loadLiveData();
  }, []);

  const electoral = dimension === "ELECTORAL";
  const liveCount = electoral ? asCount(overview?.electoral.total_constituencies) || jurisdictions.length : asCount(overview?.localBody.total_bodies);
  return <AppShell><div className="geography-page">
    <section className="geography-header"><div><div className="geography-eyebrow">{electoral ? "ELECTORAL GEOGRAPHY" : "LOCAL BODY GEOGRAPHY"}</div>
      <h1>{electoral ? "Legislative & Electoral" : "Urban & Rural Local Bodies"}</h1>
      <p>{electoral ? "Select an MP, MLA or MLC constituency and resolve its Administrative scope for campaigns and analysis." : "Navigate institutions, contested areas and their verified Administrative crosswalks."}</p>
    </div></section>
    <DimensionTabs active={dimension} onChange={onDimensionChange} />
    {message && <div className="geography-message">{message}</div>}
    <DatasetStatus masterCount={electoral ? legislativeProfile.totalConstituencies : datasetProfile.localBody.totalBodies} liveCount={liveCount} noun={electoral ? "constituencies" : "local bodies"} />
    <section className={styles.metrics}>{electoral ? <>
      <Metric icon={MapIcon} label="Constituencies" value={legislativeProfile.totalConstituencies} /><Metric icon={Landmark} label="Parliamentary" value={17} />
      <Metric icon={MapPin} label="Assembly" value={119} /><Metric icon={Users} label="MLC Constituencies" value={16} /><Metric icon={Database} label="Geographic MLC Seats" value={19} />
    </> : <><Metric icon={Building2} label="Local Bodies" value={9181} /><Metric icon={Home} label="Rural Bodies" value={9020} />
      <Metric icon={Landmark} label="Urban Bodies" value={161} /><Metric icon={MapPin} label="Urban Divisions / Wards" value={3453} />
      <Metric icon={Database} label="Synced Electoral Areas" value={asCount(overview?.localBody.total_areas)} /></>}</section>
    {electoral ? <LegislativeExplorer jurisdictions={jurisdictions} geographies={geographies} /> : <LocalBodyExplorer bodies={localBodies} geographies={geographies} apiAvailable={localApiAvailable} />}
  </div></AppShell>;
}

function LegislativeExplorer({ jurisdictions, geographies }: { jurisdictions: Jurisdiction[]; geographies: Geography[] }) {
  const [mode, setMode] = useState<LegislativeMode>("MP");
  const [selected, setSelected] = useState<LegislativeRecord | null>(null);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Geography[]>([]);
  const records = mode === "MP" ? parliamentaryConstituencies : mode === "MLA" ? assemblyConstituencies : mlcConstituencies;
  const filtered = records.filter(function (record) { const q = search.trim().toLowerCase(); return !q || `${record.id} ${record.name} ${record.parent}`.toLowerCase().includes(q); });
  useEffect(function () { setSelected(null); setSearch(""); setScope([]); }, [mode]);

  async function choose(record: LegislativeRecord) {
    setSelected(record); setScope([]);
    const live = jurisdictions.find(function (item) { return item.code === record.id || item.name === record.name; });
    if (!live) return;
    try { const result = await apiFetch(`/api/jurisdictions/${live.id}/scope`); setScope(result.geographies || []); } catch { setScope([]); }
  }
  const assemblies = selected?.type === "PC" ? assemblyConstituencies.filter(function (record) { return record.parent === selected.name; }) : [];
  const parent = selected?.type === "AC" ? parliamentaryConstituencies.find(function (record) { return record.name === selected.parent; }) : null;
  const districtNames = selected?.type === "MLC" ? selected.parent.split(",").map(function (name) { return name.trim(); }) : [];
  const districts = geographies.filter(function (geo) { return geo.geo_type === "DISTRICT" && districtNames.includes(geo.name); });

  return <section className={styles.explorerPanel}>
    <ExplorerHeader eyebrow="LEGISLATIVE EXPLORER" title="Choose an elected-office geography" description="Every selection retains its code and Administrative scope for downstream campaign allocation and reporting." />
    <div className={styles.modeTabs}><ModeButton active={mode === "MP"} onClick={function () { setMode("MP"); }} title="MP" subtitle="17 Parliamentary constituencies" />
      <ModeButton active={mode === "MLA"} onClick={function () { setMode("MLA"); }} title="MLA" subtitle="119 Assembly constituencies" />
      <ModeButton active={mode === "MLC"} onClick={function () { setMode("MLC"); }} title="MLC" subtitle="16 geographic constituencies" /></div>
    <div className={styles.explorerGrid}><div className={styles.selectionPane}>
      <label className={styles.explorerSearch}><Search size={16} /><input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder={`Search ${mode} constituency`} /></label>
      <div className={styles.resultCount}>{filtered.length} constituencies</div><div className={styles.selectionList}>{filtered.map(function (record) {
        return <SelectionButton key={record.id} active={selected?.id === record.id} title={record.name} meta={`${record.id} · ${record.reservation || record.typeLabel}`} onClick={function () { choose(record); }} />;
      })}</div></div><div className={styles.detailPane}>
      {!selected ? <EmptySelection icon={Landmark} title={`Select an ${mode} constituency`} description={mode === "MP" ? "Its Assembly segments will appear here." : mode === "MLC" ? "The districts in its extent will appear here." : "Its Parliamentary parent and Administrative links will appear here."} /> : <>
        <ScopeHeading label={selected.typeLabel} title={selected.name} meta={`${selected.id} · ${selected.office}`} onBack={function () { setSelected(null); }} />
        {selected.type === "PC" && <ScopeGroup title="Assembly constituencies in this Parliamentary segment" caption={`${assemblies.length} Assembly segments`}><ScopeCards records={assemblies.map(function (record) { return { id: record.id, title: record.name, meta: `${record.id} · MLA` }; })} /></ScopeGroup>}
        {selected.type === "AC" && parent && <ScopeGroup title="Parliamentary relationship" caption="Verified segment structure"><ScopeCards records={[{ id: parent.id, title: parent.name, meta: `${parent.id} · MP constituency` }]} /></ScopeGroup>}
        {selected.type === "MLC" && <ScopeGroup title="Districts in this MLC constituency" caption={`${districtNames.length} districts`}><ScopeCards records={districtNames.map(function (name) { const district = districts.find(function (item) { return item.name === name; }); return { id: name, title: name, meta: district?.code ? `District · ${district.code}` : "District" }; })} /></ScopeGroup>}
        {!!scope.length && <ScopeGroup title="Administrative crosswalk" caption={`${scope.length} mapped areas`}><ScopeCards records={scope.map(function (geo) { return { id: geo.id, title: geo.name, meta: `${geo.geo_type} · ${geo.code || "No code"}` }; })} /></ScopeGroup>}
        <ScopeReady />
      </>}
    </div></div>
  </section>;
}

function LocalBodyExplorer({ bodies, geographies, apiAvailable }: { bodies: LocalBody[]; geographies: Geography[]; apiAvailable: boolean }) {
  const [mode, setMode] = useState<LocalMode>("ZPTC");
  const [districtId, setDistrictId] = useState(""); const [mandalId, setMandalId] = useState("");
  const [selected, setSelected] = useState<LocalBody | null>(null); const [areas, setAreas] = useState<LocalArea[]>([]); const [search, setSearch] = useState("");
  const districts = useMemo(function () { return geographies.filter(function (g) { return g.geo_type === "DISTRICT"; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }, [geographies]);
  const mandals = geographies.filter(function (g) { return g.geo_type === "MANDAL" && (!districtId || g.parent_id === districtId); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  const villages = geographies.filter(function (g) { return g.geo_type === "VILLAGE" && g.parent_id === mandalId; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  const geographyById = useMemo(function () { return new Map(geographies.map(function (g) { return [g.id, g]; })); }, [geographies]);
  const desiredType = mode === "ZPTC" ? "ZILLA_PARISHAD" : mode === "PANCHAYAT" ? "GRAM_PANCHAYAT" : mode === "CORPORATION" ? "MUNICIPAL_CORPORATION" : "MUNICIPALITY";
  const filtered = bodies.filter(function (body) {
    const q = search.trim().toLowerCase(); if (body.body_type !== desiredType || (q && !`${body.name} ${body.code || ""}`.toLowerCase().includes(q))) return false;
    if (!districtId && !mandalId) return true;
    return (body.administrative_units || []).some(function (linked) {
      let current = geographyById.get(linked.id);
      while (current) {
        if (current.id === (mandalId || districtId)) return true;
        current = current.parent_id ? geographyById.get(current.parent_id) : undefined;
      }
      return false;
    });
  });
  useEffect(function () { setSelected(null); setAreas([]); setSearch(""); if (mode !== "PANCHAYAT") setMandalId(""); }, [mode]);
  async function choose(body: LocalBody) { setSelected(body); setAreas([]); try { const response = await apiFetch(`/api/local-bodies/${body.id}/electoral-areas?limit=5000`); setAreas(itemsOf(response)); } catch { setAreas([]); } }

  return <section className={styles.explorerPanel}>
    <ExplorerHeader eyebrow="LOCAL BODY EXPLORER" title="Navigate institutions and contested areas" description="Use District and Mandal links to keep local elections aligned with the Administrative master." />
    <div className={styles.modeTabs}><ModeButton active={mode === "ZPTC"} onClick={function () { setMode("ZPTC"); }} title="ZPTC → MPTC" subtitle="Rural tier structure" />
      <ModeButton active={mode === "PANCHAYAT"} onClick={function () { setMode("PANCHAYAT"); }} title="Panchayats" subtitle="District → Mandal → Village" />
      <ModeButton active={mode === "CORPORATION"} onClick={function () { setMode("CORPORATION"); }} title="Corporations" subtitle="Corporation → Division" />
      <ModeButton active={mode === "MUNICIPALITY"} onClick={function () { setMode("MUNICIPALITY"); }} title="Municipalities" subtitle="Municipality → Ward" /></div>
    <div className={styles.filterBar}><select value={districtId} onChange={function (e) { setDistrictId(e.target.value); setMandalId(""); setSelected(null); }}><option value="">All districts</option>{districts.map(function (g) { return <option key={g.id} value={g.id}>{g.name}</option>; })}</select>
      {mode === "PANCHAYAT" && <select value={mandalId} disabled={!districtId} onChange={function (e) { setMandalId(e.target.value); setSelected(null); }}><option value="">{districtId ? "All mandals" : "Select district first"}</option>{mandals.map(function (g) { return <option key={g.id} value={g.id}>{g.name}</option>; })}</select>}
      <label className={styles.explorerSearch}><Search size={16} /><input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search local body" /></label></div>
    {mode === "ZPTC" && <SourceGap title="Official ZPTC and MPTC constituency rows are required" description="Zilla Parishads and Mandal Praja Parishads are synchronized. ZPTC → related MPTC navigation will activate when official contested-area codes and boundaries are loaded." />}
    <div className={styles.explorerGrid}><div className={styles.selectionPane}><div className={styles.resultCount}>{mode === "PANCHAYAT" && mandalId ? `${villages.length} villages` : `${filtered.length} institutions`}</div>
      <div className={styles.selectionList}>{mode === "PANCHAYAT" && mandalId ? villages.map(function (village) {
        const panchayat = filtered.find(function (body) { return (body.administrative_units || []).some(function (g) { return g.id === village.id; }); });
        return panchayat
          ? <SelectionButton key={village.id} active={selected?.id === panchayat.id} title={village.name} meta={`Gram Panchayat: ${panchayat.name} · ${village.code || "No village code"}`} onClick={function () { choose(panchayat); }} />
          : <div key={village.id} className={styles.readonlyItem}><span><strong>{village.name}</strong><small>{village.code || "Village code unavailable"} · no supplied GP assignment</small></span><Home size={16} /></div>;
      }) : filtered.slice(0, 1000).map(function (body) { return <SelectionButton key={body.id} active={selected?.id === body.id} title={body.name} meta={body.code || body.body_type.replaceAll("_", " ")} onClick={function () { choose(body); }} />; })}
        {!apiAvailable && <div className={styles.inlineNotice}><AlertCircle size={17} /><span>Install the local-body explorer API to load individual synchronized institutions and wards.</span></div>}</div></div>
      <div className={styles.detailPane}>{!selected ? <EmptySelection icon={Building2} title={mode === "PANCHAYAT" && mandalId ? "Village structure selected" : "Select a local body"} description={mode === "CORPORATION" ? "Its divisions and Administrative coverage will appear here." : mode === "MUNICIPALITY" ? "Its wards and Administrative coverage will appear here." : mode === "PANCHAYAT" ? "Choose a district and mandal, or select a Gram Panchayat." : "ZPTC and related MPTC areas will appear after the official source is loaded."} /> : <>
        <ScopeHeading label={selected.body_type.replaceAll("_", " ")} title={selected.name} meta={selected.code || "No code supplied"} onBack={function () { setSelected(null); }} />
        <ScopeGroup title={mode === "CORPORATION" ? "Divisions" : mode === "MUNICIPALITY" ? "Wards" : "Contested electoral areas"} caption={`${areas.length} areas`}>{areas.length ? <ScopeCards records={areas.map(function (area) { return { id: area.id, title: area.display_label || area.name, meta: `${area.code || area.area_type} · ${(area.contested_office_type || "").replaceAll("_", " ")}` }; })} /> : <div className={styles.emptyInline}>No synchronized contested-area rows for this institution.</div>}</ScopeGroup>
        {!!selected.administrative_units?.length && <ScopeGroup title="Administrative coverage" caption="Verified crosswalk"><ScopeCards records={selected.administrative_units.map(function (g) { return { id: g.id, title: g.name, meta: `${g.geo_type} · ${g.code || "No code"}` }; })} /></ScopeGroup>}<ScopeReady />
      </>}</div></div>
  </section>;
}

function ExplorerHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className={styles.explorerHeader}><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><div className={styles.scopeLegend}><Database size={16} /><span>Campaign & analysis ready scope</span></div></div>; }
function ModeButton({ active, onClick, title, subtitle }: { active: boolean; onClick: () => void; title: string; subtitle: string }) { return <button type="button" onClick={onClick} className={active ? styles.modeActive : styles.modeButton}><strong>{title}</strong><small>{subtitle}</small></button>; }
function SelectionButton({ active, title, meta, onClick }: { active: boolean; title: string; meta: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={active ? styles.selectionActive : styles.selectionItem}><span><strong>{title}</strong><small>{meta}</small></span><MapPin size={16} /></button>; }
function ScopeHeading({ label, title, meta, onBack }: { label: string; title: string; meta: string; onBack: () => void }) { return <div className={styles.scopeHeading}><button type="button" onClick={onBack}><ArrowLeft size={16} /></button><div><span>{label}</span><h3>{title}</h3><p>{meta}</p></div></div>; }
function ScopeGroup({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) { return <section className={styles.scopeGroup}><div className={styles.scopeGroupHeader}><h4>{title}</h4><span>{caption}</span></div>{children}</section>; }
function ScopeCards({ records }: { records: Array<{ id: string; title: string; meta: string }> }) { return <div className={styles.scopeCards}>{records.map(function (record) { return <div key={record.id} className={styles.scopeCard}><span><MapIcon size={15} /></span><div><strong>{record.title}</strong><small>{record.meta}</small></div></div>; })}</div>; }
function ScopeReady() { return <div className={styles.scopeReady}><CheckCircle2 size={17} /><div><strong>Reusable geography scope</strong><span>This selection can drive mandal allocation, voter resolution and outcome analysis.</span></div></div>; }
function SourceGap({ title, description }: { title: string; description: string }) { return <div className={styles.sourceGap}><AlertCircle size={18} /><div><strong>{title}</strong><span>{description}</span></div></div>; }
function EmptySelection({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) { return <div className={styles.emptySelection}><span><Icon size={24} /></span><strong>{title}</strong><p>{description}</p></div>; }

export function DatasetStatus({ masterCount, liveCount, noun }: { masterCount: number; liveCount: number | string; noun: string }) {
  const normalized = asCount(liveCount); const synchronized = normalized >= masterCount;
  return <section className={styles.datasetStatus}><span className={styles.datasetStatusIcon}><CheckCircle2 size={18} /></span><div><strong>Telangana source master loaded</strong><span>{masterCount.toLocaleString()} {noun} in source · {normalized.toLocaleString()} available in database</span></div><em className={synchronized ? styles.synced : styles.pending}>{synchronized ? "Synchronized" : "Import pending"}</em></section>;
}
function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) { return <div className={styles.metric}><div className={styles.metricIcon}><Icon size={18} /></div><span>{label}</span><strong>{value.toLocaleString()}</strong></div>; }
