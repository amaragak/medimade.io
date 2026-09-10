"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type PrimaryTabsContextValue = {
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
};

const PrimaryTabsContext = createContext<PrimaryTabsContextValue | null>(null);

export function AppPrimaryTabsProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<HTMLElement | null>(null);
  const setTarget = useCallback((el: HTMLElement | null) => {
    setTargetState((prev) => (prev === el ? prev : el));
  }, []);
  const value = useMemo(
    () => ({ target, setTarget }),
    [target, setTarget],
  );
  return (
    <PrimaryTabsContext.Provider value={value}>
      {children}
    </PrimaryTabsContext.Provider>
  );
}

function usePrimaryTabsContext(): PrimaryTabsContextValue {
  const ctx = useContext(PrimaryTabsContext);
  if (!ctx) {
    throw new Error(
      "App primary tabs components must be used within AppPrimaryTabsProvider",
    );
  }
  return ctx;
}

/** Mount point in the desktop top bar (centered). */
export function AppPrimaryTabsSlot({ className }: { className?: string }) {
  const { setTarget } = usePrimaryTabsContext();
  return <div ref={setTarget} className={className} />;
}

/**
 * Renders primary page tabs into the top-bar centre on desktop (`md+`).
 * Pair with a `md:hidden` copy in the page content for mobile.
 */
export function AppPrimaryTabsDesktop({ children }: { children: ReactNode }) {
  const { target } = usePrimaryTabsContext();
  if (!target) return null;
  return createPortal(children, target);
}
