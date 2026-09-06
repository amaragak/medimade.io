import { redirect } from "next/navigation";

export default async function IdeateGoalRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") q.set(key, value);
    else if (Array.isArray(value)) {
      for (const v of value) q.append(key, v);
    }
  }
  const qs = q.toString();
  redirect(
    qs
      ? `/dream/goal/${encodeURIComponent(id)}?${qs}`
      : `/dream/goal/${encodeURIComponent(id)}`,
  );
}
