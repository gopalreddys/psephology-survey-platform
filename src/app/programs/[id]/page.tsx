"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Flag,
  Languages,
  MapPinned,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Plus,
  Target,
  UserRound,
} from "lucide-react";
import { useParams } from "next/navigation";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";

type Program = {
  id: string;
  study_code: string;
  study_name: string;
  purpose: string | null;
  study_type: string;
  scope_mode: string | null;
  election_type: string | null;
  jurisdiction_name: string | null;
  jurisdiction_code: string | null;
  target_sample_size: number | null;
  primary_language: string | null;
  status: string;
};

type Campaign = {
  id: string;
  program_id?: string | null;
  campaign_code: string;
  campaign_name: string;
  target_type: string;
  target_name: string;
  survey_stage?: string | null;
  status: string;
  campaign_manager_name?: string | null;
  iteration_count?: number;
  completed_iteration_count?: number;
  run_count?: number;
  successful_voters?: number;
  start_date: string | null;
  end_date: string | null;
};

const RUNNING_STATUSES = new Set(["ACTIVE"]);
const COMPLETED_STATUSES = new Set(["COMPLETED", "COMPLETE"]);

export default function ProgramDetailPage() {
  const params = useParams();
  const programId = params.id as string;
  const { user, loading: userLoading } = useCurrentUser();
  const [program, setProgram] = useState<Program | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const canManagePrograms = Boolean(
    user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code)
  );

  useEffect(function () {
    if (!canManagePrograms || !programId) return;
    let cancelled = false;

    Promise.all([
      apiFetch(`/api/programs/${programId}`),
      apiFetch("/api/campaigns"),
    ])
      .then(function ([programData, campaignData]) {
        if (cancelled) return;
        const allCampaigns = Array.isArray(campaignData)
          ? campaignData
          : campaignData.items || [];
        setProgram(programData);
        setCampaigns(
          allCampaigns.filter(function (campaign: Campaign) {
            return campaign.program_id === programId;
          })
        );
      })
      .catch(function (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Unable to load Program campaigns"
          );
        }
      })
      .finally(function () {
        if (!cancelled) setLoading(false);
      });

    return function () {
      cancelled = true;
    };
  }, [canManagePrograms, programId]);

  const summary = useMemo(function () {
    return {
      running: campaigns.filter(function (campaign) {
        return RUNNING_STATUSES.has(String(campaign.status).toUpperCase());
      }).length,
      completed: campaigns.filter(function (campaign) {
        return COMPLETED_STATUSES.has(String(campaign.status).toUpperCase());
      }).length,
      paused: campaigns.filter(function (campaign) {
        return String(campaign.status).toUpperCase() === "PAUSED";
      }).length,
      draft: campaigns.filter(function (campaign) {
        return String(campaign.status).toUpperCase() === "DRAFT";
      }).length,
    };
  }, [campaigns]);

  if (userLoading || (canManagePrograms && loading)) {
    return <AppShell><div className="program-detail-loading">Loading Program portfolio…</div></AppShell>;
  }

  if (user && !canManagePrograms) {
    return (
      <AppShell>
        <div className="program-detail-page">
          <FeedbackMessage
            message="Programs are governed by Admin and Super Admin users. Campaign Managers work from their assigned Campaigns."
            className="program-detail-message"
          />
        </div>
      </AppShell>
    );
  }

  if (!program) {
    return (
      <AppShell>
        <div className="program-detail-page">
          <Link href="/programs" className="program-detail-back"><ArrowLeft size={15} /> Back to Programs</Link>
          <div className="program-detail-error">{message || "Program not found."}</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="program-detail-page">
        <Link href="/programs" className="program-detail-back"><ArrowLeft size={15} /> Back to Programs</Link>

        <section className="program-detail-header">
          <div>
            <div className="program-detail-eyebrow">RESEARCH PROGRAM</div>
            <h1>{program.study_name}</h1>
            <div className="program-detail-code">{program.study_code}</div>
          </div>
          <div className="program-detail-actions">
            <div className="program-detail-operations-note">
              <ClipboardList size={16} />
              Admins define Campaigns; Campaign Managers create their Iterations.
            </div>
            <Link href={`/campaigns/new?programId=${program.id}`} className="program-detail-create-button">
              <Plus size={15} /> Create Campaign
            </Link>
          </div>
        </section>

        {message && <FeedbackMessage message={message} className="program-detail-message" />}

        <section className="program-detail-metrics">
          <ProgramMetric icon={MapPinned} label="Constituency" value={program.jurisdiction_name || "-"} />
          <ProgramMetric icon={Target} label="Target Sample" value={program.target_sample_size?.toLocaleString() || "-"} />
          <ProgramMetric icon={Languages} label="Language" value={program.primary_language || "-"} />
          <ProgramMetric icon={Megaphone} label="Campaigns" value={String(campaigns.length)} />
          <ProgramMetric icon={PlayCircle} label="Running" value={String(summary.running)} />
          <ProgramMetric icon={PauseCircle} label="Paused" value={String(summary.paused)} />
          <ProgramMetric icon={CheckCircle2} label="Completed" value={String(summary.completed)} />
          <ProgramMetric icon={Flag} label="Program Status" value={program.status} />
        </section>

        <section className="program-purpose-card">
          <div className="program-purpose-icon"><ClipboardList size={19} /></div>
          <div>
            <div className="program-detail-eyebrow">RESEARCH PURPOSE</div>
            <h2>Program Objective</h2>
            <p>{program.purpose || "No purpose defined."}</p>
          </div>
        </section>

        <section className="program-campaign-panel">
          <div className="program-campaign-header">
            <div>
              <div className="program-detail-eyebrow">CAMPAIGN PORTFOLIO</div>
              <h2>Campaigns under this Program</h2>
              <p>Review ownership, operational state and geography before opening a Campaign.</p>
            </div>
            <div className="program-campaign-count">
              {campaigns.length} {campaigns.length === 1 ? "Campaign" : "Campaigns"}
            </div>
          </div>

          {campaigns.length === 0 ? (
            <div className="program-campaign-empty">
              <Megaphone size={25} />
              <strong>No Campaigns created</strong>
              <span>Create the first Campaign within this Program’s approved parameters.</span>
              <Link href={`/campaigns/new?programId=${program.id}`} className="program-detail-create-button">
                <Plus size={15} /> Create Campaign
              </Link>
            </div>
          ) : (
            <div className="program-campaign-list">
              {campaigns.map(function (campaign) {
                return (
                  <Link href={`/campaigns/${campaign.id}`} className="program-campaign-row" key={campaign.id}>
                    <div className="program-campaign-icon"><Megaphone size={18} /></div>
                    <div className="program-campaign-main">
                      <span>{campaign.campaign_code}</span>
                      <strong>{campaign.campaign_name}</strong>
                      <small>{campaign.target_type} · {campaign.target_name} · {campaign.survey_stage || "BASE"}</small>
                    </div>
                    <CampaignFact icon={UserRound} label="Campaign Manager" value={campaign.campaign_manager_name || "Not assigned"} />
                    <CampaignFact icon={CheckCircle2} label="Execution" value={`${Number(campaign.completed_iteration_count || 0)} / ${Number(campaign.iteration_count || 0)} iterations · ${Number(campaign.run_count || 0)} runs · ${Number(campaign.successful_voters || 0)} successful`} />
                    <span className={`program-campaign-status ${statusClass(campaign.status)}`}>{campaign.status}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {summary.draft > 0 && (
            <div className="program-campaign-footnote">
              {summary.draft} Draft {summary.draft === 1 ? "Campaign requires" : "Campaigns require"} manager assignment and readiness review.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function ProgramMetric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="program-detail-metric">
      <div className="program-detail-metric-icon"><Icon size={18} /></div>
      <div><div className="program-detail-metric-label">{label}</div><div className="program-detail-metric-value">{value}</div></div>
    </div>
  );
}

function CampaignFact({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="program-campaign-fact">
      <Icon size={15} />
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

function statusClass(status: string) {
  const normalized = String(status).toLowerCase();
  if (["active", "running"].includes(normalized)) return "is-running";
  if (["completed", "complete"].includes(normalized)) return "is-completed";
  if (normalized === "paused") return "is-paused";
  return "is-draft";
}
