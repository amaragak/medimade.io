/**
 * Cloud-first Ideate sync for signed-in users.
 * Guests stay on device demos; localStorage is only a cache after GET / before PUT.
 */

import { getMedimadeSessionJwt } from "@/lib/auth-session";
import type { IdeateStoreV2 } from "@/lib/plan-ideate-store";
import { withoutDemoIdeateStore } from "@/lib/ideate-demo-seed";
import {
  loadIdeateReflectionQuestionsStore,
  saveIdeateReflectionQuestionsStoreLocal,
  type IdeateReflectionQuestionsStoreV1,
} from "@/lib/ideate-reflection-questions";
import {
  loadIdeateVisionBoardStore,
  saveIdeateVisionBoardStoreLocal,
  type IdeateVisionBoardStoreV1,
  type VisionBoardItem,
  type VisionSelfReference,
} from "@/lib/ideate-vision-board";
import {
  fetchIdeateStoreRemote,
  getMedimadeApiBase,
  putIdeateStoreRemote,
  type IdeateCloudBundle,
} from "@/lib/medimade-api";
import {
  loadIdeateStoreRaw,
  saveIdeateStoreLocal,
} from "@/lib/plan-ideate-store";

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

export function subscribeIdeateCloud(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyIdeateCloud(): void {
  for (const l of listeners) l();
}

function isSignedIn(): boolean {
  return Boolean(getMedimadeSessionJwt());
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
  };
}

export function applyIdeateCloudBundle(bundle: IdeateCloudBundle): void {
  withCloudPushSuppressed(() => {
    const ideate = withoutDemoIdeateStore(
      (bundle.ideate as IdeateStoreV2) ?? {
        v: 2,
        dreams: [],
        subtasks: [],
        todos: [],
        resistanceEntries: [],
      },
    );
    saveIdeateStoreLocal(ideate);

    const vision = stripVisionForCloud(
      (bundle.visionBoard as IdeateVisionBoardStoreV1) ?? {
        v: 2,
        items: [],
        selfReference: null,
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
  });
  notifyIdeateCloud();
}

/**
 * Pull cloud Ideate once per session when signed in.
 * Cloud always wins — empty cloud replaces local cache with blanks (no demos).
 */
export async function pullIdeateStoreFromCloud(): Promise<{
  applied: boolean;
  empty: boolean;
}> {
  if (!isSignedIn() || !getMedimadeApiBase()) {
    markIdeateStorePulledThisSession();
    return { applied: false, empty: true };
  }
  if (pulledThisSession) {
    return { applied: false, empty: false };
  }

  try {
    const remote = await fetchIdeateStoreRemote();
    markIdeateStorePulledThisSession();
    if (!remote) {
      withCloudPushSuppressed(() => {
        saveIdeateStoreLocal({
          v: 2,
          dreams: [],
          subtasks: [],
          todos: [],
          resistanceEntries: [],
        });
        saveIdeateVisionBoardStoreLocal({
          v: 2,
          items: [],
          selfReference: null,
        });
        saveIdeateReflectionQuestionsStoreLocal({ v: 1, questions: [] });
      });
      notifyIdeateCloud();
      return { applied: true, empty: true };
    }
    applyIdeateCloudBundle(remote);
    return { applied: true, empty: false };
  } catch {
    markIdeateStorePulledThisSession();
    // Offline: keep whatever cache exists; strip demos only.
    withCloudPushSuppressed(() => {
      saveIdeateStoreLocal(withoutDemoIdeateStore(loadIdeateStoreRaw()));
      saveIdeateVisionBoardStoreLocal(
        stripVisionForCloud(loadIdeateVisionBoardStore()),
      );
      saveIdeateReflectionQuestionsStoreLocal(
        stripQuestionsForCloud(loadIdeateReflectionQuestionsStore()),
      );
    });
    notifyIdeateCloud();
    return { applied: false, empty: false };
  }
}

export function scheduleIdeateCloudPush(delayMs = 1200): void {
  if (!isSignedIn() || !getMedimadeApiBase()) return;
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
  if (!isSignedIn() || !getMedimadeApiBase()) return;
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
