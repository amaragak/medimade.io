import Link from "next/link";
import {
  IconBulb,
  IconNotebook,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { HomeHeroCreatePaths } from "@/components/home-hero-create-paths";
import { HomeHeroOneShotPrompt } from "@/components/home-hero-one-shot-prompt";
import {
  HomeHeroListenGrid,
  HomeListenSection,
} from "@/components/home-listen-section";
import { createMeditationHref } from "@/lib/create-meditation-path";

const journalCreateHref = createMeditationHref({ path: "journalReflect" });
const ideateCreateHref = createMeditationHref({ path: "goal" });

const pillars = [
  {
    href: "/meditate/create",
    title: "Meditate",
    body: "By type, chat, or a journal entry.",
    Icon: IconSparkles,
    highlight: true,
  },
  {
    href: "/journal",
    title: "Journal",
    body: "Write, speak, see what recurs.",
    Icon: IconNotebook,
    highlight: false,
  },
  {
    href: "/ideate",
    title: "Ideate",
    body: "Steps, and what's really stopping you.",
    Icon: IconBulb,
    highlight: false,
  },
  {
    href: "/focus",
    title: "Focus",
    body: "Sessions tied to one task.",
    Icon: IconTargetArrow,
    highlight: false,
  },
] as const;

function StartFreeButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/meditate/create"
      className={`inline-flex items-center justify-center rounded-full bg-gold px-7 py-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 ${className}`}
    >
      Start free
    </Link>
  );
}

export function EnhancedMeditatePage() {
  return (
    <div className="w-full">
      <section className="home-hero w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <h1 className="max-w-3xl font-display text-3xl font-medium leading-tight tracking-tight text-marketing-ink sm:text-4xl md:text-[2.75rem]">
            Personalised guided meditations that actually sound good.
          </h1>
          <div className="mt-8 w-full">
            <HomeHeroOneShotPrompt />
          </div>
          <div className="mt-10 w-full">
            <h2 className="mb-6 text-center font-display text-xl font-medium tracking-tight text-marketing-ink sm:mb-8 sm:text-2xl">
              Shape how your script is written
            </h2>
            <HomeHeroCreatePaths />
          </div>
          <h2 className="mt-14 font-display text-2xl font-medium tracking-tight text-marketing-ink sm:mt-16 sm:text-3xl">
            Take a listen
          </h2>
          <div className="mt-6 w-full sm:mt-8">
            <HomeHeroListenGrid />
          </div>
        </div>
      </section>

      <section className="w-full bg-marketing-band-a px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Not just meditation.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-base text-marketing-muted sm:text-lg">
            A journal, a project planner, and a meditation generator that
            actually talk to each other.
          </p>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6">
            {pillars.map(({ href, title, body, Icon, highlight }) => (
              <li key={title}>
                <Link
                  href={href}
                  className={`block h-full rounded-2xl border p-6 transition-opacity hover:opacity-95 sm:p-7 ${
                    highlight
                      ? "border-gold bg-marketing-pillar-selected-bg"
                      : "border-marketing-card-border bg-marketing-pillar-idle-bg"
                  }`}
                >
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${
                      highlight
                        ? "bg-marketing-highlight-icon-bg text-marketing-highlight-icon-fg"
                        : "bg-marketing-icon-bg text-marketing-pillar-idle-icon-fg"
                    }`}
                  >
                    <Icon size={22} stroke={1.75} aria-hidden />
                  </span>
                  <p
                    className={`mt-4 font-display text-lg font-semibold ${
                      highlight
                        ? "text-marketing-highlight-icon-fg"
                        : "text-marketing-ink"
                    }`}
                  >
                    {title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-marketing-body">
                    {body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <HomeListenSection />

      <section className="w-full bg-marketing-band-c px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marketing-eyebrow">
              Journal
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Write it down. Turn it into a meditation when you&apos;re ready.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-muted sm:text-lg">
              Any entry can become the starting point for a session — built from
              what&apos;s actually there.
            </p>
          </div>
          <div className="rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 sm:p-6">
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
            <Link
              href={journalCreateHref}
              className="mt-5 inline-flex items-center rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Reflect on this entry →
            </Link>
          </div>
        </div>
      </section>

      <section className="w-full bg-marketing-band-ideate px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="order-2 rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 sm:p-6 lg:order-1">
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
            <Link
              href={ideateCreateHref}
              className="mt-5 inline-flex items-center rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              Build a meditation from this →
            </Link>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marketing-eyebrow">
              Ideate
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Turn what&apos;s blocking you into what you meditate on.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-muted sm:text-lg">
              Name the resistance, then build a visualisation or manifestation
              session straight from it.
            </p>
          </div>
        </div>
      </section>

      <section className="w-full bg-marketing-band-a px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
            Start with whatever&apos;s on your mind.
          </h2>
          <div className="mt-8">
            <StartFreeButton />
          </div>
        </div>
      </section>
    </div>
  );
}
