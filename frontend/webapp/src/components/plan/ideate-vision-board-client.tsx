"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  loadIdeateVisionBoardStore,
  type VisionBoardItem,
} from "@/lib/ideate-vision-board";

/**
 * Placeholder vision board screen — content model not fully decided yet.
 * Route: /ideate/my/vision-board
 */
export function IdeateVisionBoardClient() {
  const [items, setItems] = useState<VisionBoardItem[]>([]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setItems(loadIdeateVisionBoardStore().items);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/ideate/my"
        className="text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
      >
        ← My Ideas
      </Link>
      <p className="mt-6 text-sm font-medium uppercase tracking-widest text-[#8A7566]">
        Your dream
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
        Vision board
      </h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">
        {/* Placeholder — board UX and content model TBD */}
        A quiet place to gather images and colours for what you&apos;re moving
        toward. Full board editing is coming soon.
      </p>

      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <p className="font-display text-lg text-foreground">
            Nothing on the board yet
          </p>
          <p className="mt-2 text-sm text-muted">
            When you add pieces, they&apos;ll live here as a soft mosaic.
          </p>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="aspect-square rounded-2xl border border-border"
              style={{ backgroundColor: item.color }}
              title={item.label || undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
