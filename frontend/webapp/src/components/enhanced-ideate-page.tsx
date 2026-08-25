import Link from "next/link";
import {
  IconBulb,
  IconListCheck,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { LogoMark } from "@/components/logo-mark";

const GOLD = "#D9A24F";
const GOLD_INK = "#3D2E10";
const CREAM = "#F4F0E8";
const MUTED = "#A8B0BC";

const SECTION_BG = {
  mid: "#2A3A4E",
  cta: "#1A2330",
} as const;

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
      <section className="home-hero w-full px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
          <div className="home-hero-sun" aria-hidden>
            <LogoMark size={80} />
          </div>
          <h1 className="mt-8 max-w-3xl font-display text-3xl font-medium leading-tight tracking-tight text-foreground sm:text-4xl md:text-[2.75rem] dark:text-[#F4F0E8]">
            Turn what&apos;s blocking you into what you build toward.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#7A7566] sm:text-lg dark:text-[#A8B0BC]">
            Ideate holds dreams and goals gently — then helps you shape a
            vision, steps, and meditations from what&apos;s underneath.
          </p>

          <ul className="mt-10 grid w-full max-w-6xl grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {cards.map(({ title, body, Icon }) => (
              <li key={title} className="min-h-0">
                <div className="flex h-full flex-col rounded-2xl border border-[#D8D2C4] bg-white p-5 text-left shadow-[0_10px_28px_rgb(30_37_48_/_0.06)] dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none sm:p-6">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#F4F0E8] text-[#5A6B7D] dark:bg-white/10 dark:text-[#D9A24F]">
                    <Icon size={22} stroke={1.75} aria-hidden />
                  </span>
                  <p className="mt-4 font-display text-lg font-semibold tracking-tight text-[#1E2530] dark:text-[#F4F0E8]">
                    {title}
                  </p>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-[#7A7566] dark:text-[#A8B0BC]">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="w-full px-4 py-16 sm:px-6 sm:py-20"
        style={{ backgroundColor: SECTION_BG.mid }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2
            className="font-display text-3xl font-medium tracking-tight sm:text-4xl"
            style={{ color: CREAM }}
          >
            Ambition, without the spiral.
          </h2>
          <p
            className="mx-auto mt-4 max-w-2xl text-base leading-relaxed sm:text-lg"
            style={{ color: MUTED }}
          >
            Keep projects visible. Notice resistance. Move one honest step —
            then practice the feeling of already being there.
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
            Open your ideas.
          </h2>
          <div className="mt-8">
            <Link
              href="/ideate/my"
              className="inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: GOLD, color: GOLD_INK }}
            >
              My Ideas
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
