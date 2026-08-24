import Link from "next/link";
import {
  IconBulb,
  IconNotebook,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { HomeHeroOneShotPrompt } from "@/components/home-hero-one-shot-prompt";
import {
  HomeHeroListenGrid,
  HomeListenSection,
} from "@/components/home-listen-section";
import { LogoMark } from "@/components/logo-mark";
import { createMeditationHref } from "@/lib/create-meditation-path";

/** Flat `bg-nav` — SiteHeader only (`--nav` / `#33465C`). */
const GOLD = "#D9A24F";
const GOLD_INK = "#3D2E10";
const CREAM = "#F4F0E8";
const MUTED = "#A8B0BC";

/**
 * Homepage section backgrounds (below hero) — same navy family, each step
 * clearly distinct from its neighbors. Hero is theme-aware via `.home-hero`.
 * Pillars → Listen → Journal → Ideate → CTA
 */
const SECTION_BG = {
  pillars: "#2A3A4E",
  listen: "#161D28",
  journal: "#243447",
  ideate: "#1A2330",
  cta: "#2A3A4E",
} as const;
/** Inset demo cards: darker than their section so they read as panels. */
const PANEL_BG = "#12181F";

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
      className={`inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-semibold transition-opacity hover:opacity-90 ${className}`}
      style={{ backgroundColor: GOLD, color: GOLD_INK }}
    >
      Start free
    </Link>
  );
}

export default function HomePage() {
  return (
    <div className="w-full">
      {/*
        Hero: light = off-white + mesh gradient; dark = solid #1A2330.
        See .home-hero in globals.css.
      */}
      <section className="home-hero w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <LogoMark size={52} />
          <h1 className="mt-8 max-w-3xl font-display text-3xl font-medium leading-tight tracking-tight text-foreground sm:text-4xl md:text-[2.75rem] dark:text-[#F4F0E8]">
            Personalised guided meditations that actually sound good.
          </h1>
          <div className="mt-8 w-full">
            <HomeHeroOneShotPrompt />
          </div>
          <div className="mt-10 w-full">
            <HomeHeroListenGrid />
          </div>
        </div>
      </section>

      {/* Not just meditation — lighter mid-navy than hero */}
      <section
        className="w-full px-4 py-16 sm:px-6 sm:py-20"
        style={{ backgroundColor: SECTION_BG.pillars }}
      >
        <div className="mx-auto max-w-6xl">
          <h2
            className="text-center font-display text-3xl font-medium tracking-tight sm:text-4xl"
            style={{ color: CREAM }}
          >
            Not just meditation.
          </h2>
          <p
            className="mx-auto mt-3 max-w-2xl text-center text-base sm:text-lg"
            style={{ color: MUTED }}
          >
            A journal, a project planner, and a meditation generator that
            actually talk to each other.
          </p>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6">
            {pillars.map(({ href, title, body, Icon, highlight }) => (
              <li key={title}>
                <Link
                  href={href}
                  className="block h-full rounded-2xl border p-6 transition-opacity hover:opacity-95 sm:p-7"
                  style={
                    highlight
                      ? {
                          backgroundColor: "rgba(217,162,79,0.12)",
                          borderColor: GOLD,
                        }
                      : {
                          backgroundColor: "rgba(255,255,255,0.05)",
                          borderColor: "rgba(255,255,255,0.12)",
                        }
                  }
                >
                  <span
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
                    style={
                      highlight
                        ? {
                            backgroundColor: "rgba(217,162,79,0.22)",
                            color: GOLD,
                          }
                        : {
                            backgroundColor: "rgba(255,255,255,0.08)",
                            color: CREAM,
                          }
                    }
                  >
                    <Icon size={22} stroke={1.75} aria-hidden />
                  </span>
                  <p
                    className="mt-4 font-display text-lg font-semibold"
                    style={{ color: highlight ? GOLD : CREAM }}
                  >
                    {title}
                  </p>
                  <p
                    className="mt-2 text-sm leading-relaxed sm:text-[15px]"
                    style={{ color: MUTED }}
                  >
                    {body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <HomeListenSection />

      {/* Journal */}
      <section
        className="w-full px-4 py-16 sm:px-6 sm:py-20"
        style={{ backgroundColor: SECTION_BG.journal }}
      >
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: GOLD }}
            >
              Journal
            </p>
            <h2
              className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl"
              style={{ color: CREAM }}
            >
              Write it down. Turn it into a meditation when you&apos;re ready.
            </h2>
            <p
              className="mt-4 text-base leading-relaxed sm:text-lg"
              style={{ color: MUTED }}
            >
              Any entry can become the starting point for a session — built from
              what&apos;s actually there.
            </p>
          </div>
          <div
            className="rounded-2xl border p-5 sm:p-6"
            style={{
              backgroundColor: PANEL_BG,
              borderColor: "rgba(255,255,255,0.12)",
            }}
          >
            <p
              className="text-xs font-medium uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              Today · journal entry
            </p>
            <p
              className="mt-3 font-display text-lg font-medium leading-snug"
              style={{ color: CREAM }}
            >
              Still carrying yesterday&apos;s conversation
            </p>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: MUTED }}
            >
              I keep replaying what I should have said. My chest feels tight
              when I think about tomorrow&apos;s meeting — like I&apos;m already
              bracing for it.
            </p>
            <Link
              href={journalCreateHref}
              className="mt-5 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: GOLD, color: GOLD_INK }}
            >
              Reflect on this entry →
            </Link>
          </div>
        </div>
      </section>

      {/* Ideate — mirrored layout */}
      <section
        className="w-full px-4 py-16 sm:px-6 sm:py-20"
        style={{ backgroundColor: SECTION_BG.ideate }}
      >
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div
            className="order-2 rounded-2xl border p-5 sm:p-6 lg:order-1"
            style={{
              backgroundColor: PANEL_BG,
              borderColor: "rgba(255,255,255,0.12)",
            }}
          >
            <p
              className="text-xs font-medium uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              Project
            </p>
            <p
              className="mt-2 font-display text-lg font-medium leading-snug"
              style={{ color: CREAM }}
            >
              Release my album
            </p>
            <p
              className="mt-3 font-display text-base italic leading-relaxed"
              style={{ color: MUTED }}
            >
              &ldquo;I freeze when I imagine people hearing the unfinished
              tracks.&rdquo;
            </p>
            <Link
              href={ideateCreateHref}
              className="mt-5 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: GOLD, color: GOLD_INK }}
            >
              Build a meditation from this →
            </Link>
          </div>
          <div className="order-1 lg:order-2">
            <p
              className="text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: GOLD }}
            >
              Ideate
            </p>
            <h2
              className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl"
              style={{ color: CREAM }}
            >
              Turn what&apos;s blocking you into what you meditate on.
            </h2>
            <p
              className="mt-4 text-base leading-relaxed sm:text-lg"
              style={{ color: MUTED }}
            >
              Name the resistance, then build a visualisation or manifestation
              session straight from it.
            </p>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section
        className="w-full px-4 py-20 sm:px-6 sm:py-24"
        style={{ backgroundColor: SECTION_BG.cta }}
      >
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2
            className="font-display text-3xl font-medium tracking-tight sm:text-4xl"
            style={{ color: CREAM }}
          >
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
