"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyVisionBoardRefinement,
  getComposeSlotIds,
  loadIdeateVisionBoardStore,
  MAX_VISION_EXTRA_REFERENCES,
  pickVisionSwatchColor,
  placeVisionItemInComposeSlot,
  removeVisionBoardItem,
  restoreVisionBoardVersion,
  saveIdeateVisionBoardStore,
  upsertVisionBoardItem,
  visionItemHasImage,
  visionLabelFromPrompt,
  VISION_COMPOSE_SLOT_COUNT,
  type VisionBoardItem,
  type VisionExtraReference,
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

const VISION_TILE_DRAG_MIME = "application/x-ideate-vision-tile";

type TileMenu = "actions" | "refine" | "versions";

function newTileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tile_${crypto.randomUUID()}`;
  }
  return `tile_${Date.now().toString(16)}`;
}

function newExtraRefId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `xref_${crypto.randomUUID()}`;
  }
  return `xref_${Date.now().toString(16)}`;
}

/** Recover S3 object key from a vision CloudFront URL when `key` was dropped from the store. */
function visionKeyFromUrl(url: string | undefined | null): string | null {
  if (!url?.trim()) return null;
  try {
    const path = new URL(url.trim()).pathname.replace(/^\/+/, "");
    if (path.startsWith("ideate/vision/")) return path;
    return null;
  } catch {
    return null;
  }
}

/**
 * Vision board — same content shell as My Ideas (`max-w-6xl`).
 * Signed-in: S3 + Ideate cloud store only (no IndexedDB).
 * Guests: device IndexedDB only.
 */
export function IdeateVisionBoardClient() {
  const [items, setItems] = useState<VisionBoardItem[]>([]);
  const [selfRef, setSelfRef] = useState<VisionSelfReference | null>(null);
  const [extraRefs, setExtraRefs] = useState<VisionExtraReference[]>([]);
  const [selfPreviewUrl, setSelfPreviewUrl] = useState<string | null>(null);
  const [extraPreviewUrls, setExtraPreviewUrls] = useState<
    Record<string, string>
  >({});
  const [tileUrls, setTileUrls] = useState<Record<string, string>>({});
  const [scenePrompt, setScenePrompt] = useState("");
  const [busy, setBusy] = useState<"ref" | "gen" | "extra" | "upload" | null>(
    null,
  );
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [menuTileId, setMenuTileId] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<TileMenu>("actions");
  const [refineDraft, setRefineDraft] = useState("");
  const [composeDragOver, setComposeDragOver] = useState<number | null>(null);
  const [draggingTileId, setDraggingTileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const extraFileInputRef = useRef<HTMLInputElement | null>(null);
  const boardFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const extraPreviewUrlsRef = useRef<Record<string, string>>({});
  const tileUrlsRef = useRef<Record<string, string>>({});
  const boardRef = useRef<HTMLUListElement | null>(null);
  const { ready: cloudReady, signedIn, revision } = useIdeateCloud();

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
    setSelfPreviewUrl(null);
  }, []);

  const closeTileMenu = useCallback(() => {
    setMenuTileId(null);
    setMenuMode("actions");
    setRefineDraft("");
  }, []);

  const refresh = useCallback(async () => {
    const store = loadIdeateVisionBoardStore();
    setItems(store.items);
    setSelfRef(store.selfReference ?? null);
    setExtraRefs(store.extraReferences ?? []);

    revokePreview();
    for (const u of Object.values(extraPreviewUrlsRef.current)) {
      if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    }
    extraPreviewUrlsRef.current = {};

    const nextExtraPreviews: Record<string, string> = {};

    if (signedIn) {
      if (store.selfReference?.url) {
        setSelfPreviewUrl(store.selfReference.url);
      }
      for (const xr of store.extraReferences ?? []) {
        if (xr.url) nextExtraPreviews[xr.id] = xr.url;
      }
      const nextTiles: Record<string, string> = {};
      for (const item of store.items) {
        if (item.imageUrl) nextTiles[item.id] = item.imageUrl;
        for (const v of item.versions ?? []) {
          if (v.imageUrl) nextTiles[v.id] = v.imageUrl;
        }
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

      for (const xr of store.extraReferences ?? []) {
        if (xr.url) {
          nextExtraPreviews[xr.id] = xr.url;
          continue;
        }
        if (!xr.mediaId) continue;
        const rec = await getVisionMedia(xr.mediaId);
        if (!rec) continue;
        nextExtraPreviews[xr.id] = visionMediaToObjectUrl(rec);
      }

      const nextTiles: Record<string, string> = {};
      const loadMedia = async (id: string, mediaId?: string, imageUrl?: string) => {
        if (imageUrl) {
          nextTiles[id] = imageUrl;
          return;
        }
        if (!mediaId) return;
        const rec = await getVisionMedia(mediaId);
        if (!rec) return;
        nextTiles[id] = visionMediaToObjectUrl(rec);
      };
      for (const item of store.items) {
        await loadMedia(item.id, item.mediaId, item.imageUrl);
        for (const v of item.versions ?? []) {
          await loadMedia(v.id, v.mediaId, v.imageUrl);
        }
      }
      for (const u of Object.values(tileUrlsRef.current)) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      tileUrlsRef.current = nextTiles;
      setTileUrls(nextTiles);
    }
    extraPreviewUrlsRef.current = nextExtraPreviews;
    setExtraPreviewUrls(nextExtraPreviews);
    setHydrated(true);
  }, [revokePreview, signedIn]);

  useEffect(() => {
    if (!cloudReady && signedIn) return;
    const id = requestAnimationFrame(() => {
      void refresh();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [refresh, cloudReady, revision, signedIn]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      for (const u of Object.values(extraPreviewUrlsRef.current)) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      for (const u of Object.values(tileUrlsRef.current)) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuTileId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (boardRef.current?.contains(t)) return;
      closeTileMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTileMenu();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuTileId, closeTileMenu]);

  const persistBoard = useCallback(
    async (store: ReturnType<typeof loadIdeateVisionBoardStore>) => {
      saveIdeateVisionBoardStore(store);
      if (signedIn) {
        await flushIdeateCloudNow();
      }
    },
    [signedIn],
  );

  const runGenerate = useCallback(
    async (params: {
      prompt: string;
      changeRequest?: string;
      polishPrompt?: boolean;
    }) => {
      await import("@/lib/auth-session").then((m) =>
        m.ensureMedimadeSession({ force: false }),
      );
      const auth = await import("@/lib/auth-session");
      // Refresh once if memory JWT missing (common after reload).
      if (!auth.getMedimadeSessionJwt()) {
        await auth.ensureMedimadeSession({ force: true });
      }

      const store = loadIdeateVisionBoardStore();
      const refMeta = store.selfReference;
      if (!refMeta) {
        throw new Error("Upload a clear photo of yourself first.");
      }

      const common = {
        prompt: params.prompt,
        ...(params.changeRequest
          ? { changeRequest: params.changeRequest }
          : {}),
        ...(params.polishPrompt === false ? { polishPrompt: false } : {}),
      };

      const jwt = Boolean(auth.getMedimadeSessionJwt());
      const referenceKey =
        refMeta.key?.trim() || visionKeyFromUrl(refMeta.url) || "";

      // Persist recovered key so later generates don't need URL parsing.
      if (jwt && referenceKey && !refMeta.key) {
        await persistBoard({
          ...store,
          v: 2,
          selfReference: { ...refMeta, key: referenceKey },
        });
      }

      const buildExtras = async (): Promise<
        Array<{
          description: string;
          referenceKey?: string;
          referenceBase64?: string;
          mimeType?: string;
        }>
      > => {
        const out: Array<{
          description: string;
          referenceKey?: string;
          referenceBase64?: string;
          mimeType?: string;
        }> = [];
        for (const xr of store.extraReferences ?? []) {
          const description = xr.description.trim();
          if (!description) continue;
          const xKey = xr.key?.trim() || visionKeyFromUrl(xr.url) || "";
          if (jwt && xKey) {
            out.push({
              description,
              referenceKey: xKey,
              mimeType: xr.mimeType,
            });
            continue;
          }
          if (xr.mediaId) {
            const rec = await getVisionMedia(xr.mediaId);
            if (!rec) continue;
            const blob = new Blob([rec.bytes], { type: rec.mimeType });
            const prepared = await resizeImageFileForApi(blob, 1280, 0.88);
            const apiBuf = await blobToArrayBuffer(prepared.blob);
            const referenceBase64 = await visionMediaToBase64({
              id: "tmp",
              mimeType: prepared.mimeType,
              bytes: apiBuf,
              updatedAt: new Date().toISOString(),
            });
            out.push({
              description,
              referenceBase64,
              mimeType: prepared.mimeType,
            });
          }
        }
        return out.slice(0, MAX_VISION_EXTRA_REFERENCES);
      };

      const extraReferences = await buildExtras();

      // Cloud path: Lambda reads the object from S3 (no browser CORS to CloudFront).
      if (jwt && referenceKey) {
        try {
          return await generateVisionBoardScene({
            ...common,
            referenceKey,
            mimeType: refMeta.mimeType,
            ...(extraReferences.length ? { extraReferences } : {}),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/failed to fetch/i.test(msg)) {
            throw new Error(
              "Could not reach the API. Check your connection and try again.",
            );
          }
          throw e;
        }
      }

      // Guest IndexedDB binary.
      if (refMeta.mediaId) {
        const rec = await getVisionMedia(refMeta.mediaId);
        if (!rec) {
          throw new Error("Reference photo is missing — upload it again.");
        }
        const blob = new Blob([rec.bytes], { type: rec.mimeType });
        const prepared = await resizeImageFileForApi(blob, 1536, 0.9);
        const apiBuf = await blobToArrayBuffer(prepared.blob);
        const referenceBase64 = await visionMediaToBase64({
          id: "tmp",
          mimeType: prepared.mimeType,
          bytes: apiBuf,
          updatedAt: new Date().toISOString(),
        });
        return generateVisionBoardScene({
          ...common,
          referenceBase64,
          mimeType: prepared.mimeType,
          ...(extraReferences.length ? { extraReferences } : {}),
        });
      }

      if (refMeta.url && !jwt) {
        throw new Error(
          "Your session expired. Sign in again to regenerate with your cloud photo.",
        );
      }

      throw new Error(
        "Your reference photo is incomplete — re-upload it, then try again.",
      );
    },
    [persistBoard],
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

  const onPickExtraReference = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      const store = loadIdeateVisionBoardStore();
      const current = store.extraReferences ?? [];
      if (current.length >= MAX_VISION_EXTRA_REFERENCES) {
        setError(`You can add up to ${MAX_VISION_EXTRA_REFERENCES} extra references.`);
        if (extraFileInputRef.current) extraFileInputRef.current.value = "";
        return;
      }
      setBusy("extra");
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
        const id = newExtraRefId();

        let meta: VisionExtraReference;
        if (signedIn) {
          const prepared = await resizeImageFileForApi(file, 1600, 0.9);
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
            kind: "extra",
          });
          meta = {
            id,
            description: "",
            url: uploaded.url,
            key: uploaded.key,
            mimeType: prepared.mimeType,
            fileName: file.name || "extra.jpg",
            width: prepared.width || width,
            height: prepared.height || height,
            byteLength: uploaded.byteLength ?? apiBuf.byteLength,
            updatedAt: new Date().toISOString(),
          };
        } else {
          const fullBuf = await blobToArrayBuffer(file);
          const mediaId = newVisionMediaId("extra");
          await putVisionMedia({
            id: mediaId,
            mimeType: file.type || "image/jpeg",
            bytes: fullBuf,
            updatedAt: new Date().toISOString(),
          });
          meta = {
            id,
            description: "",
            mediaId,
            mimeType: file.type || "image/jpeg",
            fileName: file.name || "extra.jpg",
            width,
            height,
            byteLength: fullBuf.byteLength,
            updatedAt: new Date().toISOString(),
          };
        }

        await persistBoard({
          ...store,
          v: 2,
          extraReferences: [...current, meta].slice(
            0,
            MAX_VISION_EXTRA_REFERENCES,
          ),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that photo");
      } finally {
        setBusy(null);
        if (extraFileInputRef.current) extraFileInputRef.current.value = "";
      }
    },
    [persistBoard, refresh, signedIn],
  );

  const updateExtraDescription = useCallback(
    async (id: string, description: string) => {
      const store = loadIdeateVisionBoardStore();
      const next = (store.extraReferences ?? []).map((r) =>
        r.id === id
          ? { ...r, description: description.slice(0, 280) }
          : r,
      );
      setExtraRefs(next);
      await persistBoard({ ...store, v: 2, extraReferences: next });
    },
    [persistBoard],
  );

  const clearExtraReference = useCallback(
    async (id: string) => {
      setError(null);
      const store = loadIdeateVisionBoardStore();
      const target = (store.extraReferences ?? []).find((r) => r.id === id);
      if (!signedIn && target?.mediaId) {
        await deleteVisionMedia(target.mediaId);
      }
      await persistBoard({
        ...store,
        v: 2,
        extraReferences: (store.extraReferences ?? []).filter((r) => r.id !== id),
      });
      await refresh();
    },
    [persistBoard, refresh, signedIn],
  );

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

    setBusy("gen");
    try {
      const result = await runGenerate({ prompt });
      const finalPrompt = result.prompt?.trim() || prompt;

      if (signedIn) {
        if (!result.url) {
          throw new Error("Generated image did not sync to the cloud.");
        }
        const item: VisionBoardItem = {
          id: newTileId(),
          color: pickVisionSwatchColor(finalPrompt),
          label: visionLabelFromPrompt(finalPrompt),
          kind: "image",
          imageUrl: result.url,
          ...(result.key ? { mediaKey: result.key } : {}),
          prompt: finalPrompt,
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
          color: pickVisionSwatchColor(finalPrompt),
          label: visionLabelFromPrompt(finalPrompt),
          kind: "image",
          mediaId,
          ...(result.url ? { imageUrl: result.url } : {}),
          ...(result.key ? { mediaKey: result.key } : {}),
          prompt: finalPrompt,
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
  }, [persistBoard, refresh, runGenerate, scenePrompt, signedIn]);

  const onUploadBoardImage = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      setBusy("upload");
      try {
        if (!file.type.startsWith("image/")) {
          throw new Error("Choose a photo or image file.");
        }
        if (signedIn && !getMedimadeApiBase()) {
          throw new Error("API URL is not configured.");
        }

        const label =
          file.name.replace(/\.[^.]+$/, "").trim().slice(0, 48) || "Uploaded";
        const id = newTileId();

        if (signedIn) {
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
            kind: "tile",
          });
          const item: VisionBoardItem = {
            id,
            color: pickVisionSwatchColor(label),
            label,
            kind: "image",
            imageUrl: uploaded.url,
            mediaKey: uploaded.key,
            createdAt: new Date().toISOString(),
          };
          await persistBoard(
            upsertVisionBoardItem(loadIdeateVisionBoardStore(), item),
          );
        } else {
          const fullBuf = await blobToArrayBuffer(file);
          const mediaId = newVisionMediaId("tile");
          await putVisionMedia({
            id: mediaId,
            mimeType: file.type || "image/jpeg",
            bytes: fullBuf,
            updatedAt: new Date().toISOString(),
          });
          const item: VisionBoardItem = {
            id,
            color: pickVisionSwatchColor(label),
            label,
            kind: "image",
            mediaId,
            createdAt: new Date().toISOString(),
          };
          await persistBoard(
            upsertVisionBoardItem(loadIdeateVisionBoardStore(), item),
          );
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add that image");
      } finally {
        setBusy(null);
        if (boardFileInputRef.current) boardFileInputRef.current.value = "";
      }
    },
    [persistBoard, refresh, signedIn],
  );

  const onRemoveTile = useCallback(
    async (item: VisionBoardItem) => {
      if (!signedIn) {
        if (item.mediaId) await deleteVisionMedia(item.mediaId);
        for (const v of item.versions ?? []) {
          if (v.mediaId) await deleteVisionMedia(v.mediaId);
        }
      }
      closeTileMenu();
      await persistBoard(
        removeVisionBoardItem(loadIdeateVisionBoardStore(), item.id),
      );
      await refresh();
    },
    [closeTileMenu, persistBoard, refresh, signedIn],
  );

  const onRegenerateTile = useCallback(
    async (item: VisionBoardItem) => {
      setError(null);
      if (!getMedimadeApiBase()) {
        setError("API URL is not configured.");
        return;
      }
      const basePrompt = item.prompt?.trim();
      if (!basePrompt) {
        setError("This tile has no scene prompt to regenerate.");
        return;
      }

      setRefiningId(item.id);
      try {
        const result = await runGenerate({
          prompt: basePrompt,
          polishPrompt: false,
        });
        const finalPrompt = result.prompt?.trim() || basePrompt;

        let nextMediaId: string | undefined;
        let nextUrl = result.url;
        let nextKey = result.key;

        if (signedIn) {
          if (!result.url) {
            throw new Error("Generated image did not sync to the cloud.");
          }
        } else {
          const outBytes = Uint8Array.from(atob(result.imageBase64), (c) =>
            c.charCodeAt(0),
          );
          nextMediaId = newVisionMediaId("scene");
          await putVisionMedia({
            id: nextMediaId,
            mimeType: result.mimeType,
            bytes: outBytes.buffer.slice(
              outBytes.byteOffset,
              outBytes.byteOffset + outBytes.byteLength,
            ),
            updatedAt: new Date().toISOString(),
          });
        }

        const updated = applyVisionBoardRefinement(item, {
          prompt: finalPrompt,
          ...(nextUrl ? { imageUrl: nextUrl } : {}),
          ...(nextMediaId ? { mediaId: nextMediaId } : {}),
          ...(nextKey ? { mediaKey: nextKey } : {}),
          ...(item.changeRequest
            ? { changeRequest: item.changeRequest }
            : {}),
        });
        await persistBoard(
          upsertVisionBoardItem(loadIdeateVisionBoardStore(), updated),
        );
        closeTileMenu();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Regenerate failed");
      } finally {
        setRefiningId(null);
      }
    },
    [closeTileMenu, persistBoard, refresh, runGenerate, signedIn],
  );

  const onRefineTile = useCallback(
    async (item: VisionBoardItem) => {
      setError(null);
      if (!getMedimadeApiBase()) {
        setError("API URL is not configured.");
        return;
      }
      const change = refineDraft.trim();
      if (change.length < 2) {
        setError("Say how you’d like to change this image.");
        return;
      }
      const basePrompt = item.prompt?.trim();
      if (!basePrompt) {
        setError("This tile has no scene prompt to refine.");
        return;
      }

      setRefiningId(item.id);
      try {
        const result = await runGenerate({
          prompt: basePrompt,
          changeRequest: change,
        });
        const finalPrompt = result.prompt?.trim() || basePrompt;

        let nextMediaId: string | undefined;
        let nextUrl = result.url;
        let nextKey = result.key;

        if (signedIn) {
          if (!result.url) {
            throw new Error("Generated image did not sync to the cloud.");
          }
        } else {
          const outBytes = Uint8Array.from(atob(result.imageBase64), (c) =>
            c.charCodeAt(0),
          );
          nextMediaId = newVisionMediaId("scene");
          await putVisionMedia({
            id: nextMediaId,
            mimeType: result.mimeType,
            bytes: outBytes.buffer.slice(
              outBytes.byteOffset,
              outBytes.byteOffset + outBytes.byteLength,
            ),
            updatedAt: new Date().toISOString(),
          });
        }

        const updated = applyVisionBoardRefinement(item, {
          prompt: finalPrompt,
          ...(nextUrl ? { imageUrl: nextUrl } : {}),
          ...(nextMediaId ? { mediaId: nextMediaId } : {}),
          ...(nextKey ? { mediaKey: nextKey } : {}),
          changeRequest: change,
        });
        await persistBoard(
          upsertVisionBoardItem(loadIdeateVisionBoardStore(), updated),
        );
        closeTileMenu();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Refine failed");
      } finally {
        setRefiningId(null);
      }
    },
    [closeTileMenu, persistBoard, refineDraft, refresh, runGenerate, signedIn],
  );

  const onRestoreVersion = useCallback(
    async (item: VisionBoardItem, versionId: string) => {
      const updated = restoreVisionBoardVersion(item, versionId);
      if (!updated) return;
      closeTileMenu();
      await persistBoard(
        upsertVisionBoardItem(loadIdeateVisionBoardStore(), updated),
      );
      await refresh();
    },
    [closeTileMenu, persistBoard, refresh],
  );

  const onPlaceInCompose = useCallback(
    async (itemId: string, slotIndex: number) => {
      const next = placeVisionItemInComposeSlot(
        loadIdeateVisionBoardStore(),
        itemId,
        slotIndex,
      );
      await persistBoard(next);
      setItems(next.items);
    },
    [persistBoard],
  );

  const megapixels =
    selfRef && selfRef.width && selfRef.height
      ? ((selfRef.width * selfRef.height) / 1_000_000).toFixed(1)
      : null;

  const hasReference = signedIn
    ? Boolean(selfRef?.url && (selfRef?.key || visionKeyFromUrl(selfRef?.url)))
    : Boolean(selfRef?.mediaId || selfRef?.url);

  const composeSlotIds = getComposeSlotIds(items);
  const composeSlotIdSet = new Set(
    composeSlotIds.filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="min-h-[calc(100vh-3.5rem)] pb-16">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <Link
          href="/ideate/my"
          className="text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
        >
          ← Ideate
        </Link>

        <h1 className="mt-6 font-display text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Vision board
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">
          Compose the mosaic that opens Ideate. Drag images from your library
          into slots, or generate new ones below.
        </p>

        {/* Compose grid — page hero */}
        <div
          className="mt-8 grid w-full grid-cols-3 gap-1"
          style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setComposeDragOver(null);
            }
          }}
        >
          {Array.from({ length: VISION_COMPOSE_SLOT_COUNT }, (_, slotIndex) => {
            const id = composeSlotIds[slotIndex];
            const item = id ? (items.find((x) => x.id === id) ?? null) : null;
            const src = item
              ? item.imageUrl || tileUrls[item.id] || null
              : null;
            const isOver = composeDragOver === slotIndex;
            const isDraggingHere =
              draggingTileId != null && draggingTileId === id;
            return (
              <div
                key={`compose-slot-${slotIndex}`}
                className={`group relative aspect-[4/3] overflow-hidden rounded-[8px] transition-[outline-color] ${
                  src
                    ? "bg-surface-2"
                    : "border border-dashed border-[#D4CBB8] bg-[#F5F1E7] dark:border-border dark:bg-accent-soft/20"
                } ${
                  isOver
                    ? "outline outline-2 outline-offset-[-2px] outline-[#F0A855]"
                    : ""
                } ${isDraggingHere ? "opacity-50" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setComposeDragOver(slotIndex);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setComposeDragOver(null);
                  setDraggingTileId(null);
                  const dropped =
                    e.dataTransfer.getData(VISION_TILE_DRAG_MIME) ||
                    e.dataTransfer.getData("text/plain");
                  if (!dropped) return;
                  void onPlaceInCompose(dropped, slotIndex);
                }}
              >
                {src ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={item?.label || `Mosaic slot ${slotIndex + 1}`}
                      className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
                      draggable={Boolean(id)}
                      onDragStart={(e) => {
                        if (!id) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData(VISION_TILE_DRAG_MIME, id);
                        e.dataTransfer.setData("text/plain", id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingTileId(id);
                      }}
                      onDragEnd={() => {
                        setDraggingTileId(null);
                        setComposeDragOver(null);
                      }}
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/25 group-hover:opacity-100">
                      <span className="font-sans text-[11px] font-medium tracking-wide text-white">
                        Drag to swap
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center font-sans text-3xl font-medium text-[#8A8272]/55">
                    {slotIndex + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Library + References */}
        <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,65fr)_minmax(0,32fr)] lg:gap-[3%]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={SECTION_LABEL}>Library</p>
              <button
                type="button"
                disabled={busy !== null || refiningId !== null}
                onClick={() => boardFileInputRef.current?.click()}
                className="cursor-pointer rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-[#F5F1E7]/80 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-accent-soft/20"
              >
                {busy === "upload" ? "Uploading…" : "Upload image"}
              </button>
              <input
                ref={boardFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  void onUploadBoardImage(e.target.files?.[0] ?? null)
                }
              />
            </div>
            {!hydrated ? (
              <p className="mt-5 text-sm text-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="mt-5 max-w-md text-sm italic text-[#A39C8C]">
                Nothing in your library yet — generate or upload an image to
                begin.
              </p>
            ) : (
              <ul
                ref={boardRef}
                className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"
              >
                {items.map((item) => {
                  const src = item.imageUrl || tileUrls[item.id];
                  const open = menuTileId === item.id;
                  const versionCount = item.versions?.length ?? 0;
                  const isImage = Boolean(
                    src &&
                      (item.kind === "image" ||
                        item.prompt ||
                        visionItemHasImage(item)),
                  );
                  const canAiEdit = Boolean(item.prompt?.trim());
                  const onMosaic = composeSlotIdSet.has(item.id);
                  return (
                    <li
                      key={item.id}
                      className={`group relative aspect-square overflow-visible ${
                        draggingTileId === item.id ? "opacity-50" : ""
                      }`}
                      draggable={isImage}
                      onDragStart={(e) => {
                        if (!isImage) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData(VISION_TILE_DRAG_MIME, item.id);
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingTileId(item.id);
                        closeTileMenu();
                      }}
                      onDragEnd={() => {
                        setDraggingTileId(null);
                        setComposeDragOver(null);
                      }}
                    >
                      <button
                        type="button"
                        disabled={!isImage || refiningId === item.id}
                        onClick={() => {
                          if (!isImage) return;
                          if (open) {
                            closeTileMenu();
                            return;
                          }
                          setMenuTileId(item.id);
                          setMenuMode("actions");
                          setRefineDraft("");
                          setError(null);
                        }}
                        className="relative block h-full w-full cursor-grab overflow-hidden rounded-[8px] border border-[#E5DFD0] text-left active:cursor-grabbing dark:border-border disabled:cursor-default"
                        style={
                          src ? undefined : { backgroundColor: item.color }
                        }
                        title={
                          isImage
                            ? `${item.label || "Tile"} — drag onto the mosaic`
                            : item.label || undefined
                        }
                        aria-expanded={open}
                        aria-haspopup="menu"
                      >
                        {src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={src}
                            alt={item.label || "Vision board tile"}
                            className="pointer-events-none h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <span className="sr-only">{item.label}</span>
                        )}
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/20 group-hover:opacity-100">
                          <span className="font-sans text-[11px] font-medium text-white">
                            Drag
                          </span>
                        </span>
                        {onMosaic ? (
                          <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-[#EDE4D4]/95 px-1.5 py-0.5 font-sans text-[11px] font-medium text-[#5C5346] dark:bg-[#2A3340] dark:text-[#E8E0D4]">
                            On mosaic
                          </span>
                        ) : null}
                        {refiningId === item.id ? (
                          <span className="ideate-frosted-overlay absolute inset-1 flex items-center justify-center text-xs font-medium text-white">
                            Updating…
                          </span>
                        ) : null}
                        {versionCount > 0 && refiningId !== item.id ? (
                          <span className="ideate-frosted-overlay ideate-frosted-overlay--chip absolute left-2 top-2 text-[10px] font-medium text-white">
                            {versionCount + 1}v
                          </span>
                        ) : null}
                      </button>

                      {open ? (
                        <div
                          role="menu"
                          className="absolute left-1/2 top-[calc(100%+0.4rem)] z-20 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[#E5DFD0] bg-[#FAF8F3] p-2 shadow-[0_12px_40px_rgba(30,37,48,0.18)] dark:border-border dark:bg-card"
                        >
                          {menuMode === "actions" ? (
                            <div className="flex flex-col gap-0.5">
                              {canAiEdit ? (
                                <>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={refiningId !== null}
                                    className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-[#EFEBE3] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-accent-soft/30"
                                    onClick={() => void onRegenerateTile(item)}
                                  >
                                    {refiningId === item.id
                                      ? "Regenerating…"
                                      : "Regenerate"}
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-[#EFEBE3] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-accent-soft/30"
                                    onClick={() => setMenuMode("refine")}
                                  >
                                    Refine
                                  </button>
                                  {versionCount > 0 ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-[#EFEBE3] dark:hover:bg-accent-soft/30"
                                      onClick={() => setMenuMode("versions")}
                                    >
                                      Versions ({versionCount})
                                    </button>
                                  ) : null}
                                </>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium text-[#A65252] transition-colors hover:bg-[#F3E4E0]"
                                onClick={() => void onRemoveTile(item)}
                              >
                                Remove
                              </button>
                            </div>
                          ) : null}

                          {menuMode === "refine" ? (
                            <div className="space-y-2 p-1">
                              <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
                                How would you like to change this image?
                              </p>
                              <textarea
                                value={refineDraft}
                                onChange={(e) => setRefineDraft(e.target.value)}
                                rows={3}
                                autoFocus
                                placeholder="e.g. warmer light, standing instead of sitting, softer background"
                                className="w-full resize-y rounded-lg border border-[#E5DFD0] bg-card px-3 py-2 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2 dark:border-border"
                              />
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-muted hover:text-foreground"
                                  onClick={() => setMenuMode("actions")}
                                >
                                  Back
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    refiningId !== null ||
                                    refineDraft.trim().length < 2
                                  }
                                  className="cursor-pointer rounded-full bg-[#1E2530] px-3.5 py-1.5 text-sm font-semibold text-[#FAF8F3] disabled:opacity-40 dark:bg-foreground dark:text-background"
                                  onClick={() => void onRefineTile(item)}
                                >
                                  {refiningId === item.id
                                    ? "Working…"
                                    : "Regenerate"}
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {menuMode === "versions" && versionCount > 0 ? (
                            <div className="max-h-56 space-y-1 overflow-y-auto p-1">
                              <button
                                type="button"
                                className="mb-1 cursor-pointer rounded-lg px-2 py-1 text-sm text-muted hover:text-foreground"
                                onClick={() => setMenuMode("actions")}
                              >
                                ← Back
                              </button>
                              <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                                Current
                              </p>
                              <div className="flex items-center gap-2 rounded-lg bg-[#EFEBE3]/70 px-2 py-1.5 dark:bg-accent-soft/20">
                                {src ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={src}
                                    alt=""
                                    className="h-10 w-10 shrink-0 rounded-md object-cover"
                                  />
                                ) : null}
                                <p className="min-w-0 flex-1 truncate text-xs text-foreground">
                                  {item.label || item.prompt || "Current"}
                                </p>
                              </div>
                              <p className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                                Earlier
                              </p>
                              {[...(item.versions ?? [])]
                                .reverse()
                                .map((v) => {
                                  const vSrc = v.imageUrl || tileUrls[v.id];
                                  return (
                                    <button
                                      key={v.id}
                                      type="button"
                                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#EFEBE3] dark:hover:bg-accent-soft/30"
                                      onClick={() =>
                                        void onRestoreVersion(item, v.id)
                                      }
                                    >
                                      {vSrc ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={vSrc}
                                          alt=""
                                          className="h-10 w-10 shrink-0 rounded-md object-cover"
                                        />
                                      ) : (
                                        <span
                                          className="h-10 w-10 shrink-0 rounded-md"
                                          style={{
                                            backgroundColor: item.color,
                                          }}
                                        />
                                      )}
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-foreground">
                                          {visionLabelFromPrompt(v.prompt) ||
                                            "Earlier version"}
                                        </span>
                                        {v.changeRequest ? (
                                          <span className="block truncate text-[11px] text-muted">
                                            via “{v.changeRequest}”
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                  );
                                })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-8">
              <p className={SECTION_LABEL}>New image</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Describe the scene. Mention people or pets by the labels in
                References if you&apos;ve added them.
              </p>
              <div className="mt-4 flex w-full flex-col gap-3 sm:flex-row sm:items-stretch">
                <input
                  type="text"
                  value={scenePrompt}
                  onChange={(e) => setScenePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (
                        busy === null &&
                        refiningId === null &&
                        hasReference &&
                        scenePrompt.trim().length >= 3
                      ) {
                        void onGenerate();
                      }
                    }
                  }}
                  placeholder="e.g. Me sitting on a large pile of money in a sunny room"
                  className="min-w-0 flex-1 rounded-[12px] border border-[#E5DFD0] bg-card px-4 py-2.5 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2 dark:border-border"
                />
                <button
                  type="button"
                  disabled={
                    busy !== null || refiningId !== null || !hasReference
                  }
                  onClick={() => void onGenerate()}
                  className="shrink-0 cursor-pointer rounded-full bg-[#1E2530] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-foreground dark:text-background"
                >
                  {busy === "gen" ? "Generating…" : "Generate an image"}
                </button>
              </div>
              {!hasReference ? (
                <p className="mt-2 text-xs text-muted lg:hidden">
                  Add your photo in References first.
                </p>
              ) : null}
              {error ? (
                <p className="mt-3 text-sm text-[#A65252]" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-20">
            <p className={SECTION_LABEL}>References</p>
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-muted">
              Your likeness first. Optional extras below — label them so scenes
              can use them.
            </p>

            <div className="mt-5">
              <p className="font-sans text-[13px] font-medium text-foreground">
                You
              </p>
              <div className="mt-2 relative aspect-[3/4] w-full overflow-hidden rounded-[8px] border border-[#E5DFD0] bg-[#F5F1E7] dark:border-border dark:bg-accent-soft/20">
                {selfPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selfPreviewUrl}
                    alt="Your reference"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted">
                    {hydrated ? "No photo yet" : "…"}
                  </div>
                )}
              </div>
              {selfRef && hasReference ? (
                <p className="mt-2 font-sans text-[12px] leading-snug text-muted">
                  {selfRef.fileName}
                  {megapixels ? ` · ${megapixels} MP` : ""}
                </p>
              ) : (
                <p className="mt-2 font-sans text-[12px] leading-snug text-muted">
                  Clear, front-facing light works best.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null || refiningId !== null}
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer rounded-full accent-fill-gradient px-3.5 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "ref"
                    ? "Saving…"
                    : hasReference
                      ? "Replace"
                      : "Upload"}
                </button>
                {hasReference ? (
                  <button
                    type="button"
                    disabled={busy !== null || refiningId !== null}
                    onClick={() => void clearReference()}
                    className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
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

            <div className="mt-6">
              <p className="font-sans text-[13px] font-medium text-foreground">
                Also in the scene
              </p>
              <p className="mt-1 font-sans text-[12px] leading-snug text-muted">
                People, pets, places — optional.
              </p>
              <ul className="mt-3 flex flex-col gap-4">
                {extraRefs.map((xr) => (
                  <li key={xr.id} className="w-full">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-[8px] border border-[#E5DFD0] bg-[#F5F1E7] dark:border-border dark:bg-accent-soft/20">
                      {extraPreviewUrls[xr.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={extraPreviewUrls[xr.id]}
                          alt={xr.description || "Extra reference"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-muted">
                          Photo
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null || refiningId !== null}
                        onClick={() => void clearExtraReference(xr.id)}
                        className="ideate-frosted-overlay ideate-frosted-overlay--chip absolute right-1 top-1 text-[10px] font-medium text-white disabled:opacity-40"
                        aria-label="Remove reference"
                      >
                        ×
                      </button>
                    </div>
                    <label className="mt-1.5 block">
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                        Label
                      </span>
                      <textarea
                        value={xr.description}
                        onChange={(e) => {
                          const v = e.target.value.slice(0, 280);
                          setExtraRefs((prev) =>
                            prev.map((r) =>
                              r.id === xr.id ? { ...r, description: v } : r,
                            ),
                          );
                        }}
                        onBlur={(e) =>
                          void updateExtraDescription(xr.id, e.target.value)
                        }
                        rows={2}
                        placeholder="e.g. My mum"
                        className="w-full resize-none rounded-lg border border-[#E5DFD0] bg-card px-2 py-1.5 text-xs leading-snug outline-none ring-accent/25 focus:ring-2 dark:border-border"
                      />
                    </label>
                  </li>
                ))}

                {extraRefs.length < MAX_VISION_EXTRA_REFERENCES ? (
                  <li className="w-full">
                    <button
                      type="button"
                      disabled={busy !== null || refiningId !== null}
                      onClick={() => extraFileInputRef.current?.click()}
                      className="flex aspect-[3/4] w-full cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-[#D4CBB8] text-center transition-colors hover:border-[#B8A99A] hover:bg-[#F5F1E7]/60 disabled:opacity-40 dark:border-border dark:hover:bg-accent-soft/20"
                    >
                      <span className="text-lg leading-none text-muted">+</span>
                      <span className="mt-1 text-[11px] font-medium text-muted">
                        {busy === "extra" ? "Saving…" : "Add photo"}
                      </span>
                    </button>
                  </li>
                ) : null}
              </ul>
              <input
                ref={extraFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  void onPickExtraReference(e.target.files?.[0] ?? null)
                }
              />
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
