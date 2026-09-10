"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppPrimaryTabsDesktop } from "@/components/app-primary-tabs";

const SECTIONS = [
  { href: "/admin/sounds", label: "Sounds" },
  { href: "/admin/sound-mixes", label: "Sound mixes" },
  { href: "/admin/voice", label: "Voice" },
  { href: "/admin/programs", label: "Programs" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/script-lab", label: "Script Lab" },
  { href: "/admin/stress-test", label: "Stress Test" },
] as const;

function AdminSectionTabs({ pathname }: { pathname: string }) {
  return (
    <>
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${
              active
                ? "bg-selected font-medium text-on-selected"
                : "border border-border text-muted hover:bg-card"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </>
  );
}

export function AdminPageClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const fillViewport = pathname.startsWith("/admin/sound-mixes");

  return (
    <div
      className={
        fillViewport
          ? "mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 pt-2 pb-5 sm:px-6 sm:py-5"
          : "mx-auto w-full max-w-6xl px-4 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-8"
      }
    >
      <AppPrimaryTabsDesktop>
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
          <AdminSectionTabs pathname={pathname} />
        </div>
      </AppPrimaryTabsDesktop>
      <div className="flex shrink-0 flex-wrap gap-2 md:hidden">
        <AdminSectionTabs pathname={pathname} />
      </div>

      <div
        className={
          fillViewport
            ? "mt-4 flex min-h-0 flex-1 flex-col overflow-hidden md:mt-3"
            : "mt-6 md:mt-3"
        }
      >
        {children}
      </div>
    </div>
  );
}
