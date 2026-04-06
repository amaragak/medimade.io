"use client";

import { useLayoutEffect, useState } from "react";

/** Typical phone / mobile browser user agents. */
const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi|Mobile/i;

function prefersAlwaysVisibleChrome(): boolean {
  if (typeof window === "undefined") return false;
  if (MOBILE_UA_RE.test(navigator.userAgent)) return true;
  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  if (nav.userAgentData?.mobile === true) return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if (window.matchMedia("(hover: none)").matches) return true;
  return false;
}

/**
 * True when the browser looks like mobile / touch-first (UA, coarse pointer, or no hover),
 * so UI that normally appears on `:hover` should stay visible.
 */
export function useMobileOrTouchChrome(): boolean {
  const [v, setV] = useState(false);

  useLayoutEffect(() => {
    setV(prefersAlwaysVisibleChrome());
    const mqCoarse = window.matchMedia("(pointer: coarse)");
    const mqHover = window.matchMedia("(hover: none)");
    const sync = () => setV(prefersAlwaysVisibleChrome());
    mqCoarse.addEventListener("change", sync);
    mqHover.addEventListener("change", sync);
    return () => {
      mqCoarse.removeEventListener("change", sync);
      mqHover.removeEventListener("change", sync);
    };
  }, []);

  return v;
}
