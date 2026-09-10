/**
 * Soft-link journal entries and library meditations to a life area.
 * No demo/stub rows — only real local/cloud content that matches.
 */

import { isMedimadeSessionActive } from "@/lib/auth-session";
import {
  listLibraryMeditations,
  type LibraryMeditationItem,
} from "@/lib/medimade-api";
import type { PlanDream } from "@/lib/plan-dreams";
import {
  isDemoJournalEntry,
  loadJournalStoreRaw,
  stripHtmlToText,
  type JournalEntry,
} from "@/lib/journal-storage";

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "my",
  "our",
  "with",
  "this",
  "that",
  "from",
  "into",
  "about",
  "life",
  "area",
  "goal",
  "dream",
]);

export type LinkedJournalHit = {
  id: string;
  date: string;
  title: string;
  href: string;
};

export type LinkedMeditationHit = {
  id: string;
  title: string;
  type: string;
  date: string;
  href: string;
};

export function lifeAreaMatchTokens(dream: PlanDream): string[] {
  const blob = [
    dream.title,
    dream.dreamText.slice(0, 240),
    dream.visionText.slice(0, 160),
  ]
    .join(" ")
    .toLowerCase();
  const raw = blob.match(/[a-z0-9']{4,}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}

function scoreHaystack(haystack: string, tokens: string[]): number {
  if (!haystack || tokens.length === 0) return 0;
  let score = 0;
  for (const t of tokens) {
    if (haystack.includes(t)) score += 1;
  }
  return score;
}

export function journalEntriesLinkedToLifeArea(
  dream: PlanDream,
  entries?: JournalEntry[],
): LinkedJournalHit[] {
  const tokens = lifeAreaMatchTokens(dream);
  if (tokens.length === 0) return [];

  const list =
    entries ??
    loadJournalStoreRaw().entries.filter((e) => !isDemoJournalEntry(e));

  const scored = list
    .filter((e) => !isDemoJournalEntry(e))
    .map((e) => {
      const plain = stripHtmlToText(e.contentHtml).slice(0, 800).toLowerCase();
      const tags = (e.tags ?? []).join(" ").toLowerCase();
      const title = (e.title || "").toLowerCase();
      const score =
        scoreHaystack(title, tokens) * 3 +
        scoreHaystack(tags, tokens) * 2 +
        scoreHaystack(plain, tokens);
      return { e, score };
    })
    .filter((x) => x.score >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.e.updatedAt).getTime() - new Date(a.e.updatedAt).getTime(),
    )
    .slice(0, 6);

  return scored.map(({ e }) => ({
    id: e.id,
    date: e.updatedAt || e.createdAt,
    title: e.title.trim() || "Untitled",
    href:
      e.kind === "gratitude"
        ? `/journal/my/gratitudes/${encodeURIComponent(e.id)}`
        : `/journal/my/${encodeURIComponent(e.id)}`,
  }));
}

export function meditationsLinkedToLifeArea(
  dream: PlanDream,
  items: LibraryMeditationItem[],
): LinkedMeditationHit[] {
  const byId = items
    .filter(
      (m) =>
        !m.archived &&
        !m.isDraft &&
        typeof m.lifeAreaId === "string" &&
        m.lifeAreaId === dream.id &&
        m.title.trim(),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime(),
    )
    .slice(0, 6);

  if (byId.length > 0) {
    return byId.map((m) => ({
      id: m.sk || m.s3Key || m.id || m.title,
      title: m.title,
      type: m.meditationStyle || m.meditationType || "Meditation",
      date: m.createdAt || new Date().toISOString(),
      href: m.sk
        ? `/meditate/library/creations?focus=${encodeURIComponent(m.sk)}`
        : "/meditate/library/creations",
    }));
  }

  // No id-linked rows yet — do not invent soft matches (integration must be real).
  return [];
}

export async function fetchLinkedMeditationsForLifeArea(
  dream: PlanDream,
): Promise<LinkedMeditationHit[]> {
  if (!isMedimadeSessionActive()) return [];
  try {
    const items = await listLibraryMeditations();
    return meditationsLinkedToLifeArea(dream, items);
  } catch {
    return [];
  }
}
