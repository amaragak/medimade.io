"use client";

import dynamic from "next/dynamic";

const PlanLifeAreaWhiteboardInner = dynamic(
  () =>
    import("@/components/plan/plan-life-area-whiteboard-inner").then(
      (m) => m.PlanLifeAreaWhiteboardInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[min(70vh,40rem)] items-center justify-center text-sm text-muted">
        Loading whiteboard…
      </div>
    ),
  },
);

type Props = {
  dreamId: string;
};

/** Life-area whiteboard — client-only tldraw canvas. */
export function PlanLifeAreaWhiteboard({ dreamId }: Props) {
  return (
    <div className="mt-8">
      <div className="mm-life-area-whiteboard relative h-[min(75vh,44rem)] overflow-hidden rounded-[12px] border border-[#E5DFD0] dark:border-border">
        <PlanLifeAreaWhiteboardInner dreamId={dreamId} />
      </div>
    </div>
  );
}
