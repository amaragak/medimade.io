import type {
  IdeateStoreV2,
  ResistanceCategory,
  ResistanceEntry,
} from "@/lib/plan-ideate-store";
import { RESISTANCE_CATEGORY_LABEL } from "@/lib/plan-ideate-store";

export type ResistanceTheme = {
  category: ResistanceCategory;
  label: string;
  sampleText: string;
  level: ResistanceEntry["level"];
  occurrences: number;
};

export function aggregateResistanceThemes(
  store: IdeateStoreV2,
  opts?: { projectId?: string; minOccurrences?: number },
): ResistanceTheme[] {
  const min = opts?.minOccurrences ?? 3;
  const rows = store.resistanceEntries.filter((r) => {
    if (!r.category) return false;
    if (opts?.projectId && r.projectId !== opts.projectId) return false;
    return true;
  });
  const byCat = new Map<
    ResistanceCategory,
    { count: number; recent: ResistanceEntry[] }
  >();
  const sorted = [...rows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  for (const r of sorted) {
    if (!r.category) continue;
    const cur = byCat.get(r.category) ?? { count: 0, recent: [] };
    cur.count += 1;
    if (cur.recent.length < 3) cur.recent.push(r);
    byCat.set(r.category, cur);
  }
  const themes: ResistanceTheme[] = [];
  for (const [category, { count, recent }] of byCat) {
    if (count < min) continue;
    const sample = recent[0]?.text?.trim() || "";
    themes.push({
      category,
      label: RESISTANCE_CATEGORY_LABEL[category],
      sampleText: sample,
      level: recent[0]?.level ?? "todo",
      occurrences: count,
    });
  }
  return themes.sort((a, b) => b.occurrences - a.occurrences);
}

export function activeResistanceThemesForProject(
  store: IdeateStoreV2,
  projectId: string,
): ResistanceTheme[] {
  return aggregateResistanceThemes(store, {
    projectId,
    minOccurrences: 1,
  }).slice(0, 3);
}

export function globalResistanceThreads(store: IdeateStoreV2): ResistanceTheme[] {
  return aggregateResistanceThemes(store, { minOccurrences: 3 }).slice(0, 3);
}
