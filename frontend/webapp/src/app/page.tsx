import Link from "next/link";

const pillars = [
  {
    title: "Guided meditation generation",
    body: "Chat through mood and intention, shape the script, then generate audio with the voice, ambience, and structure you want.",
  },
  {
    title: "Your meditation library",
    body: "Save sessions, revisit favourites, and keep drafts until you are ready to finish or share them.",
  },
  {
    title: "Smart journaling",
    body: "Rich notes and voice clips in one place, with autosave in the browser and optional cloud sync when you are signed in.",
  },
  {
    title: "Insights from your entries",
    body: "Rolling themes and summaries by topic so patterns in your writing are easier to notice—without leaving the Journal.",
  },
];

export default function HomePage() {
  return (
    <div className="mesh-hero">
      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:grid-cols-2 sm:items-center sm:px-6 lg:py-24">
        <div>
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-accent">
            consciously.live
          </p>
          <h1 className="text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            <span className="font-display">Consciously</span>
            <span className="mx-1.5 text-foreground">·</span>
            <span className="font-hand text-[1.08em] font-medium leading-snug text-accent tracking-normal">
              Live consciously
            </span>
          </h1>
          <p className="mt-2 text-lg font-medium text-foreground/90">
            Live consciously—with meditations built for you and a journal that
            remembers the story.
          </p>
          <p className="mt-5 max-w-lg text-lg text-muted">
            Consciously combines guided meditation creation, a personal
            meditation library, and smart journaling with rolling insights so your
            practice and reflection stay in one flow.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/meditate/create"
              className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90 dark:text-deep"
            >
              Start creating
            </Link>
            <Link
              href="/meditate/library"
              className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:border-accent/40"
            >
              Open library
            </Link>
            <Link
              href="/journal"
              className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:border-accent/40"
            >
              Journal
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted">
            <span className="font-medium text-foreground">Pro</span> for
            creators: WAV downloads, YouTube-ready workflows, and more.
          </p>
        </div>
        <HeroVisual />
      </section>

      <section className="border-t border-border/60 bg-card/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-medium sm:text-3xl">
            Meditation, library, and journal—together
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Whether you are settling in for the day or preparing for something
            that matters, Consciously is built to support both stillness and
            clarity.
          </p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {pillars.map((p) => (
              <li
                key={p.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <h3 className="font-display text-lg font-medium">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {p.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative flex min-h-[280px] items-center justify-center rounded-3xl border border-border bg-card/80 p-8 shadow-inner sm:min-h-[360px]">
      <div
        className="absolute inset-4 rounded-2xl opacity-40"
        style={{
          background:
            "radial-gradient(circle at 30% 40%, rgb(184 107 72 / 0.2), transparent 50%), radial-gradient(circle at 70% 60%, rgb(196 154 108 / 0.18), transparent 45%)",
        }}
      />
      <div className="relative flex max-w-xs flex-col items-center text-center">
        <HeadphonesGlyph className="h-24 w-24 text-accent" />
        <p className="mt-6 font-display text-lg italic text-muted">
          “A few minutes of guided audio, then a line in the journal—both shaped
          by what you actually need today.”
        </p>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted">
          Concept visual · replace with photography
        </p>
      </div>
    </div>
  );
}

function HeadphonesGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M24 64V52a36 36 0 1 1 72 0v12"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect
        x="12"
        y="56"
        width="28"
        height="44"
        rx="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <rect
        x="80"
        y="56"
        width="28"
        height="44"
        rx="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M40 100h40"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}
