/** Ensures only one homepage sample plays at a time (hero + Listen section). */

type Listener = (activeId: string | null) => void;

let activeId: string | null = null;
const listeners = new Set<Listener>();

export function getHomepageActiveAudioId(): string | null {
  return activeId;
}

export function setHomepageActiveAudioId(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  for (const listener of listeners) listener(activeId);
}

export function subscribeHomepageActiveAudio(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
