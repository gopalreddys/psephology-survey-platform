"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Building2, CheckCircle2, ChevronRight, ClipboardList, MapPin, Megaphone, PhoneCall, Plus, ShieldCheck, Target, Trash2, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { surveyStageOptions } from "@/lib/research-codes";
import styles from "../campaigns.module.css";

type ScopeRow = { id: string; name: string; code: string | null; district_id: string; district_name: string; district_code: string | null };
type LocalArea = { id: string; name: string; display_label?: string | null; code: string | null; area_type: string };
type Allocation = { id: string; iteration_id?: string | null; allocation_level: string; geo_unit_id?: string | null; local_body_area_id?: string | null; geography_name: string; geography_code: string | null; campaigner_user_id?: string; campaigner_name: string; status: string; iteration_number?: number | null; iteration_name?: string | null };
type CampaignIteration = { id: string; campaign_id?: string | null; study_id: string; iteration_number: number; iteration_name: string; research_phase: string; status: string; target_sample_size: number | null; planned_start_date: string | null; run_count?: number; successful_voters?: number; voice_agent_id?: string | null; voice_agent_name?: string | null; voice_agent_category?: string | null; voice_agent_app_id?: string | null; voice_agent_app_version?: number | null };
type Campaign = { id: string; campaign_code: string; campaign_name: string; program_id?: string | null; target_domain: string; target_type: string; target_name: string; target_code: string | null; local_body_id?: string | null; survey_stage?: "BASE" | "CAMPAIGN" | "TURNOUT"; status: string; created_by_user_id?: string | null; created_by_name: string | null; campaign_manager_user_id?: string | null; campaign_manager_name?: string | null; start_date: string | null; end_date: string | null; scope: ScopeRow[]; allocations: Allocation[] };
type Campaigner = { id: string; full_name: string; email?: string; role_code: string; status?: string };
type VoiceAgent = { id: string; provider_name: string | null; app_id: string; app_version: number; usage_category: "URBAN_MALE" | "URBAN_FEMALE" | "RURAL_MALE" | "RURAL_FEMALE" };
type AllocationSummaryRow = { id: string; name: string; code: string; district?: string; campaigner: string | null };

function normalizedAssignments(value: Record<string, string>) {
  return JSON.stringify(Object.keys(value).filter(function (key) { return Boolean(value[key]); }).sort().map(function (key) { return [key, value[key]]; }));
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { user } = useCurrentUser();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [iterations, setIterations] = useState<CampaignIteration[]>([]);
  const [iterationError, setIterationError] = useState<string | null>(null);
  const [campaigners, setCampaigners] = useState<Campaigner[]>([]);
  const [voiceAgents, setVoiceAgents] = useState<VoiceAgent[]>([]);
  const [localAreas, setLocalAreas] = useState<LocalArea[]>([]);
  const [managers, setManagers] = useState<Campaigner[]>([]);
  const [managerId, setManagerId] = useState("");
  const [savingManager, setSavingManager] = useState(false);
  const [managerNotice, setManagerNotice] = useState<string | null>(null);
  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null);
  const [iterationAssignments, setIterationAssignments] = useState<Record<string, string>>({});
  const [savedIterationAssignments, setSavedIterationAssignments] = useState<Record<string, string>>({});
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [allocationSaved, setAllocationSaved] = useState(false);
  const [allocationNotice, setAllocationNotice] = useState<string | null>(null);
  const [showIterationForm, setShowIterationForm] = useState(false);
  const [savingIteration, setSavingIteration] = useState(false);
  const [iterationForm, setIterationForm] = useState({ name: "", stage: "BASE", targetSample: "", voiceAgentId: "", startDate: "", endDate: "" });
  const [updatingStatus, setUpdatingStatus] = useState(false);
  useEffect(function () {
    let cancelled = false;
    async function load() {
      try {
        const result = await apiFetch(`/api/campaigns/${id}`);
        if (cancelled) return;
        setCampaign(result);
        setManagerId(result.campaign_manager_user_id || "");
        if (result.target_domain === "LOCAL_BODY" && result.local_body_id && user?.role.code !== "CAMPAIGNER") {
          try {
            const areaResult = await apiFetch(`/api/local-bodies/${result.local_body_id}/electoral-areas?limit=5000`);
            if (!cancelled) setLocalAreas(Array.isArray(areaResult) ? areaResult : areaResult.items || []);
          } catch (reason) {
            if (!cancelled) setIterationError(reason instanceof Error ? reason.message : "Local electoral areas are not available yet");
          }
        }
        if (user?.role.code !== "CAMPAIGNER") {
          try {
            const campaignerResult = await apiFetch(`/api/campaigns/${id}/campaigners`);
            if (!cancelled) setCampaigners(Array.isArray(campaignerResult) ? campaignerResult : campaignerResult.items || []);
          } catch (reason) {
            if (!cancelled) setIterationError(reason instanceof Error ? reason.message : "Campaigners are not available yet");
          }
          if (user?.role.code === "CAMPAIGN_MANAGER") {
            try {
              const agentResult = await apiFetch("/api/voice-agents?selectable=true");
              if (!cancelled) setVoiceAgents(Array.isArray(agentResult) ? agentResult : agentResult.items || []);
            } catch (reason) {
              if (!cancelled) setIterationError(reason instanceof Error ? reason.message : "Sarvam voice agents are not available yet");
            }
          }
          if (["SUPER_ADMIN", "ADMIN"].includes(user?.role.code || "")) {
            try {
              const usersResult = await apiFetch("/api/users");
              if (!cancelled) setManagers((Array.isArray(usersResult) ? usersResult : usersResult.items || []).filter(function (item: Campaigner) { return item.role_code === "CAMPAIGN_MANAGER" && item.status === "ACTIVE"; }));
            } catch (reason) {
              if (!cancelled) setError(reason instanceof Error ? reason.message : "Campaign Managers are not available yet");
            }
          }
        }
        setIterationForm(function (current) { return { ...current, targetSample: String(result.target_sample_size || "") }; });
        try {
          const iterationResult = await apiFetch(`/api/campaigns/${id}/iterations`);
          if (!cancelled) setIterations(Array.isArray(iterationResult) ? iterationResult : iterationResult.items || []);
        } catch (reason) {
          if (!cancelled) setIterationError(reason instanceof Error ? reason.message : "Campaign iteration status is not available yet");
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load campaign");
      }
    }
    load();
    return function () { cancelled = true; };
  }, [id, user]);
  const districts = useMemo(function () {
    const groups = new globalThis.Map<string, ScopeRow[]>();
    for (const row of campaign?.scope || []) { if (!groups.has(row.district_name)) groups.set(row.district_name, []); groups.get(row.district_name)!.push(row); }
    return Array.from(groups.entries());
  }, [campaign]);

  async function changeStatus(status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED") {
    if (!campaign || !window.confirm(`Change this campaign to ${status.toLowerCase()}?`)) return;
    setUpdatingStatus(true); setError(null); setActionNotice(null);
    try {
      const updated = await apiFetch(`/api/campaigns/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setCampaign(function (current) { return current ? { ...current, status: updated.status } : current; });
      setActionNotice(`Campaign status changed to ${String(updated.status || status).toLowerCase()}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update campaign status"); }
    finally { setUpdatingStatus(false); }
  }

  async function assignManager() {
    if (!campaign || !managerId) return;
    setSavingManager(true); setError(null); setActionNotice(null);
    setManagerNotice(null);
    try {
      const updated = await apiFetch(`/api/campaigns/${id}/manager`, {
        method: "PATCH",
        body: JSON.stringify({ campaignManagerUserId: managerId })
      });
      setCampaign(function (current) {
        return current ? { ...current, campaign_manager_user_id: updated.campaign_manager_user_id, campaign_manager_name: updated.campaign_manager_name } : current;
      });
      setManagerNotice(`${updated.campaign_manager_name} is now the Campaign Manager for this campaign. They can create iterations and manage campaigner allocations.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to assign Campaign Manager"); }
    finally { setSavingManager(false); }
  }

  async function openIterationAllocations(iterationId: string) {
    setSelectedIterationId(iterationId);
    setIterationError(null);
    setAllocationSaved(false);
    setAllocationNotice(null);
    try {
      const result = await apiFetch(`/api/campaigns/${id}/iterations/${iterationId}/allocations`);
      const rows: Allocation[] = Array.isArray(result) ? result : result.items || [];
      const next: Record<string, string> = {};
      rows.forEach(function (row) {
        const key = row.local_body_area_id ? `A:${row.local_body_area_id}` : `${row.allocation_level === "DISTRICT" ? "D" : "M"}:${row.geo_unit_id}`;
        next[key] = row.campaigner_user_id || "";
      });
      setIterationAssignments(next);
      setSavedIterationAssignments(next);
    } catch (reason) { setIterationError(reason instanceof Error ? reason.message : "Unable to load iteration allocations"); }
  }

  async function saveIterationAllocations() {
    if (!campaign || !selectedIterationId) return;
    const assignments = Object.entries(iterationAssignments).filter(function ([, campaignerUserId]) { return Boolean(campaignerUserId); }).map(function ([key, campaignerUserId]) {
      const [level, idValue] = key.split(":");
      return level === "A" ? { allocationLevel: "LOCAL_BODY_AREA", localBodyAreaId: idValue, campaignerUserId } : { allocationLevel: level === "D" ? "DISTRICT" : "MANDAL", geoUnitId: idValue, campaignerUserId };
    });
    if (!assignments.length) { setIterationError("Assign at least one work area before saving."); return; }
    setSavingAssignments(true); setIterationError(null); setActionNotice(null);
    setAllocationNotice(null);
    try {
      const result = await apiFetch(`/api/campaigns/${id}/iterations/${selectedIterationId}/allocations`, { method: "PUT", body: JSON.stringify({ assignments }) });
      const saved: Allocation[] = Array.isArray(result) ? result : result.items || [];
      setCampaign(function (current) { return current ? { ...current, allocations: [...current.allocations.filter(function (row) { return row.iteration_id !== selectedIterationId; }), ...saved] } : current; });
      const persisted: Record<string, string> = {};
      saved.forEach(function (row) {
        const key = row.local_body_area_id ? `A:${row.local_body_area_id}` : `${row.allocation_level === "DISTRICT" ? "D" : "M"}:${row.geo_unit_id}`;
        persisted[key] = row.campaigner_user_id || "";
      });
      setIterationAssignments(persisted);
      setSavedIterationAssignments(persisted);
      setAllocationSaved(true);
      setAllocationNotice(`${saved.length} work area${saved.length === 1 ? "" : "s"} saved. Campaigners can now access only the geography allocated to them.`);
    } catch (reason) { setIterationError(reason instanceof Error ? reason.message : "Unable to save iteration allocations"); }
    finally { setSavingAssignments(false); }
  }

  async function removeCampaign() {
    if (!campaign || !window.confirm("Delete this Draft campaign? Its scope and assignments will be removed.")) return;
    setUpdatingStatus(true); setError(null);
    try {
      await apiFetch(`/api/campaigns/${id}`, { method: "DELETE" });
      router.push("/campaigns");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete campaign"); setUpdatingStatus(false); }
  }

  async function createCampaignIteration() {
    if (!campaign || !iterationForm.name.trim() || !iterationForm.targetSample || Number(iterationForm.targetSample) < 1 || !iterationForm.voiceAgentId) {
      setIterationError("Iteration name, target sample and Sarvam voice agent are required.");
      return;
    }
    setSavingIteration(true); setIterationError(null); setActionNotice(null);
    try {
      const result = await apiFetch(`/api/campaigns/${id}/iterations`, {
        method: "POST",
        body: JSON.stringify({
          iterationName: iterationForm.name.trim(),
          researchPhase: iterationForm.stage,
          targetSampleSize: Number(iterationForm.targetSample),
          voiceAgentId: iterationForm.voiceAgentId,
          plannedStartDate: iterationForm.startDate || null,
          plannedEndDate: iterationForm.endDate || null
        })
      });
      const created = result.iteration || result;
      setIterations(function (current) { return [...current, { ...created, run_count: 0 }]; });
      setIterationForm(function (current) { return { ...current, name: "", stage: "BASE", voiceAgentId: "", startDate: "", endDate: "" }; });
      setShowIterationForm(false);
      setActionNotice("Iteration created successfully. You can now allocate its work areas to Campaigners.");
    } catch (reason) {
      setIterationError(reason instanceof Error ? reason.message : "Unable to create iteration");
    } finally { setSavingIteration(false); }
  }

  const canReview = Boolean(user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code));
  const canAssignManager = Boolean(user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code) && campaign?.status === "DRAFT");
  const canManageIterations = Boolean(user?.role.code === "CAMPAIGN_MANAGER" && campaign?.campaign_manager_user_id === user.id && campaign.status !== "COMPLETED" && campaign.status !== "ARCHIVED");
  const canAllocateIteration = canManageIterations && Boolean(selectedIterationId);
  const managerDirty = Boolean(managerId) && managerId !== (campaign?.campaign_manager_user_id || "");
  const allocationDirty = normalizedAssignments(iterationAssignments) !== normalizedAssignments(savedIterationAssignments);
  const campaignerNameById = useMemo(function () {
    return new globalThis.Map(campaigners.map(function (campaigner) { return [campaigner.id, campaigner.full_name]; }));
  }, [campaigners]);
  const allocationSummary = useMemo<AllocationSummaryRow[]>(function () {
    if (localAreas.length) {
      return localAreas.map(function (area) {
        const campaignerId = iterationAssignments[`A:${area.id}`] || "";
        return { id: area.id, name: area.display_label || area.name, code: area.code || area.area_type, campaigner: campaignerId ? campaignerNameById.get(campaignerId) || "Assigned campaigner" : null };
      });
    }
    return districts.flatMap(function ([districtName, rows]) {
      const districtId = rows[0]?.district_id;
      const districtCampaignerId = districtId ? iterationAssignments[`D:${districtId}`] || "" : "";
      return rows.map(function (row) {
        const campaignerId = districtCampaignerId || iterationAssignments[`M:${row.id}`] || "";
        return { id: row.id, name: row.name, code: row.code || "No code", district: districtName, campaigner: campaignerId ? campaignerNameById.get(campaignerId) || "Assigned campaigner" : null };
      });
    });
  }, [campaignerNameById, districts, iterationAssignments, localAreas]);
  const assignedWorkCount = allocationSummary.filter(function (row) { return Boolean(row.campaigner); }).length;
  const remainingWorkCount = allocationSummary.length - assignedWorkCount;
  const canDelete = Boolean(campaign && user && campaign.status === "DRAFT" && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code));
  const statusAction = campaign?.status === "DRAFT" ? { label: "Review & Activate", status: "ACTIVE" as const } : campaign?.status === "ACTIVE" ? { label: "Pause campaign", status: "PAUSED" as const } : campaign?.status === "PAUSED" ? { label: "Resume campaign", status: "ACTIVE" as const } : null;

  return <AppShell><div className={styles.page}>
    <div className={styles.backRow}><Link href="/campaigns"><ArrowLeft size={16} />Campaigns</Link></div>
    {error ? <FeedbackMessage message={error} className={styles.message} /> : !campaign ? <div className={styles.empty}>Loading campaign…</div> : <>
      {actionNotice && <FeedbackMessage message={actionNotice} className={styles.successMessage} />}
      <section className={styles.detailHero}><div className={styles.campaignIcon}><Megaphone size={18} /></div><div><span>{campaign.campaign_code} · {campaign.target_domain === "LOCAL_BODY" ? "LOCAL BODY" : "LEGISLATIVE"}</span><h1>{campaign.campaign_name}</h1><p>{campaign.target_type} · {campaign.target_name}{campaign.target_code ? ` · ${campaign.target_code}` : ""} · {campaign.survey_stage || "BASE"} survey</p></div><div className={styles.detailActions}><em>{campaign.status}</em>{canReview && statusAction && <button type="button" className={styles.primaryAction} disabled={updatingStatus || (statusAction.status === "ACTIVE" && !campaign.campaign_manager_user_id)} onClick={function () { changeStatus(statusAction.status); }}>{updatingStatus ? "Updating…" : statusAction.status === "ACTIVE" && !campaign.campaign_manager_user_id ? "Assign manager first" : statusAction.label}</button>}{canReview && campaign.status === "ACTIVE" && <button type="button" className={styles.secondaryButton} disabled={updatingStatus} onClick={function () { changeStatus("COMPLETED"); }}>Mark completed</button>}{canDelete && <button type="button" className={styles.dangerButton} disabled={updatingStatus} onClick={removeCampaign}><Trash2 size={14} />Delete draft</button>}</div></section>
      {canAssignManager && <section className={styles.managerPanel}><div><span>CAMPAIGN OWNERSHIP</span><h2>Assign Campaign Manager</h2><p>The manager receives this campaign and owns its iteration planning.</p>{managerNotice && <FeedbackMessage message={managerNotice} className={styles.successMessage} />}</div><div className={styles.managerControls}><select value={managerId} onChange={function (event) { setManagerId(event.target.value); setManagerNotice(null); }}><option value="">Select Campaign Manager</option>{managers.map(function (manager) { return <option key={manager.id} value={manager.id}>{manager.full_name}</option>; })}</select><button type="button" className={styles.primaryAction} disabled={!managerDirty || savingManager} onClick={assignManager}>{savingManager ? "Assigning…" : managerDirty ? "Assign manager" : "Manager assigned"}</button></div></section>}
      <section className={styles.metrics}><DetailMetric icon={MapPin} label="Districts" value={districts.length} /><DetailMetric icon={Building2} label="Mandals" value={campaign.scope.length} /><DetailMetric icon={ClipboardList} label="Iterations" value={iterations.length} /><DetailMetric icon={Users} label="Campaign Manager" value={campaign.campaign_manager_name || "Unassigned"} /></section>
      <section className={styles.iterationPanel}>
        <div className={styles.listHeader}><div><span>CAMPAIGN RESEARCH CYCLES</span><h2>Iterations and execution status</h2><p>Campaign Managers define the survey waves; Campaigners execute their assigned runs.</p></div>{canManageIterations && <button type="button" className={styles.primaryAction} onClick={function () { setShowIterationForm(true); }}><Plus size={15} />Create iteration</button>}</div>
        {iterationError && <FeedbackMessage message={iterationError} className={styles.message} />}
        {showIterationForm && canManageIterations && <div className={styles.iterationForm}><label>Iteration name<input value={iterationForm.name} onChange={function (event) { setIterationForm({ ...iterationForm, name: event.target.value }); }} placeholder="Base survey — September" /></label><label>Survey stage<select value={iterationForm.stage} onChange={function (event) { setIterationForm({ ...iterationForm, stage: event.target.value }); }}>{surveyStageOptions.map(function (option) { return <option key={option.value} value={option.value}>{option.label}</option>; })}</select></label><label>AI voice agent *<select value={iterationForm.voiceAgentId} onChange={function (event) { setIterationForm({ ...iterationForm, voiceAgentId: event.target.value }); }}><option value="">Select Sarvam Agent App</option>{voiceAgents.map(function (agent) { return <option key={agent.id} value={agent.id}>{formatAgentCategory(agent.usage_category)} · {agent.provider_name || agent.app_id} · v{agent.app_version}</option>; })}</select></label><label>Target sample<input type="number" min={1} value={iterationForm.targetSample} onChange={function (event) { setIterationForm({ ...iterationForm, targetSample: event.target.value }); }} /></label><label>Planned start<input type="date" value={iterationForm.startDate} onChange={function (event) { setIterationForm({ ...iterationForm, startDate: event.target.value }); }} /></label><label>Planned end<input type="date" value={iterationForm.endDate} onChange={function (event) { setIterationForm({ ...iterationForm, endDate: event.target.value }); }} /></label><div className={styles.iterationFormActions}><button type="button" className={styles.secondaryButton} onClick={function () { setShowIterationForm(false); }}>Cancel</button><button type="button" className={styles.primaryAction} disabled={savingIteration || !voiceAgents.length} onClick={createCampaignIteration}>{savingIteration ? "Creating…" : "Create iteration"}</button></div>{!voiceAgents.length && <FeedbackMessage message="No campaign-ready Sarvam Agent App is available. Ask an Admin to register and categorize the agents first." className={styles.message} />}</div>}
        {iterations.length ? <div className={styles.iterationList}>{iterations.map(function (iteration) { const stage = surveyStageOptions.find(function (option) { return option.value === String(iteration.research_phase).toUpperCase(); }); return <Link key={iteration.id} href={`/iterations/${iteration.id}`} className={styles.iterationRow}><div className={styles.iterationNumber}>{iteration.iteration_number}</div><div><strong>{iteration.iteration_name}</strong><span>{stage?.label || iteration.research_phase} · {iteration.status}</span><small><Bot size={13} />{iteration.voice_agent_name || "Voice agent not assigned"}{iteration.voice_agent_category ? ` · ${formatAgentCategory(iteration.voice_agent_category as VoiceAgent["usage_category"])}` : ""}</small></div><div><small><Target size={13} />{Number(iteration.target_sample_size || 0).toLocaleString()} voters</small><small><PhoneCall size={13} />{Number(iteration.run_count || 0)} runs</small><small><CheckCircle2 size={13} />{Number(iteration.successful_voters || 0)} successful</small></div>{canManageIterations && <button type="button" className={styles.inlineAction} onClick={function (event) { event.preventDefault(); event.stopPropagation(); openIterationAllocations(iteration.id); }}>{selectedIterationId === iteration.id ? "Editing allocation" : "Allocate work"}</button>}<ChevronRight size={17} /></Link>; })}</div> : <div className={styles.empty}><ClipboardList size={24} /><strong>No campaign iterations yet</strong><span>{canManageIterations ? "Create the first survey wave and choose its Sarvam voice agent." : "Iterations will appear here once the Campaign Manager creates them."}</span></div>}
        {canAllocateIteration && <section className={styles.iterationAssignmentPanel}><div className={styles.listHeader}><div><span>ITERATION WORK ALLOCATION</span><h2>Assign Campaigners</h2><p>{localAreas.length ? "Assign each verified division or ward for this iteration." : "Allocate Districts or Mandals for this iteration."} Runs will use only these assigned areas.</p>{allocationNotice && <FeedbackMessage message={allocationNotice} className={styles.successMessage} />}</div><button type="button" className={styles.primaryAction} disabled={savingAssignments || allocationSaved || !allocationDirty} onClick={saveIterationAllocations}>{savingAssignments ? "Saving…" : allocationSaved ? "Allocations saved" : "Save allocations"}</button></div>{localAreas.length ? <div className={styles.areaAllocation}>{localAreas.map(function (area) { const key = `A:${area.id}`; return <label key={area.id}><span><strong>{area.display_label || area.name}</strong><small>{area.code || area.area_type}</small></span><select value={iterationAssignments[key] || ""} onChange={function (event) { setAllocationSaved(false); setIterationAssignments({ ...iterationAssignments, [key]: event.target.value }); setAllocationNotice(null); }}><option value="">Assign Campaigner</option>{campaigners.map(function (campaigner) { return <option key={campaigner.id} value={campaigner.id}>{campaigner.full_name}</option>; })}</select></label>; })}</div> : <div className={styles.allocationBody}><div className={styles.districtGroups}>{districts.map(function ([districtName, rows]) { const districtId = rows[0]?.district_id; const districtKey = `D:${districtId}`; const districtValue = iterationAssignments[districtKey] || ""; return <article key={districtName}><div className={styles.districtHead}><span><strong>{districtName}</strong><small>{rows.length} Mandals in iteration scope</small></span><select value={districtValue} onChange={function (event) { const value = event.target.value; setAllocationSaved(false); setIterationAssignments(function (current) { const next = { ...current, [districtKey]: value }; rows.forEach(function (row) { delete next[`M:${row.id}`]; }); return next; }); setAllocationNotice(null); }}><option value="">Assign individual Mandals</option>{campaigners.map(function (campaigner) { return <option key={campaigner.id} value={campaigner.id}>{campaigner.full_name}</option>; })}</select></div><div className={styles.mandalAllocation}>{rows.map(function (row) { return <label key={row.id}><span><strong>{row.name}</strong><small>{row.code || "No code"}</small></span><select disabled={Boolean(districtValue)} value={iterationAssignments[`M:${row.id}`] || ""} onChange={function (event) { setAllocationSaved(false); setIterationAssignments({ ...iterationAssignments, [`M:${row.id}`]: event.target.value }); setAllocationNotice(null); }}><option value="">Assign Campaigner</option>{campaigners.map(function (campaigner) { return <option key={campaigner.id} value={campaigner.id}>{campaigner.full_name}</option>; })}</select></label>; })}</div></article>; })}</div></div>}<div className={styles.allocationSummary}><div className={styles.summaryHeader}><div><span>ALLOCATION SUMMARY</span><strong>{assignedWorkCount} assigned · {remainingWorkCount} remaining</strong></div><small>Unassigned geography remains available for allocation.</small></div><div className={styles.allocationTable}><div className={styles.allocationTableHeader}><span>Work area</span><span>District</span><span>Campaigner</span><span>Status</span></div>{allocationSummary.map(function (row) { return <div key={row.id} className={styles.allocationTableRow}><span><strong>{row.name}</strong><small>{row.code}</small></span><span>{row.district || "—"}</span><span>{row.campaigner || "—"}</span><em className={row.campaigner ? styles.assignedStatus : styles.remainingStatus}>{row.campaigner ? "Assigned" : "Remaining"}</em></div>; })}</div></div></section>}
      </section>
      <div className={styles.detailGrid}><section className={styles.listPanel}><div className={styles.listHeader}><div><span>ADMINISTRATIVE SCOPE</span><h2>District → Mandal</h2></div></div><div className={styles.scopeTree}>{districts.map(function ([district, rows]) { return <article key={district}><strong>{district}</strong><span>{rows.length} Mandals</span><div>{rows.map(function (row) { return <small key={row.id}>{row.name}</small>; })}</div></article>; })}</div></section>
        <section className={styles.listPanel}><div className={styles.listHeader}><div><span>WORK DISTRIBUTION</span><h2>Iteration Campaigner allocations</h2></div></div>{campaign.allocations.length ? <div className={styles.allocationList}>{campaign.allocations.map(function (allocation) { return <article key={allocation.id}><div><strong>{allocation.geography_name}</strong><small>{allocation.allocation_level} · {allocation.geography_code || "No code"}{allocation.iteration_name ? ` · ${allocation.iteration_name}` : ""}</small></div><span>{allocation.campaigner_name}</span><em>{allocation.status}</em></article>; })}</div> : <div className={styles.empty}>No iteration work allocations yet. The assigned Campaign Manager will allocate work after creating an iteration.</div>}</section></div>
      <section className={styles.scopeContract}><ShieldCheck size={20} /><div><strong>Campaign geography contract</strong><span>Voter access and analysis remain limited to the target constituency and each user’s assigned work area.</span></div></section>
    </>}
  </div></AppShell>;
}

function DetailMetric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) { return <div className={styles.metric}><span><Icon size={17} /></span><div><small>{label}</small><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div></div>; }

function formatAgentCategory(value: VoiceAgent["usage_category"]) {
  return value.split("_").map(function (word) { return word.charAt(0) + word.slice(1).toLowerCase(); }).join(" ");
}
