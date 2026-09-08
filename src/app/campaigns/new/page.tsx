"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Check, ChevronRight, Landmark, MapPin, Search, ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "../campaigns.module.css";
import {
  buildCampaignCode,
  nextCodeSequence,
  surveyStageOptions,
  type SurveyStage,
} from "@/lib/research-codes";

type Program = { id: string; study_name: string; study_code?: string; study_type?: string; status?: string; owner_user_id?: string | null; owner_name?: string | null };
type Jurisdiction = { id: string; name: string; code: string | null; type_code: string; metadata?: { crosswalk_status?: string } };
type Geography = { id: string; parent_id: string | null; name: string; geo_type: string; code: string | null; coverage_type?: "FULL" | "PARTIAL"; verification_status?: string };
type LocalBody = { id: string; name: string; code: string | null; body_type: string; administrative_units: Geography[] };
type LocalArea = { id: string; name: string; display_label: string | null; code: string | null; area_type: string; administrative_units?: Geography[] };
type Domain = "LEGISLATIVE" | "LOCAL_BODY";
type Office = "MP" | "MLA" | "MLC";

const officeMatches: Record<Office, RegExp> = { MP: /PARLIAMENTARY/i, MLA: /ASSEMBLY/i, MLC: /MLC/i };
const localModes = [
  { type: "ZILLA_PARISHAD", target: "ZPTC", label: "ZPTC", detail: "Zilla Parishad scope" },
  { type: "MANDAL_PRAJA_PARISHAD", target: "MPTC", label: "MPTC", detail: "Mandal Parishad scope" },
  { type: "GRAM_PANCHAYAT", target: "GRAM_PANCHAYAT", label: "Panchayat", detail: "Gram Panchayat" },
  { type: "MUNICIPAL_CORPORATION", target: "MUNICIPAL_CORPORATION", label: "Corporation", detail: "Division allocation" },
  { type: "MUNICIPALITY", target: "MUNICIPALITY", label: "Municipality", detail: "Ward allocation" }
];

export default function NewCampaignPage() {
  const { user } = useCurrentUser();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [geographies, setGeographies] = useState<Geography[]>([]);
  const [existingCampaignCodes, setExistingCampaignCodes] = useState<string[]>([]);
  const [localBodies, setLocalBodies] = useState<LocalBody[]>([]);
  const [localAreas, setLocalAreas] = useState<LocalArea[]>([]);
  const [domain, setDomain] = useState<Domain>("LEGISLATIVE");
  const [office, setOffice] = useState<Office>("MLA");
  const [bodyType, setBodyType] = useState("ZILLA_PARISHAD");
  const [surveyStage, setSurveyStage] = useState<SurveyStage>("BASE");
  const [targetId, setTargetId] = useState("");
  const [scopeLinks, setScopeLinks] = useState<Geography[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ code: "", name: "", programId: "", startDate: "", endDate: "" });
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(function () {
    if (!user) return;
    Promise.all([apiFetch("/api/campaign-programs"), apiFetch("/api/jurisdictions"), apiFetch("/api/geographies"), apiFetch("/api/local-bodies?limit=10000"), apiFetch("/api/campaigns").catch(function () { return []; })])
      .then(function ([programData, jurisdictionData, geographyData, bodyData, campaignData]) {
        setPrograms(programData); setJurisdictions(jurisdictionData); setGeographies(geographyData);
        setLocalBodies(bodyData.items || bodyData);
        setExistingCampaignCodes((campaignData || []).map(function (item: { campaign_code?: string }) { return item.campaign_code || ""; }));
      }).catch(function (error) { setMessage(error instanceof Error ? error.message : "Unable to load campaign planning data"); });
  }, [user]);

  const geoById = useMemo(function () { return new globalThis.Map(geographies.map(function (geo) { return [geo.id, geo]; })); }, [geographies]);
  const target = domain === "LEGISLATIVE" ? jurisdictions.find(function (item) { return item.id === targetId; }) : localBodies.find(function (item) { return item.id === targetId; });
  const selectedProgram = programs.find(function (item) { return item.id === form.programId; });
  const targetElectionType = domain === "LEGISLATIVE" ? ((target as Jurisdiction | undefined)?.type_code || office) : "LOCAL";
  const generatedCampaignCode = useMemo(function () {
    if (!target || !form.programId) return "";
    const targetCode = (target as Jurisdiction | LocalBody).code;
    const studyType = selectedProgram?.study_type || "BASE";
    const prefix = buildCampaignCode({ electionType: targetElectionType, constituencyCode: targetCode, studyType, stage: surveyStage, sequence: 1 }).replace(/-C01$/, "");
    return buildCampaignCode({ electionType: targetElectionType, constituencyCode: targetCode, studyType, stage: surveyStage, sequence: nextCodeSequence(prefix, existingCampaignCodes) });
  }, [existingCampaignCodes, form.programId, selectedProgram, surveyStage, target, targetElectionType]);
  const availableTargets = domain === "LEGISLATIVE"
    ? jurisdictions.filter(function (item) { return officeMatches[office].test(item.type_code); }).sort(function (a, b) { return a.name.localeCompare(b.name); })
    : localBodies.filter(function (item) { return item.body_type === bodyType; }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  const mandals = useMemo(function () {
    const ids = new Set<string>();
    for (const linked of scopeLinks) {
      if (linked.geo_type === "MANDAL" && linked.coverage_type !== "PARTIAL") ids.add(linked.id);
      if (linked.geo_type === "DISTRICT" && linked.coverage_type !== "PARTIAL" && (domain === "LOCAL_BODY" || office === "MLC")) geographies.filter(function (geo) { return geo.geo_type === "MANDAL" && geo.parent_id === linked.id; }).forEach(function (geo) { ids.add(geo.id); });
      if (linked.geo_type === "VILLAGE" && linked.parent_id) ids.add(linked.parent_id);
    }
    return Array.from(ids).map(function (id) { return geoById.get(id); }).filter(Boolean) as Geography[];
  }, [scopeLinks, geographies, geoById, domain, office]);

  const partialMandals = useMemo(function () {
    return scopeLinks.filter(function (linked) { return linked.geo_type === "MANDAL" && linked.coverage_type === "PARTIAL"; });
  }, [scopeLinks]);

  const districts = useMemo(function () {
    const groups = new globalThis.Map<string, { district: Geography; mandals: Geography[] }>();
    for (const mandal of mandals) {
      const district = mandal.parent_id ? geoById.get(mandal.parent_id) : undefined;
      if (!district) continue;
      if (!groups.has(district.id)) groups.set(district.id, { district, mandals: [] });
      groups.get(district.id)!.mandals.push(mandal);
    }
    return Array.from(groups.values()).sort(function (a, b) { return a.district.name.localeCompare(b.district.name); }).map(function (group) {
      group.mandals.sort(function (a, b) { return a.name.localeCompare(b.name); }); return group;
    });
  }, [mandals, geoById]);

  const urbanAreaMode = domain === "LOCAL_BODY" && ["MUNICIPAL_CORPORATION", "MUNICIPALITY"].includes(bodyType) && localAreas.length > 0;
  const visibleDistricts = districts.filter(function (group) { const query = search.trim().toLowerCase(); return !query || group.district.name.toLowerCase().includes(query) || group.mandals.some(function (m) { return m.name.toLowerCase().includes(query); }); });
  const scopeNames = districts.map(function (group) { return `${group.district.name} (${group.mandals.map(function (mandal) { return mandal.name; }).join(", ")})`; }).join(" · ");

  function resetTarget() { setTargetId(""); setScopeLinks([]); setLocalAreas([]); setReviewing(false); setMessage(null); }

  async function chooseTarget(id: string) {
    setTargetId(id); setScopeLinks([]); setLocalAreas([]); setReviewing(false); setMessage(null);
    if (!id) return;
    try {
      if (domain === "LEGISLATIVE") {
        const scope = await apiFetch(`/api/jurisdictions/${id}/scope`); setScopeLinks(scope.geographies || []);
      } else {
        const body = localBodies.find(function (item) { return item.id === id; });
        const areaData = await apiFetch(`/api/local-bodies/${id}/electoral-areas?limit=5000`);
        const areas = areaData.items || areaData; setLocalAreas(areas);
        const areaLinks = areas.flatMap(function (area: LocalArea) { return area.administrative_units || []; });
        setScopeLinks(areaLinks.length ? areaLinks : body?.administrative_units || []);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to resolve target geography"); }
  }

  async function save() {
    if (!generatedCampaignCode || !form.name.trim() || !form.programId || !target || !mandals.length) { setMessage("Complete the campaign details, select an assigned research program and choose a verified target geography."); return; }
    const mode = localModes.find(function (item) { return item.type === bodyType; });
    setSaving(true); setMessage(null);
    try {
      const created = await apiFetch("/api/campaigns", { method: "POST", body: JSON.stringify({
        campaignCode: generatedCampaignCode, campaignName: form.name.trim(), programId: form.programId || null, surveyStage,
        targetDomain: domain, targetType: domain === "LEGISLATIVE" ? office : mode?.target,
        jurisdictionId: domain === "LEGISLATIVE" ? target.id : null, localBodyId: domain === "LOCAL_BODY" ? target.id : null,
        targetName: target.name, targetCode: target.code, startDate: form.startDate || null, endDate: form.endDate || null,
        mandalIds: mandals.map(function (mandal) { return mandal.id; })
      }) });
      window.location.href = `/campaigns/${created.id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create campaign"); setSaving(false); }
  }

  if (user && !["SUPER_ADMIN", "ADMIN"].includes(user.role.code)) return <AppShell><div className={styles.page}><FeedbackMessage message="Only Admins and Super Admins create campaigns. A Campaign Manager receives an assigned campaign and creates its iterations." className={styles.message} /></div></AppShell>;

  return <AppShell><div className={styles.page}>
    <div className={styles.backRow}><Link href="/campaigns"><ArrowLeft size={16} />Campaigns</Link><span>Draft remains private until it is ready for operations.</span></div>
    <section className={styles.header}><div><span>ADMIN CAMPAIGN SETUP</span><h1>Create Campaign</h1><p>Define the campaign scope. After creation, assign it to a Campaign Manager who will create iterations and distribute work to Campaigners.</p></div></section>
    <div className={styles.steps}><span className={styles.stepDone}><Check size={14} />Details</span><span className={targetId ? styles.stepDone : styles.stepActive}>2 · Election target</span><span className={mandals.length ? styles.stepDone : styles.stepActive}>3 · Geography scope</span><span className={reviewing ? styles.stepActive : ""}>4 · Review</span></div>
    {message && <FeedbackMessage message={message} className={styles.message} />}
    <section className={styles.createPanel}>
      <div className={styles.panelHeader}><div><span>STEP 1</span><h2>Campaign details</h2><p>This identifies the campaign independently from its research program.</p></div></div>
      <div className={styles.formGrid}><Field label="Generated campaign code"><input value={generatedCampaignCode || "Select a program and target"} readOnly /></Field><Field label="Campaign name"><input value={form.name} onChange={function (e) { setForm({ ...form, name: e.target.value }); }} placeholder="Campaign name" /></Field><Field label="Research program *"><select value={form.programId} onChange={function (e) { setForm({ ...form, programId: e.target.value }); }}><option value="">Select an assigned program</option>{programs.map(function (program) { return <option key={program.id} value={program.id}>{program.study_name}{program.study_code ? ` · ${program.study_code}` : ""}</option>; })}</select></Field><Field label="Survey stage *"><select value={surveyStage} onChange={function (e) { setSurveyStage(e.target.value as SurveyStage); }}>{surveyStageOptions.map(function (option) { return <option key={option.value} value={option.value}>{option.label}</option>; })}</select></Field><Field label="Schedule"><div className={styles.datePair}><input type="date" value={form.startDate} onChange={function (e) { setForm({ ...form, startDate: e.target.value }); }} /><input type="date" value={form.endDate} onChange={function (e) { setForm({ ...form, endDate: e.target.value }); }} /></div></Field></div>
      {!programs.length && <FeedbackMessage message="No research program has been assigned to you. Ask an Admin to create and assign a program before creating a campaign." className={styles.message} />}
    </section>
    <section className={styles.createPanel}>
      <div className={styles.panelHeader}><div><span>STEP 2</span><h2>Election target</h2><p>Legislative and Local Body campaigns use the same canonical Administrative geography.</p></div></div>
      <div className={styles.domainTabs}><button className={domain === "LEGISLATIVE" ? styles.domainActive : ""} onClick={function () { setDomain("LEGISLATIVE"); resetTarget(); }}><Landmark size={20} /><span><strong>Legislative</strong><small>MP, MLA and MLC</small></span></button><button className={domain === "LOCAL_BODY" ? styles.domainActive : ""} onClick={function () { setDomain("LOCAL_BODY"); resetTarget(); }}><Building2 size={20} /><span><strong>Local Body</strong><small>Urban and rural elections</small></span></button></div>
      <div className={styles.officeTabs}>{domain === "LEGISLATIVE" ? (["MP", "MLA", "MLC"] as Office[]).map(function (item) { return <button key={item} type="button" className={office === item ? styles.officeActive : ""} onClick={function () { setOffice(item); resetTarget(); }}><strong>{item}</strong><small>{item === "MP" ? "Parliamentary" : item === "MLA" ? "Assembly" : "Legislative Council"}</small></button>; }) : localModes.map(function (item) { return <button key={item.type} type="button" className={bodyType === item.type ? styles.officeActive : ""} onClick={function () { setBodyType(item.type); resetTarget(); }}><strong>{item.label}</strong><small>{item.detail}</small></button>; })}</div>
      <div className={styles.scopeSelector}><Field label="Select election geography"><select value={targetId} onChange={function (event) { chooseTarget(event.target.value); }}><option value="">Select target</option>{availableTargets.map(function (item) { return <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>; })}</select></Field><div className={styles.scopeSummary}><MapPin size={18} /><div><strong>{target?.name || "No target selected"}</strong><span>{target ? `${districts.length} Districts · ${mandals.length} assignable Mandals${partialMandals.length ? ` · ${partialMandals.length} partial boundaries` : ""}` : "Choose a target to load its verified geography."}</span></div></div></div>
      {domain === "LEGISLATIVE" && partialMandals.length > 0 && <FeedbackMessage message={`Partial Mandal boundaries (${partialMandals.map(function (item) { return item.name; }).join(", ")}) are shown for reference but cannot be allocated until voter records are mapped below Mandal level.`} className={styles.message} />}
      {domain === "LEGISLATIVE" && target && (target as Jurisdiction).metadata?.crosswalk_status === "WARD_CROSSWALK_REQUIRED" && <FeedbackMessage message="This urban constituency is defined by municipal wards. Complete its ward-level crosswalk before allocating campaign work." className={styles.message} />}
    </section>
    {target && <section className={styles.createPanel}>
      <div className={styles.panelHeader}><div><span>STEP 3</span><h2>Confirm geography scope</h2><p>{urbanAreaMode ? "The campaign includes the verified urban body areas linked to this target." : "The campaign includes the verified District and Mandal footprint. Work allocation happens after the Campaign Manager creates an iteration."}</p></div><strong>{mandals.length} Mandals</strong></div>
      <div className={styles.allocationBody}><label className={styles.search}><Search size={15} /><input value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Search District or Mandal" /></label><div className={styles.districtGroups}>{visibleDistricts.map(function (group) { return <article key={group.district.id}><div className={styles.districtHead}><span><strong>{group.district.name}</strong><small>{group.mandals.length} Mandals in campaign scope</small></span><span className={styles.scopeSummary}>Verified scope</span></div><div className={styles.mandalAllocation}>{group.mandals.map(function (mandal) { return <div key={mandal.id} className={styles.mandalItem}><MapPin size={15} /><span><strong>{mandal.name}</strong><small>{mandal.code || "No code"}</small></span></div>; })}</div></article>; })}</div></div>
      {!mandals.length && <div className={styles.empty}>No safe Mandals could be resolved. Complete this target’s verified Administrative or ward crosswalk before creating a campaign.</div>}
      <div className={styles.footer}><div><ShieldCheck size={18} /><span><strong>Two-stage ownership</strong><small>Admin assigns this campaign to a Campaign Manager; that manager allocates each iteration to Campaigners.</small></span></div><button type="button" disabled={!mandals.length} onClick={function () { setReviewing(true); }}>Review Campaign<ChevronRight size={16} /></button></div>
    </section>}
    {reviewing && target && <section className={styles.createPanel}>
      <div className={styles.panelHeader}><div><span>STEP 4</span><h2>Review campaign</h2><p>Confirm the constituency, voter geography and campaigner workload before creating the draft.</p></div></div>
      <div className={styles.reviewGrid}><div><small>Campaign identity</small><strong>{form.name || "Campaign name required"}</strong><span>{generatedCampaignCode || "Code generated after target selection"}</span></div><div><small>Research program</small><strong>{programs.find(function (program) { return program.id === form.programId; })?.study_name || "Program required"}</strong><span>Admin-assigned program</span></div><div><small>Survey stage</small><strong>{surveyStageOptions.find(function (option) { return option.value === surveyStage; })?.label}</strong><span>{surveyStageOptions.find(function (option) { return option.value === surveyStage; })?.detail}</span></div><div><small>Election constituency</small><strong>{target.name}</strong><span>{domain === "LEGISLATIVE" ? `${office} constituency` : localModes.find(function (item) { return item.type === bodyType; })?.label}</span></div><div><small>Geography scope</small><strong>{districts.length} District · {mandals.length} Mandal</strong><span>{scopeNames || "No administrative geography resolved"}</span></div><div className={styles.reviewWarning}><small>Next owner</small><strong>Campaign Manager</strong><span>Assign the draft after creation, then the manager creates iterations and Campaigner allocations.</span></div></div>
      <div className={styles.footer}><button type="button" className={styles.secondaryButton} onClick={function () { setReviewing(false); }}>Back to allocation</button><button type="button" disabled={saving || !generatedCampaignCode || !form.name.trim() || !form.programId} onClick={save}>{saving ? "Creating Draft…" : "Create Draft Campaign"}<ChevronRight size={16} /></button></div>
    </section>}
  </div></AppShell>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
