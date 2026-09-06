"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadIdeateVisionBoardStore,
  pickVisionSwatchColor,
  removeVisionBoardItem,
  saveIdeateVisionBoardStore,
  upsertVisionBoardItem,
  type VisionBoardItem,
  type VisionSelfReference,
} from "@/lib/ideate-vision-board";
import {
  blobToArrayBuffer,
  deleteVisionMedia,
  getVisionMedia,
  newVisionMediaId,
  putVisionMedia,
  resizeImageFileForApi,
  visionMediaToBase64,
  visionMediaToObjectUrl,
} from "@/lib/ideate-vision-media";
import { flushIdeateCloudNow } from "@/lib/ideate-cloud";
import {
  generateVisionBoardScene,
  getMedimadeApiBase,
  uploadIdeateVisionMedia,
} from "@/lib/medimade-api";
import { useIdeateCloud } from "@/components/plan/ideate-cloud-provider";

const SECTION_LABEL =
  "text-sm font-medium uppercase tracking-widest text-[#8A7566]";

function newTileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tile_${crypto.randomUUID()}`;
  }
  return `tile_${Date.now().toString(16)}`;
}

/**
 * Vision board — same content shell as My Ideas (`max-w-6xl`).
 * Signed-in: S3 + Ideate cloud store only (no IndexedDB).
 * Guests: device IndexedDB only.
 */
export function IdeateVisionBoardClient() {
  const [items, setItems] = useState<VisionBoardItem[]>([]);
  const [selfRef, setSelfRef] = useState<VisionSelfReference | null>(null);
  const [selfPreviewUrl, setSelfPreviewUrl] = useState<string | null>(null);
  const [tileUrls, setTileUrls] = useState<Record<string, string>>({});
  const [scenePrompt, setScenePrompt] = useState("");
  const [busy, setBusy] = useState<"ref" | "gen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const tileUrlsRef = useRef<Record<string, string>>({});
  const { ready: cloudReady, signedIn, revision } = useIdeateCloud();

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
    setSelfPreviewUrl(null);
  }, []);

  const refresh = useCallback(async () => {
    const store = loadIdeateVisionBoardStore();
    setItems(store.items);
    setSelfRef(store.selfReference ?? null);

    revokePreview();
    if (signedIn) {
      // Cloud-first: only CloudFront URLs. Ignore orphan IndexedDB mediaIds.
      if (store.selfReference?.url) {
        setSelfPreviewUrl(store.selfReference.url);
      }
      const nextTiles: Record<string, string> = {};
      for (const item of store.items) {
        if (item.imageUrl) nextTiles[item.id] = item.imageUrl;
      }
      tileUrlsRef.current = nextTiles;
      setTileUrls(nextTiles);
    } else {
      if (store.selfReference?.url) {
        setSelfPreviewUrl(store.selfReference.url);
      } else if (store.selfReference?.mediaId) {
        const rec = await getVisionMedia(store.selfReference.mediaId);
        if (rec) {
          const url = visionMediaToObjectUrl(rec);
          previewUrlRef.current = url;
          setSelfPreviewUrl(url);
        }
      }

      const nextTiles: Record<string, string> = {};
      for (const item of store.items) {
        if (item.imageUrl) {
          nextTiles[item.id] = item.imageUrl;
          continue;
        }
        if (!item.mediaId) continue;
        const rec = await getVisionMedia(item.mediaId);
        if (!rec) continue;
        nextTiles[item.id] = visionMediaToObjectUrl(rec);
      }
      for (const u of Object.values(tileUrlsRef.current)) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      tileUrlsRef.current = nextTiles;
      setTileUrls(nextTiles);
    }
    setHydrated(true);
  }, [revokePreview, signedIn]);

  useEffect(() => {
    if (!cloudReady) return;
    const id = requestAnimationFrame(() => {
      void refresh();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [refresh, cloudReady, revision]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      for (const u of Object.values(tileUrlsRef.current)) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
    };
  }, []);

  const persistBoard = useCallback(
    async (store: ReturnType<typeof loadIdeateVisionBoardStore>) => {
      saveIdeateVisionBoardStore(store);
      if (signedIn) {
        await flushIdeateCloudNow();
      }
    },
    [signedIn],
  );

  const onPickReference = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      setBusy("ref");
      try {
        if (!file.type.startsWith("image/")) {
          throw new Error("Choose a photo (JPEG, PNG, or HEIC).");
        }
        if (signedIn && !getMedimadeApiBase()) {
          throw new Error("API URL is not configured.");
        }

        const probe = await createImageBitmap(file);
        const width = probe.width;
        const height = probe.height;
        probe.close();

        const prev = loadIdeateVisionBoardStore().selfReference;

        if (signedIn) {
          // Cloud is the only store: upload to S3, then PUT Ideate store.
          const prepared = await resizeImageFileForApi(file, 2048, 0.92);
          const apiBuf = await blobToArrayBuffer(prepared.blob);
          const imageBase64 = await visionMediaToBase64({
            id: "tmp",
            mimeType: prepared.mimeType,
            bytes: apiBuf,
            updatedAt: new Date().toISOString(),
          });
          const uploaded = await uploadIdeateVisionMedia({
            imageBase64,
            mimeType: prepared.mimeType,
            kind: "self",
          });

          const meta: VisionSelfReference = {
            url: uploaded.url,
            key: uploaded.key,
            mimeType: prepared.mimeType,
            fileName: file.name || "reference.jpg",
            width: prepared.width || width,
            height: prepared.height || height,
            byteLength: uploaded.byteLength ?? apiBuf.byteLength,
            updatedAt: new Date().toISOString(),
          };
          const store = loadIdeateVisionBoardStore();
          await persistBoard({
            ...store,
            v: 2,
            selfReference: meta,
          });
        } else {
          // Guest: device only.
          const fullBuf = await blobToArrayBuffer(file);
          const mediaId = newVisionMediaId("self");
          if (prev?.mediaId) await deleteVisionMedia(prev.mediaId);
          await putVisionMedia({
            id: mediaId,
            mimeType: file.type || "image/jpeg",
            bytes: fullBuf,
            updatedAt: new Date().toISOString(),
          });
          const meta: VisionSelfReference = {
            mediaId,
            mimeType: file.type || "image/jpeg",
            fileName: file.name || "reference.jpg",
            width,
            height,
            byteLength: fullBuf.byteLength,
            updatedAt: new Date().toISOString(),
          };
          const store = loadIdeateVisionBoardStore();
          await persistBoard({
            ...store,
            v: 2,
            selfReference: meta,
          });
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that photo");
      } finally {
        setBusy(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [persistBoard, refresh, signedIn],
  );

  const clearReference = useCallback(async () => {
    setError(null);
    const store = loadIdeateVisionBoardStore();
    if (!signedIn && store.selfReference?.mediaId) {
      await deleteVisionMedia(store.selfReference.mediaId);
    }
    await persistBoard({
      ...store,
      v: 2,
      selfReference: null,
    });
    await refresh();
  }, [persistBoard, refresh, signedIn]);

  const onGenerate = useCallback(async () => {
    setError(null);
    if (!getMedimadeApiBase()) {
      setError("API URL is not configured.");
      return;
    }
    const prompt = scenePrompt.trim();
    if (prompt.length < 3) {
      setError("Describe the scene you want to step into.");
      return;
    }
    const store = loadIdeateVisionBoardStore();
    const refMeta = store.selfReference;
    if (signedIn) {
      if (!refMeta?.key) {
        setError("Upload a clear photo of yourself first.");
        return;
      }
    } else if (!refMeta?.mediaId) {
      setError("Upload a clear photo of yourself first.");
      return;
    }

    setBusy("gen");
    try {
      let result;
      if (signedIn && refMeta?.key) {
        result = await generateVisionBoardScene({
          prompt,
          referenceKey: refMeta.key,
          mimeType: refMeta.mimeType,
        });
      } else {
        const rec = await getVisionMedia(refMeta!.mediaId!);
        if (!rec) throw new Error("Reference photo is missing — upload it again.");
        const blob = new Blob([rec.bytes], { type: rec.mimeType });
        const prepared = await resizeImageFileForApi(blob, 1536, 0.9);
        const apiBuf = await blobToArrayBuffer(prepared.blob);
        const referenceBase64 = await visionMediaToBase64({
          id: "tmp",
          mimeType: prepared.mimeType,
          bytes: apiBuf,
          updatedAt: new Date().toISOString(),
        });
        result = await generateVisionBoardScene({
          prompt,
          referenceBase64,
          mimeType: prepared.mimeType,
        });
      }

      if (signedIn) {
        if (!result.url) {
          throw new Error("Generated image did not sync to the cloud.");
        }
        const item: VisionBoardItem = {
          id: newTileId(),
          color: pickVisionSwatchColor(prompt),
          label: prompt.length > 48 ? `${prompt.slice(0, 45)}…` : prompt,
          kind: "image",
          imageUrl: result.url,
          ...(result.key ? { mediaKey: result.key } : {}),
          prompt,
          createdAt: new Date().toISOString(),
        };
        await persistBoard(
          upsertVisionBoardItem(loadIdeateVisionBoardStore(), item),
        );
      } else {
        const outBytes = Uint8Array.from(atob(result.imageBase64), (c) =>
          c.charCodeAt(0),
        );
        const mediaId = newVisionMediaId("scene");
        await putVisionMedia({
          id: mediaId,
          mimeType: result.mimeType,
          bytes: outBytes.buffer.slice(
            outBytes.byteOffset,
            outBytes.byteOffset + outBytes.byteLength,
          ),
          updatedAt: new Date().toISOString(),
        });
        const item: VisionBoardItem = {
          id: mediaId.replace(/^scene_/, "tile_"),
          color: pickVisionSwatchColor(prompt),
          label: prompt.length > 48 ? `${prompt.slice(0, 45)}…` : prompt,
          kind: "image",
          mediaId,
          ...(result.url ? { imageUrl: result.url } : {}),
          ...(result.key ? { mediaKey: result.key } : {}),
          prompt,
          createdAt: new Date().toISOString(),
        };
        await persistBoard(
          upsertVisionBoardItem(loadIdeateVisionBoardStore(), item),
        );
      }
      setScenePrompt("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  }, [persistBoard, refresh, scenePrompt, signedIn]);

  const onRemoveTile = useCallback(
    async (item: VisionBoardItem) => {
      if (!signedIn && item.mediaId) await deleteVisionMedia(item.mediaId);
      await persistBoard(
        removeVisionBoardItem(loadIdeateVisionBoardStore(), item.id),
      );
      await refresh();
    },
    [persistBoard, refresh, signedIn],
  );

  const megapixels =
    selfRef && selfRef.width && selfRef.height
      ? ((selfRef.width * selfRef.height) / 1_000_000).toFixed(1)
      : null;

  const hasReference = signedIn
    ? Boolean(selfRef?.url && selfRef?.key)
    : Boolean(selfRef?.mediaId || selfRef?.url);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] pb-16">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <Link
          href="/ideate/my"
          className="text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
        >
          ← My Ideas
        </Link>

        <h1 className="mt-6 font-display text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Vision board
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">
          Gather images for what you&apos;re moving toward. Add a clear photo of
          yourself, then generate scenes with you in them.
        </p>

        <div className="mt-10">
          <p className={SECTION_LABEL}>Your reference photo</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            A clear photo of your face (and upper body if you can). When
            you&apos;re signed in it lives in your account and shows on every
            device.
          </p>

          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="relative aspect-[3/4] w-full max-w-[220px] overflow-hidden rounded-2xl border border-[#E5DFD0] bg-[#F5F1E7] dark:border-border dark:bg-accent-soft/20">
              {selfPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selfPreviewUrl}
                  alt="Your reference"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
                  {hydrated ? "No photo yet" : "Loading…"}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {selfRef && hasReference ? (
                <p className="text-sm text-muted">
                  {selfRef.fileName}
                  {selfRef.width && selfRef.height
                    ? ` · ${selfRef.width}×${selfRef.height}`
                    : ""}
                  {megapixels ? ` · ${megapixels} MP` : ""}
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Prefer a well-lit, front-facing photo. Glasses and hair as you
                  usually wear them help consistency.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer rounded-full accent-fill-gradient px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "ref"
                    ? "Saving…"
                    : hasReference
                      ? "Replace photo"
                      : "Upload photo"}
                </button>
                {hasReference ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void clearReference()}
                    className="cursor-pointer rounded-full border border-border px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  void onPickReference(e.target.files?.[0] ?? null)
                }
              />
            </div>
          </div>
        </div>

        <div className="mt-12">
          <p className={SECTION_LABEL}>Place yourself in a scene</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Describe where you want to be — morning kitchen light, a quiet trail,
            finishing the project at your desk. We use your reference with Google
            Gemini image (Nano Banana).
          </p>
          <textarea
            value={scenePrompt}
            onChange={(e) => setScenePrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Me sitting by a sunny kitchen window with tea, soft morning light, calm and unhurried"
            className="mt-4 w-full max-w-2xl resize-y rounded-[12px] border border-[#E5DFD0] bg-card px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2 dark:border-border"
          />
          <div className="mt-3">
            <button
              type="button"
              disabled={busy !== null || !hasReference}
              onClick={() => void onGenerate()}
              className="cursor-pointer rounded-full bg-[#1E2530] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-foreground dark:text-background"
            >
              {busy === "gen" ? "Generating…" : "Generate scene"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-4 max-w-2xl text-sm text-[#A65252]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-14">
          <p className={SECTION_LABEL}>On the board</p>
          {!hydrated ? (
            <p className="mt-5 text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-5 max-w-md text-sm italic text-[#A39C8C]">
              Nothing on the board yet — generate a scene or add pieces as you
              go.
            </p>
          ) : (
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {items.map((item) => {
                const src = item.imageUrl || tileUrls[item.id];
                return (
                  <li
                    key={item.id}
                    className="group relative aspect-square overflow-hidden rounded-2xl border border-[#E5DFD0] dark:border-border"
                    style={src ? undefined : { backgroundColor: item.color }}
                    title={item.label || undefined}
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt={item.label || "Vision board tile"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="sr-only">{item.label}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void onRemoveTile(item)}
                      className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      Remove
                    </button>
                    {item.label ? (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 pb-2 pt-6 text-[11px] leading-snug text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {item.label}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
