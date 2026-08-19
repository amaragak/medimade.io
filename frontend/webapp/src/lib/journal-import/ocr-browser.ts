import { ocrJournalPhoto } from "@/lib/medimade-api";

/** Flip to `true` to use in-browser Text Detector / Tesseract instead of Textract. */
export const USE_DEVICE_OCR = false;

export const OCR_LOW_CONFIDENCE = 70;

export type OcrWord = {
  text: string;
  confidence: number | null;
};

export type OcrPhotoResult = {
  text: string;
  words: OcrWord[];
  engine: "text_detector" | "tesseract" | "textract";
  lowConfidenceCount: number;
};

type TextDetectorCtor = new () => {
  detect: (image: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type TessWord = { text?: string; confidence?: number };
type TessLine = { words?: TessWord[] };
type TessPara = { lines?: TessLine[] };
type TessBlock = { paragraphs?: TessPara[] };
type TessHandle = {
  recognize: (image: HTMLCanvasElement) => Promise<{
    data: { text?: string; blocks?: TessBlock[] | null };
  }>;
  terminate: () => Promise<unknown>;
};

let tessWorker: TessHandle | null = null;
let tessLoading: Promise<TessHandle> | null = null;

async function getTessWorker(): Promise<TessHandle> {
  if (tessWorker) return tessWorker;
  if (!tessLoading) {
    tessLoading = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = (await createWorker("eng")) as unknown as TessHandle;
      tessWorker = worker;
      return worker;
    })();
  }
  return tessLoading;
}

export async function terminateOcrWorker(): Promise<void> {
  const w = tessWorker;
  tessWorker = null;
  tessLoading = null;
  if (w) await w.terminate();
}

function isHeicName(file: File): boolean {
  return (
    /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
  );
}

export async function fileToOcrBlob(file: File): Promise<Blob> {
  if (!isHeicName(file)) return file;
  try {
    const bmp = await createImageBitmap(file);
    bmp.close();
    return file;
  } catch {
    /* Chrome cannot decode HEIC natively */
  }
  const { heicTo, isHeic } = await import("heic-to");
  const heic = await isHeic(file);
  if (!heic) return file;
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that photo."));
      el.src = url;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const maxEdge = 1600;
    if (w > maxEdge || h > maxEdge) {
      const s = Math.min(maxEdge / w, maxEdge / h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that photo.");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function tryTextDetector(image: ImageBitmapSource): Promise<string | null> {
  const Ctor = (globalThis as { TextDetector?: TextDetectorCtor }).TextDetector;
  if (typeof Ctor !== "function") return null;
  try {
    const detector = new Ctor();
    const found = await detector.detect(image);
    const text = found
      .map((d) => (typeof d.rawValue === "string" ? d.rawValue.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

function countLow(words: OcrWord[]): number {
  return words.filter(
    (w) => w.confidence != null && w.confidence < OCR_LOW_CONFIDENCE,
  ).length;
}

function canvasToJpegBase64(canvas: HTMLCanvasElement, quality: number): string {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

async function ocrPhotoFileTextract(file: File): Promise<OcrPhotoResult> {
  const blob = await fileToOcrBlob(file);
  const canvas = await blobToCanvas(blob);
  let quality = 0.82;
  let imageBase64 = canvasToJpegBase64(canvas, quality);
  while (imageBase64.length > 3_200_000 && quality > 0.45) {
    quality -= 0.12;
    imageBase64 = canvasToJpegBase64(canvas, quality);
  }
  const dated = await ocrJournalPhoto(imageBase64);
  const words = dated.words;
  return {
    text: dated.text.trim(),
    words,
    engine: "textract",
    lowConfidenceCount: countLow(words),
  };
}

async function ocrPhotoFileOnDevice(file: File): Promise<OcrPhotoResult> {
  const blob = await fileToOcrBlob(file);
  const canvas = await blobToCanvas(blob);

  const platform = await tryTextDetector(canvas);
  if (platform) {
    const words: OcrWord[] = platform.split(/\s+/).map((text) => ({
      text,
      confidence: null,
    }));
    return {
      text: platform,
      words,
      engine: "text_detector",
      lowConfidenceCount: 0,
    };
  }

  const worker = await getTessWorker();
  const { data } = await worker.recognize(canvas);
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const text = typeof w.text === "string" ? w.text.trim() : "";
          if (!text) continue;
          words.push({
            text,
            confidence: typeof w.confidence === "number" ? w.confidence : null,
          });
        }
      }
    }
  }
  const text = (data.text ?? "").replace(/\u000c/g, "").trim();
  return {
    text: text || words.map((w) => w.text).join(" "),
    words,
    engine: "tesseract",
    lowConfidenceCount: countLow(words),
  };
}

export async function ocrPhotoFile(file: File): Promise<OcrPhotoResult> {
  if (USE_DEVICE_OCR) return ocrPhotoFileOnDevice(file);
  return ocrPhotoFileTextract(file);
}
