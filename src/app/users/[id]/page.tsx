"use client";

import {
  ArrowLeft,
  LockKeyhole,
  Save,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";
import styles from "./user-profile.module.css";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  status: string;
  designation: string | null;
  organization_name: string | null;
  created_at: string;
  last_login_at: string | null;
  role_code: string;
  role_name: string;
  photo_content_type: string | null;
  photo_uploaded_at: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  village_name: string | null;
  mandal_name: string | null;
  district_name: string | null;
  state_name: string | null;
  postal_code: string | null;
  govt_id_type: string | null;
  govt_id_last4: string | null;
  govt_id_uploaded_at: string | null;
  govt_id_verified: boolean;
  govt_id_verified_at: string | null;
  geographies: Array<{
    id: string;
    name: string;
    geo_type: string;
    code: string | null;
    access_level: string;
  }>;
};

type EditableProfile = Pick<Profile,
  "address_line_1" | "address_line_2" | "village_name" | "mandal_name" |
  "district_name" | "state_name" | "postal_code"
>;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function display(value: string | null) {
  return value || "Not provided";
}

export default function UserProfilePage() {
  const params = useParams();
  const userId = String(params.id);
  const { user: currentUser } = useCurrentUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<EditableProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isAdmin = currentUser?.role.code === "SUPER_ADMIN" || currentUser?.role.code === "ADMIN";
  const canEdit = isAdmin || currentUser?.id === userId;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch(`/api/users/${userId}/profile`) as Profile;
        if (!cancelled) {
          setProfile(data);
          setForm({
            address_line_1: data.address_line_1,
            address_line_2: data.address_line_2,
            village_name: data.village_name,
            mandal_name: data.mandal_name,
            district_name: data.district_name,
            state_name: data.state_name,
            postal_code: data.postal_code
          });
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Unable to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  const profileInitials = useMemo(() => initials(profile?.full_name || "User"), [profile?.full_name]);

  async function saveProfile() {
    if (!form || !canEdit) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await apiFetch(`/api/users/${userId}/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          addressLine1: form.address_line_1,
          addressLine2: form.address_line_2,
          villageName: form.village_name,
          mandalName: form.mandal_name,
          districtName: form.district_name,
          stateName: form.state_name,
          postalCode: form.postal_code
        })
      }) as Profile;
      setProfile(data);
      setMessage("Profile details saved successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save profile");
    } finally {
      setSaving(false);
    }
  }

  function updateField(key: keyof EditableProfile, value: string) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  return (
    <AppShell>
      <main className={styles.page}>
        <Link href="/users" className={styles.back}><ArrowLeft size={15} /> Users & Roles</Link>
        {message && <div className={styles.message}>{message}</div>}
        {loading ? <div className={styles.panel}><p className={styles.muted}>Loading secure profile…</p></div> : profile ? (
          <>
            <section className={styles.hero}>
              <div className={styles.avatar}>{profileInitials}</div>
              <div>
                <div className={styles.eyebrow}>USER PROFILE</div>
                <h1>{profile.full_name}</h1>
                <p>{profile.role_name || profile.role_code} · {profile.email}</p>
              </div>
              <span className={styles.status}>{profile.status}</span>
            </section>

            <div className={styles.grid}>
              <section className={styles.panel}>
                <div className={styles.sectionLabel}>IDENTITY & ACCESS</div>
                <h2>Platform details</h2>
                <div className={styles.fields}>
                  <div className={styles.readOnly}><span>Email</span><strong>{profile.email}</strong></div>
                  <div className={styles.readOnly}><span>Phone</span><strong>{display(profile.phone_number)}</strong></div>
                  <div className={styles.readOnly}><span>Designation</span><strong>{display(profile.designation)}</strong></div>
                  <div className={styles.readOnly}><span>Organization</span><strong>{display(profile.organization_name)}</strong></div>
                  <div className={styles.readOnly}><span>Created</span><strong>{formatDate(profile.created_at)}</strong></div>
                  <div className={styles.readOnly}><span>Last login</span><strong>{formatDate(profile.last_login_at)}</strong></div>
                </div>
              </section>

              <section className={`${styles.panel} ${styles.panelWide}`}>
                <div className={styles.sectionLabel}>GEOGRAPHY ACCESS</div>
                <h2>Assigned administrative areas</h2>
                {profile.geographies.length ? (
                  <div className={styles.fields}>
                    {profile.geographies.map((geography) => (
                      <div className={styles.readOnly} key={geography.id}>
                        <span>{geography.geo_type} · {geography.access_level}</span>
                        <strong>{geography.name}{geography.code ? ` · ${geography.code}` : ""}</strong>
                      </div>
                    ))}
                  </div>
                ) : <p className={styles.muted}>No direct geography assignments recorded.</p>}
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionLabel}>PROFILE PHOTO</div>
                <h2>Photo record</h2>
                <div className={styles.readOnly}>
                  <span>Status</span>
                  <strong>{profile.photo_uploaded_at ? `Uploaded ${formatDate(profile.photo_uploaded_at)}` : "Not uploaded"}</strong>
                </div>
                <p className={styles.muted}>Photos will be stored in private object storage and served through expiring links.</p>
              </section>

              <section className={`${styles.panel} ${styles.panelWide}`}>
                <div className={styles.sectionLabel}>CONTACT & ADDRESS</div>
                <h2>Personal details</h2>
                {form && canEdit ? (
                  <div className={styles.fields}>
                    <Field label="Address line 1" value={form.address_line_1} onChange={(value) => updateField("address_line_1", value)} wide />
                    <Field label="Address line 2" value={form.address_line_2} onChange={(value) => updateField("address_line_2", value)} wide />
                    <Field label="Village" value={form.village_name} onChange={(value) => updateField("village_name", value)} />
                    <Field label="Mandal" value={form.mandal_name} onChange={(value) => updateField("mandal_name", value)} />
                    <Field label="District" value={form.district_name} onChange={(value) => updateField("district_name", value)} />
                    <Field label="State" value={form.state_name} onChange={(value) => updateField("state_name", value)} />
                    <Field label="PIN code" value={form.postal_code} onChange={(value) => updateField("postal_code", value)} />
                  </div>
                ) : <p className={styles.muted}>This profile is visible only to authorized administrators and the profile owner.</p>}
                {canEdit && <div className={styles.actions}><button className={styles.button} type="button" onClick={saveProfile} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save details"}</button></div>}
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionLabel}>GOVERNMENT IDENTITY</div>
                <h2>Verification record</h2>
                <div className={styles.readOnly}><span>Document type</span><strong>{display(profile.govt_id_type)}</strong></div>
                <div className={styles.readOnly}><span>Reference</span><strong>{profile.govt_id_last4 ? `•••• ${profile.govt_id_last4}` : "Not provided"}</strong></div>
                <div className={styles.readOnly}><span>Verification</span><strong>{profile.govt_id_verified ? `Verified ${formatDate(profile.govt_id_verified_at)}` : "Not verified"}</strong></div>
                <div className={styles.privacy}><LockKeyhole size={14} /> Raw government ID numbers are never stored in the database. Proof files remain private.</div>
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionLabel}>SECURITY</div>
                <h2>Access protection</h2>
                <p className={styles.muted}><ShieldCheck size={15} /> Profile access is role-restricted and audited. Campaign Managers and Campaigners cannot view other users’ private details.</p>
              </section>
            </div>
          </>
        ) : <section className={styles.panel}><p className={styles.muted}>Profile unavailable.</p></section>}
      </main>
    </AppShell>
  );
}

function Field({ label, value, onChange, wide = false }: { label: string; value: string | null; onChange: (value: string) => void; wide?: boolean }) {
  return <div className={`${styles.field} ${wide ? styles.fieldWide : ""}`}><label>{label}</label><input value={value || ""} onChange={(event) => onChange(event.target.value)} /></div>;
}
