/**
 * Focus session background mix (device-local).
 */

import {
  DEFAULT_MIX_EDITOR_VALUES,
  type MixEditorValues,
} from "@/components/mix-editor-panel";

const LS_KEY = "mm_focus_mix_v1";

function isMix(x: unknown): x is MixEditorValues {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.natureKey === "string" &&
    typeof o.musicKey === "string" &&
    typeof o.drumsKey === "string" &&
    typeof o.noiseKey === "string" &&
    typeof o.natureGain === "number" &&
    typeof o.musicGain === "number" &&
    typeof o.drumsGain === "number" &&
    typeof o.noiseGain === "number"
  );
}

export function loadFocusMix(): MixEditorValues {
  if (typeof window === "undefined") return { ...DEFAULT_MIX_EDITOR_VALUES };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_MIX_EDITOR_VALUES };
    const parsed = JSON.parse(raw) as unknown;
    if (isMix(parsed)) return parsed;
  } catch {
    /* */
  }
  return { ...DEFAULT_MIX_EDITOR_VALUES };
}

export function saveFocusMix(mix: MixEditorValues): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(mix));
  } catch {
    /* */
  }
}
