"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ChevronRight, ClipboardList, MapPin, Megaphone, PhoneCall, Plus, ShieldCheck, Target, Trash2, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { surveyStageOptions } from "@/lib/research-codes";
import styles from "../campaigns.module.css";

type ScopeRow = { id: string; name: string; code: string | null; district_id: string; district_name: string; district_code: string | null };
type Allocation = { id: string; allocation_level: string; geography_name: string; geography_code: string | null; campaigner_name: string; status: string };
type CampaignIteration = { id: string; campaign_id?: string | null; study_id: string; iteration_number: number; iteration_name: string; research_phase: string; status: string; target_sample_size: number | null; planned_start_date: string | null; run_count?: number };
type Campaign = { id: string; campaign_code: string; campaign_name: string; program_id?: string | null; target_domain: string; target_type: string; target_name: string; target_code: string | null; survey_stage?: "BASE" | "CAMPAIGN" | "TURNOUT"; status: string; created_by_user_id?: string | null; created_by_name: string | null; start_date: string | null; end_date: string | null; scope: ScopeRow[]; allocations: Allocation[] };

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useCurrentUser();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState<CampaignIteration[]>([]);
  const [iterationError, setIterationError] = useState<string | null>(null);
  const [showIterationForm, setShowIterationForm] = useState(false);
  const [savingIteration, setSavingIteration] = useState(false);
  const [iterationForm, setIterationForm] = useState({ name: "", stage: "BASE", targetSample: "", startDate: "", endDate: "" });
  const [updatingStatus, setUpdatingStatus] = useState(false);
  useEffect(function () {
    let cancelled = false;
    async function load() {
      try {
        const result = await apiFetch(`/api/campaigns/${id}`);
        if (cancelled) return;
        setCampaign(result);
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
  }, [id]);
  const districts = useMemo(function () {
    const groups = new globalThis.Map<string, ScopeRow[]>();
    for (const row of campaign?.scope || []) { if (!groups.has(row.district_name)) groups.set(row.district_name, []); groups.get(row.district_name)!.push(row); }
    return Array.from(groups.entries());
  }, [campaign]);

  async function changeStatus(status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED") {
    if (!campaign || !window.confirm(`Change this campaign to ${status.toLowerCase()}?`)) return;
    setUpdatingStatus(true); setError(null);
    try {
      const updated = await apiFetch(`/api/campaigns/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setCampaign(function (current) { return current ? { ...current, status: updated.status } : current; });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update campaign status"); }
    finally { setUpdatingStatus(false); }
  }

  async function removeCampaign() {
    if (!campaign || !window.confirm("Delete this Draft campaign? Its scope and assignments will be removed.")) return;
    setUpdatingStatus(true); setError(null);
    try {
      await apiFetch(`/api/campaigns/${id}`, { method: "DELETE" });
      window.location.href = "/campaigns";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete campaign"); setUpdatingStatus(false); }
  }

  async function createCampaignIteration() {
    if (!campaign || !iterationForm.name.trim() || !iterationForm.targetSample || Number(iterationForm.targetSample) < 1) {
      setIterationError("Iteration name and a target sample greater than zero are required.");
      return;
    }
    setSavingIteration(true); setIterationError(null);
    try {
      const result = await apiFetch(`/api/campaigns/${id}/iterations`, {
        method: "POST",
        body: JSON.stringify({
          iterationName: iterationForm.name.trim(),
          researchPhase: iterationForm.stage,
          targetSampleSize: Number(iterationForm.targetSample),
          plannedStartDate: iterationForm.startDate || null,
          plannedEndDate: iterationForm.endDate || null
        })
      });
      const created = result.iteration || result;
      setIterations(function (current) { return [...current, { ...created, run_count: 0 }]; });
      setIterationForm(function (current) { return { ...current, name: "", stage: "BASE", startDate: "", endDate: "" }; });
      setShowIterationForm(false);
    } catch (reason) {
      setIterationError(reason instanceof Error ? reason.message : "Unable to create iteration");
    } finally { setSavingIteration(false); }
  }

  const canReview = Boolean(user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code));
  const canManageIterations = Boolean(user?.role.code === "CAMPAIGN_MANAGER" && campaign?.created_by_user_id === user.id && campaign.status !== "COMPLETED" && campaign.status !== "ARCHIVED");
  const canDelete = Boolean(campaign && user && campaign.status === "DRAFT" && (["SUPER_ADMIN", "ADMIN"].includes(user.role.code) || (user.role.code === "CAMPAIGN_MANAGER" && campaign.created_by_user_id === user.id)));
  const statusAction = campaign?.status === "DRAFT" ? { label: "Review & Activate", status: "ACTIVE" as const } : campaign?.status === "ACTIVE" ? { label: "Pause campaign", status: "PAUSED" as const } : campaign?.status === "PAUSED" ? { label: "Resume campaign", status: "ACTIVE" as const } : null;

  return <AppShell><div className={styles.page}>
    <div className={styles.backRow}><Link href="/campaigns"><ArrowLeft size={16} />Campaigns</Link></div>
    {error ? <div className={styles.message}>{error}</div> : !campaign ? <div className={styles.empty}>Loading campaign…</div> : <>
      <section className={styles.detailHero}><div className={styles.campaignIcon}><Megaphone size={18} /></div><div><span>{campaign.campaign_code} · {campaign.target_domain === "LOCAL_BODY" ? "LOCAL BODY" : "LEGISLATIVE"}</span><h1>{campaign.campaign_name}</h1><p>{campaign.target_type} · {campaign.target_name}{campaign.target_code ? ` · ${campaign.target_code}` : ""} · {campaign.survey_stage || "BASE"} survey</p></div><div className={styles.detailActions}><em>{campaign.status}</em>{canReview && statusAction && <button type="button" className={styles.primaryAction} disabled={updatingStatus} onClick={function () { changeStatus(statusAction.status); }}>{updatingStatus ? "Updating…" : statusAction.label}</button>}{canReview && campaign.status === "ACTIVE" && <button type="button" className={styles.secondaryButton} disabled={updatingStatus} onClick={function () { changeStatus("COMPLETED"); }}>Mark completed</button>}{canDelete && <button type="button" className={styles.dangerButton} disabled={updatingStatus} onClick={removeCampaign}><Trash2 size={14} />Delete draft</button>}</div></section>
      <section className={styles.metrics}><DetailMetric icon={MapPin} label="Districts" value={districts.length} /><DetailMetric icon={Building2} label="Mandals" value={campaign.scope.length} /><DetailMetric icon={ClipboardList} label="Iterations" value={iterations.length} /><DetailMetric icon={Users} label="Visible allocations" value={campaign.allocations.length} /></section>
      <section className={styles.iterationPanel}>
        <div className={styles.listHeader}><div><span>CAMPAIGN RESEARCH CYCLES</span><h2>Iterations and execution status</h2><p>Campaign Managers define the survey waves; Campaigners execute their assigned runs.</p></div>{canManageIterations && <button type="button" className={styles.primaryAction} onClick={function () { setShowIterationForm(true); }}><Plus size={15} />Create iteration</button>}</div>
        {iterationError && <div className={styles.message}>{iterationError}</div>}
        {showIterationForm && canManageIterations && <div className={styles.iterationForm}><label>Iteration name<input value={iterationForm.name} onChange={function (event) { setIterationForm({ ...iterationForm, name: event.target.value }); }} placeholder="Base survey — September" /></label><label>Survey stage<select value={iterationForm.stage} onChange={function (event) { setIterationForm({ ...iterationForm, stage: event.target.value }); }}>{surveyStageOptions.map(function (option) { return <option key={option.value} value={option.value}>{option.label}</option>; })}</select></label><label>Target sample<input type="number" min={1} value={iterationForm.targetSample} onChange={function (event) { setIterationForm({ ...iterationForm, targetSample: event.target.value }); }} /></label><label>Planned start<input type="date" value={iterationForm.startDate} onChange={function (event) { setIterationForm({ ...iterationForm, startDate: event.target.value }); }} /></label><label>Planned end<input type="date" value={iterationForm.endDate} onChange={function (event) { setIterationForm({ ...iterationForm, endDate: event.target.value }); }} /></label><div className={styles.iterationFormActions}><button type="button" className={styles.secondaryButton} onClick={function () { setShowIterationForm(false); }}>Cancel</button><button type="button" className={styles.primaryAction} disabled={savingIteration} onClick={createCampaignIteration}>{savingIteration ? "Creating…" : "Create iteration"}</button></div></div>}
        {iterations.length ? <div className={styles.iterationList}>{iterations.map(function (iteration) { const stage = surveyStageOptions.find(function (option) { return option.value === String(iteration.research_phase).toUpperCase(); }); return <Link key={iteration.id} href={`/iterations/${iteration.id}`} className={styles.iterationRow}><div className={styles.iterationNumber}>{iteration.iteration_number}</div><div><strong>{iteration.iteration_name}</strong><span>{stage?.label || iteration.research_phase} · {iteration.status}</span></div><div><small><Target size={13} />{Number(iteration.target_sample_size || 0).toLocaleString()} voters</small><small><PhoneCall size={13} />{Number(iteration.run_count || 0)} runs</small></div><ChevronRight size={17} /></Link>; })}</div> : <div className={styles.empty}><ClipboardList size={24} /><strong>No campaign iterations yet</strong><span>{canManageIterations ? "Create the first survey wave for this campaign." : "Iterations will appear here once the Campaign Manager creates them."}</span></div>}
      </section>
      <div className={styles.detailGrid}><section className={styles.listPanel}><div className={styles.listHeader}><div><span>ADMINISTRATIVE SCOPE</span><h2>District → Mandal</h2></div></div><div className={styles.scopeTree}>{districts.map(function ([district, rows]) { return <article key={district}><strong>{district}</strong><span>{rows.length} Mandals</span><div>{rows.map(function (row) { return <small key={row.id}>{row.name}</small>; })}</div></article>; })}</div></section>
        <section className={styles.listPanel}><div className={styles.listHeader}><div><span>WORK DISTRIBUTION</span><h2>Campaigner allocations</h2></div></div>{campaign.allocations.length ? <div className={styles.allocationList}>{campaign.allocations.map(function (allocation) { return <article key={allocation.id}><div><strong>{allocation.geography_name}</strong><small>{allocation.allocation_level} · {allocation.geography_code || "No code"}</small></div><span>{allocation.campaigner_name}</span><em>{allocation.status}</em></article>; })}</div> : <div className={styles.empty}>No visible work allocations.</div>}</section></div>
      <section className={styles.scopeContract}><ShieldCheck size={20} /><div><strong>Campaign geography contract</strong><span>Voter access and analysis remain limited to the target constituency and each user’s assigned work area.</span></div></section>
    </>}
  </div></AppShell>;
}

function DetailMetric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) { return <div className={styles.metric}><span><Icon size={17} /></span><div><small>{label}</small><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div></div>; }
