import Link from "next/link";
import {
  IconBulb,
  IconNotebook,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";

const features = [
  {
    href: "/meditate",
    title: "Meditate",
    body: "Personalised guided sessions from a prompt, a style, a chat, a journal entry, or a goal — with voices and sound beds that actually sound good.",
    Icon: IconSparkles,
  },
  {
    href: "/journal",
    title: "Journal",
    body: "Write or speak what’s on your mind. Spot patterns over time, then turn any entry into a meditation when you’re ready.",
    Icon: IconNotebook,
  },
  {
    href: "/ideate",
    title: "Ideate",
    body: "Name the project, the resistance, and the next steps — then build a visualisation or manifestation practice from what’s blocking you.",
    Icon: IconBulb,
  },
  {
    href: "/focus",
    title: "Focus",
    body: "Sit with one task at a time. Short sessions that keep you in the work instead of escaping it.",
    Icon: IconTargetArrow,
  },
] as const;

/**
 * Site homepage — suite overview. Meditation-specific marketing lives on
 * `/meditate` via `EnhancedMeditatePage`.
 */
export function EnhancedHomePage() {
  return (
    <div className="w-full">
      <section className="home-hero w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <h1 className="max-w-3xl font-display text-4xl font-medium leading-tight tracking-tight text-marketing-ink sm:text-5xl md:text-[3.5rem]">
            Live Consciously.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-marketing-body sm:text-lg">
            with our suite of self reflection tools.
          </p>

          <ul className="mt-10 grid w-full max-w-6xl grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {features.map(({ href, title, body, Icon }) => (
              <li key={title} className="min-h-0">
                <Link
                  href={href}
                  className="flex h-full flex-col rounded-2xl border border-marketing-card-border bg-marketing-card-bg p-5 text-left shadow-[var(--marketing-card-shadow)] transition-[background-color,border-color] duration-150 ease-out hover:border-gold/70 hover:bg-marketing-card-hover sm:p-6"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-marketing-icon-bg text-marketing-icon-fg">
                    <Icon size={22} stroke={1.75} aria-hidden />
                  </span>
                  <p className="mt-4 font-display text-lg font-semibold tracking-tight text-marketing-ink">
                    {title}
                  </p>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-marketing-body">
                    {body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="w-full bg-marketing-band-a px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Tools that talk to each other.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-marketing-muted sm:text-lg">
            Journal what you feel. Plan what you want. Focus on what matters.
            Meditate on all of it — so reflection becomes practice, not another
            tab you forget about.
          </p>
        </div>
      </section>

      <section className="w-full bg-marketing-band-b px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Start with whatever&apos;s on your mind.
          </h2>
          <div className="mt-8">
            <Link
              href="/meditate"
              className="inline-flex items-center justify-center rounded-full bg-gold px-7 py-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Start free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
