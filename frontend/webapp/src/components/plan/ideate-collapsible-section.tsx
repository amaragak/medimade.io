"use client";

import { IconChevronDown } from "@tabler/icons-react";

type Props = {
  eyebrow: string;
  summary: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

/**
 * Manifesto section chrome: header-row toggle, inline collapsed preview,
 * height-only content animation.
 */
export function IdeateCollapsibleSection({
  eyebrow,
  summary,
  collapsed,
  onToggle,
  children,
}: Props) {
  return (
    <section className="group mt-16 cursor-pointer border-t border-border pt-8">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={`flex w-full cursor-pointer items-center justify-between gap-4 text-left ${
          collapsed ? "pb-8" : "pb-2"
        }`}
      >
        <div className="flex min-w-0 items-center gap-4">
          <p className="shrink-0 font-sans text-[15px] font-medium uppercase tracking-[0.08em] text-[#1E2530] dark:text-foreground">
            {eyebrow}
          </p>
          {collapsed ? (
            <span className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[14px] font-normal italic text-muted/50">
              {summary}
            </span>
          ) : null}
        </div>
        <IconChevronDown
          size={18}
          stroke={2}
          aria-hidden
          className={`shrink-0 text-muted transition-transform duration-200 ease-[ease] ${
            collapsed ? "" : "rotate-180"
          }`}
        />
      </button>

      {/* Hairline only when collapsed — never between header and open content */}
      {collapsed ? (
        <div
          aria-hidden
          className="border-b border-border transition-[border-color] duration-200 ease-[ease] group-hover:border-[#F0A855]"
        />
      ) : null}

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-[ease]"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div
          className={`min-h-0 ${collapsed ? "overflow-hidden" : "overflow-visible"}`}
        >
          <div className={collapsed ? "" : "pt-4"}>{children}</div>
        </div>
      </div>
    </section>
  );
}
