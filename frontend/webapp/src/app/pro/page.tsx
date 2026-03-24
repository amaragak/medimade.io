import Link from "next/link";

export const metadata = {
  title: "Pro",
};

export default function ProPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-widest text-gold">
        medimade Pro
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
        For YouTube channels & serious creators
      </h1>
      <p className="mt-4 text-lg text-muted">
        Lossless WAV downloads, loudness-friendly masters, batch generation, and
        voice cloning seats—built for channels that publish guided content on a
        cadence.
      </p>

      <ul className="mt-10 space-y-4">
        {[
          "WAV (and stem-friendly) exports per session",
          "Channel packs & naming presets",
          "Higher generation caps and priority queue",
          "Voice cloning + brand-locked voice profiles",
        ].map((item) => (
          <li
            key={item}
            className="flex gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"
          >
            <span className="text-gold">✓</span>
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-full bg-gold px-8 py-3 text-sm font-semibold text-deep"
        >
          Upgrade (mock)
        </button>
        <Link
          href="/create"
          className="inline-flex items-center rounded-full border border-border px-8 py-3 text-sm font-medium hover:border-accent/40"
        >
          Back to Create
        </Link>
      </div>
    </div>
  );
}
