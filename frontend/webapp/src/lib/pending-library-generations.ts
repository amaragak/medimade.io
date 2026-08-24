export type PendingLibraryGeneration = {
  jobId: string;
  createdAt: string;
  title: string;
  description: string | null;
  meditationStyle: string | null;
  speakerName: string | null;
  speakerModelId: string | null;
};

export const PENDING_LIBRARY_GENERATIONS_LS_KEY =
  "mm_pending_library_generations_v1";

export function loadPendingLibraryGenerations(): PendingLibraryGeneration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_LIBRARY_GENERATIONS_LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is PendingLibraryGeneration => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      return (
        typeof o.jobId === "string" &&
        typeof o.createdAt === "string" &&
        typeof o.title === "string"
      );
    });
  } catch {
    return [];
  }
}

export function savePendingLibraryGenerations(
  next: PendingLibraryGeneration[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PENDING_LIBRARY_GENERATIONS_LS_KEY,
      JSON.stringify(next.slice(0, 20)),
    );
  } catch {
    /* ignore */
  }
}

export function appendPendingLibraryGeneration(
  pending: PendingLibraryGeneration,
): void {
  const next = [pending, ...loadPendingLibraryGenerations()].filter(
    (x, idx, arr) => arr.findIndex((y) => y.jobId === x.jobId) === idx,
  );
  savePendingLibraryGenerations(next);
}
