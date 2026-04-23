"use client";

import Link from "next/link";
import { useState } from "react";
import {
  getMedimadeApiBase,
  requestMedimadeMagicLink,
} from "@/lib/medimade-api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const base = getMedimadeApiBase();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    setBusy(true);
    try {
      await requestMedimadeMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        We email you a one-time link. No password. Your library and cloud journal are tied to
        this account.
      </p>

      {!base ? (
        <p className="mt-8 rounded-xl border border-border bg-card p-4 text-sm text-muted">
          Set <code className="rounded bg-background px-1 py-0.5">NEXT_PUBLIC_MEDIMADE_API_URL</code>{" "}
          to enable sign-in.
        </p>
      ) : sent ? (
        <p className="mt-8 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
          Check your email for a sign-in link. You can close this tab.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 dark:text-deep"
          >
            {busy ? "Sending…" : "Email me a link"}
          </button>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/" className="text-accent underline-offset-2 hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}
