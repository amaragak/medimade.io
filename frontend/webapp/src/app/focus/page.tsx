import Link from "next/link";

export const metadata = {
  title: "Focus",
  description:
    "breath+work for Chrome by Consciously: block distracting sites, run focus and Pomodoro sessions, and stay in flow—coming to the Chrome Web Store.",
};

const features = [
  {
    title: "Site blocking",
    body: "Choose sites and patterns to block during focus hours—or always—so reflexive tab switches don’t derail deep work.",
  },
  {
    title: "Focus & Pomodoro",
    body: "Classic Pomodoro rounds with customizable work and break lengths, plus a simple focus mode when you just need a timer.",
  },
  {
    title: "Session history",
    body: "See completed focus blocks at a glance so you can notice streaks, spot overload, and adjust your rhythm over time.",
  },
  {
    title: "Gentle breaks",
    body: "Optional break nudges when a round ends so you stand, stretch, or step away before the next sprint.",
  },
];

export default function FocusMarketingPage() {
  return (
    <div className="mesh-hero">
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          Chrome extension
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          breath+work
        </h1>
        <p className="mt-2 max-w-2xl font-hand text-2xl font-medium leading-snug text-accent sm:text-[1.65rem]">
          Block noise. Run the timer. Stay with one thing.
        </p>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          <span className="font-semibold text-foreground">breath+work</span> is
          Consciously&apos;s Chrome extension for people who do real work in the
          tab: distraction blocking, Pomodoro and focus timers, and light
          structure around breaks—without turning your day into a spreadsheet.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center justify-center rounded-full border border-border bg-card/80 px-6 py-3 text-sm font-semibold text-muted opacity-80"
          >
            Coming to Chrome Web Store
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/40"
          >
            Back to Consciously
          </Link>
        </div>
      </section>

      <section className="border-t border-border/60 bg-card/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-medium sm:text-3xl">
            Built for deep work in the tab you already use
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Marketing preview only—the extension is not published yet. When it
            ships, this page will link to install and release notes.
          </p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {features.map((f) => (
              <li
                key={f.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <h3 className="font-display text-lg font-medium">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
