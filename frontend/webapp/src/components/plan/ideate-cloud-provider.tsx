"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getMedimadeSessionJwt,
  isMedimadeSessionActive,
} from "@/lib/auth-session";
import {
  clearIdeateCloudSessionCache,
  clearIdeateSignedInWorkingCopy,
  pullIdeateStoreFromCloud,
  subscribeIdeateCloud,
  wasIdeateStorePulledThisSession,
  wipeIdeateDeviceData,
} from "@/lib/ideate-cloud";
import { loadIdeateStoreRaw } from "@/lib/plan-ideate-store";

type IdeateCloudContextValue = {
  ready: boolean;
  signedIn: boolean;
  /** Bumps when local/cloud Ideate data changes — remount readers. */
  revision: number;
  refresh: () => void;
};

const IdeateCloudContext = createContext<IdeateCloudContextValue>({
  ready: false,
  signedIn: false,
  revision: 0,
  refresh: () => {},
});

export function useIdeateCloud(): IdeateCloudContextValue {
  return useContext(IdeateCloudContext);
}

function memoryHasIdeateRows(): boolean {
  try {
    return loadIdeateStoreRaw().dreams.length > 0;
  } catch {
    return false;
  }
}

/**
 * Pulls cloud Ideate for signed-in users before children read the store.
 * Guests become ready immediately with forced local demos.
 */
export function IdeateCloudProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const wasSignedInRef = useRef<boolean | null>(null);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => subscribeIdeateCloud(refresh), [refresh]);

  useEffect(() => {
    const syncAuth = () => {
      const next = isMedimadeSessionActive();
      setSignedIn((prev) => {
        if (prev !== next) {
          clearIdeateCloudSessionCache();
          if (!next) {
            wipeIdeateDeviceData();
          }
          setAuthEpoch((e) => e + 1);
          setReady(false);
        }
        return next;
      });
    };
    void import("@/lib/auth-session").then((m) =>
      m.ensureMedimadeSession().finally(syncAuth),
    );
    window.addEventListener("medimade-session-changed", syncAuth);
    return () =>
      window.removeEventListener("medimade-session-changed", syncAuth);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      await import("@/lib/auth-session").then((m) => m.ensureMedimadeSession());
      const active = isMedimadeSessionActive();
      setSignedIn(active);

      const wasSignedIn = wasSignedInRef.current;
      wasSignedInRef.current = active;
      const justSignedIn = active && wasSignedIn === false;

      if (active) {
        // Only wipe memory on guest → signed-in (drop demos) or when memory is empty.
        // Remounts must keep an existing in-memory account store.
        if (justSignedIn || !memoryHasIdeateRows()) {
          clearIdeateSignedInWorkingCopy();
        }

        let jwt = getMedimadeSessionJwt();
        if (!jwt) {
          await import("@/lib/auth-session").then((m) =>
            m.ensureMedimadeSession({ force: true }),
          );
          jwt = getMedimadeSessionJwt();
        }

        if (jwt) {
          const needPull =
            !wasIdeateStorePulledThisSession() || !memoryHasIdeateRows();
          if (needPull) {
            await pullIdeateStoreFromCloud({
              force: wasIdeateStorePulledThisSession() && !memoryHasIdeateRows(),
            });
          }
        }
      } else {
        // Guests always get seeded samples — never leftover account rows in LS.
        const { resetIdeateLocalToGuestDemos } = await import(
          "@/lib/ideate-demo-seed"
        );
        resetIdeateLocalToGuestDemos();
      }

      if (!cancelled) {
        setReady(true);
        setRevision((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authEpoch]);

  return (
    <IdeateCloudContext.Provider
      value={{ ready, signedIn, revision, refresh }}
    >
      {children}
    </IdeateCloudContext.Provider>
  );
}
