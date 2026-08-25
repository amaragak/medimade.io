/**
 * Tracks App Router soft navigations. Module state resets on full document
 * load (refresh / typed URL), so homepage effects can run only on hard entry.
 */

let spaPathHasChanged = false;

export function markSpaClientNavigation(): void {
  spaPathHasChanged = true;
}

/** True when this document load has not yet soft-navigated between routes. */
export function isHardDocumentEntry(): boolean {
  return !spaPathHasChanged;
}
