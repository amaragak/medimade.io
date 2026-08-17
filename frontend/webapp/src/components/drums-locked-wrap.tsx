"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { DRUMS_LOCKED_FOR_MELODIC_HINT } from "@/lib/sound-taxonomy";

export function DrumsLockedWrap({
  locked,
  className,
  children,
}: {
  locked: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <div
      className={`${className ?? ""} ${locked ? "opacity-40" : ""}`.trim()}
      aria-disabled={locked || undefined}
    >
      {children}
    </div>
  );
  if (!locked) return inner;
  return (
    <Tooltip.Provider delayDuration={200} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {inner}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="center"
            sideOffset={8}
            className="z-[120] max-w-[16rem] rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground shadow-md"
          >
            {DRUMS_LOCKED_FOR_MELODIC_HINT}
            <Tooltip.Arrow className="fill-card stroke-border" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
