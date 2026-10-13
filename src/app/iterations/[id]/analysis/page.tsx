"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import FeedbackMessage from "@/components/FeedbackMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { apiFetch } from "@/lib/api";

/** Retained bookmarks resolve through the authorized Iteration boundary, not a second analysis workflow. */
export default function LegacyIterationAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useCurrentUser();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    void apiFetch(`/api/iterations/${encodeURIComponent(id)}/navigation`).then((navigation: { iterationId: string; campaignId?: string | null }) => {
      if (cancelled) return;
      if (navigation.iterationId !== id) throw new Error("Authorized navigation response does not match this Iteration.");
      if (user.role.code === "CAMPAIGNER" || !navigation.campaignId) {
        router.replace(`/iterations/${encodeURIComponent(id)}`);
      } else {
        router.replace(`/analytics/campaigns/${encodeURIComponent(navigation.campaignId)}?iterationId=${encodeURIComponent(id)}`);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to verify this Iteration's authorized analysis scope.");
    });
    return () => { cancelled = true; };
  }, [id, router, user]);

  return <AppShell><main className="p-8">
    {error ? <><FeedbackMessage tone="error" message={error} /><Link href="/campaigns">Back to Campaigns</Link></> : <p role="status">Opening your authorized Iteration workspace…</p>}
  </main></AppShell>;
}
