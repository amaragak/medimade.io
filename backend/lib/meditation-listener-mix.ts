import { meditationUserPk } from "./meditation-user-pk";

const GUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeGuestListenerId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return GUEST_ID_RE.test(id) ? id : null;
}

/** Partition for a listener's mix overrides (signed-in user or anonymous guest). */
export function mixListenerPk(opts: {
  userSub?: string | null;
  guestListenerId?: unknown;
}): string | null {
  const sub = opts.userSub?.trim();
  if (sub) return meditationUserPk(sub);
  const guest = normalizeGuestListenerId(opts.guestListenerId);
  if (guest) return `GUEST#${guest}`;
  return null;
}

export function mixOverrideSk(s3Key: string): string {
  return `MIX#${s3Key.trim()}`;
}
