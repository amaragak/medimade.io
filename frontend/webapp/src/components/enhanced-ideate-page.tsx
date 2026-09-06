import Link from "next/link";
import {
  IconBulb,
  IconEye,
  IconListCheck,
  IconSparkles,
  IconTargetArrow,
  IconWind,
} from "@tabler/icons-react";
import {
  VisionBoardMosaic,
  VISION_BOARD_EXAMPLE_COLORS,
} from "@/components/plan/vision-board-mosaic";

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

const LIFE_AREA_BREAKDOWN = [
  {
    label: "The dream",
    hint: "What you’re quietly hoping for",
    sample: "Evenings that end with a song, not a scroll.",
    Icon: IconSparkles,
    iconColor: "#B8703A",
    iconBg: "rgb(184 112 58 / 0.15)",
  },
  {
    label: "What’s in the way",
    hint: "Resistance, fear, logistics",
    sample: "I wait for the ‘right’ mood — and then it’s late.",
    Icon: IconWind,
    iconColor: "#A65252",
    iconBg: "rgb(166 82 82 / 0.15)",
  },
  {
    label: "The vision",
    hint: "A moment when it’s already true",
    sample: "Guitar in my lap. Ten minutes. No audience needed.",
    Icon: IconEye,
    iconColor: "#5A7A5E",
    iconBg: "rgb(90 122 94 / 0.15)",
  },
] as const;

/**
 * Dream marketing page at `/dream`. App lives at `/dream/my`.
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
            Dream holds your goals gently — then helps you shape a vision,
            steps, and meditations from what&apos;s underneath.
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

      {/* Life areas — mid peach band between hero cream and deeper vision board. */}
      <section className="w-full bg-marketing-band-d px-4 py-16 dark:bg-marketing-band-ideate sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Name a life area. Break it open.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-marketing-muted sm:text-lg">
              Choose a life area, then open it into dream, resistance, and
              vision — with room for thoughts as they come, and Insights that
              pull the threads together.
            </p>
            <Link
              href="/dream/my"
              className="mt-6 inline-flex items-center rounded-full bg-[#1E2530] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] transition-opacity hover:opacity-90 dark:bg-marketing-ink dark:text-home-hero-bg"
            >
              Open life areas →
            </Link>
          </div>
          <div className="rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 shadow-[var(--marketing-card-shadow)] sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-marketing-body">
              Life area
            </p>
            <p className="mt-2 font-display text-xl font-medium tracking-tight text-marketing-ink">
              Play music more
            </p>
            <ul className="mt-5 space-y-4">
              {LIFE_AREA_BREAKDOWN.map(
                ({ label, hint, sample, Icon, iconColor, iconBg }) => (
                  <li key={label} className="flex gap-3">
                    <span
                      className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: iconBg, color: iconColor }}
                    >
                      <Icon size={15} stroke={1.75} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-sm font-medium text-marketing-ink">
                        {label}
                      </p>
                      <p className="text-xs text-marketing-body">{hint}</p>
                      <p className="mt-1 text-sm leading-snug text-marketing-muted">
                        {sample}
                      </p>
                    </div>
                  </li>
                ),
              )}
            </ul>
            <div className="mt-5 border-t border-marketing-card-border pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B8A98A]">
                Insights
              </p>
              <p className="mt-1.5 font-display text-sm italic leading-relaxed text-[#8A8272]">
                The pull isn&apos;t a big practice — it&apos;s a small evening
                where music comes before the scroll.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Vision board feature — placeholder copy, not final. */}
      <section className="w-full bg-marketing-band-c px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <h2 className="font-display text-3xl font-medium tracking-tight text-marketing-ink sm:text-4xl">
              Keep a vision board
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-marketing-muted sm:text-lg">
              Gather images and colours for what you&apos;re moving toward — a
              quiet mosaic beside your goals.
            </p>
            <Link
              href="/dream/my/vision-board"
              className="mt-6 inline-flex items-center rounded-full bg-[#1E2530] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] transition-opacity hover:opacity-90 dark:bg-marketing-ink dark:text-home-hero-bg"
            >
              Open vision board →
            </Link>
          </div>
          <div className="rounded-2xl border border-marketing-card-border bg-marketing-panel-bg p-5 shadow-[var(--marketing-card-shadow)] sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-marketing-body">
              Vision board
            </p>
            <div className="mt-4 flex justify-center sm:justify-start">
              <VisionBoardMosaic
                colors={VISION_BOARD_EXAMPLE_COLORS}
                sizeClassName="h-[200px] w-[200px] sm:h-[220px] sm:w-[220px]"
              />
            </div>
          </div>
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
            Open your dreams.
          </h2>
          <div className="mt-8">
            <Link
              href="/dream/my"
              className="inline-flex items-center justify-center rounded-full accent-fill-gradient px-7 py-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              My Dreams
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
