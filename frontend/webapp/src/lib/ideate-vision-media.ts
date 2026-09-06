/**
 * High-res vision-board media (self-reference + generated tiles) in IndexedDB.
 * localStorage is only for metadata — not binary.
 */

const DB_NAME = "mm_ideate_vision_media_v1";
const STORE = "blobs";

export type VisionMediaRecord = {
  id: string;
  mimeType: string;
  bytes: ArrayBuffer;
  updatedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function putVisionMedia(rec: VisionMediaRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
  });
  db.close();
}

export async function getVisionMedia(
  id: string,
): Promise<VisionMediaRecord | null> {
  const db = await openDb();
  const row = await new Promise<VisionMediaRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () =>
      resolve((req.result as VisionMediaRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
  });
  db.close();
  return row;
}

export async function deleteVisionMedia(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
  db.close();
}

export function visionMediaToObjectUrl(rec: VisionMediaRecord): string {
  const blob = new Blob([rec.bytes], { type: rec.mimeType });
  return URL.createObjectURL(blob);
}

export async function visionMediaToBase64(
  rec: VisionMediaRecord,
): Promise<string> {
  const bytes = new Uint8Array(rec.bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Downscale for API payloads (API Gateway ~10MB). Keeps aspect ratio. */
export async function resizeImageFileForApi(
  file: Blob,
  maxEdge = 1536,
  quality = 0.9,
): Promise<{ blob: Blob; mimeType: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not prepare image");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mimeType = "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
      mimeType,
      quality,
    );
  });
  return { blob, mimeType, width, height };
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export function newVisionMediaId(prefix = "vm"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
