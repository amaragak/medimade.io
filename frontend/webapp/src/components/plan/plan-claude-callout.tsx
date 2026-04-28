"use client";

export function PlanClaudeCallout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mt-4 rounded-2xl border border-accent/20 bg-accent-soft/15 px-5 py-4 pl-8 shadow-sm">
      <span
        className="absolute left-3 top-4 select-none text-accent/70"
        aria-hidden
      >
        ✦
      </span>
      <div className="font-hand text-[15px] italic leading-relaxed text-foreground/90">
        {children}
      </div>
    </div>
  );
}
