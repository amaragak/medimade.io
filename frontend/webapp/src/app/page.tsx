import Link from "next/link";

const pillars = [
  {
    title: "Sound & style",
    body: "Pick ambience, meditation style, and optional background video with your logo.",
  },
  {
    title: "Voice & cloning",
    body: "Choose a guide voice or clone yours for a consistent, personal sound.",
  },
  {
    title: "Markers & cadence",
    body: "Place chimes before sections and pause markers to control pacing.",
  },
  {
    title: "Manifestation goals",
    body: "Anchor meditations to specific outcomes—performances, interviews, big days.",
  },
  {
    title: "Community library",
    body: "Browse top-rated meditations from others on the free tier and leave feedback.",
  },
  {
    title: "Schedule ahead",
    body: "Pre-build tomorrow’s session so it’s ready when you sit down.",
  },
];

export default function HomePage() {
  return (
    <div className="mesh-hero">
      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:grid-cols-2 sm:items-center sm:px-6 lg:py-24">
        <div>
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-accent">
            medimade.io
          </p>
          <h1 className="text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            <span className="font-display">Meditations made</span>{" "}
            <span className="font-hand text-[1.12em] font-medium leading-snug text-accent tracking-normal">
              just for you
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted">
            An app for on-the-fly guided meditations: chat through mood and
            intention, then generate a bespoke session with the sounds, voice,
            and structure you want.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/create"
              className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90 dark:text-deep"
            >
              Start creating
            </Link>
            <Link
              href="/library"
              className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:border-accent/40"
            >
              Explore library
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
            Everything in one flow
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Guided assistant for mood and daily intention, then fine-tune audio,
            structure, and manifestation focus.
          </p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
          “Settling in before the performance—with a guided track built for the
          outcome you want.”
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
