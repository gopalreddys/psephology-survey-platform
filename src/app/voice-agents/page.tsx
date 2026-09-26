"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, CloudDownload, History, Pencil, PhoneCall, Plus, ShieldCheck, X } from "lucide-react";
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
  is_current: boolean;
  is_selectable: boolean;
  identity_conflict?: boolean;
  identity_conflict_app_ids?: string[];
  iteration_usage_count: number;
  completed_iteration_count: number;
  active_iteration_count: number;
  last_synced_at: string;
};

type VoiceAgentGroup = {
  appId: string;
  current: VoiceAgent;
  history: VoiceAgent[];
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
  const [editingAgent, setEditingAgent] = useState<VoiceAgent | null>(null);
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

  const agentGroups = useMemo<VoiceAgentGroup[]>(function () {
    const grouped = new Map<string, VoiceAgent[]>();
    agents.forEach(function (agent) {
      grouped.set(agent.app_id, [...(grouped.get(agent.app_id) || []), agent]);
    });
    return Array.from(grouped.entries()).map(function ([appId, versions]) {
      const ordered = [...versions].sort(function (left, right) {
        if (left.is_current !== right.is_current) return left.is_current ? -1 : 1;
        if (left.is_enabled !== right.is_enabled) return left.is_enabled ? -1 : 1;
        return Number(right.app_version) - Number(left.app_version);
      });
      return { appId, current: ordered[0], history: ordered.slice(1) };
    }).sort(function (left, right) {
      return (left.current.provider_name || left.appId).localeCompare(right.current.provider_name || right.appId);
    });
  }, [agents]);

  const metrics = useMemo(function () {
    return {
      agentApps: agentGroups.length,
      history: Math.max(0, agents.length - agentGroups.length),
      selectable: agentGroups.filter(function (group) { return group.current.is_selectable; }).length,
      attention: agentGroups.filter(function (group) { return !group.current.is_selectable; }).length
    };
  }, [agents, agentGroups]);

  function startRegistration() {
    setEditingAgent(null);
    setRegistration(emptyRegistration);
    setShowRegistration(true);
    setMessage(null);
  }

  function startEditing(agent: VoiceAgent) {
    setEditingAgent(agent);
    setRegistration({
      providerName: agent.provider_name || "",
      appId: agent.app_id,
      appVersion: String(agent.app_version),
      connectionId: agent.connection_id || "",
      outboundPhoneNumber: agent.outbound_phone_number || "",
      usageCategory: agent.usage_category || "",
      description: agent.description || ""
    });
    setShowRegistration(true);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeEditor() {
    setShowRegistration(false);
    setEditingAgent(null);
    setRegistration(emptyRegistration);
  }

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

  async function saveAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistering(true); setMessage(null);
    try {
      const result = await apiFetch(editingAgent
        ? `/api/voice-agents/${editingAgent.id}/config`
        : "/api/voice-agents/register", {
        method: editingAgent ? "PATCH" : "POST",
        body: JSON.stringify({ ...registration, appVersion: Number(registration.appVersion) })
      });
      const saved = editingAgent ? result.agent : result;
      const successMessage = editingAgent
        ? result.createdVersion
          ? `${saved.provider_name} version ${saved.app_version} is now current. Earlier versions moved to read-only history; existing iterations remain on their saved version.`
          : `${saved.provider_name} details updated. Existing iteration snapshots remain unchanged.`
        : `${saved.provider_name} registered and ready for iteration assignment.`;
      setTone("success");
      setMessage(successMessage);
      closeEditor();
      try {
        setAgents(await apiFetch("/api/voice-agents"));
      } catch {
        setTone("info");
        setMessage(`${successMessage} Refresh the page to update the catalog list.`);
      }
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to save Sarvam Agent App");
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
      setAgents(await apiFetch("/api/voice-agents"));
      setTone("success");
      setMessage(inputMessageForUpdate(agent, changes, updated));
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
      <div><span>AI CONVERSATION OPERATIONS</span><h1>Voice Agents</h1><p>Maintain one current configuration for each Sarvam Agent App while preserving used versions as read-only operational history.</p></div>
      <div className={styles.headerActions}><button type="button" className={styles.secondaryAction} onClick={startRegistration}><Plus size={17} />Register Agent App</button><button type="button" onClick={synchronize} disabled={syncing}><CloudDownload size={17} />{syncing ? "Synchronizing…" : "Sync Deployments"}</button></div>
    </header>

    {message && <FeedbackMessage message={message} tone={tone} />}

    {showRegistration && <section className={styles.registrationPanel}>
      <div className={styles.registrationHeader}><div><span>OUTBOUND AGENT APP</span><h2>{editingAgent ? `Edit ${editingAgent.provider_name || editingAgent.app_id}` : "Register callable Sarvam configuration"}</h2><p>{editingAgent ? "After a committed version or telephony change, the new configuration becomes current. Prior versions remain available only in history for audit." : "Copy these values from the committed Sarvam agent and its outbound telephony connection."}</p></div><button type="button" aria-label="Close agent form" onClick={closeEditor}><X size={18} /></button></div>
      <form onSubmit={saveAgent} className={styles.registrationForm}>
        <Field label="Agent display name *"><input value={registration.providerName} onChange={function (event) { setRegistration({ ...registration, providerName: event.target.value }); }} placeholder="Telangana Urban Male Agent" required /></Field>
        <Field label="Audience category *"><select value={registration.usageCategory} disabled={Boolean(editingAgent)} onChange={function (event) { setRegistration({ ...registration, usageCategory: event.target.value as Category | "" }); }} required><option value="">Select category</option>{categories.map(function (category) { return <option key={category.value} value={category.value}>{category.label}</option>; })}</select></Field>
        <Field label="Sarvam Agent App ID *"><input value={registration.appId} onChange={function (event) { setRegistration({ ...registration, appId: event.target.value }); }} placeholder="Conversatio-…" readOnly={Boolean(editingAgent)} required /></Field>
        <Field label="Committed version *"><input type="number" min="1" step="1" value={registration.appVersion} onChange={function (event) { setRegistration({ ...registration, appVersion: event.target.value }); }} placeholder="9" required /></Field>
        <Field label="Connection ID *"><input value={registration.connectionId} readOnly={Boolean(editingAgent)} onChange={function (event) { setRegistration({ ...registration, connectionId: event.target.value }); }} placeholder="Exotel-Sarv-…" required /></Field>
        <Field label="Outbound phone number *"><input value={registration.outboundPhoneNumber} readOnly={Boolean(editingAgent)} onChange={function (event) { setRegistration({ ...registration, outboundPhoneNumber: event.target.value }); }} placeholder="+9180…" required /></Field>
        <Field label="Operational note"><input value={registration.description} onChange={function (event) { setRegistration({ ...registration, description: event.target.value }); }} placeholder="Telugu urban research voice" /></Field>
        <div className={styles.registrationFooter}><span>{editingAgent ? "App ID, connection, phone and category are locked. Increase only the committed version; existing iterations retain their frozen identity until explicitly upgraded." : "Register each Sarvam Agent App once. Saving makes it selectable for new iterations."}</span><div className={styles.formActions}><button type="button" className={styles.cancelButton} onClick={closeEditor}>Cancel</button><button type="submit" disabled={registering}>{registering ? "Saving…" : editingAgent ? "Save as Current" : "Register Agent"}</button></div></div>
      </form>
    </section>}

    <section className={styles.metrics}>
      <Metric icon={<Bot size={20} />} label="Agent Apps" value={metrics.agentApps} />
      <Metric icon={<History size={20} />} label="Historical versions" value={metrics.history} />
      <Metric icon={<CheckCircle2 size={20} />} label="Current and ready" value={metrics.selectable} />
      <Metric icon={<ShieldCheck size={20} />} label="Needs attention" value={metrics.attention} />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span>APPROVED SARVAM CATALOG</span><h2>Current voice agents</h2><p>Each App ID appears once. Earlier versions are retained below the current configuration only when operational history requires them.</p></div><strong>{agentGroups.length} apps · {agents.length} versions</strong></div>
      {loading ? <div className={styles.empty}>Loading voice-agent catalog…</div> : !agentGroups.length ? <div className={styles.empty}><Bot size={28} /><strong>No callable Sarvam agents registered</strong><span>Register the Agent App ID, committed version and outbound connection used for calling.</span><button type="button" onClick={startRegistration}>Register first agent</button></div> : <div className={styles.list}>
        {agentGroups.map(function (group) {
          const agent = group.current;
          return <article key={group.appId} className={styles.agentGroup}>
            <div className={agent.is_selectable ? styles.readyCard : styles.agentCard}>
              <div className={styles.agentIcon}><Bot size={20} /></div>
              <div className={styles.identity}><span>{agent.provider_name || "Unnamed Sarvam agent"}</span><strong>{agent.app_id}</strong><small>Current version {agent.app_version} · {agent.catalog_source === "MANUAL_AGENT_APP" ? "Agent App" : "Deployment API"}</small>{agent.description && <p>{agent.description}</p>}{agent.identity_conflict && <p className={styles.identityWarning}>Identity conflict: similar Agent App{agent.identity_conflict_app_ids?.length === 1 ? "" : "s"} share this telephony configuration. Disable the incorrect App ID before selection.</p>}</div>
              <div className={styles.telephony}><span><PhoneCall size={14} />{agent.channel_direction}</span><small>{agent.outbound_phone_number || "No outbound number"}</small><small>{agent.connection_id || "No connection id"}</small></div>
              <label className={styles.category}><span>Audience category</span><select value={agent.usage_category || ""} disabled={savingId === agent.id} onChange={function (event) { updateAgent(agent, { usageCategory: event.target.value as Category | "" }); }}><option value="">Select category</option>{categories.map(function (category) { return <option key={category.value} value={category.value}>{category.label}</option>; })}</select></label>
              <label className={styles.toggle}><input type="checkbox" checked={agent.is_enabled} disabled={savingId === agent.id} onChange={function (event) { updateAgent(agent, { isEnabled: event.target.checked }); }} /><span>Enabled</span></label>
              <em className={agent.is_selectable ? styles.ready : styles.attention}>{agent.is_selectable ? "Current · ready" : agent.identity_conflict ? "Identity conflict" : "Not selectable"}</em>
              {agent.catalog_source === "MANUAL_AGENT_APP" && <button type="button" className={styles.editButton} onClick={function () { startEditing(agent); }}><Pencil size={15} />Edit current</button>}
            </div>
            {group.history.length > 0 && <details className={styles.versionHistory}>
              <summary><History size={15} />Version history ({group.history.length})</summary>
              <div className={styles.historyList}>{group.history.map(function (version) {
                const usageLabel = version.active_iteration_count > 0
                  ? `${version.active_iteration_count} active iteration${version.active_iteration_count === 1 ? "" : "s"}`
                  : version.iteration_usage_count > 0
                    ? `${version.iteration_usage_count} completed/historical iteration${version.iteration_usage_count === 1 ? "" : "s"}`
                    : "Never used";
                return <div key={version.id} className={styles.historyRow}>
                  <strong>Version {version.app_version}</strong>
                  <span>{version.outbound_phone_number || "No outbound number"}</span>
                  <span>{version.connection_id || "No connection id"}</span>
                  <em className={version.active_iteration_count > 0 ? styles.inUse : styles.historical}>{version.active_iteration_count > 0 ? "In use" : "Historical"}</em>
                  <small>{usageLabel}</small>
                </div>;
              })}</div>
            </details>}
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

function inputMessageForUpdate(agent: VoiceAgent, changes: { usageCategory?: Category | ""; isEnabled?: boolean }, updated: VoiceAgent) {
  if (changes.isEnabled === true) {
    return `${agent.provider_name || agent.app_id} version ${updated.app_version} is current. Other versions are retained only in history.`;
  }
  if (changes.isEnabled === false) {
    return `${agent.provider_name || agent.app_id} is disabled for future iteration selection. Existing iterations are unchanged.`;
  }
  return `${agent.provider_name || agent.app_id} classification saved.`;
}
