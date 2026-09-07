"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, MapPin, Megaphone, Plus, Search, Target, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./campaigns.module.css";

type Campaign = { id: string; campaign_code: string; campaign_name: string; target_domain: string; target_name: string; target_type: string; status: string; mandal_count: number; assignment_count: number; eligible_voters: number; created_by_name: string | null; start_date: string | null; end_date: string | null };

export default function CampaignsPage() {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("ALL");
  const canManage = Boolean(user && user.role.code !== "CAMPAIGNER");

  useEffect(function () {
    if (!user) return;
    apiFetch("/api/campaigns").then(setCampaigns).catch(function (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load campaigns");
    }).finally(function () { setLoading(false); });
  }, [user]);

  const visible = useMemo(function () {
    const search = query.trim().toLowerCase();
    return campaigns.filter(function (campaign) {
      const matchesDomain = domain === "ALL" || campaign.target_domain === domain;
      const matchesSearch = !search || `${campaign.campaign_code} ${campaign.campaign_name} ${campaign.target_name}`.toLowerCase().includes(search);
      return matchesDomain && matchesSearch;
    });
  }, [campaigns, query, domain]);

  const roleMessage = user?.role.code === "CAMPAIGNER"
    ? "Campaigns assigned to you and the geography available for your work."
    : user?.role.code === "CAMPAIGN_MANAGER"
      ? "Campaigns created by you, their allocations and operational coverage."
      : "All campaign operations across managers, campaigners and geographies.";

  return <AppShell><div className={styles.page}>
    <section className={styles.header}><div><span>CAMPAIGN OPERATIONS</span><h1>Campaigns</h1><p>{roleMessage}</p></div>
      {canManage && <Link className={styles.primaryAction} href="/campaigns/new"><Plus size={16} />Create Campaign</Link>}</section>
    <section className={styles.metrics}>
      <Metric icon={Megaphone} label="Visible Campaigns" value={campaigns.length} />
      <Metric icon={Target} label="Active" value={campaigns.filter(function (item) { return item.status === "ACTIVE"; }).length} />
      <Metric icon={MapPin} label="Mandals in Scope" value={campaigns.reduce(function (sum, item) { return sum + Number(item.mandal_count || 0); }, 0)} />
      <Metric icon={Users} label="Work Allocations" value={campaigns.reduce(function (sum, item) { return sum + Number(item.assignment_count || 0); }, 0)} />
    </section>
    {error && <div className={styles.message}>{error}</div>}
    <section className={styles.listPanel}>
      <div className={styles.listHeader}><div><span>MY PORTFOLIO</span><h2>Operational campaigns</h2></div><em>{visible.length} campaigns</em></div>
      <div className={styles.filters}><label className={styles.search}><Search size={15} /><input value={query} onChange={function (event) { setQuery(event.target.value); }} placeholder="Search campaigns or constituency" /></label>
        <select value={domain} onChange={function (event) { setDomain(event.target.value); }}><option value="ALL">All campaign types</option><option value="LEGISLATIVE">Legislative</option><option value="LOCAL_BODY">Local Body</option></select></div>
      {loading ? <div className={styles.empty}>Loading campaigns…</div> : !visible.length ? <div className={styles.emptyState}><Megaphone size={25} /><strong>No campaigns available</strong><span>{canManage ? "Create a campaign from a verified election geography." : "Assigned campaigns will appear here."}</span></div> : <div className={styles.campaignList}>{visible.map(function (campaign) {
        return <Link className={styles.campaignRow} href={`/campaigns/${campaign.id}`} key={campaign.id}><div className={styles.campaignIcon}><Megaphone size={17} /></div><div className={styles.campaignMain}><span>{campaign.campaign_code}</span><h3>{campaign.campaign_name}</h3><p>{campaign.target_type} · {campaign.target_name}{campaign.created_by_name ? ` · ${campaign.created_by_name}` : ""}</p></div><div className={styles.campaignFacts}><span><MapPin size={14} />{campaign.mandal_count} Mandals</span><span><Users size={14} />{campaign.assignment_count} allocations</span><span><ClipboardList size={14} />{Number(campaign.eligible_voters || 0).toLocaleString()} voters</span></div><em>{campaign.status}</em></Link>;
      })}</div>}
    </section>
  </div></AppShell>;
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return <div className={styles.metric}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value.toLocaleString()}</strong></div></div>;
}
