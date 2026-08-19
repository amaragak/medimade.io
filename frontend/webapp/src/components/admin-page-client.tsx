"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SECTIONS = [
  { href: "/admin/sounds", label: "Sounds" },
  { href: "/admin/sound-mixes", label: "Sound mixes" },
  { href: "/admin/voice", label: "Voice" },
  { href: "/admin/analytics", label: "Analytics" },
] as const;

export function AdminPageClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const fillViewport = pathname.startsWith("/admin/sound-mixes");

  return (
    <div
      className={
        fillViewport
          ? "mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-5 sm:px-6"
          : "mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      }
    >
      <h1 className="font-display text-2xl font-medium tracking-tight">Admin</h1>
      <p className="mt-1 max-w-2xl shrink-0 text-sm text-muted">
        Internal tools. Sounds: import and categorise beds. Sound mixes: factory mixer
        presets. Voice: Fish speakers and pauses. Analytics: meditation cost and duration
        stats.
      </p>

      <div className="mt-6 flex shrink-0 flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`rounded-full px-4 py-1.5 text-sm ${
                active
                  ? "bg-selected font-medium text-on-selected"
                  : "border border-border text-muted hover:bg-card"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div
        className={
          fillViewport
            ? "mt-4 flex min-h-0 flex-1 flex-col overflow-hidden"
            : "mt-6"
        }
      >
        {children}
      </div>
    </div>
  );
}
