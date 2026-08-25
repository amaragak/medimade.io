import Link from "next/link";
import {
  IconBulb,
  IconNotebook,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { HomeHeadlineTypewriter } from "@/components/home-headline-typewriter";

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
      <section className="home-hero home-hero--live w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <HomeHeadlineTypewriter />

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

      {/* Meditate */}
      <section className="w-full bg-marketing-band-c px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marketing-eyebrow">
              Meditate
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Guided sessions that actually sound good.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-muted sm:text-lg">
              Start from a prompt, a style, a chat, a journal entry, or a goal.
              Voices and sound beds are chosen so the session feels intentional —
              not generic.
            </p>
            <Link
              href="/meditate"
              className="mt-6 inline-flex items-center rounded-full accent-fill-gradient px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Explore Meditate →
            </Link>
          </div>
          <div className="rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-marketing-body">
              Session · from a prompt
            </p>
            <p className="mt-3 font-display text-lg font-medium leading-snug text-marketing-ink">
              I can&apos;t sleep — racing thoughts about tomorrow
            </p>
            <p className="mt-3 text-sm leading-relaxed text-marketing-muted">
              A calm body-scan and breath practice written for this exact
              feeling, with a voice and bed that fit the tone.
            </p>
          </div>
        </div>
      </section>

      {/* Journal */}
      <section className="w-full bg-marketing-band-d px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="order-2 rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 sm:p-6 lg:order-1">
            <p className="text-xs font-medium uppercase tracking-wide text-marketing-body">
              Today · journal entry
            </p>
            <p className="mt-3 font-display text-lg font-medium leading-snug text-marketing-ink">
              Still carrying yesterday&apos;s conversation
            </p>
            <p className="mt-3 text-sm leading-relaxed text-marketing-muted">
              I keep replaying what I should have said. My chest feels tight
              when I think about tomorrow&apos;s meeting — like I&apos;m already
              bracing for it.
            </p>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marketing-eyebrow">
              Journal
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Write it down. Hear yourself think.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-muted sm:text-lg">
              Write or speak what&apos;s on your mind. Spot patterns over time,
              then turn any entry into a meditation when you&apos;re ready to go
              deeper.
            </p>
            <Link
              href="/journal"
              className="mt-6 inline-flex items-center rounded-full accent-fill-gradient px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Explore Journal →
            </Link>
          </div>
        </div>
      </section>

      {/* Ideate */}
      <section className="w-full bg-marketing-band-ideate px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marketing-eyebrow">
              Ideate
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Turn what&apos;s blocking you into what you build toward.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-muted sm:text-lg">
              Name the project, the resistance, and the next steps — then shape
              a visualisation or manifestation practice from what&apos;s
              underneath.
            </p>
            <Link
              href="/ideate"
              className="mt-6 inline-flex items-center rounded-full accent-fill-gradient px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Explore Ideate →
            </Link>
          </div>
          <div className="rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-marketing-body">
              Project
            </p>
            <p className="mt-2 font-display text-lg font-medium leading-snug text-marketing-ink">
              Release my album
            </p>
            <p className="mt-3 font-display text-base italic leading-relaxed text-marketing-muted">
              &ldquo;I freeze when I imagine people hearing the unfinished
              tracks.&rdquo;
            </p>
          </div>
        </div>
      </section>

      {/* Focus */}
      <section className="w-full bg-marketing-band-a px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="order-2 rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 sm:p-6 lg:order-1">
            <p className="text-xs font-medium uppercase tracking-wide text-marketing-body">
              breath+work · Chrome
            </p>
            <p className="mt-3 font-display text-lg font-medium leading-snug text-marketing-ink">
              Block noise. Stay with one thing.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-marketing-muted">
              Focus timers, site blocking, and gentle structure around deep work
              — in the tab you already use.
            </p>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marketing-eyebrow">
              Focus
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Sit with one task at a time.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-muted sm:text-lg">
              Short sessions that keep you in the work instead of escaping it —
              without turning your day into another dashboard.
            </p>
            <Link
              href="/focus"
              className="mt-6 inline-flex items-center rounded-full accent-fill-gradient px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Explore Focus →
            </Link>
          </div>
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
              className="inline-flex items-center justify-center rounded-full accent-fill-gradient px-7 py-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Start free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
