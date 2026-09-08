"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

/**
 * Pulls cloud Ideate for signed-in users before children read the store.
 * Guests become ready immediately (local demos).
 * Never seed demos while a session is active — even before the access JWT lands.
 */
export function IdeateCloudProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => subscribeIdeateCloud(refresh), [refresh]);

  useEffect(() => {
    const syncAuth = () => {
      const next = isMedimadeSessionActive();
      const hasJwt = Boolean(getMedimadeSessionJwt());
      setSignedIn((prev) => {
        if (prev !== next) {
          clearIdeateCloudSessionCache();
          if (!next) {
            // Sign-out: wipe account working copy and put guest demos back.
            wipeIdeateDeviceData();
          } else {
            // Sign-in: drop guest demos immediately so they cannot flash / leak.
            clearIdeateSignedInWorkingCopy();
          }
          setAuthEpoch((e) => e + 1);
          setReady(false);
        }
        return next;
      });
      // Sticky active + late access JWT: pull cloud once without flipping signedIn.
      if (next && hasJwt && !wasIdeateStorePulledThisSession()) {
        void pullIdeateStoreFromCloud().then(() => {
          setReady(true);
          setRevision((n) => n + 1);
        });
      }
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
      // Do not force-rotate here — forced refresh on every Dream mount burned soft
      // failures on localhost and logged people out.
      await import("@/lib/auth-session").then((m) => m.ensureMedimadeSession());
      const active = isMedimadeSessionActive();
      setSignedIn(active);

      if (active) {
        // Signed-in path: never seed guest demos. Pull cloud when JWT is ready.
        clearIdeateSignedInWorkingCopy();
        if (getMedimadeSessionJwt()) {
          await pullIdeateStoreFromCloud();
        } else {
          // Soft refresh miss — keep account UI; scheduled retry will restore JWT.
          void import("@/lib/auth-session").then((m) => m.ensureMedimadeSession());
        }
      } else {
        const { ensureGuestCompanionDemos, resetIdeateLocalToGuestDemos } =
          await import("@/lib/ideate-demo-seed");
        const { loadIdeateStore } = await import("@/lib/plan-ideate-store");
        loadIdeateStore();
        ensureGuestCompanionDemos(true);
        if (loadIdeateStore().dreams.length === 0) {
          resetIdeateLocalToGuestDemos();
        }
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
