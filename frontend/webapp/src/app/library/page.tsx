import Link from "next/link";

const featured = [
  {
    title: "Pre-show grounding · 12 min",
    author: "aria_m",
    rating: 4.9,
    reviews: 128,
    tier: "Free tier",
  },
  {
    title: "Interview calm · manifestation",
    author: "focuslab",
    rating: 4.8,
    reviews: 86,
    tier: "Free tier",
  },
  {
    title: "Deep sleep descent",
    author: "nightowl",
    rating: 4.7,
    reviews: 240,
    tier: "Free tier",
  },
];

export const metadata = {
  title: "Library",
};

export default function LibraryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight">
            Community library
          </h1>
          <p className="mt-2 max-w-xl text-muted">
            Top-rated meditations from other users on the free tier. Feedback
            helps everyone refine what lands.
          </p>
        </div>
        <Link
          href="/create"
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white dark:text-deep"
        >
          Make your own
        </Link>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        {["Top rated", "Manifestation", "Sleep", "Performance"].map((f) => (
          <button
            key={f}
            type="button"
            className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted first:border-accent first:bg-accent-soft/50 first:text-foreground"
          >
            {f}
          </button>
        ))}
      </div>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((m) => (
          <li
            key={m.title}
            className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-accent">
              {m.tier}
            </p>
            <h2 className="mt-2 font-display text-lg font-medium leading-snug">
              {m.title}
            </h2>
            <p className="mt-1 text-sm text-muted">by {m.author}</p>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-gold">★ {m.rating}</span>
              <span className="text-muted">({m.reviews} ratings)</span>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-accent/90 py-2 text-sm font-medium text-white dark:text-deep"
              >
                Play preview
              </button>
              <button
                type="button"
                className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:border-accent/40"
              >
                Feedback
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
