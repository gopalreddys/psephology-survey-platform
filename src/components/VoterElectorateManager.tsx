"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Ban, LoaderCircle, Plus, ShieldCheck, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import styles from "./voter-electorate-manager.module.css";

type VoterSummary = { id: string; full_name: string; phone_number: string | null };
type Identifier = {
  id: string; identifier_type: string; identifier_value: string; issuing_authority: string | null;
  status: string; is_primary: boolean; source_name: string | null;
};
type Registration = {
  id: string; electorate_type: string; target_type: string; eligibility_status: string;
  jurisdiction_name: string | null; local_body_name: string | null; local_body_area_name: string | null;
  identifier_type: string | null; identifier_value: string | null; source_name: string | null;
};
type Profile = { voter: VoterSummary; identifiers: Identifier[]; registrations: Registration[] };
type Jurisdiction = { id: string; name: string; code: string | null; type_code: string };
type LocalBody = { id: string; name: string; code: string | null; body_type: string };
type LocalArea = { id: string; name: string; display_label: string | null; code: string | null };

const identifierLabels: Record<string, string> = {
  EPIC: "EPIC / Assembly roll", MLC_GRADUATE_ROLL: "Graduate MLC roll",
  MLC_TEACHER_ROLL: "Teacher MLC roll", MLC_LOCAL_AUTHORITY_ROLL: "Local Authorities MLC roll",
  LOCAL_BODY_ROLL: "Local-body roll", INTERNAL_DEMO: "Internal demo ID", OTHER: "Other verified ID"
};
const electorateLabels: Record<string, string> = {
  PARLIAMENTARY: "Parliamentary electorate", ASSEMBLY: "Assembly electorate",
  MLC_GRADUATES: "MLC Graduates electorate", MLC_TEACHERS: "MLC Teachers electorate",
  MLC_LOCAL_AUTHORITIES: "MLC Local Authorities electorate", LOCAL_BODY: "Local-body electorate",
  DEMO: "Controlled demo electorate"
};
const identifierFor: Record<string, string> = {
  PARLIAMENTARY: "EPIC", ASSEMBLY: "EPIC", MLC_GRADUATES: "MLC_GRADUATE_ROLL",
  MLC_TEACHERS: "MLC_TEACHER_ROLL", MLC_LOCAL_AUTHORITIES: "MLC_LOCAL_AUTHORITY_ROLL",
  LOCAL_BODY: "LOCAL_BODY_ROLL", DEMO: "INTERNAL_DEMO"
};

function itemsOf(value: unknown): never[] {
  if (Array.isArray(value)) return value as never[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)) {
    return (value as { items: never[] }).items;
  }
  return [];
}

export default function VoterElectorateManager({ voter, onClose }: {
  voter: VoterSummary; onClose: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [localBodies, setLocalBodies] = useState<LocalBody[]>([]);
  const [localAreas, setLocalAreas] = useState<LocalArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState({
    identifierType: "EPIC", identifierValue: "", issuingAuthority: "", sourceName: "", isPrimary: true
  });
  const [registration, setRegistration] = useState({
    electorateType: "ASSEMBLY", targetType: "MLA", jurisdictionId: "", localBodyId: "",
    localBodyAreaId: "", rollIdentifierId: "", sourceName: "", verified: false
  });

  async function loadProfile() {
    setLoading(true);
    try {
      const [profileData, jurisdictionData, localBodyData] = await Promise.all([
        apiFetch(`/api/voters/${voter.id}/electorate-profile`),
        apiFetch("/api/jurisdictions"),
        apiFetch("/api/local-bodies?limit=10000")
      ]);
      setProfile(profileData);
      setJurisdictions(itemsOf(jurisdictionData));
      setLocalBodies(itemsOf(localBodyData));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load electoral profile");
    } finally { setLoading(false); }
  }

  useEffect(function () { loadProfile(); }, [voter.id]);

  const requiredIdentifierType = identifierFor[registration.electorateType];
  const eligibleIdentifiers = useMemo(function () {
    return (profile?.identifiers || []).filter(function (item) {
      return item.identifier_type === requiredIdentifierType && ["ACTIVE", "UNVERIFIED"].includes(item.status);
    });
  }, [profile, requiredIdentifierType]);

  const visibleJurisdictions = useMemo(function () {
    const matcher = registration.electorateType === "PARLIAMENTARY" ? /PARLIAMENTARY/i
      : registration.electorateType === "ASSEMBLY" ? /ASSEMBLY/i : /MLC/i;
    return jurisdictions.filter(function (item) { return matcher.test(item.type_code); });
  }, [jurisdictions, registration.electorateType]);

  function chooseElectorate(electorateType: string) {
    const targetType = electorateType === "PARLIAMENTARY" ? "MP"
      : electorateType === "ASSEMBLY" ? "MLA"
        : electorateType === "LOCAL_BODY" ? "ZPTC"
          : electorateType === "DEMO" ? "DEMO" : "MLC";
    setRegistration({
      electorateType, targetType, jurisdictionId: "", localBodyId: "", localBodyAreaId: "",
      rollIdentifierId: "", sourceName: "", verified: false
    });
    setLocalAreas([]);
  }

  async function chooseLocalBody(localBodyId: string) {
    setRegistration(function (current) { return { ...current, localBodyId, localBodyAreaId: "" }; });
    if (!localBodyId) return setLocalAreas([]);
    try {
      const data = await apiFetch(`/api/local-bodies/${localBodyId}/electoral-areas?limit=5000`);
      setLocalAreas(itemsOf(data));
    } catch { setLocalAreas([]); }
  }

  async function addIdentifier() {
    setSaving(true); setMessage(null);
    try {
      await apiFetch(`/api/voters/${voter.id}/identifiers`, {
        method: "POST", body: JSON.stringify(identifier)
      });
      setIdentifier({ ...identifier, identifierValue: "", issuingAuthority: "", sourceName: "" });
      await loadProfile();
      setMessage("Identifier recorded. Verify it by creating the matching electorate registration.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add identifier"); }
    finally { setSaving(false); }
  }

  async function addRegistration() {
    setSaving(true); setMessage(null);
    try {
      await apiFetch(`/api/voters/${voter.id}/electorate-registrations`, {
        method: "POST", body: JSON.stringify(registration)
      });
      await loadProfile();
      setRegistration(function (current) { return { ...current, rollIdentifierId: "", verified: false }; });
      setMessage("Verified electorate registration recorded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add registration"); }
    finally { setSaving(false); }
  }

  async function changeStatus(kind: "identifiers" | "electorate-registrations", id: string, status: string) {
    if (!window.confirm(`Change this record to ${status}? Historical data will be retained.`)) return;
    setSaving(true); setMessage(null);
    try {
      await apiFetch(`/api/voters/${voter.id}/${kind}/${id}/status`, {
        method: "PATCH", body: JSON.stringify({ status })
      });
      await loadProfile();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update status"); }
    finally { setSaving(false); }
  }

  return <div className={styles.backdrop} role="presentation" onMouseDown={function (event) {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="electorate-title">
      <header><div><span>VOTER ELIGIBILITY</span><h2 id="electorate-title">{voter.full_name}</h2><p>{voter.phone_number || "No phone recorded"} · One canonical person, multiple election rolls</p></div><button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      {message && <div className={styles.message}>{message}</div>}
      {loading && !profile ? <div className={styles.loading}><LoaderCircle size={18} />Loading electoral profile…</div> : <>
        <div className={styles.columns}>
          <article className={styles.panel}><div className={styles.panelTitle}><div><span>STEP 1</span><h3>Electoral identifiers</h3></div><strong>{profile?.identifiers.length || 0}</strong></div>
            <div className={styles.records}>{profile?.identifiers.map(function (item) { return <div className={styles.record} key={item.id}><div><strong>{identifierLabels[item.identifier_type] || item.identifier_type}</strong><span>{item.identifier_value}{item.is_primary ? " · Primary" : ""}</span><small>{item.issuing_authority || item.source_name || "Source not recorded"}</small></div><div><em data-status={item.status}>{item.status}</em>{["ACTIVE", "UNVERIFIED"].includes(item.status) && <button type="button" disabled={saving} onClick={function () { changeStatus("identifiers", item.id, "REVOKED"); }}><Ban size={13} />Revoke</button>}</div></div>; })}</div>
            <div className={styles.form}><label>Identifier type<select value={identifier.identifierType} onChange={function (e) { setIdentifier({ ...identifier, identifierType: e.target.value }); }}>{Object.entries(identifierLabels).map(function ([value, label]) { return <option value={value} key={value}>{label}</option>; })}</select></label><label>Identifier / roll number<input value={identifier.identifierValue} onChange={function (e) { setIdentifier({ ...identifier, identifierValue: e.target.value }); }} /></label><label>Issuing authority<input value={identifier.issuingAuthority} onChange={function (e) { setIdentifier({ ...identifier, issuingAuthority: e.target.value }); }} placeholder="Election authority / roll issuer" /></label><label>Source reference<input value={identifier.sourceName} onChange={function (e) { setIdentifier({ ...identifier, sourceName: e.target.value }); }} placeholder="Roll name, file or verification source" /></label><label className={styles.check}><input type="checkbox" checked={identifier.isPrimary} onChange={function (e) { setIdentifier({ ...identifier, isPrimary: e.target.checked }); }} />Primary identifier of this type</label><button type="button" disabled={saving || !identifier.identifierValue.trim()} onClick={addIdentifier}><Plus size={14} />Record identifier</button></div>
          </article>
          <article className={styles.panel}><div className={styles.panelTitle}><div><span>STEP 2</span><h3>Verified electorate registrations</h3></div><strong>{profile?.registrations.length || 0}</strong></div>
            <div className={styles.records}>{profile?.registrations.map(function (item) { return <div className={styles.record} key={item.id}><div><strong>{electorateLabels[item.electorate_type] || item.electorate_type}</strong><span>{item.jurisdiction_name || item.local_body_area_name || item.local_body_name || item.target_type}</span><small>{item.identifier_type}: {item.identifier_value || "No roll ID"}</small></div><div><em data-status={item.eligibility_status}>{item.eligibility_status}</em>{["VERIFIED", "ELIGIBLE", "UNVERIFIED"].includes(item.eligibility_status) && <button type="button" disabled={saving} onClick={function () { changeStatus("electorate-registrations", item.id, "INACTIVE"); }}><Ban size={13} />Inactivate</button>}</div></div>; })}</div>
            <div className={styles.form}><label>Electorate type<select value={registration.electorateType} onChange={function (e) { chooseElectorate(e.target.value); }}>{Object.entries(electorateLabels).map(function ([value, label]) { return <option value={value} key={value}>{label}</option>; })}</select></label>
              {registration.electorateType === "LOCAL_BODY" && <label>Contested office<select value={registration.targetType} onChange={function (e) { setRegistration({ ...registration, targetType: e.target.value }); }}><option value="ZPTC">ZPTC</option><option value="MPTC">MPTC</option><option value="GRAM_PANCHAYAT">Gram Panchayat</option><option value="MUNICIPAL_CORPORATION">Municipal Corporation</option><option value="MUNICIPALITY">Municipality</option></select></label>}
              {!['LOCAL_BODY','DEMO'].includes(registration.electorateType) && <label>Constituency<select value={registration.jurisdictionId} onChange={function (e) { setRegistration({ ...registration, jurisdictionId: e.target.value }); }}><option value="">Select constituency</option>{visibleJurisdictions.map(function (item) { return <option value={item.id} key={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>; })}</select></label>}
              {registration.electorateType === "LOCAL_BODY" && <><label>Local body<select value={registration.localBodyId} onChange={function (e) { chooseLocalBody(e.target.value); }}><option value="">Select local body</option>{localBodies.map(function (item) { return <option value={item.id} key={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>; })}</select></label><label>Electoral area (optional)<select value={registration.localBodyAreaId} onChange={function (e) { setRegistration({ ...registration, localBodyAreaId: e.target.value }); }}><option value="">Whole local body / roll</option>{localAreas.map(function (item) { return <option value={item.id} key={item.id}>{item.display_label || item.name}</option>; })}</select></label></>}
              <label>Supporting {identifierLabels[requiredIdentifierType] || requiredIdentifierType}<select value={registration.rollIdentifierId} onChange={function (e) { setRegistration({ ...registration, rollIdentifierId: e.target.value }); }}><option value="">Select recorded identifier</option>{eligibleIdentifiers.map(function (item) { return <option value={item.id} key={item.id}>{item.identifier_value} · {item.status}</option>; })}</select></label><label>Verification source<input value={registration.sourceName} onChange={function (e) { setRegistration({ ...registration, sourceName: e.target.value }); }} placeholder="Official roll / authority / dated source" /></label><label className={styles.check}><input type="checkbox" checked={registration.verified} onChange={function (e) { setRegistration({ ...registration, verified: e.target.checked }); }} /><ShieldCheck size={15} />I verified this person’s membership in the selected roll</label><button type="button" disabled={saving || !registration.rollIdentifierId || !registration.verified} onClick={addRegistration}><BadgeCheck size={14} />Record verified registration</button></div>
          </article>
        </div>
      </>}
    </section>
  </div>;
}
