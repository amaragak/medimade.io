import AsyncStorage from "@react-native-async-storage/async-storage";

/** Same key as web `localStorage` for cross-surface consistency. */
export const PENDING_LIBRARY_GENERATIONS_KEY = "mm_pending_library_generations_v1";

export type PendingLibraryGeneration = {
  jobId: string;
  createdAt: string;
  title: string;
  description: string | null;
  meditationStyle: string | null;
  speakerName: string | null;
  speakerModelId: string | null;
  status?: "pending" | "running" | "failed";
  error?: string | null;
};

function isPendingGen(x: unknown): x is PendingLibraryGeneration {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.jobId === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.title === "string"
  );
}

export async function loadPendingGenerations(): Promise<
  PendingLibraryGeneration[]
> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_LIBRARY_GENERATIONS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isPendingGen);
  } catch {
    return [];
  }
}

export async function savePendingGenerations(
  next: PendingLibraryGeneration[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PENDING_LIBRARY_GENERATIONS_KEY,
      JSON.stringify(next.slice(0, 20)),
    );
  } catch {
    /* ignore */
  }
}

export async function upsertPendingGeneration(
  row: PendingLibraryGeneration,
): Promise<void> {
  const cur = await loadPendingGenerations();
  const rest = cur.filter((x) => x.jobId !== row.jobId);
  await savePendingGenerations([row, ...rest]);
}

export async function removePendingGeneration(jobId: string): Promise<void> {
  const cur = await loadPendingGenerations();
  await savePendingGenerations(cur.filter((x) => x.jobId !== jobId));
}
