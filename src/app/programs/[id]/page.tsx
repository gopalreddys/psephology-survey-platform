"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  Flag,
  Languages,
  MapPinned,
  Megaphone,
  PauseCircle,
  PhoneCall,
  PlayCircle,
  Plus,
  RefreshCw,
  Target,
  UserRound,
  Users
} from "lucide-react";
import { useParams } from "next/navigation";

import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./dashboard.module.css";

type ProgramCampaign = {
  id: string;
  code: string;
  name: string;
  targetType: string;
  targetName: string;
  surveyStage: string;
  recordedStatus: string;
  operationalStatus: string;
  campaignManagerId: string | null;
  campaignManagerName: string | null;
  iterationCount: number;
  completedIterationCount: number;
  runCount: number;
  closedRunCount: number;
  openRunCount: number;
  selectedVoters: number;
  successfulVoters: number;
  retryEligibleVoters: number;
  pendingVoters: number;
  successfulYieldPct: number;
  callAttempts: number;
  callbacksReceived: number;
  connectedResponses: number;
  transcriptsCaptured: number;
  responsesCaptured: number;
  comparisonReady: boolean;
  needsAttention: boolean;
  attentionReasons: string[];
};

type ProgramDashboard = {
  program: {
    id: string;
    code: string;
    name: string;
    purpose: string | null;
    studyType: string;
    scopeMode: string | null;
    electionType: string | null;
    jurisdictionName: string | null;
    jurisdictionCode: string | null;
    targetSampleSize: number;
    primaryLanguage: string | null;
    status: string;
  };
  summary: {
    campaignCount: number;
    notStartedCampaignCount: number;
    inProgressCampaignCount: number;
    pausedCampaignCount: number;
    readyForReviewCampaignCount: number;
    completedCampaignCount: number;
    attentionCampaignCount: number;
    iterationCount: number;
    completedIterationCount: number;
    iterationCompletionPct: number;
    runCount: number;
    closedRunCount: number;
    openRunCount: number;
    selectedVoters: number;
    successfulVoters: number;
    successfulYieldPct: number;
    retryEligibleVoters: number;
    pendingVoters: number;
  };
  evidence: {
    callAttempts: number;
    callbacksReceived: number;
    connectedResponses: number;
    demoResponses: number;
    transcriptsCaptured: number;
    responsesCaptured: number;
    comparisonReadyCampaignCount: number;
    representative: boolean;
    predictiveReady: boolean;
  };
  campaigns: ProgramCampaign[];
  lifecycle?: {
    status: "NOT_STARTED" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "PAUSED" | "COMPLETED" | "ARCHIVED";
    recordedStatus: string;
    readyToComplete: boolean;
    blockers: string[];
    campaignCount: number;
    completedCampaignCount: number;
    openRuns: number;
    pendingVoters: number;
    retryEligibleVoters: number;
    attentionCampaigns: number;
    history: Array<{
      id: string;
      entity_type: string;
      previous_status: string | null;
      next_status: string;
      trigger_source: string;
      created_at: string;
      actor_name: string | null;
      campaign_name: string | null;
    }>;
  };
  warnings: string[];
  generatedAt: string;
};

export default function ProgramDetailPage() {
  const params = useParams();
  const programId = params.id as string;
  const { user, loading: userLoading } = useCurrentUser();
  const [dashboard, setDashboard] = useState<ProgramDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canManagePrograms = Boolean(
    user && ["SUPER_ADMIN", "ADMIN"].includes(user.role.code)
  );

  const loadDashboard = useCallback(async function (refresh = false) {
    if (!programId) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setMessage(null);

    try {
      const data = await apiFetch(`/api/programs/${programId}/dashboard`);
      setDashboard(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Program executive dashboard"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [programId]);

  useEffect(function () {
    if (!canManagePrograms || !programId) return;
    const timer = window.setTimeout(function () {
      void loadDashboard();
    }, 0);
    return function () {
      window.clearTimeout(timer);
    };
  }, [canManagePrograms, loadDashboard, programId]);

  async function completeProgram() {
    if (!dashboard?.lifecycle?.readyToComplete) return;
    if (!window.confirm("Complete this Program? This confirms that every Campaign has been formally completed and reviewed.")) return;
    setCompleting(true);
    setMessage(null);
    try {
      await apiFetch(`/api/programs/${programId}/complete`, { method: "POST" });
      await loadDashboard(true);
      setMessage("Program completed successfully. The portfolio lifecycle is now closed and audited.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete Program");
    } finally {
      setCompleting(false);
    }
  }

  if (userLoading || (canManagePrograms && loading)) {
    return (
      <AppShell>
        <div className="program-detail-loading">Preparing Program oversight…</div>
      </AppShell>
    );
  }

  if (user && !canManagePrograms) {
    return (
      <AppShell>
        <div className="program-detail-page">
          <FeedbackMessage
            tone="error"
            message="Program oversight is available only to Admin and Super Admin users. Campaign Managers work from their assigned Campaigns."
          />
        </div>
      </AppShell>
    );
  }

  if (!dashboard) {
    return (
      <AppShell>
        <div className="program-detail-page">
          <Link href="/programs" className="program-detail-back">
            <ArrowLeft size={15} /> Back to Programs
          </Link>
          <div className="program-detail-error">
            {message || "Program dashboard is unavailable."}
          </div>
        </div>
      </AppShell>
    );
  }

  const { program, summary, evidence, campaigns, warnings } = dashboard;
  const lifecycle = dashboard.lifecycle ?? {
    status: String(program.status || "DRAFT").toUpperCase() === "COMPLETED"
      ? "COMPLETED" as const
      : "IN_PROGRESS" as const,
    recordedStatus: program.status,
    readyToComplete: false,
    blockers: ["Program lifecycle status is waiting for the API deployment"],
    campaignCount: summary.campaignCount,
    completedCampaignCount: summary.completedCampaignCount,
    openRuns: summary.openRunCount,
    pendingVoters: summary.pendingVoters,
    retryEligibleVoters: summary.retryEligibleVoters,
    attentionCampaigns: summary.attentionCampaignCount,
    history: []
  };
  const programClosed = ["COMPLETED", "ARCHIVED"].includes(String(program.status).toUpperCase());

  return (
    <AppShell>
      <div className="program-detail-page">
        <Link href="/programs" className="program-detail-back">
          <ArrowLeft size={15} /> Back to Programs
        </Link>

        <section className="program-detail-header">
          <div>
            <div className="program-detail-eyebrow">PROGRAM OVERSIGHT</div>
            <h1>{program.name}</h1>
            <div className="program-detail-code">
              {program.code} · {program.jurisdictionName || "Scope not defined"}
            </div>
          </div>
          <div className="program-detail-actions">
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.refreshButton}
                disabled={refreshing}
                onClick={() => void loadDashboard(true)}
              >
                <RefreshCw size={15} className={refreshing ? styles.spinning : ""} />
                {refreshing ? "Refreshing…" : "Refresh status"}
              </button>
              {lifecycle.readyToComplete && (
                <button
                  type="button"
                  className={styles.completeButton}
                  disabled={completing}
                  onClick={() => void completeProgram()}
                >
                  <CheckCircle2 size={15} />
                  {completing ? "Completing…" : "Complete Program"}
                </button>
              )}
              {!programClosed && <Link
                href={`/campaigns/new?programId=${program.id}`}
                className="program-detail-create-button"
              >
                <Plus size={15} /> Create Campaign
              </Link>}
            </div>
            <div className="program-detail-operations-note">
              <ClipboardList size={16} />
              Oversight only: Campaign Managers govern Iterations; Campaigners execute Runs.
            </div>
          </div>
        </section>

        {message && (
          <FeedbackMessage message={message} className="program-detail-message" />
        )}

        <section className={styles.programLifecyclePanel}>
          <div>
            <div className="program-detail-eyebrow">PROGRAM LIFECYCLE</div>
            <h2>{formatStatus(lifecycle.status)}</h2>
            <p>{lifecycle.status === "READY_FOR_REVIEW" ? "Every Campaign is formally completed. An Admin can now close this Program." : lifecycle.status === "COMPLETED" ? "The Program portfolio has been formally completed and audited." : "Program readiness is governed by the formal completion of every Campaign."}</p>
          </div>
          <div className={styles.programLifecycleFacts}>
            <span><strong>{lifecycle.completedCampaignCount}/{lifecycle.campaignCount}</strong> Campaigns complete</span>
            <span><strong>{lifecycle.openRuns}</strong> Open Runs</span>
            <span><strong>{lifecycle.attentionCampaigns}</strong> Need attention</span>
          </div>
          {lifecycle.blockers.length > 0 && <div className={styles.programLifecycleBlockers}><strong>Required before Program completion</strong>{lifecycle.blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}</div>}
          {lifecycle.history.length > 0 && <div className={styles.programLifecycleHistory}><strong>Recent governed activity</strong>{lifecycle.history.slice(0, 6).map((event) => <span key={event.id}><em>{event.entity_type.replaceAll("_", " ")}</em><b>{event.previous_status ? `${event.previous_status} → ` : ""}{event.next_status}</b>{event.campaign_name && <i>{event.campaign_name}</i>}<small>{event.actor_name || formatStatus(event.trigger_source)} · {new Date(event.created_at).toLocaleString()}</small></span>)}</div>}
        </section>

        <section className={styles.primaryMetrics} aria-label="Program status summary">
          <DashboardMetric
            icon={Megaphone}
            label="Campaigns"
            value={summary.campaignCount}
            detail={`${summary.inProgressCampaignCount} in progress`}
          />
          <DashboardMetric
            icon={CheckCircle2}
            label="Iterations completed"
            value={`${summary.completedIterationCount}/${summary.iterationCount}`}
            detail={`${summary.iterationCompletionPct}% complete`}
          />
          <DashboardMetric
            icon={PhoneCall}
            label="Runs"
            value={summary.runCount}
            detail={`${summary.closedRunCount} closed · ${summary.openRunCount} open`}
          />
          <DashboardMetric
            icon={Target}
            label="Successful surveys"
            value={summary.successfulVoters}
            detail={`${summary.successfulYieldPct}% of ${summary.selectedVoters} selected`}
          />
          <DashboardMetric
            icon={AlertTriangle}
            label="Needs attention"
            value={summary.attentionCampaignCount}
            detail={`${summary.pendingVoters} pending · ${summary.retryEligibleVoters} retry eligible`}
            attention={summary.attentionCampaignCount > 0}
          />
          <DashboardMetric
            icon={Flag}
            label="Program status"
            value={formatStatus(lifecycle.status)}
            detail={program.studyType}
          />
        </section>

        <section className={styles.lifecyclePanel}>
          <div className={styles.sectionHeading}>
            <div>
              <div className="program-detail-eyebrow">CAMPAIGN LIFECYCLE</div>
              <h2>Portfolio execution status</h2>
              <p>Operational status is calculated from governed Campaign, Iteration and Run records.</p>
            </div>
          </div>
          <div className={styles.lifecycleGrid}>
            <LifecycleItem icon={ClipboardList} label="Not started" value={summary.notStartedCampaignCount} />
            <LifecycleItem icon={PlayCircle} label="In progress" value={summary.inProgressCampaignCount} />
            <LifecycleItem icon={PauseCircle} label="Paused" value={summary.pausedCampaignCount} />
            <LifecycleItem icon={Activity} label="Ready for review" value={summary.readyForReviewCampaignCount} />
            <LifecycleItem icon={CheckCircle2} label="Completed" value={summary.completedCampaignCount} />
          </div>
        </section>

        <div className={styles.twoColumnGrid}>
          <section className="program-purpose-card">
            <div className="program-purpose-icon"><ClipboardList size={19} /></div>
            <div>
              <div className="program-detail-eyebrow">RESEARCH PURPOSE</div>
              <h2>Program objective</h2>
              <p>{program.purpose || "No purpose defined."}</p>
              <div className={styles.programContext}>
                <span><MapPinned size={14} /> {program.jurisdictionName || "Scope pending"}</span>
                <span><Target size={14} /> Target {program.targetSampleSize || "–"}</span>
                <span><Languages size={14} /> {program.primaryLanguage || "Language pending"}</span>
              </div>
            </div>
          </section>

          <section className={styles.evidencePanel}>
            <div className="program-detail-eyebrow">EVIDENCE CAPTURE</div>
            <h2>Research data readiness</h2>
            <div className={styles.evidenceGrid}>
              <EvidenceFact icon={PhoneCall} label="Call attempts" value={evidence.callAttempts} />
              <EvidenceFact icon={Activity} label="Callbacks stored" value={evidence.callbacksReceived} />
              <EvidenceFact icon={Users} label="Connected responses" value={evidence.connectedResponses} />
              <EvidenceFact icon={FileText} label="Transcripts" value={evidence.transcriptsCaptured} />
              <EvidenceFact icon={Database} label="Structured responses" value={evidence.responsesCaptured} />
              <EvidenceFact icon={BarChart3} label="Campaigns comparable" value={evidence.comparisonReadyCampaignCount} />
            </div>
            <div className={styles.researchBoundary}>
              <AlertTriangle size={15} />
              Program evidence remains directional; representative and predictive reporting is locked until methodology controls are configured.
            </div>
          </section>
        </div>

        <section className="program-campaign-panel">
          <div className="program-campaign-header">
            <div>
              <div className="program-detail-eyebrow">CAMPAIGN PORTFOLIO</div>
              <h2>Campaigns under this Program</h2>
              <p>Review ownership, execution progress and evidence readiness, then drill down for operational detail.</p>
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
              <Link
                href={`/campaigns/new?programId=${program.id}`}
                className="program-detail-create-button"
              >
                <Plus size={15} /> Create Campaign
              </Link>
            </div>
          ) : (
            <div className={styles.campaignList}>
              {campaigns.map((campaign) => (
                <article className={styles.campaignCard} key={campaign.id}>
                  <div className={styles.campaignTopRow}>
                    <div className={styles.campaignIdentity}>
                      <div className="program-campaign-icon"><Megaphone size={18} /></div>
                      <div>
                        <span>{campaign.code}</span>
                        <Link href={`/campaigns/${campaign.id}`}>{campaign.name}</Link>
                        <small>{campaign.targetType} · {campaign.targetName} · {campaign.surveyStage}</small>
                      </div>
                    </div>
                    <StatusBadge status={campaign.operationalStatus} />
                  </div>

                  <div className={styles.campaignFacts}>
                    <CampaignFact
                      icon={UserRound}
                      label="Campaign Manager"
                      value={campaign.campaignManagerName || "Not assigned"}
                    />
                    <CampaignFact
                      icon={CheckCircle2}
                      label="Iterations"
                      value={`${campaign.completedIterationCount}/${campaign.iterationCount} completed`}
                    />
                    <CampaignFact
                      icon={PhoneCall}
                      label="Runs"
                      value={`${campaign.closedRunCount}/${campaign.runCount} closed`}
                    />
                    <CampaignFact
                      icon={Target}
                      label="Survey yield"
                      value={`${campaign.successfulVoters}/${campaign.selectedVoters} · ${campaign.successfulYieldPct}%`}
                    />
                  </div>

                  <div className={styles.progressTrack}>
                    <span style={{ width: `${Math.min(campaign.successfulYieldPct, 100)}%` }} />
                  </div>

                  <div className={styles.campaignFooter}>
                    <div className={styles.captureSummary}>
                      {campaign.callbacksReceived}/{campaign.callAttempts} callbacks · {campaign.transcriptsCaptured} transcripts · {campaign.responsesCaptured} response records
                    </div>
                    <div className={styles.campaignLinks}>
                      {campaign.comparisonReady && (
                        <Link href={`/analytics/campaigns/${campaign.id}`}>
                          <BarChart3 size={14} /> Compare Iterations
                        </Link>
                      )}
                      <Link href={`/campaigns/${campaign.id}`}>
                        Open Campaign <ArrowLeft size={14} className={styles.forwardArrow} />
                      </Link>
                    </div>
                  </div>

                  {campaign.needsAttention && (
                    <div className={styles.attentionNote}>
                      <AlertTriangle size={14} />
                      <span>{campaign.attentionReasons.join(" ")}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className={styles.governancePanel}>
          <div className={styles.sectionHeading}>
            <div>
              <div className="program-detail-eyebrow">GOVERNANCE CHECKS</div>
              <h2>Research and operational safeguards</h2>
            </div>
            <span>Generated {new Date(dashboard.generatedAt).toLocaleString()}</span>
          </div>
          <div className={styles.warningList}>
            {warnings.map((warning) => (
              <div key={warning}><AlertTriangle size={15} /><span>{warning}</span></div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function DashboardMetric({
  icon: Icon,
  label,
  value,
  detail,
  attention = false
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  detail: string;
  attention?: boolean;
}) {
  return (
    <div className={`${styles.metricCard} ${attention ? styles.metricAttention : ""}`}>
      <div className={styles.metricIcon}><Icon size={19} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function LifecycleItem({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className={styles.lifecycleItem}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceFact({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className={styles.evidenceFact}>
      <Icon size={16} />
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

function CampaignFact({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.campaignFact}>
      <Icon size={15} />
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status${statusClass(status)}`]}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusClass(status: string) {
  return String(status || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function statusLabel(status: string) {
  return String(status || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatStatus(status: string) {
  return statusLabel(status);
}
