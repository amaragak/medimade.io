/**
 * Gapless looping for background beds.
 *
 * `HTMLMediaElement.loop` restarts the decode pipeline at the seam, so every
 * cycle has an audible gap. Instead each bed runs two elements that hand over
 * to each other: the idle one is started a few tens of milliseconds before the
 * playing one ends, with an equal-power crossfade across the overlap.
 *
 * Unlike Web Audio buffer looping this keeps beds streaming, so long ambience
 * files start immediately instead of downloading in full.
 */

import { playWithLeadBuffer } from "@/lib/audio-lead-buffer";

/** Overlap at the seam. Long enough to hide scheduler jitter, short enough to stay inaudible. */
const CROSSFADE_SEC = 0.04;

type BedState = {
  url: string | null;
  /** Used when `url` fails to load — e.g. an Opus sibling that isn't backfilled yet. */
  fallbackUrl: string | null;
  volume: number;
  playing: boolean;
};

type Controller = {
  elements: [HTMLAudioElement, HTMLAudioElement];
  activeIndex: 0 | 1;
  state: BedState;
  /** Set once the handover for the current cycle has been started. */
  handingOver: boolean;
  frame: number | null;
  usingFallback: boolean;
  onBlocked: (() => void) | null;
  detach: () => void;
};

const controllers = new WeakMap<HTMLAudioElement, Controller>();

function equalPowerPair(progress: number): { out: number; in: number } {
  const t = Math.min(1, Math.max(0, progress));
  return { out: Math.cos((t * Math.PI) / 2), in: Math.sin((t * Math.PI) / 2) };
}

function createController(primary: HTMLAudioElement): Controller {
  const secondary = document.createElement("audio");
  secondary.preload = "auto";
  secondary.crossOrigin = primary.crossOrigin;
  // Looping is scheduled here, so neither element may loop on its own.
  primary.loop = false;
  secondary.loop = false;
  primary.preload = "auto";

  const controller: Controller = {
    elements: [primary, secondary],
    activeIndex: 0,
    state: { url: null, fallbackUrl: null, volume: 0, playing: false },
    handingOver: false,
    frame: null,
    usingFallback: false,
    onBlocked: null,
    detach: () => {},
  };

  const onError = () => {
    const { fallbackUrl } = controller.state;
    if (!fallbackUrl || controller.usingFallback) return;
    controller.usingFallback = true;
    applySource(controller, fallbackUrl);
    if (controller.state.playing) void startActive(controller);
  };
  primary.addEventListener("error", onError);
  secondary.addEventListener("error", onError);
  controller.detach = () => {
    primary.removeEventListener("error", onError);
    secondary.removeEventListener("error", onError);
  };

  return controller;
}

function active(controller: Controller): HTMLAudioElement {
  return controller.elements[controller.activeIndex];
}

function idle(controller: Controller): HTMLAudioElement {
  return controller.elements[controller.activeIndex === 0 ? 1 : 0];
}

/**
 * Only the playing element gets the source up front. Loading both would have
 * two full downloads of the same file competing for bandwidth, which starves
 * the one actually playing — audible as a dropout seconds into an hour-long
 * composition. The idle element is armed near the seam instead.
 */
function applySource(controller: Controller, url: string): void {
  const el = controller.elements[0];
  if (el.src !== url) {
    el.src = url;
    el.load();
  }
  const other = controller.elements[1];
  if (other.getAttribute("src")) {
    other.pause();
    other.removeAttribute("src");
    other.load();
  }
  controller.activeIndex = 0;
  controller.handingOver = false;
}

/** Lead time for arming the idle element, so its buffer is ready at the seam. */
const PRELOAD_LEAD_SEC = 20;

function armIdleElement(controller: Controller): void {
  const { url } = controller.state;
  if (!url) return;
  const next = idle(controller);
  if (next.src === url) return;
  next.volume = 0;
  next.src = url;
  next.load();
}

function clearSource(controller: Controller): void {
  for (const el of controller.elements) {
    el.pause();
    if (el.getAttribute("src")) {
      el.removeAttribute("src");
      el.load();
    }
  }
  controller.activeIndex = 0;
  controller.handingOver = false;
}

async function startActive(controller: Controller): Promise<void> {
  const el = active(controller);
  el.volume = controller.state.volume;
  idle(controller).volume = 0;
  try {
    await playWithLeadBuffer(el);
  } catch {
    controller.onBlocked?.();
  }
}

function stopFrameLoop(controller: Controller): void {
  if (controller.frame !== null) {
    cancelAnimationFrame(controller.frame);
    controller.frame = null;
  }
}

function runFrameLoop(controller: Controller): void {
  if (controller.frame !== null) return;

  const tick = () => {
    controller.frame = null;
    if (!controller.state.playing || !controller.state.url) return;

    const current = active(controller);
    const next = idle(controller);
    const { volume } = controller.state;
    const duration = current.duration;

    if (Number.isFinite(duration) && duration > CROSSFADE_SEC) {
      const remaining = duration - current.currentTime;

      if (!controller.handingOver && remaining <= PRELOAD_LEAD_SEC) {
        armIdleElement(controller);
      }

      // A seam only sounds gapless if the idle element can start instantly; if
      // it is still buffering, let this cycle end and restart in place.
      if (!controller.handingOver && remaining <= CROSSFADE_SEC && next.readyState < 3) {
        if (remaining <= 0 || current.ended) {
          current.currentTime = 0;
          void current.play().catch(() => {});
        }
      } else if (!controller.handingOver && remaining <= CROSSFADE_SEC) {
        controller.handingOver = true;
        next.currentTime = 0;
        next.volume = 0;
        void next.play().catch(() => {});
      }

      if (controller.handingOver) {
        const progress = 1 - Math.max(0, remaining) / CROSSFADE_SEC;
        const gains = equalPowerPair(progress);
        current.volume = volume * gains.out;
        next.volume = volume * gains.in;

        if (remaining <= 0 || current.ended) {
          current.pause();
          current.currentTime = 0;
          current.volume = 0;
          next.volume = volume;
          controller.activeIndex = controller.activeIndex === 0 ? 1 : 0;
          controller.handingOver = false;
        }
      } else if (current.volume !== volume) {
        current.volume = volume;
      }
    }

    controller.frame = requestAnimationFrame(tick);
  };

  controller.frame = requestAnimationFrame(tick);
}

/**
 * Drive one bed. Safe to call on every render — sources reload only when the
 * URL actually changes.
 */
export function syncGaplessBed(
  el: HTMLAudioElement | null,
  opts: {
    url: string | null;
    fallbackUrl?: string | null;
    volume: number;
    playing: boolean;
    /** Called when the browser rejects playback (autoplay policy). */
    onPlaybackBlocked?: () => void;
  },
): void {
  if (!el) return;
  let controller = controllers.get(el);
  if (!controller) {
    controller = createController(el);
    controllers.set(el, controller);
  }

  const url = opts.url?.trim() ? opts.url.trim() : null;
  const urlChanged = url !== controller.state.url;
  controller.onBlocked = opts.onPlaybackBlocked ?? null;
  controller.state.fallbackUrl = opts.fallbackUrl?.trim() || null;
  controller.state.volume = opts.volume;
  controller.state.playing = opts.playing;

  if (urlChanged) {
    controller.state.url = url;
    controller.usingFallback = false;
    if (url) applySource(controller, url);
    else clearSource(controller);
  }

  if (!url || !opts.playing) {
    stopFrameLoop(controller);
    for (const bed of controller.elements) bed.pause();
    controller.handingOver = false;
    return;
  }

  active(controller).volume = opts.volume;
  if (active(controller).paused) void startActive(controller);
  runFrameLoop(controller);
}

/**
 * Pause a bed without dropping its source, so it can resume where it left off.
 * Use instead of `el.pause()` — a bed owns two elements.
 */
export function pauseGaplessBed(el: HTMLAudioElement | null): void {
  if (!el) return;
  const controller = controllers.get(el);
  if (!controller) {
    el.pause();
    return;
  }
  controller.state.playing = false;
  stopFrameLoop(controller);
  for (const bed of controller.elements) bed.pause();
  controller.handingOver = false;
}

/** Resume a paused bed. Use instead of `el.play()` — a bed owns two elements. */
export async function resumeGaplessBed(el: HTMLAudioElement | null): Promise<void> {
  if (!el) return;
  const controller = controllers.get(el);
  if (!controller) {
    await el.play();
    return;
  }
  if (!controller.state.url) return;
  controller.state.playing = true;
  await startActive(controller);
  runFrameLoop(controller);
}

/**
 * Live volume change without touching the source. The crossfade owns element
 * volume mid-handover, so only the active element is set directly.
 */
export function setGaplessBedVolume(el: HTMLAudioElement | null, volume: number): void {
  if (!el) return;
  const controller = controllers.get(el);
  if (!controller) {
    el.volume = volume;
    return;
  }
  controller.state.volume = volume;
  if (!controller.handingOver) active(controller).volume = volume;
}

/** Stop and release both elements for a bed. Call on unmount. */
export function releaseGaplessBed(el: HTMLAudioElement | null): void {
  if (!el) return;
  const controller = controllers.get(el);
  if (!controller) return;
  stopFrameLoop(controller);
  clearSource(controller);
  controller.detach();
  controllers.delete(el);
}
