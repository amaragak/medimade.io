/**
 * Cloud-first Ideate sync for signed-in users.
 * Guests stay on device demos. Signed-in working copies live in memory only
 * (never durable localStorage) between cloud GET and PUT.
 */

import { getMedimadeSessionJwt, isMedimadeSessionActive } from "@/lib/auth-session";
import type { IdeateStoreV2 } from "@/lib/plan-ideate-store";
import {
  resetIdeateLocalToGuestDemos,
  withoutDemoIdeateStore,
} from "@/lib/ideate-demo-seed";
import { clearIdeateManifestoCache } from "@/lib/ideate-manifesto";
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
}

/**
 * Drop signed-in in-memory working copy only.
 * Keeps localStorage personal rows until pull migrates or adopts cloud —
 * wiping LS first was deleting real Dream data that never reached Dynamo.
 */
export function clearIdeateSignedInWorkingCopy(): void {
  clearIdeateCloudSessionCache();
  clearIdeateStoreMemoryOnly();
  clearIdeateVisionBoardMemoryOnly();
  clearIdeateReflectionQuestionsMemoryOnly();
  clearIdeateValuesMemoryOnly();
  clearIdeateRegretsMemoryOnly();
  clearIdeateManifestoCache();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem("mm_ideate_demo_seed_v1");
      window.localStorage.removeItem("mm_ideate_demo_seed_v2");
      window.localStorage.removeItem("mm_ideate_demo_seed_v3");
      window.localStorage.removeItem("mm_ideate_demo_seed_v4");
      window.localStorage.removeItem("mm_ideate_demo_seed_v5");
    } catch {
      /* */
    }
  }
}

/**
 * Wipe signed-in Ideate working copies + any leftover localStorage keys.
 * Call on logout and when refresh fails so cloud data never stays on device.
 */
export function wipeIdeateDeviceData(): void {
  clearIdeateCloudSessionCache();
  clearIdeateStoreDeviceData();
  clearIdeateVisionBoardDeviceData();
  clearIdeateReflectionQuestionsDeviceData();
  clearIdeateValuesDeviceData();
  clearIdeateRegretsDeviceData();
  clearIdeateManifestoCache();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem("mm_ideate_demo_seed_v1");
      window.localStorage.removeItem("mm_ideate_demo_seed_v2");
      window.localStorage.removeItem("mm_ideate_demo_seed_v3");
      window.localStorage.removeItem("mm_ideate_demo_seed_v4");
      window.localStorage.removeItem("mm_ideate_demo_seed_v5");
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
  // Prefer cloud URL tiles; drop device-only tiles that never uploaded.
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
  };
}

function readJsonLs(key: string): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function emptyIdeate(): IdeateStoreV2 {
  return { v: 2, dreams: [], subtasks: [], todos: [], resistanceEntries: [] };
}

/** Personal (non-demo) Ideate still sitting in localStorage — migrate if cloud empty. */
function snapshotDeviceIdeatePersonal(): IdeateCloudBundle | null {
  const ideateRaw = readJsonLs("mm_plan_dreams_v1");
  let ideate = emptyIdeate();
  if (ideateRaw && typeof ideateRaw === "object") {
    const o = ideateRaw as Record<string, unknown>;
    ideate = withoutDemoIdeateStore({
      v: 2,
      dreams: Array.isArray(o.dreams) ? (o.dreams as IdeateStoreV2["dreams"]) : [],
      subtasks: Array.isArray(o.subtasks)
        ? (o.subtasks as IdeateStoreV2["subtasks"])
        : [],
      todos: Array.isArray(o.todos) ? (o.todos as IdeateStoreV2["todos"]) : [],
      resistanceEntries: Array.isArray(o.resistanceEntries)
        ? (o.resistanceEntries as IdeateStoreV2["resistanceEntries"])
        : [],
    });
  }

  const visionRaw = readJsonLs("mm_ideate_vision_board_v1");
  const vision = stripVisionForCloud(
    (visionRaw && typeof visionRaw === "object"
      ? visionRaw
      : { v: 2, items: [], selfReference: null, extraReferences: [] }) as IdeateVisionBoardStoreV1,
  );

  const qsRaw = readJsonLs("mm_ideate_reflection_questions_v1");
  const reflectionQuestions = stripQuestionsForCloud(
    (qsRaw && typeof qsRaw === "object"
      ? qsRaw
      : { v: 1, questions: [] }) as IdeateReflectionQuestionsStoreV1,
  );

  const valuesRaw = readJsonLs("mm_ideate_values_v1");
  const values = stripValuesForCloud(
    (valuesRaw && typeof valuesRaw === "object"
      ? valuesRaw
      : { v: 1, values: [] }) as IdeateValuesStoreV1,
  );

  const regretsRaw = readJsonLs("mm_ideate_regrets_v1");
  const regrets = stripRegretsForCloud(
    (regretsRaw && typeof regretsRaw === "object"
      ? regretsRaw
      : { v: 1, regrets: [] }) as IdeateRegretsStoreV1,
  );

  const bundle: IdeateCloudBundle = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ideate,
    visionBoard: vision,
    reflectionQuestions,
    values,
    regrets,
  };
  return ideateBundleHasContent(bundle) ? bundle : null;
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
  if ((ideate?.dreams?.length ?? 0) > 0) return true;
  if ((vision?.items?.length ?? 0) > 0) return true;
  if (vision?.selfReference?.url || vision?.selfReference?.key) return true;
  if ((qs?.questions?.length ?? 0) > 0) return true;
  if ((values?.values?.length ?? 0) > 0) return true;
  if ((regrets?.regrets?.length ?? 0) > 0) return true;
  return false;
}

function removeIdeateLocalStorageKeys(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("mm_plan_dreams_v1");
    window.localStorage.removeItem("mm_ideate_vision_board_v1");
    window.localStorage.removeItem("mm_ideate_reflection_questions_v1");
    window.localStorage.removeItem("mm_ideate_values_v1");
    window.localStorage.removeItem("mm_ideate_regrets_v1");
  } catch {
    /* */
  }
}

export function applyIdeateCloudBundle(bundle: IdeateCloudBundle): void {
  withCloudPushSuppressed(() => {
    const ideate = withoutDemoIdeateStore(
      (bundle.ideate as IdeateStoreV2) ?? emptyIdeate(),
    );
    saveIdeateStoreLocal(ideate);

    const vision = stripVisionForCloud(
      (bundle.visionBoard as IdeateVisionBoardStoreV1) ?? {
        v: 2,
        items: [],
        selfReference: null,
        extraReferences: [],
      },
    );
    saveIdeateVisionBoardStoreLocal(vision);

    const qs = stripQuestionsForCloud(
      (bundle.reflectionQuestions as IdeateReflectionQuestionsStoreV1) ?? {
        v: 1,
        questions: [],
      },
    );
    saveIdeateReflectionQuestionsStoreLocal(qs);

    const values = stripValuesForCloud(
      (bundle.values as IdeateValuesStoreV1) ?? { v: 1, values: [] },
    );
    saveIdeateValuesStoreLocal(values);

    const regrets = stripRegretsForCloud(
      (bundle.regrets as IdeateRegretsStoreV1) ?? { v: 1, regrets: [] },
    );
    saveIdeateRegretsStoreLocal(regrets);
  });
  notifyIdeateCloud();
}

/**
 * Pull cloud Ideate once per session when signed in.
 * If cloud is empty but the device still has personal (non-demo) rows, migrate
 * those up instead of blanking the account.
 */
export async function pullIdeateStoreFromCloud(): Promise<{
  applied: boolean;
  empty: boolean;
}> {
  if (!isSignedIn() || !getMedimadeSessionJwt() || !getMedimadeApiBase()) {
    // Do not mark pulled — a later JWT must still be allowed to fetch.
    return { applied: false, empty: true };
  }
  if (pulledThisSession) {
    return { applied: false, empty: false };
  }

  const devicePersonal = snapshotDeviceIdeatePersonal();

  try {
    const remote = await fetchIdeateStoreRemote();
    markIdeateStorePulledThisSession();

    if (remote && ideateBundleHasContent(remote)) {
      applyIdeateCloudBundle(remote);
      removeIdeateLocalStorageKeys();
      return { applied: true, empty: false };
    }

    if (devicePersonal) {
      applyIdeateCloudBundle(devicePersonal);
      removeIdeateLocalStorageKeys();
      // Best-effort upload so other devices see the recovered data.
      void putIdeateStoreRemote({
        ...devicePersonal,
        updatedAt: new Date().toISOString(),
      }).catch(() => {
        /* offline */
      });
      return { applied: true, empty: false };
    }

    // Truly empty account — blank working copy, do not push.
    withCloudPushSuppressed(() => {
      saveIdeateStoreLocal(emptyIdeate());
      saveIdeateVisionBoardStoreLocal({
        v: 2,
        items: [],
        selfReference: null,
        extraReferences: [],
      });
      saveIdeateReflectionQuestionsStoreLocal({ v: 1, questions: [] });
      saveIdeateValuesStoreLocal({ v: 1, values: [] });
      saveIdeateRegretsStoreLocal({ v: 1, regrets: [] });
    });
    notifyIdeateCloud();
    return { applied: true, empty: true };
  } catch {
    markIdeateStorePulledThisSession();
    if (devicePersonal) {
      applyIdeateCloudBundle(devicePersonal);
      return { applied: true, empty: false };
    }
    withCloudPushSuppressed(() => {
      saveIdeateStoreLocal(withoutDemoIdeateStore(loadIdeateStoreRaw()));
      saveIdeateVisionBoardStoreLocal(
        stripVisionForCloud(loadIdeateVisionBoardStore()),
      );
      saveIdeateReflectionQuestionsStoreLocal(
        stripQuestionsForCloud(loadIdeateReflectionQuestionsStore()),
      );
      saveIdeateValuesStoreLocal(stripValuesForCloud(loadIdeateValuesStore()));
    });
    notifyIdeateCloud();
    return { applied: false, empty: false };
  }
}

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

/** Immediate cloud PUT — use after vision uploads so other devices see them. */
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
  pushInFlight = putIdeateStoreRemote(bundle).finally(() => {
    pushInFlight = null;
  });
  await pushInFlight;
}
