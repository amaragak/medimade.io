"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Intentionally obvious chrome for alpha testing (ships in production).
 * Monospace + hard corners so it never reads as finished product UI.
 */
export function AlphaChromeButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 border border-dashed border-[#c026d3] bg-[#fdf4ff] px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-wide text-[#86198e] shadow-none transition-colors hover:bg-[#fae8ff] disabled:cursor-wait disabled:opacity-60 dark:border-[#e879f9] dark:bg-[#4a044e]/40 dark:text-[#f0abfc] dark:hover:bg-[#4a044e]/70 ${className}`}
      style={{ borderRadius: 0, ...(props.style ?? {}) }}
    >
      {children}
      <span aria-hidden className="text-[11px] leading-none">
        →
      </span>
    </button>
  );
}

/** @deprecated Prefer AlphaChromeButton — same control, alpha-testing naming. */
export const DevChromeButton = AlphaChromeButton;
