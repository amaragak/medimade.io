import Link from "next/link";
import {
  IconBulb,
  IconListCheck,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";

const cards = [
  {
    title: "Hold the dream",
    body: "Name the project or outcome without forcing a plan — start from desire, not a spreadsheet.",
    Icon: IconBulb,
  },
  {
    title: "Find the block",
    body: "Surface what’s really stopping you: fear, perfectionism, unclear next steps.",
    Icon: IconTargetArrow,
  },
  {
    title: "Shape the work",
    body: "Break the vision into tasks you can actually move — gentle structure, not busywork.",
    Icon: IconListCheck,
  },
  {
    title: "Meditate on it",
    body: "Turn a goal into a visualisation or manifestation session so the work includes your nervous system.",
    Icon: IconSparkles,
  },
] as const;

/**
 * Ideate marketing page at `/ideate`. App lives at `/ideate/my`.
 */
export function EnhancedIdeatePage() {
  return (
    <div className="w-full">
      <section className="home-hero home-hero--product w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <h1 className="max-w-3xl font-display text-3xl font-medium leading-tight tracking-tight text-marketing-ink sm:text-4xl md:text-[2.75rem]">
            Turn what&apos;s blocking you into what you build toward.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-marketing-body sm:text-lg">
            Ideate holds dreams and goals gently — then helps you shape a
            vision, steps, and meditations from what&apos;s underneath.
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
            Ambition, without the spiral.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-marketing-muted sm:text-lg">
            Keep projects visible. Notice resistance. Move one honest step —
            then practice the feeling of already being there.
          </p>
        </div>
      </section>

      <section className="w-full bg-marketing-band-b px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Open your ideas.
          </h2>
          <div className="mt-8">
            <Link
              href="/ideate/my"
              className="inline-flex items-center justify-center rounded-full accent-fill-gradient px-7 py-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              My Ideas
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
