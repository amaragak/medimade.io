import { redirect } from "next/navigation";

export default async function PlanGoalRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dream/goal/${encodeURIComponent(id)}`);
}
