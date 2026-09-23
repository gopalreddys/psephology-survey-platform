import { redirect } from "next/navigation";

export default async function LegacyCampaignAnalysisPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/analytics/campaigns/${id}`);
}
