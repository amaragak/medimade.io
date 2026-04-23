import Link from "next/link";

export const metadata = {
  title: "Plan",
  description:
    "Track goals and intentions over time, shape a clear plan, and align with manifestation and visualization meditations.",
};

const pillars = [
  {
    title: "Goals & intentions over time",
    body: "Capture what you want—not only outcomes, but the mindset and values behind them—so you can see how your direction evolves instead of forgetting it in a stray note.",
  },
  {
    title: "A plan you can actually use",
    body: "Break big aims into steps, milestones, and check-ins. Consciously will help you refine wording, spot gaps, and keep the plan honest when life shifts.",
  },
  {
    title: "Meditation that matches the plan",
    body: "Later, your goals and plan will feed manifestation- and visualization-style meditations—audio that helps you rehearse success, settle nerves, and return to the same north star between sessions.",
  },
] as const;

export default function PlanPage() {
  return (
    <div className="mesh-hero">
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          Plan
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          From intention to action—and back again
        </h1>
        <p className="mt-2 max-w-2xl font-hand text-2xl font-medium leading-snug text-accent sm:text-[1.65rem]">
          Know what you want. See the path. Sit with it.
        </p>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          Plan is where Consciously will help you hold goals and intentions across
          weeks and months—not as a rigid dashboard, but as a living story you can
          revisit, adjust, and eventually connect to guided meditations built around
          your own language.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/meditate/create"
            className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 dark:text-deep"
          >
            Create a meditation
          </Link>
          <Link
            href="/journal"
            className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/40"
          >
            Journal alongside it
          </Link>
        </div>
      </section>

      <section className="border-t border-border/60 bg-card/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-medium sm:text-3xl">
            What we are building here
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            This area is early: the navigation is live so you know where Plan will
            live. Saving goals, timelines, and meditation prompts from your plan will
            ship in stages after the core journal and meditation flows feel solid.
          </p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pillars.map((p) => (
              <li
                key={p.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <h3 className="font-display text-lg font-medium">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
