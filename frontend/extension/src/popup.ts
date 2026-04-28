/* eslint-disable @typescript-eslint/no-use-before-define */

type FilterTab = "timer" | "block" | "sounds";

const TAB_KEYS: FilterTab[] = ["timer", "block", "sounds"];

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatMmSs(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${pad2(m)}:${pad2(r)}`;
}

async function storageGet<T extends Record<string, unknown>>(keys: string[]) {
  return (await chrome.storage.local.get(keys)) as T;
}

async function storageSet(obj: Record<string, unknown>) {
  return chrome.storage.local.set(obj);
}

function normalizeDomains(text: string) {
  const lines = (text || "")
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const raw of lines) {
    const d = raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      .trim();
    if (!d) continue;
    if (!/^[a-z0-9.-]+$/i.test(d)) continue;
    out.push(d.toLowerCase());
  }
  return Array.from(new Set(out)).slice(0, 200);
}

// ---------------- Tabs ----------------
function initTabs() {
  const tabButtons = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
  tabButtons.forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.getAttribute("data-tab") as FilterTab | null;
      if (!key || !TAB_KEYS.includes(key)) return;
      setActiveTab(key);
    });
  });
}

function setActiveTab(key: FilterTab) {
  const tabButtons = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
  tabButtons.forEach((b) => {
    const k = b.getAttribute("data-tab");
    const on = k === key;
    b.classList.toggle("isActive", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  const panels = [...document.querySelectorAll<HTMLElement>(".panel")];
  panels.forEach((p) => {
    const k = p.getAttribute("data-panel");
    p.classList.toggle("isHidden", k !== key);
  });
}

// ---------------- Timer ----------------
const timerTimeEl = qs<HTMLElement>("#timerTime");
const timerStartPauseBtn = qs<HTMLButtonElement>("#timerStartPause");
const timerResetBtn = qs<HTMLButtonElement>("#timerReset");
const timerPhasePill = qs<HTMLElement>("#timerPhasePill");
const focusMinInput = qs<HTMLInputElement>("#focusMin");
const breakMinInput = qs<HTMLInputElement>("#breakMin");
const preset255 = qs<HTMLButtonElement>("#preset255");
const preset5010 = qs<HTMLButtonElement>("#preset5010");
const preset9015 = qs<HTMLButtonElement>("#preset9015");

let timerPoll: number | null = null;

type TimerState = {
  running: boolean;
  phase: "focus" | "break";
  endAt: number | null;
  remainingSec: number | null;
};

type TimerToggleResponse = { timer: TimerState; remainingSec: number };

async function loadTimerUi() {
  const s = await storageGet<{ timer?: TimerState; timerSettings?: { focusMin?: number; breakMin?: number } }>([
    "timer",
    "timerSettings",
  ]);
  const settings = s.timerSettings || { focusMin: 25, breakMin: 5 };
  focusMinInput.value = String(settings.focusMin ?? 25);
  breakMinInput.value = String(settings.breakMin ?? 5);

  const t: TimerState =
    s.timer || {
      running: false,
      phase: "focus",
      endAt: null,
      remainingSec: (settings.focusMin ?? 25) * 60,
    };
  const remaining = (await chrome.runtime.sendMessage({
    type: "TIMER_GET_REMAINING",
  })) as { remainingSec: number };
  renderTimer(
    t,
    remaining?.remainingSec ?? t.remainingSec ?? (settings.focusMin ?? 25) * 60,
  );
}

function renderTimer(timerState: TimerState, remainingSec: number) {
  timerTimeEl.textContent = formatMmSs(remainingSec);
  const phase = timerState?.phase === "break" ? "Break" : "Focus";
  timerPhasePill.textContent = phase;
  timerStartPauseBtn.textContent = timerState?.running ? "Pause" : "Start";
}

async function saveTimerSettings() {
  const focusMin = clamp(parseInt(focusMinInput.value || "25", 10), 1, 180);
  const breakMin = clamp(parseInt(breakMinInput.value || "5", 10), 1, 60);
  focusMinInput.value = String(focusMin);
  breakMinInput.value = String(breakMin);
  await storageSet({ timerSettings: { focusMin, breakMin } });
  chrome.runtime.sendMessage({ type: "TIMER_SETTINGS_UPDATED" }).catch(() => {});
}

function initTimer() {
  focusMinInput.addEventListener("change", () => void saveTimerSettings());
  breakMinInput.addEventListener("change", () => void saveTimerSettings());

  preset255.addEventListener("click", async () => {
    focusMinInput.value = "25";
    breakMinInput.value = "5";
    await saveTimerSettings();
  });
  preset5010.addEventListener("click", async () => {
    focusMinInput.value = "50";
    breakMinInput.value = "10";
    await saveTimerSettings();
  });
  preset9015.addEventListener("click", async () => {
    focusMinInput.value = "90";
    breakMinInput.value = "15";
    await saveTimerSettings();
  });

  timerStartPauseBtn.addEventListener("click", async () => {
    const resp = (await chrome.runtime.sendMessage({
      type: "TIMER_TOGGLE",
    })) as TimerToggleResponse;
    renderTimer(resp.timer, resp.remainingSec);
  });
  timerResetBtn.addEventListener("click", async () => {
    const resp = (await chrome.runtime.sendMessage({
      type: "TIMER_RESET",
    })) as TimerToggleResponse;
    renderTimer(resp.timer, resp.remainingSec);
  });

  if (timerPoll) window.clearInterval(timerPoll);
  timerPoll = window.setInterval(async () => {
    const s = await storageGet<{ timer?: TimerState }>(["timer"]);
    const r = (await chrome.runtime.sendMessage({
      type: "TIMER_GET_REMAINING",
    })) as { remainingSec: number };
    if (s.timer) renderTimer(s.timer, r.remainingSec);
  }, 1000);
}

// ---------------- Blocker ----------------
const blockEnabled = qs<HTMLInputElement>("#blockEnabled");
const blockList = qs<HTMLTextAreaElement>("#blockList");
const blockSave = qs<HTMLButtonElement>("#blockSave");
const blockApplyNow = qs<HTMLButtonElement>("#blockApplyNow");
const blockStatus = qs<HTMLElement>("#blockStatus");

type BlockerState = { enabled: boolean; domains: string[] };

async function loadBlockerUi() {
  const s = await storageGet<{ blocker?: BlockerState }>(["blocker"]);
  const b = s.blocker || { enabled: false, domains: [] };
  blockEnabled.checked = Boolean(b.enabled);
  blockList.value = (b.domains || []).join("\n");
  blockStatus.textContent = "";
}

async function saveBlockerUi() {
  const domains = normalizeDomains(blockList.value);
  blockList.value = domains.join("\n");
  const next: BlockerState = { enabled: Boolean(blockEnabled.checked), domains };
  await storageSet({ blocker: next });
  blockStatus.textContent = "Saved.";
  return next;
}

function initBlocker() {
  blockEnabled.addEventListener("change", async () => {
    const next = await saveBlockerUi();
    await chrome.runtime.sendMessage({ type: "BLOCKER_APPLY", blocker: next });
    blockStatus.textContent = next.enabled ? "Blocking is on." : "Blocking is off.";
  });
  blockSave.addEventListener("click", async () => {
    await saveBlockerUi();
    blockStatus.textContent = "Saved. Click “Apply now” to update rules.";
  });
  blockApplyNow.addEventListener("click", async () => {
    const next = await saveBlockerUi();
    const resp = (await chrome.runtime.sendMessage({
      type: "BLOCKER_APPLY",
      blocker: next,
    })) as { ok?: boolean };
    blockStatus.textContent = resp?.ok ? "Applied." : "Could not apply rules.";
  });
}

// ---------------- Sounds ----------------
const soundsStopAll = qs<HTMLButtonElement>("#soundsStopAll");
const soundsStatus = qs<HTMLElement>("#soundsStatus");
const soundsFootnote = qs<HTMLElement>("#soundsFootnote");

const selNature = qs<HTMLSelectElement>("#selNature");
const selMusic = qs<HTMLSelectElement>("#selMusic");
const selNoise = qs<HTMLSelectElement>("#selNoise");
const volNature = qs<HTMLInputElement>("#volNature");
const volMusic = qs<HTMLInputElement>("#volMusic");
const volNoise = qs<HTMLInputElement>("#volNoise");
const toggleNature = qs<HTMLButtonElement>("#toggleNature");
const toggleMusic = qs<HTMLButtonElement>("#toggleMusic");
const toggleNoise = qs<HTMLButtonElement>("#toggleNoise");

const audio = {
  nature: new Audio(),
  music: new Audio(),
  noise: new Audio(),
} as const;
audio.nature.loop = true;
audio.music.loop = true;
audio.noise.loop = true;

function setVol() {
  audio.nature.volume = clamp(parseInt(volNature.value, 10) / 100, 0, 1);
  audio.music.volume = clamp(parseInt(volMusic.value, 10) / 100, 0, 1);
  audio.noise.volume = clamp(parseInt(volNoise.value, 10) / 100, 0, 1);
}

function setToggleIcon(btn: HTMLButtonElement, isPlaying: boolean) {
  const icon = btn.querySelector<HTMLElement>(".icon");
  if (!icon) return;
  icon.textContent = isPlaying ? "❚❚" : "▶";
  icon.setAttribute("data-icon", isPlaying ? "pause" : "play");
}

function anyPlaying() {
  return !audio.nature.paused || !audio.music.paused || !audio.noise.paused;
}

function updateAllToggleButton() {
  const playing = anyPlaying();
  soundsStopAll.textContent = playing ? "Pause all" : "Play all";
  soundsStopAll.setAttribute("aria-label", playing ? "Pause all" : "Play all");
}

async function playAllSelected() {
  const tasks: Promise<unknown>[] = [];
  if (selNature.value) {
    if (audio.nature.src !== selNature.value) audio.nature.src = selNature.value;
    tasks.push(audio.nature.play().catch(() => {}));
  }
  if (selMusic.value) {
    if (audio.music.src !== selMusic.value) audio.music.src = selMusic.value;
    tasks.push(audio.music.play().catch(() => {}));
  }
  if (selNoise.value) {
    if (audio.noise.src !== selNoise.value) audio.noise.src = selNoise.value;
    tasks.push(audio.noise.play().catch(() => {}));
  }
  await Promise.all(tasks);
  updateAllToggleButton();
}

function pauseAll() {
  audio.nature.pause();
  audio.music.pause();
  audio.noise.pause();
  updateAllToggleButton();
}

async function toggleTrack(
  kind: keyof typeof audio,
  selectEl: HTMLSelectElement,
  buttonEl: HTMLButtonElement,
) {
  const a = audio[kind];
  const src = selectEl.value;
  if (!src) return;
  if (a.src !== src) a.src = src;
  if (a.paused) await a.play().catch(() => {});
  else a.pause();
  setToggleIcon(buttonEl, !a.paused);
  updateAllToggleButton();
}

function optionize(select: HTMLSelectElement, items: { label: string; path: string }[]) {
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = items.length ? "Select…" : "No files found";
  select.appendChild(empty);
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it.path;
    opt.textContent = it.label;
    select.appendChild(opt);
  }
}

function normalizeApiBase(raw: unknown) {
  const t = String(raw || "").trim();
  if (!t) return "";
  return t.endsWith("/") ? t.slice(0, -1) : t;
}

function backgroundAudioStreamingKey(key: unknown) {
  const k = String(key || "").trim();
  if (!k) return k;
  const lower = k.toLowerCase();
  if (!lower.startsWith("background-audio/") || !lower.endsWith(".wav")) return k;
  return `${k.slice(0, -4)}.mp3`;
}

async function loadRemoteSounds(apiBase: string) {
  const base = normalizeApiBase(apiBase);
  if (!base) return null;
  const res = await fetch(`${base}/media/background-audio`);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || res.statusText || "Could not load sounds");
  }
  const baseUrl = typeof data.baseUrl === "string" ? data.baseUrl.trim() : "";
  if (!baseUrl) throw new Error("No baseUrl returned for background audio");
  const join = (u: string, k: string) => `${u.replace(/\/+$/, "")}/${k.replace(/^\/+/, "")}`;
  const map = (arr: unknown[]) =>
    (Array.isArray(arr) ? arr : []).map((it: any) => ({
      label: String((it?.name || it?.key || "Untitled") ?? "Untitled").trim(),
      path: join(baseUrl, backgroundAudioStreamingKey(it?.key || "")),
    })).filter((x) => x.path && x.label);
  return {
    nature: map(data.nature),
    music: map(data.music),
    noise: map(data.noise),
  };
}

async function loadLocalSoundsIndex() {
  const url = chrome.runtime.getURL("assets/bg-audio/sounds.json");
  const res = await fetch(url);
  if (!res.ok) return { nature: [], music: [], noise: [] };
  const j = (await res.json().catch(() => ({}))) as any;
  const mk = (arr: unknown[], folder: string) =>
    (Array.isArray(arr) ? arr : [])
      .map((x: any) => {
        const file = typeof x === "string" ? x : x?.file;
        const label = (typeof x === "object" && x?.label) || file || "Untitled";
        return {
          label,
          path: chrome.runtime.getURL(`assets/bg-audio/${folder}/${file}`),
        };
      })
      .filter(
        (x) =>
          x.path &&
          !x.path.endsWith("/undefined") &&
          !x.path.endsWith("/") &&
          x.label,
      );
  return { nature: mk(j.nature, "nature"), music: mk(j.music, "music"), noise: mk(j.noise, "noise") };
}

let soundsWired = false;

async function initSounds() {
  const envBase = normalizeApiBase(import.meta.env.VITE_MEDIMADE_API_URL || "");
  const apiBase = envBase;
  soundsStatus.textContent = "";
  soundsFootnote.textContent =
    "Sounds load from the Consciously backend configured for this build.";

  let idx: { nature: any[]; music: any[]; noise: any[] } | null = null;
  if (apiBase) {
    try {
      soundsStatus.textContent = "Loading sounds…";
      idx = await loadRemoteSounds(apiBase);
      soundsStatus.textContent = "Loaded from backend.";
    } catch (e) {
      soundsStatus.textContent =
        e instanceof Error ? `Backend error: ${e.message}` : "Backend error.";
      idx = null;
    }
  }
  if (!idx) {
    idx = await loadLocalSoundsIndex();
    soundsStatus.textContent = apiBase
      ? "Could not load backend sounds."
      : "Backend sounds are not configured for this build.";
    soundsFootnote.textContent =
      "No backend sounds available. (Dev fallback can use bundled local audio.)";
  }

  optionize(selNature, idx.nature);
  optionize(selMusic, idx.music);
  optionize(selNoise, idx.noise);

  if (!soundsWired) {
    soundsWired = true;
    volNature.addEventListener("input", setVol);
    volMusic.addEventListener("input", setVol);
    volNoise.addEventListener("input", setVol);
    setVol();

    setToggleIcon(toggleNature, false);
    setToggleIcon(toggleMusic, false);
    setToggleIcon(toggleNoise, false);
    updateAllToggleButton();

    toggleNature.addEventListener("click", () =>
      void toggleTrack("nature", selNature, toggleNature),
    );
    toggleMusic.addEventListener("click", () =>
      void toggleTrack("music", selMusic, toggleMusic),
    );
    toggleNoise.addEventListener("click", () =>
      void toggleTrack("noise", selNoise, toggleNoise),
    );

    audio.nature.addEventListener("play", () => {
      setToggleIcon(toggleNature, true);
      updateAllToggleButton();
    });
    audio.nature.addEventListener("pause", () => {
      setToggleIcon(toggleNature, false);
      updateAllToggleButton();
    });
    audio.music.addEventListener("play", () => {
      setToggleIcon(toggleMusic, true);
      updateAllToggleButton();
    });
    audio.music.addEventListener("pause", () => {
      setToggleIcon(toggleMusic, false);
      updateAllToggleButton();
    });
    audio.noise.addEventListener("play", () => {
      setToggleIcon(toggleNoise, true);
      updateAllToggleButton();
    });
    audio.noise.addEventListener("pause", () => {
      setToggleIcon(toggleNoise, false);
      updateAllToggleButton();
    });

    soundsStopAll.addEventListener("click", () => {
      if (anyPlaying()) pauseAll();
      else void playAllSelected();
    });

    selNature.addEventListener("change", updateAllToggleButton);
    selMusic.addEventListener("change", updateAllToggleButton);
    selNoise.addEventListener("change", updateAllToggleButton);
  }

  updateAllToggleButton();
}

// ---------------- Boot ----------------
async function boot() {
  initTabs();
  initTimer();
  initBlocker();
  await loadTimerUi();
  await loadBlockerUi();
  await initSounds();
}

boot().catch((e) => {
  console.error(e);
});

