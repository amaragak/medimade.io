import Link from "next/link";
import {
  IconBulb,
  IconNotebook,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { LogoMark } from "@/components/logo-mark";

const GOLD = "#D9A24F";
const GOLD_INK = "#3D2E10";
const CREAM = "#F4F0E8";
const MUTED = "#A8B0BC";

const SECTION_BG = {
  features: "#2A3A4E",
  cta: "#1A2330",
} as const;

const features = [
  {
    href: "/meditate",
    title: "Meditate",
    body: "Personalised guided sessions from a prompt, a style, a chat, a journal entry, or a goal — with voices and sound beds that actually sound good.",
    Icon: IconSparkles,
    highlight: true,
  },
  {
    href: "/journal",
    title: "Journal",
    body: "Write or speak what’s on your mind. Spot patterns over time, then turn any entry into a meditation when you’re ready.",
    Icon: IconNotebook,
    highlight: false,
  },
  {
    href: "/ideate",
    title: "Ideate",
    body: "Name the project, the resistance, and the next steps — then build a visualisation or manifestation practice from what’s blocking you.",
    Icon: IconBulb,
    highlight: false,
  },
  {
    href: "/focus",
    title: "Focus",
    body: "Sit with one task at a time. Short sessions that keep you in the work instead of escaping it.",
    Icon: IconTargetArrow,
    highlight: false,
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
          <div className="home-hero-sun" aria-hidden>
            <LogoMark size={80} />
          </div>
          <h1 className="mt-8 max-w-3xl font-display text-4xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl md:text-[3.5rem] dark:text-[#F4F0E8]">
            Live Consciously.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#7A7566] sm:text-lg dark:text-[#A8B0BC]">
            with our suite of self reflection tools.
          </p>

          <ul className="mt-10 grid w-full max-w-6xl grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {features.map(({ href, title, body, Icon, highlight }) => (
              <li key={title} className="min-h-0">
                <Link
                  href={href}
                  className={`flex h-full flex-col rounded-2xl border p-5 text-left shadow-[0_10px_28px_rgb(30_37_48_/_0.06)] transition-colors sm:p-6 ${
                    highlight
                      ? "border-[#D9A24F]/70 bg-[#FFFBF3] hover:bg-[#FBF6EA] dark:border-[#D9A24F]/50 dark:bg-[rgba(217,162,79,0.12)] dark:hover:bg-[rgba(217,162,79,0.16)] dark:shadow-none"
                      : "border-[#D8D2C4] bg-white hover:border-[#D9A24F]/70 hover:bg-[#FBF8F2] dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none dark:hover:border-[#D9A24F]/50 dark:hover:bg-white/[0.08]"
                  }`}
                >
                  <span
                    className={
                      highlight
                        ? "inline-flex h-11 w-11 items-center justify-center rounded-xl"
                        : "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#F4F0E8] text-[#5A6B7D] dark:bg-white/10 dark:text-[#D9A24F]"
                    }
                    style={
                      highlight
                        ? {
                            backgroundColor: "rgba(217,162,79,0.22)",
                            color: GOLD,
                          }
                        : undefined
                    }
                  >
                    <Icon size={22} stroke={1.75} aria-hidden />
                  </span>
                  <p
                    className={`mt-4 font-display text-lg font-semibold tracking-tight ${
                      highlight
                        ? ""
                        : "text-[#1E2530] dark:text-[#F4F0E8]"
                    }`}
                    style={highlight ? { color: GOLD } : undefined}
                  >
                    {title}
                  </p>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-[#7A7566] dark:text-[#A8B0BC]">
                    {body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="w-full px-4 py-16 sm:px-6 sm:py-20"
        style={{ backgroundColor: SECTION_BG.features }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2
            className="font-display text-3xl font-medium tracking-tight sm:text-4xl"
            style={{ color: CREAM }}
          >
            Tools that talk to each other.
          </h2>
          <p
            className="mx-auto mt-4 max-w-2xl text-base leading-relaxed sm:text-lg"
            style={{ color: MUTED }}
          >
            Journal what you feel. Plan what you want. Focus on what matters.
            Meditate on all of it — so reflection becomes practice, not another
            tab you forget about.
          </p>
        </div>
      </section>

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
            <Link
              href="/meditate"
              className="inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: GOLD, color: GOLD_INK }}
            >
              Start free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
