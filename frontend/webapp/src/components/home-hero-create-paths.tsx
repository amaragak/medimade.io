import Link from "next/link";
import type { ReactNode } from "react";
import {
  createMeditationHref,
  type CreateMeditationPath,
} from "@/lib/create-meditation-path";

function IconMeditationStyle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1" />
      <circle cx="12" cy="8" r="2" />
      <path d="M12 10v12" />
      <path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z" />
      <path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z" />
    </svg>
  );
}

function IconChatBubbles({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

function IconJournalReflect({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 7v14" />
      <path d="M16 12h2" />
      <path d="M16 8h2" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      <path d="M6 12h2" />
      <path d="M6 8h2" />
    </svg>
  );
}

function IconGoalTarget({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

const PATHS: Array<{
  path: Exclude<CreateMeditationPath, "pending" | "oneShot">;
  title: string;
  body: string;
  Icon: (props: { className?: string }) => ReactNode;
}> = [
  {
    path: "style",
    title: "Pick a meditation style",
    body: "Choose a meditation type, then answer a few questions so that style is shaped around your mood, goals, and what you need today.",
    Icon: IconMeditationStyle,
  },
  {
    path: "freeflow",
    title: "Free flow chat",
    body: "Start from mood and what is on your mind—no style label up front. The guide uses open, journal-style questions.",
    Icon: IconChatBubbles,
  },
  {
    path: "journalReflect",
    title: "Reflect on a journal entry",
    body: "Choose a saved entry; the coach uses it as context for your meditation.",
    Icon: IconJournalReflect,
  },
  {
    path: "goal",
    title: "Move towards a goal",
    body: "Choose a goal from Dream. The guide creates a visualization meditation that helps you step toward it.",
    Icon: IconGoalTarget,
  },
];

/**
 * Create-path cards from the meditation chooser (excluding one-shot),
 * for the homepage hero under the prompt input.
 */
export function HomeHeroCreatePaths({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full ${className}`}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {PATHS.map(({ path, title, body, Icon }) => (
          <li key={path} className="min-h-0">
            <Link
              href={createMeditationHref({ path })}
              className="home-hero-gold-border-pulse flex h-full flex-col rounded-2xl border border-marketing-card-border bg-marketing-card-bg p-5 text-left shadow-[var(--marketing-card-shadow)] transition-[background-color] duration-150 ease-out hover:bg-marketing-card-hover sm:p-6"
            >
              <span className="font-display text-lg font-medium tracking-tight text-marketing-ink sm:text-xl">
                {title}
              </span>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-marketing-body">
                {body}
              </p>
              <span
                className="mx-auto mt-5 flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-marketing-icon-bg text-marketing-icon-fg shadow-inner sm:h-24 sm:w-24"
                aria-hidden
              >
                <Icon className="h-12 w-12 sm:h-14 sm:w-14" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
