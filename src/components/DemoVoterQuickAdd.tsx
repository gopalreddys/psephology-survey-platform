"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import styles from "./demo-voter-quick-add.module.css";

type Geography = { id: string; name: string; geo_type: string };

const emptyForm = {
  fullName: "",
  phoneNumber: "",
  geoUnitId: "",
  preferredLanguage: "Telugu",
  age: "",
  gender: "",
  consentConfirmed: false
};

export default function DemoVoterQuickAdd({ runId, onAdded }: {
  runId: string;
  onAdded: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geographies, setGeographies] = useState<Geography[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  async function openForm() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/runs/${runId}/demo-voter-geographies`);
      const options = Array.isArray(response.geographies) ? response.geographies : [];
      if (!options.length) {
        setError("No mapped geography is available in this Run. No voter was added.");
        return;
      }
      setGeographies(options);
      setForm({ ...emptyForm, geoUnitId: options[0].id });
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Run geographies");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!form.consentConfirmed) {
      setError("Confirm that this person consented to an AI test call and recording/transcription.");
      return;
    }
    if (!window.confirm(`Add ${form.fullName || "this voter"} to Run 1? The contact will be explicitly approved as a demo voter. No call will be launched now.`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch(`/api/runs/${runId}/demo-voters`, {
        method: "POST",
        body: JSON.stringify(form)
      });
      setOpen(false);
      setForm(emptyForm);
      await onAdded();
      window.alert(`${result.fullName} added to Run 1. The Run now has ${result.selectedContacts} approved contacts. Ask the Campaigner to refresh and review the entire recipient list before launching.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add demo voter");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.root}>
      <button type="button" className={styles.openButton} onClick={openForm} disabled={loading || saving}>
        <Plus size={15} /> {loading ? "Checking Run..." : "Add demo voter"}
      </button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <div>
              <strong>Add one consented demo voter to Run 1</strong>
              <p>Admin-only, before the first Run call. This changes the approved recipient count; it does not dial anyone.</p>
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
            <label>Run geography *
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
              {saving ? "Adding..." : "Approve & add to Run 1"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
