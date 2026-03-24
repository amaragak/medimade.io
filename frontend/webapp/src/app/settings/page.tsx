export const metadata = {
  title: "API",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">
        API & integrations
      </h1>
      <p className="mt-2 text-muted">
        Programmatic generation, webhooks, and tier limits—wire your own clients
        or automations.
      </p>

      <section className="mt-10 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">API key</h2>
        <p className="mt-1 text-xs text-muted">
          Keys are scoped by environment; rotate from the console when shipped.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            readOnly
            value="mm_live_••••••••••••••••"
            className="min-w-[200px] flex-1 rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            className="rounded-xl border border-border px-4 py-2 text-sm hover:border-accent/40"
          >
            Reveal (mock)
          </button>
          <button
            type="button"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white dark:text-deep"
          >
            Create key
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Docs</h2>
        <p className="mt-2 text-sm text-muted">
          OpenAPI schema, rate limits by generation tier, and example requests
          for sound, voice, and marker payloads will live here.
        </p>
        <button
          type="button"
          className="mt-4 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          View API reference (placeholder)
        </button>
      </section>
    </div>
  );
}
