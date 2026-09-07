"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ClipboardList, MapPin, Megaphone, ShieldCheck, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import styles from "../campaigns.module.css";

type ScopeRow = { id: string; name: string; code: string | null; district_id: string; district_name: string; district_code: string | null };
type Allocation = { id: string; allocation_level: string; geography_name: string; geography_code: string | null; campaigner_name: string; status: string };
type Campaign = { id: string; campaign_code: string; campaign_name: string; target_domain: string; target_type: string; target_name: string; target_code: string | null; survey_stage?: "BASE" | "CAMPAIGN" | "TURNOUT"; status: string; created_by_name: string | null; start_date: string | null; end_date: string | null; scope: ScopeRow[]; allocations: Allocation[] };

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(function () { apiFetch(`/api/campaigns/${id}`).then(setCampaign).catch(function (reason) { setError(reason instanceof Error ? reason.message : "Unable to load campaign"); }); }, [id]);
  const districts = useMemo(function () {
    const groups = new globalThis.Map<string, ScopeRow[]>();
    for (const row of campaign?.scope || []) { if (!groups.has(row.district_name)) groups.set(row.district_name, []); groups.get(row.district_name)!.push(row); }
    return Array.from(groups.entries());
  }, [campaign]);

  return <AppShell><div className={styles.page}>
    <div className={styles.backRow}><Link href="/campaigns"><ArrowLeft size={16} />Campaigns</Link></div>
    {error ? <div className={styles.message}>{error}</div> : !campaign ? <div className={styles.empty}>Loading campaign…</div> : <>
      <section className={styles.detailHero}><div className={styles.campaignIcon}><Megaphone size={18} /></div><div><span>{campaign.campaign_code} · {campaign.target_domain === "LOCAL_BODY" ? "LOCAL BODY" : "LEGISLATIVE"}</span><h1>{campaign.campaign_name}</h1><p>{campaign.target_type} · {campaign.target_name}{campaign.target_code ? ` · ${campaign.target_code}` : ""} · {campaign.survey_stage || "BASE"} survey</p></div><em>{campaign.status}</em></section>
      <section className={styles.metrics}><DetailMetric icon={MapPin} label="Districts" value={districts.length} /><DetailMetric icon={Building2} label="Mandals" value={campaign.scope.length} /><DetailMetric icon={Users} label="My visible allocations" value={campaign.allocations.length} /><DetailMetric icon={ClipboardList} label="Campaign owner" value={campaign.created_by_name || "—"} /></section>
      <div className={styles.detailGrid}><section className={styles.listPanel}><div className={styles.listHeader}><div><span>ADMINISTRATIVE SCOPE</span><h2>District → Mandal</h2></div></div><div className={styles.scopeTree}>{districts.map(function ([district, rows]) { return <article key={district}><strong>{district}</strong><span>{rows.length} Mandals</span><div>{rows.map(function (row) { return <small key={row.id}>{row.name}</small>; })}</div></article>; })}</div></section>
        <section className={styles.listPanel}><div className={styles.listHeader}><div><span>WORK DISTRIBUTION</span><h2>Campaigner allocations</h2></div></div>{campaign.allocations.length ? <div className={styles.allocationList}>{campaign.allocations.map(function (allocation) { return <article key={allocation.id}><div><strong>{allocation.geography_name}</strong><small>{allocation.allocation_level} · {allocation.geography_code || "No code"}</small></div><span>{allocation.campaigner_name}</span><em>{allocation.status}</em></article>; })}</div> : <div className={styles.empty}>No visible work allocations.</div>}</section></div>
      <section className={styles.scopeContract}><ShieldCheck size={20} /><div><strong>Campaign geography contract</strong><span>Voter access and analysis remain limited to the target constituency and each user’s assigned work area.</span></div></section>
    </>}
  </div></AppShell>;
}

function DetailMetric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) { return <div className={styles.metric}><span><Icon size={17} /></span><div><small>{label}</small><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div></div>; }
