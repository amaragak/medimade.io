"use client";

import { useState } from "react";
import { AdminSoundsPanel } from "@/components/admin-sounds-panel";

const SECTIONS = [
  { id: "sounds", label: "Sounds" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function AdminPageClient() {
  const [section, setSection] = useState<SectionId>("sounds");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-medium tracking-tight">Admin</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Internal tools. Sounds: import beds, tag them, mark in use or skip, and trim edges.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-full px-4 py-1.5 text-sm ${
              section === s.id
                ? "bg-accent font-medium text-white dark:text-deep"
                : "border border-border text-muted hover:bg-card"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {section === "sounds" ? <AdminSoundsPanel /> : null}
      </div>
    </div>
  );
}
