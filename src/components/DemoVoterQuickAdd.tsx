"use client";

import { useState } from "react";
import { Plus, UserPlus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import styles from "./demo-voter-quick-add.module.css";

type Geography = { id: string; name: string; geo_type: string; voter_count?: number };

const emptyForm = {
  fullName: "",
  phoneNumber: "",
  geoUnitId: "",
  preferredLanguage: "Telugu",
  age: "",
  gender: "",
  consentConfirmed: false
};

export default function DemoVoterQuickAdd({ onAdded }: {
  onAdded: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geographies, setGeographies] = useState<Geography[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function openForm() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch("/api/voters/demo-voter-geographies");
      const options = Array.isArray(response.geographies) ? response.geographies : [];
      if (!options.length) {
        setError("No active geography is currently mapped in the Voter Master.");
        return;
      }
      setGeographies(options);
      setForm({ ...emptyForm, geoUnitId: options[0].id });
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load voter geographies");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!form.consentConfirmed) {
      setError("Confirm that this person consented to an AI test call and recording/transcription.");
      return;
    }
    if (!window.confirm(`Add ${form.fullName || "this voter"} to Voter Master as an approved demo voter? No Campaign, Iteration, Run or call will be changed.`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch("/api/voters/demo-voters", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setOpen(false);
      setForm(emptyForm);
      await onAdded();
      setNotice(`${result.fullName} was added to Voter Master as an approved demo voter. The voter is now available for future governed cohort selection.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add demo voter");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.root}>
      <div className={styles.intro}>
        <div className={styles.introIcon}><UserPlus size={19} /></div>
        <div className={styles.introCopy}>
          <span>CONTROLLED DEMO DATA</span>
          <strong>Add Demo Voter</strong>
          <p>Create one consented, approved demo contact in Voter Master. This does not alter an existing Campaign, Iteration or Run.</p>
        </div>
        <button type="button" className={styles.openButton} onClick={openForm} disabled={loading || saving || open}>
          <Plus size={15} /> {loading ? "Loading..." : open ? "Form open" : "Add Demo Voter"}
        </button>
      </div>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <div>
              <strong>Add one consented demo voter to Voter Master</strong>
              <p>Admin/Super Admin only. The contact is approved for controlled testing but is not assigned to any research workflow.</p>
            </div>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} disabled={saving} aria-label="Close demo voter entry"><X size={17} /></button>
          </div>
          <div className={styles.grid}>
            <label>Full name *
              <input value={form.fullName} maxLength={120} autoComplete="off" onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
            </label>
            <label>Mobile number *
              <input value={form.phoneNumber} inputMode="tel" autoComplete="off" placeholder="10-digit mobile" onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} />
            </label>
            <label>Voter geography *
              <select value={form.geoUnitId} onChange={(event) => setForm({ ...form, geoUnitId: event.target.value })}>
                {geographies.map((geo) => <option key={geo.id} value={geo.id}>{geo.name} · {geo.geo_type}</option>)}
              </select>
            </label>
            <label>Preferred language
              <select value={form.preferredLanguage} onChange={(event) => setForm({ ...form, preferredLanguage: event.target.value })}>
                <option value="Telugu">Telugu</option>
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
              </select>
            </label>
            <label>Age (optional)
              <input type="number" min={18} max={100} value={form.age} onChange={(event) => setForm({ ...form, age: event.target.value })} />
            </label>
            <label>Gender (optional)
              <select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}>
                <option value="">Not recorded</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select>
            </label>
          </div>
          <label className={styles.consent}>
            <input type="checkbox" checked={form.consentConfirmed} onChange={(event) => setForm({ ...form, consentConfirmed: event.target.checked })} />
            <span>I have confirmed this person consented to a controlled AI survey test call and to storing its recording/transcript in the platform.</span>
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className={styles.submit} onClick={submit} disabled={saving || !form.fullName.trim() || !form.phoneNumber.trim() || !form.geoUnitId || !form.consentConfirmed}>
              {saving ? "Adding..." : "Approve & Add to Voter Master"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
