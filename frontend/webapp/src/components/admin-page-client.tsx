"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SECTIONS = [
  { href: "/admin/sounds", label: "Sounds" },
  { href: "/admin/voice", label: "Voice" },
  { href: "/admin/analytics", label: "Analytics" },
] as const;

export function AdminPageClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-medium tracking-tight">Admin</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Internal tools. Sounds: import and categorise beds. Voice: Fish speakers and pauses.
        Analytics: meditation cost and duration stats.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`rounded-full px-4 py-1.5 text-sm ${
                active
                  ? "bg-accent font-medium text-white dark:text-deep"
                  : "border border-border text-muted hover:bg-card"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">{children}</div>
    </div>
  );
}
