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
  pullIdeateStoreFromCloud,
  subscribeIdeateCloud,
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
 * Signed-in: await GET /ideate/store, then ready.
 * Guests: demos, ready immediately.
 * Never cancels an in-flight pull by bumping epoch mid-request.
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
      setSignedIn((prev) => {
        if (prev === next) return prev;
        clearIdeateCloudSessionCache();
        if (!next) {
          wipeIdeateDeviceData();
        }
        setAuthEpoch((e) => e + 1);
        setReady(false);
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
    let alive = true;
    setReady(false);

    void (async () => {
      await import("@/lib/auth-session").then((m) => m.ensureMedimadeSession());
      if (!alive) return;

      const active = isMedimadeSessionActive();
      setSignedIn(active);

      if (active) {
        let jwt = getMedimadeSessionJwt();
        if (!jwt) {
          await import("@/lib/auth-session").then((m) =>
            m.ensureMedimadeSession({ force: true }),
          );
          if (!alive) return;
          jwt = getMedimadeSessionJwt();
        }
        if (jwt) {
          // Always fetch. force so a cancelled prior attempt cannot skip us.
          await pullIdeateStoreFromCloud({ force: true });
        }
      } else {
        const { resetIdeateLocalToGuestDemos } = await import(
          "@/lib/ideate-demo-seed"
        );
        resetIdeateLocalToGuestDemos();
      }

      if (!alive) return;
      setReady(true);
      setRevision((n) => n + 1);
    })();

    return () => {
      alive = false;
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
