export const metadata = {
  title: "Schedule",
};

const slots = [
  { time: "Tomorrow · 7:00 AM", label: "Morning manifestation · 15 min", on: true },
  { time: "Tomorrow · 9:30 PM", label: "Wind-down body scan · 10 min", on: false },
];

export default function SchedulePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">
        Scheduler
      </h1>
      <p className="mt-2 text-muted">
        Pre-make meditations for the next day so they’re generated and waiting—
        pick template, voice, and intention ahead of time.
      </p>

      <ul className="mt-10 space-y-4">
        {slots.map((s) => (
          <li
            key={s.time}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{s.time}</p>
              <p className="text-sm text-muted">{s.label}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" defaultChecked={s.on} />
              Enabled
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="mt-6 w-full rounded-2xl border border-dashed border-border py-4 text-sm font-medium text-muted hover:border-accent/40 hover:text-foreground"
      >
        + Schedule slot (mock)
      </button>
    </div>
  );
}
