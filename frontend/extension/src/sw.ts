type TimerSettings = { focusMin: number; breakMin: number };
type TimerState = {
  running: boolean;
  phase: "focus" | "break";
  endAt: number | null;
  remainingSec: number | null;
};
type BlockerState = { enabled: boolean; domains: string[] };

const STORAGE_KEYS = {
  TIMER: "timer",
  TIMER_SETTINGS: "timerSettings",
  BLOCKER: "blocker",
} as const;

const TIMER_ALARM = "mm_pomodoro_tick_v1";
const RULESET_ID_BASE = 9000;

function nowMs() {
  return Date.now();
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

async function getStore<T extends Record<string, unknown>>(keys: string[]) {
  return (await chrome.storage.local.get(keys)) as T;
}
async function setStore(obj: Record<string, unknown>) {
  return chrome.storage.local.set(obj);
}

async function getTimerSettings(): Promise<TimerSettings> {
  const s = await getStore<{ timerSettings?: Partial<TimerSettings> }>([
    STORAGE_KEYS.TIMER_SETTINGS,
  ]);
  const t = s[STORAGE_KEYS.TIMER_SETTINGS] || {};
  const focusMin = clamp(parseInt(String(t.focusMin ?? 25), 10) || 25, 1, 180);
  const breakMin = clamp(parseInt(String(t.breakMin ?? 5), 10) || 5, 1, 60);
  return { focusMin, breakMin };
}

async function getTimerState(): Promise<TimerState> {
  const s = await getStore<{ timer?: TimerState }>([STORAGE_KEYS.TIMER]);
  return (
    s[STORAGE_KEYS.TIMER] || {
      running: false,
      phase: "focus",
      endAt: null,
      remainingSec: null,
    }
  );
}

function computeRemaining(timer: TimerState, settings: TimerSettings) {
  if (!timer.running || !timer.endAt) {
    const base =
      timer.phase === "break" ? settings.breakMin * 60 : settings.focusMin * 60;
    const raw = timer.remainingSec ?? base;
    return clamp(parseInt(String(raw), 10) || base, 0, 24 * 3600);
  }
  const rem = Math.ceil((timer.endAt - nowMs()) / 1000);
  return clamp(rem, 0, 24 * 3600);
}

async function ensureAlarm() {
  const a = await chrome.alarms.get(TIMER_ALARM);
  if (a) return;
  chrome.alarms.create(TIMER_ALARM, { periodInMinutes: 1 / 60 });
}

async function clearAlarm() {
  await chrome.alarms.clear(TIMER_ALARM);
}

async function notify(title: string, message: string) {
  try {
    await chrome.notifications.create({
      type: "basic",
      title,
      message,
    });
  } catch {
    /* ignore */
  }
}

async function switchPhase(timer: TimerState, settings: TimerSettings) {
  const nextPhase: TimerState["phase"] =
    timer.phase === "break" ? "focus" : "break";
  const durSec =
    nextPhase === "break" ? settings.breakMin * 60 : settings.focusMin * 60;
  const next: TimerState = {
    running: true,
    phase: nextPhase,
    endAt: nowMs() + durSec * 1000,
    remainingSec: durSec,
  };
  await setStore({ [STORAGE_KEYS.TIMER]: next });
  await notify(
    nextPhase === "break" ? "Break" : "Focus",
    nextPhase === "break"
      ? "Take a short break. Let your mind exhale."
      : "Back to focus. One small step at a time.",
  );
  return next;
}

async function timerToggle() {
  const settings = await getTimerSettings();
  const timer = await getTimerState();
  const remainingSec = computeRemaining(timer, settings);

  if (timer.running) {
    const paused: TimerState = {
      ...timer,
      running: false,
      endAt: null,
      remainingSec,
    };
    await setStore({ [STORAGE_KEYS.TIMER]: paused });
    await clearAlarm();
    return { timer: paused, remainingSec };
  }

  const baseSec =
    timer.phase === "break" ? settings.breakMin * 60 : settings.focusMin * 60;
  const nextRemaining =
    remainingSec != null ? remainingSec : clamp(baseSec, 1, 24 * 3600);
  const next: TimerState = {
    ...timer,
    running: true,
    endAt: nowMs() + nextRemaining * 1000,
    remainingSec: nextRemaining,
  };
  await setStore({ [STORAGE_KEYS.TIMER]: next });
  await ensureAlarm();
  return { timer: next, remainingSec: nextRemaining };
}

async function timerReset() {
  const settings = await getTimerSettings();
  const next: TimerState = {
    running: false,
    phase: "focus",
    endAt: null,
    remainingSec: settings.focusMin * 60,
  };
  await setStore({ [STORAGE_KEYS.TIMER]: next });
  await clearAlarm();
  return { timer: next, remainingSec: next.remainingSec ?? settings.focusMin * 60 };
}

async function timerGetRemaining() {
  const settings = await getTimerSettings();
  const timer = await getTimerState();
  const remainingSec = computeRemaining(timer, settings);
  return { remainingSec };
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM) return;
  const settings = await getTimerSettings();
  const timer = await getTimerState();
  if (!timer.running) return;
  const remainingSec = computeRemaining(timer, settings);
  if (remainingSec > 0) return;
  await switchPhase(timer, settings);
});

// ---------------- Blocker (DNR) ----------------
function domainToRule(i: number, domain: string) {
  const id = RULESET_ID_BASE + i;
  const redirectUrl = chrome.runtime.getURL("blocked.html");
  return {
    id,
    priority: 1,
    action: { type: "redirect" as const, redirect: { url: redirectUrl } },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ["main_frame"] as const,
    },
  };
}

async function applyBlocker(blocker: BlockerState) {
  const enabled = Boolean(blocker?.enabled);
  const domains = Array.isArray(blocker?.domains) ? blocker.domains : [];
  const norm = domains
    .map((d) => String(d || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((d) => /^[a-z0-9.-]+$/i.test(d))
    .slice(0, 200);

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .map((r) => r.id)
    .filter((id) => id >= RULESET_ID_BASE && id < RULESET_ID_BASE + 300);

  const addRules = enabled ? norm.map((d, i) => domainToRule(i, d)) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
  await setStore({ [STORAGE_KEYS.BLOCKER]: { enabled, domains: norm } });
  return { ok: true, count: addRules.length };
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  void (async () => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "OPEN_POPUP") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "TIMER_TOGGLE") {
      sendResponse(await timerToggle());
      return;
    }
    if (msg.type === "TIMER_RESET") {
      sendResponse(await timerReset());
      return;
    }
    if (msg.type === "TIMER_GET_REMAINING") {
      sendResponse(await timerGetRemaining());
      return;
    }
    if (msg.type === "TIMER_SETTINGS_UPDATED") {
      const settings = await getTimerSettings();
      const timer = await getTimerState();
      if (!timer.running) {
        const next: TimerState = {
          ...timer,
          phase: timer.phase === "break" ? "break" : "focus",
          remainingSec:
            timer.phase === "break"
              ? settings.breakMin * 60
              : settings.focusMin * 60,
        };
        await setStore({ [STORAGE_KEYS.TIMER]: next });
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "BLOCKER_APPLY") {
      sendResponse(await applyBlocker(msg.blocker as BlockerState));
      return;
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const settings = await getTimerSettings();
    const s = await getStore<{ timer?: TimerState; blocker?: BlockerState }>([
      STORAGE_KEYS.TIMER,
      STORAGE_KEYS.BLOCKER,
    ]);
    if (!s[STORAGE_KEYS.TIMER]) {
      await setStore({
        [STORAGE_KEYS.TIMER]: {
          running: false,
          phase: "focus",
          endAt: null,
          remainingSec: settings.focusMin * 60,
        },
      });
    }
    const blocker = s[STORAGE_KEYS.BLOCKER];
    if (blocker) await applyBlocker(blocker);
  })();
});

