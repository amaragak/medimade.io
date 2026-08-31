/**
 * Ideate vision board — placeholder content model until board UX is decided.
 * LocalStorage — same convention as other Ideate content.
 */

export type VisionBoardItem = {
  id: string;
  /** Soft fill for the preview mosaic */
  color: string;
  label: string;
};

export type IdeateVisionBoardStoreV1 = {
  v: 1;
  items: VisionBoardItem[];
};

const LS_KEY = "mm_ideate_vision_board_v1";

function normalizeItem(x: unknown): VisionBoardItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  return {
    id: o.id,
    color: typeof o.color === "string" ? o.color : "#E5DFD0",
    label: typeof o.label === "string" ? o.label : "",
  };
}

export function loadIdeateVisionBoardStore(): IdeateVisionBoardStoreV1 {
  if (typeof window === "undefined") return { v: 1, items: [] };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { v: 1, items: [] };
    const parsed = JSON.parse(raw) as { v?: number; items?: unknown[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.items)) {
      return { v: 1, items: [] };
    }
    return {
      v: 1,
      items: parsed.items
        .map(normalizeItem)
        .filter((i): i is VisionBoardItem => Boolean(i))
        .slice(0, 48),
    };
  } catch {
    return { v: 1, items: [] };
  }
}

export function saveIdeateVisionBoardStore(store: IdeateVisionBoardStoreV1) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        v: 1,
        items: store.items.slice(0, 48),
      } satisfies IdeateVisionBoardStoreV1),
    );
  } catch {
    /* ignore */
  }
}
