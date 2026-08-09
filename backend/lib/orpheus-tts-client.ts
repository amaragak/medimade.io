export type OrpheusTtsRequest = {
  text: string;
  voice: string;
  model?: string;
  speed?: number;
};

const DEFAULT_MODEL = "orpheus";

export type OrpheusTtsLogFn = (
  message: string,
  data?: Record<string, unknown>,
) => void;

function defaultOrpheusLog(message: string, data?: Record<string, unknown>): void {
  if (process.env.ORPHEUS_TTS_LOG !== "1") return;
  if (data && Object.keys(data).length > 0) {
    console.log(`[orpheus-tts] ${message}`, data);
  } else {
    console.log(`[orpheus-tts] ${message}`);
  }
}

function summarizeRunpodPayload(payload: RunpodJobPayload): Record<string, unknown> {
  const output = payload.output;
  const outputKeys =
    output && typeof output === "object"
      ? Object.keys(output as Record<string, unknown>)
      : [];
  return {
    status: typeof payload.status === "string" ? payload.status : undefined,
    id: typeof payload.id === "string" ? payload.id : undefined,
    hasOutput: Boolean(output && typeof output === "object"),
    outputKeys,
    error: typeof payload.error === "string" ? payload.error.slice(0, 500) : undefined,
  };
}

export function isOpenAiSpeechUrl(url: string): boolean {
  return /\/v1\/audio\/speech\/?$/i.test(url.trim());
}

export function upstreamRequestBody(
  req: OrpheusTtsRequest,
  upstreamUrl: string,
): string {
  const voice = req.voice.trim();
  const speed =
    typeof req.speed === "number" && Number.isFinite(req.speed) && req.speed > 0
      ? req.speed
      : 1.0;
  if (isOpenAiSpeechUrl(upstreamUrl)) {
    return JSON.stringify({
      model: req.model?.trim() || DEFAULT_MODEL,
      input: req.text,
      voice,
      response_format: "wav",
      speed,
    });
  }
  // RunPod runsync: handler expects OpenAI-shaped fields inside `input`.
  return JSON.stringify({
    input: {
      model: req.model?.trim() || DEFAULT_MODEL,
      input: req.text,
      voice,
      response_format: "wav",
      speed,
    },
  });
}

function extractAudioBase64FromRunpodOutput(
  output: Record<string, unknown>,
): string | null {
  if (typeof output.error === "string" && output.error.trim()) {
    throw new Error(output.error.trim());
  }
  const audioB64 =
    typeof output.audio_base64 === "string"
      ? output.audio_base64.trim()
      : typeof output.audio === "string"
        ? output.audio.trim()
        : "";
  return audioB64 || null;
}

function parseRunpodEndpointId(upstreamUrl: string): string | null {
  const m = upstreamUrl.trim().match(/\/v2\/([^/]+)/i);
  return m?.[1] ?? null;
}

function runpodRunUrl(upstreamUrl: string): string {
  const trimmed = upstreamUrl.trim().replace(/\/$/, "");
  if (/\/runsync$/i.test(trimmed)) {
    return trimmed.replace(/\/runsync$/i, "/run");
  }
  if (/\/run$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/run`;
}

export type ActiveRunpodJob = {
  apiKey: string;
  endpointId: string;
  jobId: string;
};

let activeRunpodJob: ActiveRunpodJob | null = null;
let runpodSignalHandlersInstalled = false;

export async function cancelRunpodJob(
  job: ActiveRunpodJob,
  log: OrpheusTtsLogFn = defaultOrpheusLog,
): Promise<boolean> {
  const url = `https://api.runpod.ai/v2/${job.endpointId}/cancel/${job.jobId}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${job.apiKey}` },
    });
    let data: RunpodJobPayload = {};
    try {
      data = (await res.json()) as RunpodJobPayload;
    } catch {
      data = {};
    }
    log("RunPod cancel requested", {
      jobId: job.jobId,
      httpStatus: res.status,
      ...summarizeRunpodPayload(data),
    });
    return res.ok;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("RunPod cancel failed", { jobId: job.jobId, error: msg });
    return false;
  }
}

export async function purgeRunpodQueue(params: {
  apiKey: string;
  endpointId: string;
  log?: OrpheusTtsLogFn;
}): Promise<void> {
  const log = params.log ?? defaultOrpheusLog;
  const url = `https://api.runpod.ai/v2/${params.endpointId}/purge-queue`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.apiKey}` },
  });
  let data: RunpodJobPayload = {};
  try {
    data = (await res.json()) as RunpodJobPayload;
  } catch {
    const detail = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `RunPod purge-queue failed (${res.status}): ${detail.slice(0, 2000)}`,
      );
    }
  }
  if (!res.ok) {
    const detail =
      (typeof data.error === "string" && data.error) ||
      JSON.stringify(data).slice(0, 2000);
    throw new Error(`RunPod purge-queue failed (${res.status}): ${detail}`);
  }
  log("RunPod queue purged", {
    endpointId: params.endpointId,
    ...summarizeRunpodPayload(data),
  });
}

function registerActiveRunpodJob(job: ActiveRunpodJob, log: OrpheusTtsLogFn): void {
  activeRunpodJob = job;
  if (runpodSignalHandlersInstalled) return;
  runpodSignalHandlersInstalled = true;

  const cancelActive = (signal: string) => {
    const current = activeRunpodJob;
    if (!current) return;
    log("RunPod cancel on process signal", { signal, jobId: current.jobId });
    void cancelRunpodJob(current, log).finally(() => {
      activeRunpodJob = null;
    });
  };

  process.once("SIGINT", () => cancelActive("SIGINT"));
  process.once("SIGTERM", () => cancelActive("SIGTERM"));
}

async function clearActiveRunpodJob(
  log: OrpheusTtsLogFn,
  cancel: boolean,
): Promise<void> {
  const current = activeRunpodJob;
  activeRunpodJob = null;
  if (!current) return;
  if (cancel) {
    await cancelRunpodJob(current, log);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type RunpodJobPayload = Record<string, unknown>;

async function pollRunpodJobOutput(params: {
  apiKey: string;
  endpointId: string;
  jobId: string;
  maxAttempts?: number;
  intervalMs?: number;
  log?: OrpheusTtsLogFn;
  cancelOnTimeout?: boolean;
}): Promise<RunpodJobPayload> {
  const log = params.log ?? defaultOrpheusLog;
  const maxAttempts = params.maxAttempts ?? 180;
  const intervalMs = params.intervalMs ?? 2000;
  const statusUrl = `https://api.runpod.ai/v2/${params.endpointId}/status/${params.jobId}`;

  log("RunPod job polling started", {
    jobId: params.jobId,
    endpointId: params.endpointId,
    maxAttempts,
    intervalMs,
    maxWaitSeconds: Math.round((maxAttempts * intervalMs) / 1000),
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
    });
    let data: RunpodJobPayload = {};
    try {
      data = (await res.json()) as RunpodJobPayload;
    } catch {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `RunPod status poll returned non-JSON (${res.status}): ${detail.slice(0, 2000)}`,
      );
    }

    const status =
      typeof data.status === "string" ? data.status.toUpperCase() : "";

    const shouldLogPoll =
      attempt === 1 ||
      attempt === maxAttempts ||
      attempt % 5 === 0 ||
      status === "COMPLETED" ||
      status === "FAILED" ||
      status === "CANCELLED";
    if (shouldLogPoll) {
      log("RunPod poll", {
        attempt,
        maxAttempts,
        httpStatus: res.status,
        ...summarizeRunpodPayload(data),
      });
    }

    if (status === "COMPLETED") {
      const output = data.output;
      if (output && typeof output === "object") {
        log("RunPod job completed", {
          jobId: params.jobId,
          attempts: attempt,
          outputKeys: Object.keys(output as Record<string, unknown>),
        });
        return output as RunpodJobPayload;
      }
      throw new Error(
        `RunPod job completed without output: ${JSON.stringify(data).slice(0, 2000)}`,
      );
    }
    if (status === "FAILED" || status === "CANCELLED") {
      const err =
        (typeof data.error === "string" && data.error) ||
        JSON.stringify(data).slice(0, 2000);
      throw new Error(`RunPod job ${status.toLowerCase()}: ${err}`);
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  log("RunPod job polling timed out", {
    jobId: params.jobId,
    maxAttempts,
    intervalMs,
  });
  if (params.cancelOnTimeout) {
    await cancelRunpodJob(
      {
        apiKey: params.apiKey,
        endpointId: params.endpointId,
        jobId: params.jobId,
      },
      log,
    );
  }
  throw new Error(`RunPod job timed out after polling (${params.jobId})`);
}

async function resolveRunpodOutput(params: {
  apiKey: string;
  upstreamUrl: string;
  data: RunpodJobPayload;
  pollMaxAttempts?: number;
  pollIntervalMs?: number;
  log?: OrpheusTtsLogFn;
  cancelOnTimeout?: boolean;
}): Promise<RunpodJobPayload> {
  const log = params.log ?? defaultOrpheusLog;
  const output = params.data.output;
  if (output && typeof output === "object") {
    log("RunPod runsync returned output immediately", {
      outputKeys: Object.keys(output as Record<string, unknown>),
    });
    return output as RunpodJobPayload;
  }

  const status =
    typeof params.data.status === "string"
      ? params.data.status.toUpperCase()
      : "";
  const jobId = typeof params.data.id === "string" ? params.data.id : "";
  if (
    jobId &&
    (status === "IN_QUEUE" ||
      status === "IN_PROGRESS" ||
      status === "RUNNING" ||
      !output)
  ) {
    const endpointId = parseRunpodEndpointId(params.upstreamUrl);
    if (!endpointId) {
      throw new Error(
        `Orpheus upstream missing output: ${JSON.stringify(params.data).slice(0, 2000)}`,
      );
    }
    log("RunPod runsync deferred to polling", {
      jobId,
      status: status || "(unknown)",
      endpointId,
    });
    return pollRunpodJobOutput({
      apiKey: params.apiKey,
      endpointId,
      jobId,
      maxAttempts: params.pollMaxAttempts,
      intervalMs: params.pollIntervalMs,
      log,
      cancelOnTimeout: params.cancelOnTimeout,
    });
  }

  throw new Error(
    `Orpheus upstream missing output: ${JSON.stringify(params.data).slice(0, 2000)}`,
  );
}

/** Calls RunPod (OpenAI speech or async `/run`) and returns WAV bytes. */
export async function orpheusTtsWav(params: {
  apiKey: string;
  upstreamUrl: string;
  text: string;
  voice: string;
  model?: string;
  speed?: number;
  pollMaxAttempts?: number;
  pollIntervalMs?: number;
  log?: OrpheusTtsLogFn;
  /**
   * `single`: purge queue, submit exactly one `/run` job, cancel on timeout/exit.
   * Use for local sample tests to avoid orphan workers.
   */
  jobPolicy?: "default" | "single";
}): Promise<Buffer> {
  const singleJob = params.jobPolicy === "single";
  const log = params.log ?? defaultOrpheusLog;
  const text = params.text.trim();
  if (!text) {
    throw new Error("Orpheus TTS text is empty");
  }
  const voice = params.voice.trim();
  if (!voice) {
    throw new Error("Orpheus voice is required");
  }

  const upstreamUrl = params.upstreamUrl.trim();
  const openAiMode = isOpenAiSpeechUrl(upstreamUrl);
  const endpointId = parseRunpodEndpointId(upstreamUrl);
  if (singleJob && (!endpointId || openAiMode)) {
    throw new Error(
      "jobPolicy=single requires a RunPod queue URL (…/v2/{endpointId}/runsync or /run)",
    );
  }

  const req: OrpheusTtsRequest = {
    text,
    voice,
    model: params.model,
    speed: params.speed,
  };

  log("Orpheus TTS request", {
    voice,
    speed: params.speed ?? 1,
    textChars: text.length,
    jobPolicy: singleJob ? "single" : "default",
    upstreamMode: openAiMode
      ? "openai-speech"
      : singleJob
        ? "runpod-run"
        : "runpod-runsync",
    endpointId: endpointId ?? undefined,
    upstreamHost: (() => {
      try {
        return new URL(upstreamUrl).host;
      } catch {
        return upstreamUrl.slice(0, 80);
      }
    })(),
  });

  const requestStarted = Date.now();
  let submittedJobId: string | null = null;

  try {
    if (singleJob && endpointId) {
      await purgeRunpodQueue({
        apiKey: params.apiKey,
        endpointId,
        log,
      });

      const runUrl = runpodRunUrl(upstreamUrl);
      log("RunPod submitting single async job", { runUrl });
      const submitRes = await fetch(runUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: upstreamRequestBody(req, upstreamUrl),
      });

      let submitData: RunpodJobPayload = {};
      try {
        submitData = (await submitRes.json()) as RunpodJobPayload;
      } catch {
        const detail = await submitRes.text().catch(() => "");
        throw new Error(
          `RunPod /run returned non-JSON (${submitRes.status}): ${detail.slice(0, 2000)}`,
        );
      }

      if (!submitRes.ok) {
        const detail =
          (typeof submitData.error === "string" && submitData.error) ||
          JSON.stringify(submitData).slice(0, 2000);
        throw new Error(`RunPod /run failed (${submitRes.status}): ${detail}`);
      }

      const jobId =
        typeof submitData.id === "string" ? submitData.id.trim() : "";
      if (!jobId) {
        throw new Error(
          `RunPod /run missing job id: ${JSON.stringify(submitData).slice(0, 2000)}`,
        );
      }

      submittedJobId = jobId;
      registerActiveRunpodJob(
        { apiKey: params.apiKey, endpointId, jobId },
        log,
      );
      log("RunPod single job submitted", {
        jobId,
        endpointId,
        ...summarizeRunpodPayload(submitData),
      });

      const output = await resolveRunpodOutput({
        apiKey: params.apiKey,
        upstreamUrl,
        data: submitData,
        pollMaxAttempts: params.pollMaxAttempts,
        pollIntervalMs: params.pollIntervalMs,
        log,
        cancelOnTimeout: true,
      });

      const audioB64 = extractAudioBase64FromRunpodOutput(output);
      if (!audioB64) {
        log("Orpheus output missing audio field", {
          outputKeys: Object.keys(output),
          outputPreview: JSON.stringify(output).slice(0, 500),
        });
        throw new Error(
          `Orpheus upstream missing audio_base64: ${JSON.stringify(output).slice(0, 2000)}`,
        );
      }
      const wav = Buffer.from(audioB64, "base64");
      log("Orpheus TTS success", {
        jobId,
        wavBytes: wav.byteLength,
        audioBase64Chars: audioB64.length,
        elapsedMs: Date.now() - requestStarted,
      });
      await clearActiveRunpodJob(log, false);
      return wav;
    }

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: upstreamRequestBody(req, upstreamUrl),
    });

    const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
    log("Orpheus upstream response headers", {
      httpStatus: upstream.status,
      contentType: contentType || "(none)",
      elapsedMs: Date.now() - requestStarted,
    });

    if (contentType.includes("audio/")) {
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        throw new Error(
          `Orpheus upstream failed (${upstream.status}): ${detail.slice(0, 2000)}`,
        );
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      log("Orpheus direct audio response", {
        bytes: buf.byteLength,
        elapsedMs: Date.now() - requestStarted,
      });
      return buf;
    }

    let data: Record<string, unknown> = {};
    try {
      data = (await upstream.json()) as Record<string, unknown>;
    } catch {
      const detail = await upstream.text().catch(() => "");
      throw new Error(
        `Orpheus upstream returned non-JSON (${upstream.status}): ${detail.slice(0, 2000)}`,
      );
    }

    if (!upstream.ok) {
      const detail =
        (typeof data.error === "string" && data.error) ||
        JSON.stringify(data).slice(0, 2000);
      throw new Error(`Orpheus upstream failed (${upstream.status}): ${detail}`);
    }

    log("Orpheus upstream JSON received", summarizeRunpodPayload(data));

    const output = await resolveRunpodOutput({
      apiKey: params.apiKey,
      upstreamUrl,
      data,
      pollMaxAttempts: params.pollMaxAttempts,
      pollIntervalMs: params.pollIntervalMs,
      log,
    });

    const audioB64 = extractAudioBase64FromRunpodOutput(output);
    if (!audioB64) {
      log("Orpheus output missing audio field", {
        outputKeys: Object.keys(output),
        outputPreview: JSON.stringify(output).slice(0, 500),
      });
      throw new Error(
        `Orpheus upstream missing audio_base64: ${JSON.stringify(output).slice(0, 2000)}`,
      );
    }
    const wav = Buffer.from(audioB64, "base64");
    log("Orpheus TTS success", {
      wavBytes: wav.byteLength,
      audioBase64Chars: audioB64.length,
      elapsedMs: Date.now() - requestStarted,
    });
    return wav;
  } catch (e) {
    if (singleJob && submittedJobId && endpointId) {
      await clearActiveRunpodJob(log, true);
    }
    throw e;
  }
}
