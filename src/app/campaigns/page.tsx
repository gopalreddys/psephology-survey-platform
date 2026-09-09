"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  MapPin,
  Megaphone,
  PlayCircle,
  Plus,
  Search,
  Users,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./campaigns.module.css";

type Campaign = {
  id: string;
  program_id?: string | null;
  program_code?: string | null;
  program_name?: string | null;
  campaign_code: string;
  campaign_name: string;
  target_domain: string;
  target_name: string;
  target_type: string;
  survey_stage?: "BASE" | "CAMPAIGN" | "TURNOUT";
  status: string;
  mandal_count: number;
  assignment_count: number;
  eligible_voters: number;
  created_by_name: string | null;
  campaign_manager_name?: string | null;
  start_date: string | null;
  end_date: string | null;
};

type ProgramGroup = {
  id: string;
  name: string;
  code: string;
  campaigns: Campaign[];
};

export default function CampaignsPage() {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("ALL");
  const canCreate = Boolean(user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code));

  useEffect(function () {
    if (!user) return;
    apiFetch("/api/campaigns")
      .then(function (data) {
        setCampaigns(Array.isArray(data) ? data : data.items || []);
      })
      .catch(function (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load campaigns");
      })
      .finally(function () { setLoading(false); });
  }, [user]);

  const visible = useMemo(function () {
    const search = query.trim().toLowerCase();
    return campaigns.filter(function (campaign) {
      const matchesDomain = domain === "ALL" || campaign.target_domain === domain;
      const searchable = `${campaign.campaign_code} ${campaign.campaign_name} ${campaign.target_name} ${campaign.program_name || ""} ${campaign.program_code || ""}`.toLowerCase();
      return matchesDomain && (!search || searchable.includes(search));
    });
  }, [campaigns, query, domain]);

  const groups = useMemo(function () {
    const grouped = new Map<string, ProgramGroup>();
    for (const campaign of visible) {
      const key = campaign.program_id || "unlinked";
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: key,
          name: campaign.program_name || "Program not linked",
          code: campaign.program_code || "REVIEW REQUIRED",
          campaigns: [],
        });
      }
      grouped.get(key)!.campaigns.push(campaign);
    }
    return Array.from(grouped.values()).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }, [visible]);

  const running = campaigns.filter(function (item) { return String(item.status).toUpperCase() === "ACTIVE"; }).length;
  const completed = campaigns.filter(function (item) { return ["COMPLETED", "COMPLETE"].includes(String(item.status).toUpperCase()); }).length;
  const programCount = new Set(campaigns.map(function (item) { return item.program_id; }).filter(Boolean)).size;

  const roleMessage = user?.role.code === "CAMPAIGNER"
    ? "Campaigns assigned to you and the geography available for your work."
    : user?.role.code === "CAMPAIGN_MANAGER"
      ? "Campaigns assigned to you. Create Iterations and allocate each Iteration to Campaigners."
      : "Review Campaign volume and operational status under each research Program.";

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.header}>
          <div><span>CAMPAIGN OPERATIONS</span><h1>Campaigns</h1><p>{roleMessage}</p></div>
          {canCreate && <Link className={styles.primaryAction} href="/campaigns/new"><Plus size={16} />Create Campaign</Link>}
        </section>

        <section className={styles.metrics}>
          <Metric icon={Megaphone} label="Campaigns" value={campaigns.length} />
          <Metric icon={FolderKanban} label="Programs" value={programCount} />
          <Metric icon={PlayCircle} label="Running" value={running} />
          <Metric icon={CheckCircle2} label="Completed" value={completed} />
        </section>

        {error && <FeedbackMessage message={error} className={styles.message} />}

        <section className={styles.listPanel}>
          <div className={styles.listHeader}>
            <div><span>PROGRAM CAMPAIGN PORTFOLIO</span><h2>Operational Campaigns</h2></div>
            <em>{visible.length} Campaigns</em>
          </div>
          <div className={styles.filters}>
            <label className={styles.search}><Search size={15} /><input value={query} onChange={function (event) { setQuery(event.target.value); }} placeholder="Search Program, Campaign or constituency" /></label>
            <select value={domain} onChange={function (event) { setDomain(event.target.value); }}>
              <option value="ALL">All Campaign types</option>
              <option value="LEGISLATIVE">Legislative</option>
              <option value="LOCAL_BODY">Local Body</option>
            </select>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading Campaigns…</div>
          ) : !visible.length ? (
            <div className={styles.emptyState}>
              <Megaphone size={25} />
              <strong>No Campaigns available</strong>
              <span>{canCreate ? "Open a Program to create its first Campaign." : "Assigned Campaigns will appear here."}</span>
            </div>
          ) : (
            <div className={styles.programGroups}>
              {groups.map(function (group) {
                const groupRunning = group.campaigns.filter(function (item) { return String(item.status).toUpperCase() === "ACTIVE"; }).length;
                const groupCompleted = group.campaigns.filter(function (item) { return ["COMPLETED", "COMPLETE"].includes(String(item.status).toUpperCase()); }).length;
                return (
                  <section className={styles.programGroup} key={group.id}>
                    <div className={styles.programGroupHeader}>
                      <div><span>{group.code}</span><h3>{group.name}</h3></div>
                      <div className={styles.programGroupStats}>
                        <span><strong>{group.campaigns.length}</strong> Total</span>
                        <span><strong>{groupRunning}</strong> Running</span>
                        <span><strong>{groupCompleted}</strong> Completed</span>
                        {group.id !== "unlinked" && <Link href={`/programs/${group.id}`}>Open Program</Link>}
                      </div>
                    </div>
                    <div className={styles.campaignList}>
                      {group.campaigns.map(function (campaign) {
                        return (
                          <Link className={styles.campaignRow} href={`/campaigns/${campaign.id}`} key={campaign.id}>
                            <div className={styles.campaignIcon}><Megaphone size={17} /></div>
                            <div className={styles.campaignMain}>
                              <span>{campaign.campaign_code}</span>
                              <h3>{campaign.campaign_name}</h3>
                              <p>{campaign.target_type} · {campaign.target_name}{campaign.campaign_manager_name ? ` · Manager: ${campaign.campaign_manager_name}` : " · Manager unassigned"}</p>
                            </div>
                            <div className={styles.campaignFacts}>
                              <span><MapPin size={14} />{campaign.mandal_count} Mandals</span>
                              <span><Users size={14} />{campaign.assignment_count} allocations</span>
                              <span><ClipboardList size={14} />{Number(campaign.eligible_voters || 0).toLocaleString()} voters</span>
                            </div>
                            <em>{campaign.survey_stage || "BASE"} · {campaign.status}</em>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return <div className={styles.metric}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value.toLocaleString()}</strong></div></div>;
}
