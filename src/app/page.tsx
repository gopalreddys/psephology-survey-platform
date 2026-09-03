"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Database,
  MapPinned,
  PhoneCall,
  Sparkles,
  Users,
} from "lucide-react";

import AppShell from "@/components/AppShell";


export default function Home() {
  return (
    <AppShell>
      <div className="dashboard-page">

        {/* PAGE INTRODUCTION */}

        <section className="dashboard-hero">

          <div>
            <div className="dashboard-eyebrow">
              RESEARCH COMMAND CENTER
            </div>

            <h1 className="dashboard-title">
              Survey Intelligence Dashboard
            </h1>

            <p className="dashboard-description">
              Monitor research programs, survey execution,
              voter coverage and analytical readiness from
              one workspace.
            </p>
          </div>


          <div className="dashboard-hero-actions">

            <Link
              href="/programs"
              className="dashboard-secondary-button"
            >
              <ClipboardList size={16} />
              View Programs
            </Link>

            <Link
              href="/voters"
              className="dashboard-primary-button"
            >
              <Users size={16} />
              Voter Data
            </Link>

          </div>

        </section>


        {/* KPI OVERVIEW */}

        <section className="dashboard-kpi-grid">

          <MetricCard
            icon={ClipboardList}
            label="Research Programs"
            value="1"
            detail="Active research workspace"
            tone="rose"
          />

          <MetricCard
            icon={Database}
            label="Survey Contacts"
            value="40"
            detail="Voter master records"
            tone="peach"
          />

          <MetricCard
            icon={PhoneCall}
            label="Analyzed Calls"
            value="6"
            detail="Survey evidence processed"
            tone="pink"
          />

          <MetricCard
            icon={Activity}
            label="Platform Status"
            value="Healthy"
            detail="Core services available"
            tone="cream"
          />

        </section>


        <div className="dashboard-grid">

          {/* RESEARCH LIFECYCLE */}

          <section className="dashboard-panel dashboard-lifecycle-panel">

            <div className="dashboard-panel-header">

              <div>
                <div className="dashboard-section-label">
                  RESEARCH OPERATIONS
                </div>

                <h2>
                  Survey Research Lifecycle
                </h2>

                <p>
                  Follow research from voter data preparation
                  through evidence-based analysis.
                </p>
              </div>

            </div>


            <div className="dashboard-lifecycle">

              <LifecycleStep
                number="01"
                icon={Database}
                title="Voter Data"
                description="Prepare eligible survey contacts."
                status="Ready"
              />

              <LifecycleConnector />

              <LifecycleStep
                number="02"
                icon={ClipboardList}
                title="Research Design"
                description="Define iterations and questionnaires."
                status="Configured"
              />

              <LifecycleConnector />

              <LifecycleStep
                number="03"
                icon={PhoneCall}
                title="AI Surveys"
                description="Execute voice research and retries."
                status="In Progress"
              />

              <LifecycleConnector />

              <LifecycleStep
                number="04"
                icon={BarChart3}
                title="Analysis"
                description="Convert evidence into research insight."
                status="Available"
              />

            </div>

          </section>


          {/* QUICK ACTIONS */}

          <section className="dashboard-panel">

            <div className="dashboard-panel-header">

              <div>
                <div className="dashboard-section-label">
                  QUICK ACCESS
                </div>

                <h2>
                  Continue your work
                </h2>
              </div>

            </div>


            <div className="dashboard-quick-actions">

              <QuickAction
                href="/programs"
                icon={ClipboardList}
                title="Programs"
                description="Manage research programs and iterations."
              />

              <QuickAction
                href="/voters"
                icon={Users}
                title="Voter Data"
                description="Review survey contacts and geography."
              />

              <QuickAction
                href="/questionnaires"
                icon={Sparkles}
                title="Questionnaires"
                description="Manage research questions and themes."
              />

              <QuickAction
                href="/geography"
                icon={MapPinned}
                title="Geography"
                description="Review constituency and local mapping."
              />

            </div>

          </section>

        </div>


        {/* BOTTOM ROW */}

        <div className="dashboard-bottom-grid">

          <section className="dashboard-panel">

            <div className="dashboard-panel-header">

              <div>
                <div className="dashboard-section-label">
                  SURVEY HEALTH
                </div>

                <h2>
                  Operational Readiness
                </h2>

                <p>
                  Core components required for survey execution.
                </p>
              </div>

            </div>


            <div className="dashboard-health-list">

              <HealthRow
                label="Voter Master"
                detail="Survey contacts available"
                status="Ready"
              />

              <HealthRow
                label="Questionnaire"
                detail="Baseline research questionnaire"
                status="Ready"
              />

              <HealthRow
                label="AI Voice Configuration"
                detail="Agent and voice routing configured"
                status="Ready"
              />

              <HealthRow
                label="Research Analysis"
                detail="Question-level evidence processing"
                status="Ready"
              />

            </div>

          </section>


          <section className="dashboard-panel dashboard-insight-panel">

            <div className="dashboard-insight-icon">
              <Sparkles size={21} />
            </div>

            <div className="dashboard-section-label">
              RESEARCH INTELLIGENCE
            </div>

            <h2>
              Evidence before conclusions
            </h2>

            <p>
              Survey findings are built from recorded
              conversations, transcripts and question-level
              responses before being aggregated into
              geographical research insights.
            </p>

            <div className="dashboard-evidence-flow">

              <span>Calls</span>
              <ArrowRight size={13} />
              <span>Evidence</span>
              <ArrowRight size={13} />
              <span>Signals</span>
              <ArrowRight size={13} />
              <span>Insights</span>

            </div>

          </section>

        </div>


        <div className="dashboard-demo-note">
          Dashboard values currently represent the configured
          demo environment. Operational metrics will progressively
          use live Program, Iteration, Run and Call data.
        </div>

      </div>
    </AppShell>
  );
}


function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className={`dashboard-metric-card dashboard-tone-${tone}`}>

      <div className="dashboard-metric-top">

        <div className="dashboard-metric-icon">
          <Icon size={18} />
        </div>

        <span>
          Demo snapshot
        </span>

      </div>

      <div className="dashboard-metric-label">
        {label}
      </div>

      <div className="dashboard-metric-value">
        {value}
      </div>

      <div className="dashboard-metric-detail">
        {detail}
      </div>

    </div>
  );
}


function LifecycleStep({
  number,
  icon: Icon,
  title,
  description,
  status,
}: {
  number: string;
  icon: React.ElementType;
  title: string;
  description: string;
  status: string;
}) {
  return (
    <div className="dashboard-lifecycle-step">

      <div className="dashboard-lifecycle-number">
        {number}
      </div>

      <div className="dashboard-lifecycle-icon">
        <Icon size={19} />
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>

      <div className="dashboard-lifecycle-status">
        <CheckCircle2 size={13} />
        {status}
      </div>

    </div>
  );
}


function LifecycleConnector() {
  return (
    <div className="dashboard-lifecycle-connector">
      <ArrowRight size={17} />
    </div>
  );
}


function QuickAction({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="dashboard-quick-action"
    >

      <div className="dashboard-quick-icon">
        <Icon size={17} />
      </div>

      <div>
        <h3>
          {title}
        </h3>

        <p>
          {description}
        </p>
      </div>

      <ArrowRight
        size={15}
        className="dashboard-quick-arrow"
      />

    </Link>
  );
}


function HealthRow({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: string;
}) {
  return (
    <div className="dashboard-health-row">

      <div className="dashboard-health-check">
        <CheckCircle2 size={16} />
      </div>

      <div className="dashboard-health-copy">
        <strong>
          {label}
        </strong>

        <span>
          {detail}
        </span>
      </div>

      <div className="dashboard-health-status">
        {status}
      </div>

    </div>
  );
}
