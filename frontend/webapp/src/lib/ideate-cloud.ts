/**
 * Cloud Ideate sync for signed-in users.
 *
 * Model (intentionally boring):
 * - On sign-in / session start: GET /ideate/store once → apply to memory.
 * - On user edit: debounce PUT of current memory.
 * - Never migrate localStorage into cloud. Never auto-push on pull.
 * - Guests: device demos only (no cloud).
 */

import { getMedimadeSessionJwt, isMedimadeSessionActive } from "@/lib/auth-session";
import type { IdeateStoreV2 } from "@/lib/plan-ideate-store";
import {
  resetIdeateLocalToGuestDemos,
  withoutDemoIdeateStore,
} from "@/lib/ideate-demo-seed";
import {
  clearIdeateManifestoDeviceData,
  clearIdeateManifestoMemoryOnly,
  loadIdeateManifestoStore,
  saveIdeateManifestoStoreLocal,
  type IdeateManifestoStoreV1,
} from "@/lib/ideate-manifesto";
import {
  clearIdeateStoreDeviceData,
  clearIdeateStoreMemoryOnly,
  loadIdeateStoreRaw,
  saveIdeateStoreLocal,
} from "@/lib/plan-ideate-store";
import {
  clearIdeateValuesDeviceData,
  clearIdeateValuesMemoryOnly,
  loadIdeateValuesStore,
  saveIdeateValuesStoreLocal,
  type IdeateValuesStoreV1,
} from "@/lib/ideate-values";
import {
  clearIdeateRegretsDeviceData,
  clearIdeateRegretsMemoryOnly,
  loadIdeateRegretsStore,
  saveIdeateRegretsStoreLocal,
  type IdeateRegretsStoreV1,
} from "@/lib/ideate-regrets";
import {
  clearIdeateQuotesDeviceData,
  clearIdeateQuotesMemoryOnly,
  loadIdeateQuotesStore,
  saveIdeateQuotesStoreLocal,
  type IdeateQuotesStoreV1,
} from "@/lib/ideate-quotes";
import {
  clearIdeateVisionBoardDeviceData,
  clearIdeateVisionBoardMemoryOnly,
  loadIdeateVisionBoardStore,
  saveIdeateVisionBoardStoreLocal,
  type IdeateVisionBoardStoreV1,
  type VisionBoardItem,
  type VisionExtraReference,
  type VisionSelfReference,
} from "@/lib/ideate-vision-board";
import {
  clearIdeateReflectionQuestionsDeviceData,
  clearIdeateReflectionQuestionsMemoryOnly,
  loadIdeateReflectionQuestionsStore,
  saveIdeateReflectionQuestionsStoreLocal,
  type IdeateReflectionQuestionsStoreV1,
} from "@/lib/ideate-reflection-questions";
import {
  fetchIdeateStoreRemote,
  getMedimadeApiBase,
  putIdeateStoreRemote,
  type IdeateCloudBundle,
} from "@/lib/medimade-api";

export type { IdeateCloudBundle };

let pulledThisSession = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let suppressCloudPushDepth = 0;
let pushInFlight: Promise<void> | null = null;
/** Single-flight GET — overlapping callers share one request; never discard a good apply. */
let pullInFlight: Promise<{ applied: boolean; empty: boolean }> | null = null;
const listeners = new Set<() => void>();

export function wasIdeateStorePulledThisSession(): boolean {
  return pulledThisSession;
}

export function markIdeateStorePulledThisSession(): void {
  pulledThisSession = true;
}

export function clearIdeateCloudSessionCache(): void {
  pulledThisSession = false;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  // Do not null pullInFlight mid-request — callers await the shared promise.
}

/** Clear in-memory signed-in copy only (unused by pull — kept for rare callers). */
export function clearIdeateSignedInWorkingCopy(): void {
  clearIdeateCloudSessionCache();
  clearIdeateStoreMemoryOnly();
  clearIdeateVisionBoardMemoryOnly();
  clearIdeateReflectionQuestionsMemoryOnly();
  clearIdeateValuesMemoryOnly();
  clearIdeateRegretsMemoryOnly();
  clearIdeateQuotesMemoryOnly();
  clearIdeateManifestoMemoryOnly();
}

/** Explicit logout / guest handoff — clears device copies. */
export function wipeIdeateDeviceData(_opts?: { clearBackup?: boolean }): void {
  clearIdeateCloudSessionCache();
  clearIdeateStoreDeviceData();
  clearIdeateVisionBoardDeviceData();
  clearIdeateReflectionQuestionsDeviceData();
  clearIdeateValuesDeviceData();
  clearIdeateRegretsDeviceData();
  clearIdeateQuotesDeviceData();
  clearIdeateManifestoDeviceData();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem("mm_ideate_demo_seed_v1");
      window.localStorage.removeItem("mm_ideate_demo_seed_v2");
      window.localStorage.removeItem("mm_ideate_demo_seed_v3");
      window.localStorage.removeItem("mm_ideate_demo_seed_v4");
      window.localStorage.removeItem("mm_ideate_demo_seed_v5");
      window.localStorage.removeItem("mm_ideate_demo_seed_v6");
      window.localStorage.removeItem("mm_ideate_account_backup_v1");
      window.localStorage.removeItem("mm_plan_dreams_v1");
      window.localStorage.removeItem("mm_ideate_vision_board_v1");
      window.localStorage.removeItem("mm_ideate_reflection_questions_v1");
      window.localStorage.removeItem("mm_ideate_values_v1");
      window.localStorage.removeItem("mm_ideate_regrets_v1");
      window.localStorage.removeItem("mm_ideate_quotes_v1");
      window.localStorage.removeItem("mm_ideate_manifesto_v1");
    } catch {
      /* */
    }
    if (!isMedimadeSessionActive()) {
      resetIdeateLocalToGuestDemos();
    }
  }
  notifyIdeateCloud();
}

export function subscribeIdeateCloud(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyIdeateCloud(): void {
  for (const l of listeners) l();
}

function isSignedIn(): boolean {
  return isMedimadeSessionActive();
}

function withCloudPushSuppressed(fn: () => void): void {
  suppressCloudPushDepth += 1;
  try {
    fn();
  } finally {
    suppressCloudPushDepth -= 1;
  }
}

function emptyIdeate(): IdeateStoreV2 {
  return { v: 2, dreams: [], subtasks: [], todos: [], resistanceEntries: [] };
}

function emptyVision(): IdeateVisionBoardStoreV1 {
  return { v: 2, items: [], selfReference: null, extraReferences: [] };
}

/** Cloud never stores device IndexedDB ids — only CloudFront url/key. */
function cloudSelfReference(
  ref: VisionSelfReference | null | undefined,
): VisionSelfReference | null {
  if (!ref?.url || !ref.key) return null;
  if (String(ref.mediaId || "").startsWith("demo-")) return null;
  return {
    url: ref.url,
    key: ref.key,
    mimeType: ref.mimeType,
    fileName: ref.fileName,
    width: ref.width,
    height: ref.height,
    byteLength: ref.byteLength,
    updatedAt: ref.updatedAt,
  };
}

function cloudExtraReference(
  ref: VisionExtraReference,
): VisionExtraReference | null {
  const base = cloudSelfReference(ref);
  if (!base) return null;
  return {
    ...base,
    id: ref.id,
    description: String(ref.description || "").slice(0, 280),
  };
}

function cloudVisionItem(item: VisionBoardItem): VisionBoardItem | null {
  if (item.id.startsWith("demo-vb-") || item.id.startsWith("demo-")) return null;
  const { mediaId: _drop, ...rest } = item;
  void _drop;
  // Signed-in tiles need a CloudFront URL to show on other devices.
  if (rest.kind === "image" && !rest.imageUrl) return null;
  return rest;
}

function stripVisionForCloud(
  board: IdeateVisionBoardStoreV1,
): IdeateVisionBoardStoreV1 {
  return {
    v: 2,
    items: board.items
      .map(cloudVisionItem)
      .filter((i): i is VisionBoardItem => Boolean(i))
      .slice(0, 48),
    selfReference: cloudSelfReference(board.selfReference),
    extraReferences: (board.extraReferences ?? [])
      .map(cloudExtraReference)
      .filter((r): r is VisionExtraReference => Boolean(r))
      .slice(0, 3),
  };
}

function stripQuestionsForCloud(
  qs: IdeateReflectionQuestionsStoreV1,
): IdeateReflectionQuestionsStoreV1 {
  return {
    v: 1,
    questions: qs.questions.filter((q) => !q.id.startsWith("demo-rq-")),
  };
}

function stripValuesForCloud(store: IdeateValuesStoreV1): IdeateValuesStoreV1 {
  return {
    v: 1,
    values: store.values
      .filter((v) => !v.id.startsWith("demo-val-"))
      .slice(0, 40),
  };
}

function stripRegretsForCloud(store: IdeateRegretsStoreV1): IdeateRegretsStoreV1 {
  return {
    v: 1,
    regrets: store.regrets
      .filter((r) => !r.id.startsWith("demo-regret-"))
      .slice(0, 40),
  };
}

function stripQuotesForCloud(store: IdeateQuotesStoreV1): IdeateQuotesStoreV1 {
  return {
    v: 1,
    quotes: store.quotes
      .filter((q) => !q.id.startsWith("demo-quote-"))
      .slice(0, 40),
  };
}

function stripManifestoForCloud(
  store: IdeateManifestoStoreV1,
): IdeateManifestoStoreV1 {
  const text = typeof store.text === "string" ? store.text.trim() : "";
  return {
    v: 1,
    text,
    updatedAt:
      typeof store.updatedAt === "string" && store.updatedAt.trim()
        ? store.updatedAt
        : new Date().toISOString(),
  };
}

export function buildIdeateCloudBundle(): IdeateCloudBundle {
  const ideate = withoutDemoIdeateStore(loadIdeateStoreRaw());
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ideate,
    visionBoard: stripVisionForCloud(loadIdeateVisionBoardStore()),
    reflectionQuestions: stripQuestionsForCloud(
      loadIdeateReflectionQuestionsStore(),
    ),
    values: stripValuesForCloud(loadIdeateValuesStore()),
    regrets: stripRegretsForCloud(loadIdeateRegretsStore()),
    quotes: stripQuotesForCloud(loadIdeateQuotesStore()),
    manifesto: stripManifestoForCloud(loadIdeateManifestoStore()),
  };
}

function ideateBundleHasContent(bundle: IdeateCloudBundle): boolean {
  const ideate = bundle.ideate as IdeateStoreV2 | null | undefined;
  const vision = bundle.visionBoard as IdeateVisionBoardStoreV1 | null | undefined;
  const qs = bundle.reflectionQuestions as
    | IdeateReflectionQuestionsStoreV1
    | null
    | undefined;
  const values = bundle.values as IdeateValuesStoreV1 | null | undefined;
  const regrets = bundle.regrets as IdeateRegretsStoreV1 | null | undefined;
  const quotes = bundle.quotes as IdeateQuotesStoreV1 | null | undefined;
  const manifesto = bundle.manifesto as IdeateManifestoStoreV1 | null | undefined;
  if ((ideate?.dreams?.length ?? 0) > 0) return true;
  if ((vision?.items?.length ?? 0) > 0) return true;
  if (vision?.selfReference?.url || vision?.selfReference?.key) return true;
  if ((qs?.questions?.length ?? 0) > 0) return true;
  if ((values?.values?.length ?? 0) > 0) return true;
  if ((regrets?.regrets?.length ?? 0) > 0) return true;
  if ((quotes?.quotes?.length ?? 0) > 0) return true;
  if ((manifesto?.text?.trim().length ?? 0) > 0) return true;
  return false;
}

export function ideateCloudBundleHasContent(bundle: IdeateCloudBundle): boolean {
  return ideateBundleHasContent(bundle);
}

export function signedInIdeateMemoryHasContent(): boolean {
  try {
    if (!isSignedIn()) return false;
    return ideateBundleHasContent(buildIdeateCloudBundle());
  } catch {
    return false;
  }
}

/** Apply API payload to signed-in memory. Never schedules a push. */
export function applyIdeateCloudBundle(bundle: IdeateCloudBundle): void {
  withCloudPushSuppressed(() => {
    const ideate = withoutDemoIdeateStore(
      (bundle.ideate as IdeateStoreV2) ?? emptyIdeate(),
    );
    saveIdeateStoreLocal(ideate);

    // Apply vision as stored in cloud — do not re-strip (that is PUT-only).
    const rawVision =
      (bundle.visionBoard as IdeateVisionBoardStoreV1) ?? emptyVision();
    saveIdeateVisionBoardStoreLocal({
      v: 2,
      items: Array.isArray(rawVision.items) ? rawVision.items.slice(0, 48) : [],
      selfReference: rawVision.selfReference ?? null,
      extraReferences: Array.isArray(rawVision.extraReferences)
        ? rawVision.extraReferences.slice(0, 3)
        : [],
    });

    saveIdeateReflectionQuestionsStoreLocal(
      (bundle.reflectionQuestions as IdeateReflectionQuestionsStoreV1) ?? {
        v: 1,
        questions: [],
      },
    );
    saveIdeateValuesStoreLocal(
      (bundle.values as IdeateValuesStoreV1) ?? { v: 1, values: [] },
    );
    saveIdeateRegretsStoreLocal(
      (bundle.regrets as IdeateRegretsStoreV1) ?? { v: 1, regrets: [] },
    );
    saveIdeateQuotesStoreLocal(
      (bundle.quotes as IdeateQuotesStoreV1) ?? { v: 1, quotes: [] },
    );
    saveIdeateManifestoStoreLocal(
      (bundle.manifesto as IdeateManifestoStoreV1) ?? {
        v: 1,
        text: "",
        updatedAt: new Date().toISOString(),
      },
    );
  });
  notifyIdeateCloud();
}

/**
 * GET cloud store and apply to memory. Never PUT.
 * Concurrent callers await the same in-flight GET (no cancel/discard race).
 */
export async function pullIdeateStoreFromCloud(opts?: {
  force?: boolean;
}): Promise<{
  applied: boolean;
  empty: boolean;
}> {
  if (!isSignedIn() || !getMedimadeSessionJwt() || !getMedimadeApiBase()) {
    return { applied: false, empty: true };
  }
  if (opts?.force) {
    pulledThisSession = false;
  }
  if (pulledThisSession) {
    return { applied: false, empty: !signedInIdeateMemoryHasContent() };
  }
  if (pullInFlight) {
    return pullInFlight;
  }

  pullInFlight = (async () => {
    try {
      const { store: remote, authenticated } = await fetchIdeateStoreRemote();

      if (!authenticated) {
        // Session not accepted by API — leave memory alone, allow retry.
        return { applied: false, empty: false };
      }

      markIdeateStorePulledThisSession();

      if (remote && typeof remote === "object") {
        applyIdeateCloudBundle(remote);
        return {
          applied: true,
          empty: !ideateBundleHasContent(remote),
        };
      }

      // Authenticated + null store = empty account.
      applyIdeateCloudBundle({
        version: 1,
        updatedAt: new Date().toISOString(),
        ideate: emptyIdeate(),
        visionBoard: emptyVision(),
        reflectionQuestions: { v: 1, questions: [] },
        values: { v: 1, values: [] },
        regrets: { v: 1, regrets: [] },
        quotes: { v: 1, quotes: [] },
        manifesto: { v: 1, text: "", updatedAt: new Date().toISOString() },
      });
      return { applied: true, empty: true };
    } catch (err) {
      console.error("[ideate] cloud GET failed", err);
      return { applied: false, empty: false };
    } finally {
      pullInFlight = null;
    }
  })();

  return pullInFlight;
}

/** Debounced PUT after a user edit. Never called from pull. */
export function scheduleIdeateCloudPush(delayMs = 1200): void {
  if (!isSignedIn() || !getMedimadeSessionJwt() || !getMedimadeApiBase()) return;
  if (!pulledThisSession) return;
  if (suppressCloudPushDepth > 0) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void flushIdeateCloudNow().catch(() => {
      /* offline */
    });
  }, delayMs);
}

/** Immediate PUT after a user edit (e.g. vision upload finished). */
export async function flushIdeateCloudNow(): Promise<void> {
  if (!isSignedIn() || !getMedimadeSessionJwt() || !getMedimadeApiBase()) return;
  if (!pulledThisSession) return;
  if (suppressCloudPushDepth > 0) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (pushInFlight) {
    await pushInFlight;
  }
  const bundle = buildIdeateCloudBundle();
  if (!ideateBundleHasContent(bundle)) {
    return;
  }
  pushInFlight = putIdeateStoreRemote(bundle).finally(() => {
    pushInFlight = null;
  });
  await pushInFlight;
}

/** @deprecated No-op — localStorage backup sync removed. */
export function persistIdeateAccountBackupIfNeeded(): void {
  /* intentionally empty */
}
