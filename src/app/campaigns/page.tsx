"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ClipboardList, MapPin, Megaphone, Plus, Search, Target, Users, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./campaigns.module.css";

type Campaign = { id: string; campaign_code: string; campaign_name: string; target_name: string; target_type: string; status: string; mandal_count: number; assignment_count: number; eligible_voters: number; start_date: string | null; end_date: string | null };
type Program = { id: string; study_code: string; study_name: string; status: string };
type Jurisdiction = { id: string; name: string; code: string | null; type_code: string; type_name: string; parent_jurisdiction_id: string | null };
type Geography = { id: string; parent_id: string | null; name: string; geo_type: string; code: string | null };
type User = { id: string; full_name: string; email: string; role_code: string; status: string };
type Scope = { geographies: Geography[]; eligibleVoters: number };
type OfficeType = "MP" | "MLA" | "MLC";

const typeMatches: Record<OfficeType, (code: string) => boolean> = {
  MP: function (code) { return /PARLIAMENT|LOK_SABHA|\bPC\b/i.test(code); },
  MLA: function (code) { return /ASSEMBLY|\bAC\b/i.test(code); },
  MLC: function (code) { return /MLC|GRADUATE|TEACHER|LOCAL_AUTH/i.test(code); }
};

export default function CampaignsPage() {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [geographies, setGeographies] = useState<Geography[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [officeType, setOfficeType] = useState<OfficeType>("MLA");
  const [jurisdictionId, setJurisdictionId] = useState("");
  const [scope, setScope] = useState<Scope | null>(null);
  const [selectedMandals, setSelectedMandals] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [mandalSearch, setMandalSearch] = useState("");
  const [form, setForm] = useState({ code: "", name: "", programId: "", startDate: "", endDate: "" });

  async function load(manage: boolean) {
    setLoading(true);
    const requests = manage
      ? [apiFetch("/api/campaigns"), apiFetch("/api/programs"), apiFetch("/api/jurisdictions"), apiFetch("/api/geographies"), apiFetch("/api/users")]
      : [apiFetch("/api/campaigns")];
    const results = await Promise.allSettled(requests);
    if (results[0].status === "fulfilled") setCampaigns(results[0].value);
    if (results[1].status === "fulfilled") setPrograms(results[1].value);
    if (results[2].status === "fulfilled") setJurisdictions(results[2].value);
    if (results[3].status === "fulfilled") setGeographies(results[3].value);
    if (results[4].status === "fulfilled") setUsers(results[4].value);
    if (results.slice(1).some(function (result) { return result.status === "rejected"; })) setMessage("Some campaign planning data could not be loaded.");
    setLoading(false);
  }

  useEffect(function () {
    if (user) load(user.role.code !== "CAMPAIGNER");
  }, [user]);

  const geographyById = useMemo(function () { return new Map(geographies.map(function (geo) { return [geo.id, geo]; })); }, [geographies]);
  const availableJurisdictions = jurisdictions.filter(function (item) { return typeMatches[officeType](item.type_code || ""); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  const campaigners = users.filter(function (user) { return user.role_code === "CAMPAIGNER" && user.status === "ACTIVE"; });

  const resolvedMandals = useMemo(function () {
    if (!scope) return [];
    const ids = new Set<string>();
    for (const linked of scope.geographies || []) {
      if (linked.geo_type === "MANDAL") ids.add(linked.id);
      if (linked.geo_type === "DISTRICT") geographies.filter(function (geo) { return geo.geo_type === "MANDAL" && geo.parent_id === linked.id; }).forEach(function (geo) { ids.add(geo.id); });
      if (linked.geo_type === "VILLAGE" && linked.parent_id) ids.add(linked.parent_id);
    }
    return Array.from(ids).map(function (id) { return geographyById.get(id); }).filter(Boolean).sort(function (a, b) { return a!.name.localeCompare(b!.name); }) as Geography[];
  }, [scope, geographies, geographyById]);

  const visibleMandals = resolvedMandals.filter(function (mandal) { const query = mandalSearch.trim().toLowerCase(); return !query || `${mandal.name} ${mandal.code || ""}`.toLowerCase().includes(query); });
  const selectedJurisdiction = jurisdictions.find(function (item) { return item.id === jurisdictionId; });
  const assignedCount = selectedMandals.filter(function (id) { return Boolean(assignments[id]); }).length;
  const canManage = Boolean(user && user.role.code !== "CAMPAIGNER");

  async function chooseJurisdiction(id: string) {
    setJurisdictionId(id); setScope(null); setSelectedMandals([]); setAssignments({});
    if (!id) return;
    try { const data = await apiFetch(`/api/jurisdictions/${id}/scope`); setScope(data); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to resolve campaign scope"); }
  }

  function toggleMandal(id: string) {
    setSelectedMandals(function (current) { return current.includes(id) ? current.filter(function (item) { return item !== id; }) : [...current, id]; });
  }

  function resetCreate() {
    setShowCreate(false); setJurisdictionId(""); setScope(null); setSelectedMandals([]); setAssignments({}); setMandalSearch("");
    setForm({ code: "", name: "", programId: "", startDate: "", endDate: "" });
  }

  async function createCampaign() {
    if (!form.code.trim() || !form.name.trim() || !jurisdictionId || !selectedMandals.length) {
      setMessage("Campaign code, name, constituency and at least one Mandal are required."); return;
    }
    setSaving(true); setMessage(null);
    try {
      await apiFetch("/api/campaigns", { method: "POST", body: JSON.stringify({
        campaignCode: form.code.trim(), campaignName: form.name.trim(), programId: form.programId || null,
        targetType: officeType, jurisdictionId, targetName: selectedJurisdiction?.name, targetCode: selectedJurisdiction?.code,
        startDate: form.startDate || null, endDate: form.endDate || null, mandalIds: selectedMandals,
        assignments: selectedMandals.filter(function (id) { return assignments[id]; }).map(function (mandalId) { return { mandalId, campaignerUserId: assignments[mandalId] }; })
      }) });
      resetCreate(); setMessage("Campaign created with its Mandal scope and assignments."); await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create campaign"); }
    finally { setSaving(false); }
  }

  return <AppShell><div className={styles.page}>
    <section className={styles.header}><div><span>CAMPAIGN OPERATIONS</span><h1>Campaigns</h1><p>Create a constituency campaign, choose its working Mandals and assign them to campaigners.</p></div>
      {canManage && <button type="button" onClick={function () { setShowCreate(true); }}><Plus size={16} />Create Campaign</button>}</section>
    <section className={styles.metrics}><Metric icon={Megaphone} label="Campaigns" value={campaigns.length} /><Metric icon={Target} label="Active" value={campaigns.filter(function (c) { return c.status === "ACTIVE"; }).length} />
      <Metric icon={MapPin} label="Mandals in Scope" value={campaigns.reduce(function (sum, c) { return sum + Number(c.mandal_count || 0); }, 0)} /><Metric icon={Users} label="Assignments" value={campaigns.reduce(function (sum, c) { return sum + Number(c.assignment_count || 0); }, 0)} /></section>
    {message && <div className={styles.message}>{message}</div>}

    {canManage && showCreate && <section className={styles.createPanel}>
      <div className={styles.panelHeader}><div><span>NEW CAMPAIGN</span><h2>Define campaign geography</h2><p>The selected Mandal IDs become the operational scope for voter retrieval and reporting.</p></div><button type="button" onClick={resetCreate}><X size={18} /></button></div>
      <div className={styles.formGrid}><Field label="Campaign code"><input value={form.code} onChange={function (e) { setForm({ ...form, code: e.target.value }); }} placeholder="TG-AC-2026-01" /></Field>
        <Field label="Campaign name"><input value={form.name} onChange={function (e) { setForm({ ...form, name: e.target.value }); }} placeholder="Campaign name" /></Field>
        <Field label="Research program"><select value={form.programId} onChange={function (e) { setForm({ ...form, programId: e.target.value }); }}><option value="">No linked program</option>{programs.map(function (p) { return <option key={p.id} value={p.id}>{p.study_name}</option>; })}</select></Field>
        <Field label="Schedule"><div className={styles.datePair}><input type="date" value={form.startDate} onChange={function (e) { setForm({ ...form, startDate: e.target.value }); }} /><input type="date" value={form.endDate} onChange={function (e) { setForm({ ...form, endDate: e.target.value }); }} /></div></Field></div>

      <div className={styles.officeTabs}>{(["MP", "MLA", "MLC"] as OfficeType[]).map(function (office) { return <button key={office} type="button" className={officeType === office ? styles.officeActive : ""} onClick={function () { setOfficeType(office); chooseJurisdiction(""); }}><strong>{office}</strong><small>{office === "MP" ? "Parliamentary" : office === "MLA" ? "Assembly" : "Legislative Council"}</small></button>; })}</div>
      <div className={styles.scopeSelector}><Field label={`${officeType} constituency`}><select value={jurisdictionId} onChange={function (e) { chooseJurisdiction(e.target.value); }}><option value="">Select constituency</option>{availableJurisdictions.map(function (j) { return <option key={j.id} value={j.id}>{j.name} {j.code ? `(${j.code})` : ""}</option>; })}</select></Field>
        <div className={styles.scopeSummary}><Target size={18} /><div><strong>{selectedJurisdiction?.name || "No constituency selected"}</strong><span>{scope ? `${resolvedMandals.length} Mandals resolved · ${Number(scope.eligibleVoters || 0).toLocaleString()} currently eligible voters` : "Choose a constituency to resolve its Administrative crosswalk."}</span></div></div></div>

      {scope && <div className={styles.assignmentGrid}><section className={styles.mandalPane}><div className={styles.sectionTitle}><div><h3>Select working Mandals</h3><p>{selectedMandals.length} of {resolvedMandals.length} selected</p></div><button type="button" onClick={function () { setSelectedMandals(selectedMandals.length === resolvedMandals.length ? [] : resolvedMandals.map(function (m) { return m.id; })); }}>{selectedMandals.length === resolvedMandals.length ? "Clear all" : "Select all"}</button></div>
        <label className={styles.search}><Search size={15} /><input value={mandalSearch} onChange={function (e) { setMandalSearch(e.target.value); }} placeholder="Search Mandals" /></label>
        <div className={styles.mandalList}>{visibleMandals.map(function (mandal) { const checked = selectedMandals.includes(mandal.id); return <button key={mandal.id} type="button" onClick={function () { toggleMandal(mandal.id); }} className={checked ? styles.mandalSelected : styles.mandalItem}><span className={styles.checkbox}>{checked && <Check size={13} />}</span><span><strong>{mandal.name}</strong><small>{mandal.code || "No Mandal code"}</small></span></button>; })}{!resolvedMandals.length && <div className={styles.empty}>No Mandals are mapped to this constituency. Complete its Administrative crosswalk first.</div>}</div></section>
        <section className={styles.assignPane}><div className={styles.sectionTitle}><div><h3>Assign campaigners</h3><p>{assignedCount} of {selectedMandals.length} assigned</p></div></div><div className={styles.assignList}>{selectedMandals.map(function (id) { const mandal = geographyById.get(id); return <label key={id}><span><strong>{mandal?.name}</strong><small>{mandal?.code}</small></span><select value={assignments[id] || ""} onChange={function (e) { setAssignments({ ...assignments, [id]: e.target.value }); }}><option value="">Unassigned</option>{campaigners.map(function (user) { return <option key={user.id} value={user.id}>{user.full_name}</option>; })}</select></label>; })}{!selectedMandals.length && <div className={styles.empty}>Select Mandals to prepare campaigner assignments.</div>}</div></section></div>}
      <div className={styles.footer}><div><strong>Scope contract</strong><span>Voters are resolved live from selected Mandal IDs; voter records are never duplicated.</span></div><button type="button" disabled={saving || !selectedMandals.length} onClick={createCampaign}>{saving ? "Creating…" : "Create Campaign"}<ChevronRight size={16} /></button></div>
    </section>}

    <section className={styles.listPanel}><div className={styles.listHeader}><div><span>CAMPAIGN PORTFOLIO</span><h2>Operational campaigns</h2></div><em>{campaigns.length} campaigns</em></div>
      {loading ? <div className={styles.empty}>Loading campaigns…</div> : !campaigns.length ? <div className={styles.emptyState}><Megaphone size={25} /><strong>No campaigns yet</strong><span>Create the first campaign from a verified constituency scope.</span></div> : <div className={styles.campaignList}>{campaigns.map(function (campaign) { return <article key={campaign.id}><div className={styles.campaignIcon}><Megaphone size={17} /></div><div className={styles.campaignMain}><span>{campaign.campaign_code}</span><h3>{campaign.campaign_name}</h3><p>{campaign.target_type} · {campaign.target_name}</p></div><div className={styles.campaignFacts}><span><MapPin size={14} />{campaign.mandal_count} Mandals</span><span><Users size={14} />{campaign.assignment_count} assigned</span><span><ClipboardList size={14} />{Number(campaign.eligible_voters || 0).toLocaleString()} voters</span></div><em>{campaign.status}</em></article>; })}</div>}
    </section>
  </div></AppShell>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) { return <div className={styles.metric}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value.toLocaleString()}</strong></div></div>; }
