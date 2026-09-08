import { redirect } from "next/navigation";

/** Legacy URL — workspace lives under /ideate/goal. */
export default async function DreamGoalRedirectPage({
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
      ? `/ideate/goal/${encodeURIComponent(id)}?${qs}`
      : `/ideate/goal/${encodeURIComponent(id)}`,
  );
}
