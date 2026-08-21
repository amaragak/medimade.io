"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

const ADMIN_PASSWORD = "ajm93";
const STORAGE_KEY = "mm_admin_unlocked";

export function AdminPasswordGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    setUnlocked(localStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      localStorage.setItem(STORAGE_KEY, "1");
      setUnlocked(true);
      setError(false);
      return;
    }
    setError(true);
  }

  if (!ready) return null;
  if (unlocked) return children;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-overlay/45 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg"
      >
        <h1 className="font-display text-xl font-medium tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">Enter the password to continue.</p>
        <label className="mt-4 block text-sm font-medium" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {error ? (
          <p className="mt-2 text-sm text-danger">Wrong password.</p>
        ) : null}
        <button
          type="submit"
          className="accent-fill-gradient mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
