const LOCAL_ONLY_KEY = "mm_journal_keep_local_only";
const LOCK_KEY = "mm_journal_lock_v1";
const WEBAUTHN_KEY = "mm_journal_webauthn_v1";
const UNLOCK_SESSION_KEY = "mm_journal_unlocked_v1";

export function isJournalLocalOnlyMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOCAL_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setJournalLocalOnlyMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(LOCAL_ONLY_KEY, "1");
    else window.localStorage.removeItem(LOCAL_ONLY_KEY);
  } catch {
    /* */
  }
}

type LockRecord = { salt: string; hash: string };

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data);
  const buf = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readLock(): LockRecord | null {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (typeof r.salt !== "string" || typeof r.hash !== "string") return null;
    return { salt: r.salt, hash: r.hash };
  } catch {
    return null;
  }
}

export function journalLockIsSet(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(readLock());
}

export async function setJournalLockPin(pin: string): Promise<void> {
  const trimmed = pin.trim();
  if (trimmed.length < 4 || trimmed.length > 12) {
    throw new Error("Choose a PIN between 4 and 12 characters.");
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToB64(saltBytes);
  const enc = new TextEncoder();
  const hash = await sha256Hex(
    new Uint8Array([...saltBytes, ...enc.encode(trimmed)]),
  );
  window.localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, hash }));
  window.sessionStorage.setItem(UNLOCK_SESSION_KEY, "1");
}

export async function verifyJournalLockPin(pin: string): Promise<boolean> {
  const rec = readLock();
  if (!rec) return true;
  const saltBytes = b64ToBytes(rec.salt);
  const enc = new TextEncoder();
  const hash = await sha256Hex(
    new Uint8Array([...saltBytes, ...enc.encode(pin.trim())]),
  );
  return hash === rec.hash;
}

export function clearJournalLock(): void {
  try {
    window.localStorage.removeItem(LOCK_KEY);
    window.localStorage.removeItem(WEBAUTHN_KEY);
    window.sessionStorage.removeItem(UNLOCK_SESSION_KEY);
  } catch {
    /* */
  }
}

export function isJournalSessionUnlocked(): boolean {
  if (typeof window === "undefined") return true;
  if (!journalLockIsSet()) return true;
  try {
    return window.sessionStorage.getItem(UNLOCK_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockJournalSession(): void {
  try {
    window.sessionStorage.setItem(UNLOCK_SESSION_KEY, "1");
  } catch {
    /* */
  }
}

export function lockJournalSession(): void {
  try {
    window.sessionStorage.removeItem(UNLOCK_SESSION_KEY);
  } catch {
    /* */
  }
}

function webauthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function"
  );
}

export function journalPlatformUnlockAvailable(): boolean {
  return webauthnSupported();
}

export async function registerJournalPlatformUnlock(): Promise<boolean> {
  if (!webauthnSupported()) return false;
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Journal", id: window.location.hostname },
      user: {
        id: userId,
        name: "journal-lock",
        displayName: "Journal lock",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  const raw = new Uint8Array(cred.rawId);
  window.localStorage.setItem(WEBAUTHN_KEY, bytesToB64(raw));
  unlockJournalSession();
  return true;
}

export function journalPlatformUnlockRegistered(): boolean {
  try {
    return Boolean(window.localStorage.getItem(WEBAUTHN_KEY));
  } catch {
    return false;
  }
}

export async function unlockJournalWithPlatform(): Promise<boolean> {
  if (!webauthnSupported()) return false;
  const stored = window.localStorage.getItem(WEBAUTHN_KEY);
  if (!stored) return false;
  const id = b64ToBytes(stored);
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [
        { type: "public-key", id: new Uint8Array(id) },
      ],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  if (!cred) return false;
  unlockJournalSession();
  return true;
}
