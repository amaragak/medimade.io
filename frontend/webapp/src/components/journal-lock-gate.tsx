"use client";

import { useState } from "react";
import {
  clearJournalLock,
  isJournalSessionUnlocked,
  journalLockIsSet,
  journalPlatformUnlockRegistered,
  setJournalLockPin,
  unlockJournalSession,
  unlockJournalWithPlatform,
  verifyJournalLockPin,
} from "@/lib/journal-prefs";

type Props = {
  children: React.ReactNode;
};

export function JournalLockGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(() => isJournalSessionUnlocked());
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lockOn = journalLockIsSet();

  if (!lockOn || unlocked) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyJournalLockPin(pin);
      if (!ok) {
        setError("That PIN doesn’t match.");
        return;
      }
      unlockJournalSession();
      setUnlocked(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <h1 className="font-display text-2xl font-medium tracking-tight">
        Journal is locked
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your PIN, or use this device’s lock if you set that up.
      </p>
      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <span className="sr-only">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(ev) => setPin(ev.target.value)}
            placeholder="PIN"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-accent/50"
          />
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          Unlock
        </button>
      </form>
      {journalPlatformUnlockRegistered() ? (
        <button
          type="button"
          className="mt-3 cursor-pointer text-sm font-medium text-accent-link underline-offset-2 hover:underline"
          onClick={() => {
            void unlockJournalWithPlatform()
              .then((ok) => {
                if (ok) setUnlocked(true);
                else setError("Device unlock didn’t complete.");
              })
              .catch(() => setError("Device unlock didn’t complete."));
          }}
        >
          Unlock with this device
        </button>
      ) : null}
    </div>
  );
}

/** Compact enable/disable for a PIN that locks the journal in this browser. */
export function JournalPinLockCheckbox() {
  const [hasLock, setHasLock] = useState(() => journalLockIsSet());
  const [choosingPin, setChoosingPin] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground">
        <input
          type="checkbox"
          checked={hasLock || choosingPin}
          onChange={(ev) => {
            const on = ev.target.checked;
            setError(null);
            if (!on) {
              clearJournalLock();
              setHasLock(false);
              setChoosingPin(false);
              setPin("");
              return;
            }
            setChoosingPin(true);
          }}
          className="mt-0.5 h-4 w-4 accent-[var(--selected)]"
        />
        <span>
          Lock journal
          <span className="mt-0.5 block text-xs font-normal text-muted">
            Require a PIN to open it in this browser.
          </span>
        </span>
      </label>
      {choosingPin && !hasLock ? (
        <form
          className="ml-[1.625rem] mt-2 flex items-center gap-1.5"
          onSubmit={(ev) => {
            ev.preventDefault();
            void setJournalLockPin(pin)
              .then(() => {
                setHasLock(true);
                setChoosingPin(false);
                setPin("");
                setError(null);
              })
              .catch((e) =>
                setError(e instanceof Error ? e.message : "Could not set PIN"),
              );
          }}
        >
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(ev) => setPin(ev.target.value)}
            placeholder="PIN"
            aria-label="PIN"
            className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-on-accent"
          >
            Set
          </button>
        </form>
      ) : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}