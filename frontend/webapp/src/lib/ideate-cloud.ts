/**
 * Cloud-first Ideate sync for signed-in users.
 * Guests stay on device demos; localStorage is only a cache after GET.
 */

import { getMedimadeSessionJwt } from "@/lib/auth-session";
import type { IdeateStoreV2 } from "@/lib/plan-ideate-store";
import { withoutDemoIdeateStore } from "@/lib/ideate-demo-seed";
import {
  loadIdeateReflectionQuestionsStore,
  saveIdeateReflectionQuestionsStore,
  type IdeateReflectionQuestionsStoreV1,
} from "@/lib/ideate-reflection-questions";
import {
  loadIdeateVisionBoardStore,
  saveIdeateVisionBoardStore,
  type IdeateVisionBoardStoreV1,
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
let skipNextPush = false;
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

function stripVisionForCloud(
  board: IdeateVisionBoardStoreV1,
): IdeateVisionBoardStoreV1 {
  return {
    v: 2,
    items: board.items.filter(
      (i) => !i.id.startsWith("demo-vb-") && !i.id.startsWith("demo-"),
    ),
    selfReference:
      board.selfReference &&
      !String(board.selfReference.mediaId || "").startsWith("demo-")
        ? board.selfReference
        : null,
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
  skipNextPush = true;
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
  saveIdeateVisionBoardStore(vision);

  const qs = stripQuestionsForCloud(
    (bundle.reflectionQuestions as IdeateReflectionQuestionsStoreV1) ?? {
      v: 1,
      questions: [],
    },
  );
  saveIdeateReflectionQuestionsStore(qs);
  notifyIdeateCloud();
}

/**
 * Pull cloud Ideate once per session when signed in.
 * Returns whether remote data was applied (or empty cloud left local cache).
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
      // Empty cloud: wipe demos from local cache; keep personal if any, else blank.
      const cleaned = withoutDemoIdeateStore(loadIdeateStoreRaw());
      skipNextPush = true;
      saveIdeateStoreLocal(cleaned);
      const board = stripVisionForCloud(loadIdeateVisionBoardStore());
      saveIdeateVisionBoardStore(board);
      const qs = stripQuestionsForCloud(loadIdeateReflectionQuestionsStore());
      saveIdeateReflectionQuestionsStore(qs);
      notifyIdeateCloud();
      // Upload existing personal local writing if present.
      if (cleaned.dreams.length > 0) {
        skipNextPush = false;
        scheduleIdeateCloudPush(0);
      }
      return { applied: true, empty: true };
    }
    applyIdeateCloudBundle(remote);
    return { applied: true, empty: false };
  } catch {
    markIdeateStorePulledThisSession();
    // Offline: strip demos only.
    const cleaned = withoutDemoIdeateStore(loadIdeateStoreRaw());
    skipNextPush = true;
    saveIdeateStoreLocal(cleaned);
    notifyIdeateCloud();
    return { applied: false, empty: false };
  }
}

export function scheduleIdeateCloudPush(delayMs = 1200): void {
  if (!isSignedIn() || !getMedimadeApiBase()) return;
  if (!pulledThisSession) return;
  if (skipNextPush) {
    skipNextPush = false;
    return;
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const bundle = buildIdeateCloudBundle();
    void putIdeateStoreRemote(bundle).catch(() => {
      /* offline */
    });
  }, delayMs);
}
