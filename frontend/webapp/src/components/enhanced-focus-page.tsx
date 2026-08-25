import Link from "next/link";
import {
  IconClock,
  IconFocus2,
  IconHistory,
  IconShield,
} from "@tabler/icons-react";

const cards = [
  {
    title: "Site blocking",
    body: "Choose sites and patterns to block during focus hours — so reflexive tab switches don’t derail deep work.",
    Icon: IconShield,
  },
  {
    title: "Focus & Pomodoro",
    body: "Work and break rounds you can tune — or a simple focus timer when you just need one thing.",
    Icon: IconClock,
  },
  {
    title: "Session history",
    body: "See completed blocks at a glance: streaks, overload, and a rhythm you can actually adjust.",
    Icon: IconHistory,
  },
  {
    title: "Stay with one thing",
    body: "Gentle structure around attention — without turning your day into another dashboard.",
    Icon: IconFocus2,
  },
] as const;

/**
 * Focus marketing page at `/focus`. Product is the breath+work Chrome extension.
 */
export function EnhancedFocusPage() {
  return (
    <div className="w-full">
      <section className="home-hero w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <h1 className="max-w-3xl font-display text-3xl font-medium leading-tight tracking-tight text-marketing-ink sm:text-4xl md:text-[2.75rem]">
            Block noise. Stay with one thing.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-marketing-body sm:text-lg">
            breath+work — Consciously&apos;s Chrome extension for focus timers,
            site blocking, and gentle structure around deep work.
          </p>

          <ul className="mt-10 grid w-full max-w-6xl grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {cards.map(({ title, body, Icon }) => (
              <li key={title} className="min-h-0">
                <div className="flex h-full flex-col rounded-2xl border border-marketing-card-border bg-marketing-card-bg p-5 text-left shadow-[var(--marketing-card-shadow)] sm:p-6">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-marketing-icon-bg text-marketing-icon-fg">
                    <Icon size={22} stroke={1.75} aria-hidden />
                  </span>
                  <p className="mt-4 font-display text-lg font-semibold tracking-tight text-marketing-ink">
                    {title}
                  </p>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-marketing-body">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="w-full bg-marketing-band-a px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Deep work in the tab you already use.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-marketing-muted sm:text-lg">
            Marketing preview for now — when breath+work ships to the Chrome Web
            Store, this page will link to install and release notes.
          </p>
        </div>
      </section>

      <section className="w-full bg-marketing-band-b px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Coming soon.
          </h2>
          <div className="mt-8">
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-gold px-7 py-3 text-sm font-semibold text-on-accent opacity-70"
            >
              Chrome Web Store
            </button>
          </div>
          <Link
            href="/"
            className="mt-4 text-sm font-medium text-marketing-muted underline-offset-2 hover:underline"
          >
            Back to Consciously
          </Link>
        </div>
      </section>
    </div>
  );
}
