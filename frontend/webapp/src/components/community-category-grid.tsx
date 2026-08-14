"use client";

import {
  LIBRARY_MEDITATION_CATEGORIES,
  type LibraryMeditationCategory,
} from "@/lib/community-library";

/** Lucide (ISC) paths, 24×24. Body scan from Tabler Icons (MIT). */
function iconProps() {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-12 w-12 sm:h-14 sm:w-14",
    "aria-hidden": true,
  };
}

function CommunityCategoryIcon({
  name,
}: {
  name: LibraryMeditationCategory | "all";
}) {
  const p = iconProps();
  switch (name) {
    case "all":
      return (
        <svg {...p}>
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      );
    case "Body scan":
      return (
        <svg {...p}>
          <path d="M4 8V6a2 2 0 0 1 2-2h2" />
          <path d="M4 16v2a2 2 0 0 0 2 2h2" />
          <path d="M16 4h2a2 2 0 0 1 2 2v2" />
          <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
          <circle cx="12" cy="8" r="1" />
          <path d="M10 17v-1a2 2 0 1 1 4 0v1" />
          <path d="M8 10c.666.666 1.334 1 2 1h4c.666 0 1.334-.334 2-1" />
          <path d="M12 11v3" />
        </svg>
      );
    case "Visualization":
      return (
        <svg {...p}>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "Breath-led":
      return (
        <svg {...p}>
          <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
          <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
          <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
        </svg>
      );
    case "Manifestation":
      return (
        <svg {...p}>
          <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
          <path d="M20 2v4" />
          <path d="M22 4h-4" />
          <circle cx="4" cy="20" r="2" />
        </svg>
      );
    case "Affirmation loop":
      return (
        <svg {...p}>
          <path d="m2 9 3-3 3 3" />
          <path d="M13 18H7a2 2 0 0 1-2-2V6" />
          <path d="m22 15-3 3-3-3" />
          <path d="M11 6h6a2 2 0 0 1 2 2v10" />
        </svg>
      );
    case "Story":
      return (
        <svg {...p}>
          <path d="M12 7v14" />
          <path d="M16 12h2" />
          <path d="M16 8h2" />
          <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
          <path d="M6 12h2" />
          <path d="M6 8h2" />
        </svg>
      );
    case "Reflection":
      return (
        <svg {...p}>
          <path d="M12 18V5" />
          <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
          <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
          <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
          <path d="M18 18a4 4 0 0 0 2-7.464" />
          <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
          <path d="M6 18a4 4 0 0 1-2-7.464" />
          <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
        </svg>
      );
    case "Sleep":
      return (
        <svg {...p}>
          <path d="M18 5h4" />
          <path d="M20 3v4" />
          <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
        </svg>
      );
    case "Loving-kindness":
      return (
        <svg {...p}>
          <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
        </svg>
      );
    case "Anxiety relief":
      return (
        <svg {...p}>
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "Movement meditation":
      return (
        <svg {...p}>
          <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
          <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
          <path d="M16 17h4" />
          <path d="M4 13h4" />
        </svg>
      );
    case "Open awareness":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      );
    default:
      return null;
  }
}

/** Muted fills: [light bg, dark bg] — index 0 is All; types start at 1. */
const CATEGORY_CARD_FILLS: ReadonlyArray<readonly [string, string]> = [
  ["#e4d6c8", "#3d342e"],
  ["#d7e0d4", "#2f382f"],
  ["#d4dde6", "#2e3640"],
  ["#d5e4e2", "#2d3a38"],
  ["#eadcc4", "#3d3628"],
  ["#e6d4d8", "#3c3034"],
  ["#e8e0c9", "#3c382a"],
  ["#ddd6e4", "#353040"],
  ["#cfd8e2", "#2c3440"],
  ["#ead3c8", "#3e302c"],
  ["#d4e2d6", "#2e3a30"],
  ["#dce0d0", "#34382c"],
  ["#d8d6d2", "#383430"],
];

export function MeditationTypeCardGrid({
  selected,
  onSelect,
  includeAll = false,
  className = "",
  titles,
}: {
  selected: string;
  onSelect: (value: string) => void;
  includeAll?: boolean;
  className?: string;
  titles?: Partial<Record<string, string>>;
}) {
  const cards: Array<{
    value: string;
    label: string;
    icon: LibraryMeditationCategory | "all";
  }> = [
    ...(includeAll
      ? [{ value: "all", label: "All", icon: "all" as const }]
      : []),
    ...LIBRARY_MEDITATION_CATEGORIES.map((cat) => ({
      value: cat,
      label: cat,
      icon: cat,
    })),
  ];

  return (
    <div
      role="listbox"
      aria-label={includeAll ? "Community categories" : "Meditation types"}
      className={
        className ||
        "grid w-full grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6"
      }
    >
      {cards.map((card, i) => {
        const fillIndex = includeAll ? i : i + 1;
        const active = selected === card.value;
        const [light, dark] =
          CATEGORY_CARD_FILLS[fillIndex % CATEGORY_CARD_FILLS.length]!;
        const title = titles?.[card.value];
        return (
          <button
            key={card.value}
            type="button"
            role="option"
            aria-selected={active}
            title={title}
            onClick={() => onSelect(card.value)}
            style={{
              colorScheme: "light dark",
              backgroundColor: `light-dark(${light}, ${dark})`,
            }}
            className={`flex aspect-square min-w-0 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border px-2 py-3 text-center shadow-sm transition-[box-shadow,filter] ${
              active
                ? "border-accent text-foreground ring-2 ring-accent ring-offset-2 ring-offset-background"
                : "border-transparent text-foreground/85 hover:brightness-[0.97] dark:hover:brightness-110"
            }`}
          >
            <CommunityCategoryIcon name={card.icon} />
            <span className="text-sm font-semibold leading-tight sm:text-base">
              {card.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CommunityCategoryGrid({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <MeditationTypeCardGrid
      selected={selected}
      onSelect={onSelect}
      includeAll
      className="mt-8 grid w-full grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-7"
    />
  );
}
