import type { StoryImage } from "./contracts";
import type { SceneImageRequest } from "../components/SceneImage";
import type { WorldCoverRequest } from "../components/WorldImage";

type ImageResponse = { image: StoryImage };

export type SceneImageWaitOptions = {
  /** Cancels polling and resolves with null without issuing another request. */
  signal?: AbortSignal;
  /** Delay before the first cache recheck. Defaults to 750ms. */
  initialIntervalMs?: number;
  /** Upper bound for the exponential recheck delay. Defaults to 5 seconds. */
  maxIntervalMs?: number;
  /** Total time spent waiting for a pending image. Defaults to 2 minutes. */
  maxWaitMs?: number;
};

const DEFAULT_INITIAL_INTERVAL_MS = 750;
const DEFAULT_MAX_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 120_000;
const inFlightSceneImages = new Map<string, Promise<StoryImage | null>>();

async function imageRequest(path: string, init?: RequestInit): Promise<StoryImage | null> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null) as ImageResponse | null;
  // A 502 deliberately includes the durable failed record so the UI can show
  // the instant fallback and offer the explicit guarded retry control.
  if (payload?.image && (response.ok || response.status === 502)) return payload.image;
  throw new Error("Image request failed");
}

function sceneId(request: SceneImageRequest): string {
  return request.sceneId ?? `${request.moment}-${request.branchId ?? "root"}`;
}

export function loadSceneImage(request: SceneImageRequest, init?: Pick<RequestInit, "signal">): Promise<StoryImage | null> {
  const query = new URLSearchParams({ worldId: request.worldId });
  if (request.branchId) query.set("branchId", request.branchId);
  if (request.protagonistId) query.set("protagonistId", request.protagonistId);
  return imageRequest(`/api/images/${sceneId(request)}?${query.toString()}`, init);
}

/**
 * Waits for a previously queued image to reach a terminal state.
 *
 * This deliberately uses only the cache GET endpoint: callers must enqueue image
 * generation separately, then use this helper to observe the durable image record.
 */
export async function waitForSceneImage(
  request: SceneImageRequest,
  options: SceneImageWaitOptions = {},
): Promise<StoryImage | null> {
  const initialIntervalMs = duration(options.initialIntervalMs, DEFAULT_INITIAL_INTERVAL_MS, 1);
  const maxIntervalMs = Math.max(initialIntervalMs, duration(options.maxIntervalMs, DEFAULT_MAX_INTERVAL_MS, 1));
  const maxWaitMs = duration(options.maxWaitMs, DEFAULT_MAX_WAIT_MS, 0);
  const startedAt = Date.now();
  let attempt = 0;

  while (!options.signal?.aborted) {
    let image: StoryImage | null;
    try {
      image = await loadSceneImage(request, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) return null;
      throw error;
    }

    if (!image || image.status !== "pending") return image;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxWaitMs) return null;

    const remainingMs = maxWaitMs - elapsedMs;
    const delayMs = Math.min(remainingMs, exponentialDelay(initialIntervalMs, maxIntervalMs, attempt));
    attempt += 1;
    const completed = await wait(delayMs, options.signal);
    if (!completed) return null;
  }

  return null;
}

/**
 * Returns a terminal image record while making at most one generation request for
 * the same scene at a time. It checks the durable cache first, only queues work
 * when the record is absent, and polls cache metadata when work is pending.
 */
export function ensureSceneImage(request: SceneImageRequest, options: SceneImageWaitOptions = {}): Promise<StoryImage | null> {
  const key = sceneImageKey(request);
  const existing = inFlightSceneImages.get(key);
  if (existing) return resolveForSubscriber(existing, options.signal);

  // The shared operation intentionally has no caller AbortSignal. One unmounted
  // subscriber must not cancel the scene resolution for every other subscriber.
  const pollingOptions: Omit<SceneImageWaitOptions, "signal"> = {
    initialIntervalMs: options.initialIntervalMs,
    maxIntervalMs: options.maxIntervalMs,
    maxWaitMs: options.maxWaitMs,
  };
  const operation = ensureSceneImageInternal(request, pollingOptions);
  inFlightSceneImages.set(key, operation);
  const remove = () => {
    if (inFlightSceneImages.get(key) === operation) inFlightSceneImages.delete(key);
  };
  void operation.then(remove, remove);
  return resolveForSubscriber(operation, options.signal);
}

export function generateSceneImage(request: SceneImageRequest, retry = false): Promise<StoryImage | null> {
  return imageRequest("/api/images/generate", { method: "POST", body: JSON.stringify({ ...request, sceneId: sceneId(request), retry }) });
}

export function loadWorldCover(request: WorldCoverRequest): Promise<StoryImage | null> {
  return imageRequest(`/api/images/world-cover?worldId=${encodeURIComponent(request.worldId)}`);
}

export function generateWorldCover(request: WorldCoverRequest, retry = false): Promise<StoryImage | null> {
  return imageRequest(`/api/worlds/${encodeURIComponent(request.worldId)}/cover`, { method: "POST", body: JSON.stringify({ retry }) });
}

function duration(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, value);
}

function exponentialDelay(initialIntervalMs: number, maxIntervalMs: number, attempt: number): number {
  return Math.min(maxIntervalMs, initialIntervalMs * 2 ** Math.min(attempt, 30));
}

async function ensureSceneImageInternal(request: SceneImageRequest, options: Omit<SceneImageWaitOptions, "signal">): Promise<StoryImage | null> {
  const cached = await loadSceneImage(request);
  if (cached?.status === "pending") return waitForSceneImage(request, options);
  if (cached) return cached;

  const queued = await generateSceneImage(request);
  if (queued?.status === "pending") return waitForSceneImage(request, options);
  return queued;
}

function sceneImageKey(request: SceneImageRequest): string {
  return JSON.stringify([
    request.worldId,
    sceneId(request),
    request.moment,
    request.branchId ?? null,
    request.protagonistId ?? null,
  ]);
}

function resolveForSubscriber(operation: Promise<StoryImage | null>, signal?: AbortSignal): Promise<StoryImage | null> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => resolve(null));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (image) => finish(() => resolve(image)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function wait(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
