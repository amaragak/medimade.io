"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getMedimadeSessionJwt } from "@/lib/auth-session";
import {
  clearIdeateCloudSessionCache,
  pullIdeateStoreFromCloud,
  subscribeIdeateCloud,
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
      const next = Boolean(getMedimadeSessionJwt());
      setSignedIn((prev) => {
        if (prev !== next) {
          clearIdeateCloudSessionCache();
          setAuthEpoch((e) => e + 1);
          setReady(false);
        }
        return next;
      });
    };
    syncAuth();
    window.addEventListener("medimade-session-changed", syncAuth);
    return () => window.removeEventListener("medimade-session-changed", syncAuth);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      const jwt = Boolean(getMedimadeSessionJwt());
      setSignedIn(jwt);
      if (jwt) {
        await pullIdeateStoreFromCloud();
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
