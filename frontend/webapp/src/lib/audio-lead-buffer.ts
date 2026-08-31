/**
 * Hour-long compositions are 50–80 MB, and a cold CloudFront edge answers the
 * first byte-range in over a second. The element happily starts on the handful
 * of bytes it already has, drains them, and stalls — heard as "plays briefly,
 * cuts out, then runs fine". Waiting for a few seconds of contiguous buffer
 * ahead of the playhead removes that first dropout; the cache is warm by then,
 * so later ranges arrive faster than playback consumes them.
 */

const DEFAULT_LEAD_SEC = 4;
/** Never hold playback longer than this, even on a slow connection. */
const DEFAULT_TIMEOUT_MS = 6000;

/** Seconds of continuously buffered audio ahead of the current position. */
export function bufferedAheadSec(el: HTMLAudioElement): number {
  const t = el.currentTime;
  for (let i = 0; i < el.buffered.length; i += 1) {
    if (el.buffered.start(i) <= t + 0.25 && el.buffered.end(i) > t) {
      return el.buffered.end(i) - t;
    }
  }
  return 0;
}

/**
 * Resolves once there is `leadSec` buffered ahead, the file is fully buffered,
 * or the timeout expires. Never rejects: a slow network should still play.
 */
export function waitForLeadBuffer(
  el: HTMLAudioElement,
  { leadSec = DEFAULT_LEAD_SEC, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
): Promise<void> {
  if (bufferedAheadSec(el) >= leadSec || el.readyState >= 4) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      el.removeEventListener("progress", check);
      el.removeEventListener("canplaythrough", finish);
      el.removeEventListener("error", finish);
      resolve();
    };
    const check = () => {
      const remaining = Number.isFinite(el.duration) ? el.duration - el.currentTime : Infinity;
      if (bufferedAheadSec(el) >= Math.min(leadSec, remaining)) finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    el.addEventListener("progress", check);
    el.addEventListener("canplaythrough", finish);
    el.addEventListener("error", finish);
    // Buffering only starts once the element is told to load.
    if (el.preload === "none") el.preload = "auto";
    if (el.readyState === 0) el.load();
    check();
  });
}

/**
 * Starts playback once a lead buffer exists. Swallows `AbortError`, which is
 * the normal result of pausing or re-seeking while the play promise is pending.
 */
export async function playWithLeadBuffer(
  el: HTMLAudioElement,
  opts?: { leadSec?: number; timeoutMs?: number },
): Promise<void> {
  await waitForLeadBuffer(el, opts);
  try {
    await el.play();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
}
