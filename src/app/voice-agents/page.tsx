"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, CloudDownload, PhoneCall, Plus, ShieldCheck, Tags, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./voice-agents.module.css";

type Category = "URBAN_MALE" | "URBAN_FEMALE" | "RURAL_MALE" | "RURAL_FEMALE";
type VoiceAgent = {
  id: string;
  provider_deployment_id: string;
  app_id: string;
  app_version: number;
  provider_name: string | null;
  description: string | null;
  channel_direction: string;
  provider_status: string;
  connection_id: string | null;
  outbound_phone_number: string | null;
  catalog_source: "SARVAM_DEPLOYMENT_API" | "MANUAL_AGENT_APP";
  usage_category: Category | null;
  is_enabled: boolean;
  is_selectable: boolean;
  last_synced_at: string;
};

const categories: { value: Category; label: string }[] = [
  { value: "URBAN_MALE", label: "Urban Male" },
  { value: "URBAN_FEMALE", label: "Urban Female" },
  { value: "RURAL_MALE", label: "Rural Male" },
  { value: "RURAL_FEMALE", label: "Rural Female" }
];

const emptyRegistration = {
  providerName: "", appId: "", appVersion: "", connectionId: "",
  outboundPhoneNumber: "", usageCategory: "" as Category | "", description: ""
};

export default function VoiceAgentsPage() {
  const { user } = useCurrentUser();
  const [agents, setAgents] = useState<VoiceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registration, setRegistration] = useState(emptyRegistration);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error" | "info">("info");

  useEffect(function () {
    if (!user || !["SUPER_ADMIN", "ADMIN"].includes(user.role.code)) return;
    let cancelled = false;
    apiFetch("/api/voice-agents").then(function (result) {
      if (!cancelled) setAgents(result);
    }).catch(function (error) {
      if (!cancelled) {
        setTone("error");
        setMessage(error instanceof Error ? error.message : "Unable to load voice agents");
      }
    }).finally(function () {
      if (!cancelled) setLoading(false);
    });
    return function () { cancelled = true; };
  }, [user]);

  const metrics = useMemo(function () {
    return {
      synchronized: agents.length,
      categorized: agents.filter(function (agent) { return Boolean(agent.usage_category); }).length,
      selectable: agents.filter(function (agent) { return agent.is_selectable; }).length,
      attention: agents.filter(function (agent) { return !agent.is_selectable; }).length
    };
  }, [agents]);

  async function synchronize() {
    setSyncing(true); setMessage(null);
    try {
      const result = await apiFetch("/api/voice-agents/sync", { method: "POST", body: "{}" });
      setAgents(result.agents || []);
      setTone(result.synchronized ? "success" : "info");
      setMessage(result.synchronized
        ? `${result.synchronized} Sarvam deployments synchronized successfully.`
        : "Sarvam returned no Deployment records. Register outbound Agent App configurations below.");
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to synchronize Sarvam voice agents");
    } finally {
      setSyncing(false);
    }
  }

  async function registerAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistering(true); setMessage(null);
    try {
      const created = await apiFetch("/api/voice-agents/register", {
        method: "POST",
        body: JSON.stringify({ ...registration, appVersion: Number(registration.appVersion) })
      });
      setAgents(function (current) {
        const next = current.filter(function (agent) { return agent.id !== created.id; });
        return [{ ...created, is_selectable: true }, ...next];
      });
      setRegistration(emptyRegistration);
      setTone("success");
      setMessage(`${created.provider_name} registered and ready for iteration assignment. You can register the next Sarvam Agent App below.`);
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to register Sarvam Agent App");
    } finally {
      setRegistering(false);
    }
  }

  async function updateAgent(agent: VoiceAgent, changes: { usageCategory?: Category | ""; isEnabled?: boolean }) {
    setSavingId(agent.id); setMessage(null);
    try {
      const updated = await apiFetch(`/api/voice-agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
      setAgents(function (current) {
        return current.map(function (item) {
          if (item.id !== agent.id) return item;
          const next = { ...item, ...updated };
          next.is_selectable = next.provider_status.toLowerCase() === "active"
            && ["outbound", "both"].includes(next.channel_direction.toLowerCase())
            && Boolean(next.usage_category && next.connection_id && next.outbound_phone_number && next.is_enabled);
          return next;
        });
      });
      setTone("success");
      setMessage(`${agent.provider_name || agent.app_id} classification saved.`);
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update voice agent");
    } finally {
      setSavingId(null);
    }
  }

  if (user && !["SUPER_ADMIN", "ADMIN"].includes(user.role.code)) {
    return <AppShell><div className={styles.page}><FeedbackMessage tone="error" message="Only Admin and Super Admin users can manage voice agents." /></div></AppShell>;
  }

  return <AppShell><div className={styles.page}>
    <header className={styles.header}>
      <div><span>AI CONVERSATION OPERATIONS</span><h1>Voice Agents</h1><p>Maintain every approved Sarvam Agent App, committed version and outbound connection that Campaign Managers may select for an iteration.</p></div>
      <div className={styles.headerActions}><button type="button" className={styles.secondaryAction} onClick={function () { setShowRegistration(function (value) { return !value; }); }}><Plus size={17} />Register Agent App</button><button type="button" onClick={synchronize} disabled={syncing}><CloudDownload size={17} />{syncing ? "Synchronizing…" : "Sync Deployments"}</button></div>
    </header>

    {message && <FeedbackMessage message={message} tone={tone} />}

    {showRegistration && <section className={styles.registrationPanel}>
      <div className={styles.registrationHeader}><div><span>OUTBOUND AGENT APP</span><h2>Register callable Sarvam configuration</h2><p>Copy these values from the committed Sarvam agent and its outbound telephony connection.</p></div><button type="button" aria-label="Close registration" onClick={function () { setShowRegistration(false); }}><X size={18} /></button></div>
      <form onSubmit={registerAgent} className={styles.registrationForm}>
        <Field label="Agent display name *"><input value={registration.providerName} onChange={function (event) { setRegistration({ ...registration, providerName: event.target.value }); }} placeholder="Telangana Urban Male Agent" required /></Field>
        <Field label="Audience category *"><select value={registration.usageCategory} onChange={function (event) { setRegistration({ ...registration, usageCategory: event.target.value as Category | "" }); }} required><option value="">Select category</option>{categories.map(function (category) { return <option key={category.value} value={category.value}>{category.label}</option>; })}</select></Field>
        <Field label="Sarvam Agent App ID *"><input value={registration.appId} onChange={function (event) { setRegistration({ ...registration, appId: event.target.value }); }} placeholder="Conversatio-…" required /></Field>
        <Field label="Committed version *"><input type="number" min="1" step="1" value={registration.appVersion} onChange={function (event) { setRegistration({ ...registration, appVersion: event.target.value }); }} placeholder="9" required /></Field>
        <Field label="Connection ID *"><input value={registration.connectionId} onChange={function (event) { setRegistration({ ...registration, connectionId: event.target.value }); }} placeholder="Exotel-Sarv-…" required /></Field>
        <Field label="Outbound phone number *"><input value={registration.outboundPhoneNumber} onChange={function (event) { setRegistration({ ...registration, outboundPhoneNumber: event.target.value }); }} placeholder="+9180…" required /></Field>
        <Field label="Operational note"><input value={registration.description} onChange={function (event) { setRegistration({ ...registration, description: event.target.value }); }} placeholder="Telugu urban research voice" /></Field>
        <div className={styles.registrationFooter}><span>Register each Sarvam Agent App once. Saving makes it selectable for new iterations.</span><button type="submit" disabled={registering}>{registering ? "Registering…" : "Register Agent"}</button></div>
      </form>
    </section>}

    <section className={styles.metrics}>
      <Metric icon={<CloudDownload size={20} />} label="Synchronized" value={metrics.synchronized} />
      <Metric icon={<Tags size={20} />} label="Categorized" value={metrics.categorized} />
      <Metric icon={<CheckCircle2 size={20} />} label="Iteration ready" value={metrics.selectable} />
      <Metric icon={<ShieldCheck size={20} />} label="Needs attention" value={metrics.attention} />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span>APPROVED SARVAM CATALOG</span><h2>Available voice agents</h2><p>Only active outbound agents with a category and complete telephony configuration appear during iteration creation.</p></div><strong>{agents.length} agents</strong></div>
      {loading ? <div className={styles.empty}>Loading voice-agent catalog…</div> : !agents.length ? <div className={styles.empty}><Bot size={28} /><strong>No callable Sarvam agents registered</strong><span>Register the Agent App ID, committed version and outbound connection used for calling.</span><button type="button" onClick={function () { setShowRegistration(true); }}>Register first agent</button></div> : <div className={styles.list}>
        {agents.map(function (agent) {
          return <article key={agent.id} className={agent.is_selectable ? styles.readyCard : styles.agentCard}>
            <div className={styles.agentIcon}><Bot size={20} /></div>
            <div className={styles.identity}><span>{agent.provider_name || "Unnamed Sarvam agent"}</span><strong>{agent.app_id}</strong><small>Version {agent.app_version} · {agent.catalog_source === "MANUAL_AGENT_APP" ? "Agent App" : "Deployment API"}</small>{agent.description && <p>{agent.description}</p>}</div>
            <div className={styles.telephony}><span><PhoneCall size={14} />{agent.channel_direction}</span><small>{agent.outbound_phone_number || "No outbound number"}</small><small>{agent.connection_id || "No connection id"}</small></div>
            <label className={styles.category}><span>Audience category</span><select value={agent.usage_category || ""} disabled={savingId === agent.id} onChange={function (event) { updateAgent(agent, { usageCategory: event.target.value as Category | "" }); }}><option value="">Select category</option>{categories.map(function (category) { return <option key={category.value} value={category.value}>{category.label}</option>; })}</select></label>
            <label className={styles.toggle}><input type="checkbox" checked={agent.is_enabled} disabled={savingId === agent.id} onChange={function (event) { updateAgent(agent, { isEnabled: event.target.checked }); }} /><span>Enabled</span></label>
            <em className={agent.is_selectable ? styles.ready : styles.attention}>{agent.is_selectable ? "Iteration ready" : "Not selectable"}</em>
          </article>;
        })}
      </div>}
    </section>

    <div className={styles.contract}><ShieldCheck size={20} /><div><strong>Research consistency contract</strong><span>The selected App ID, version, connection and phone number are frozen into each iteration. Its runs cannot silently switch when Sarvam is edited later.</span></div></div>
  </div></AppShell>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className={styles.metric}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}
