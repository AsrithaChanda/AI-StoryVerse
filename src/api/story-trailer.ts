export type StoryTrailerStatus = "queued" | "in_progress" | "ready" | "failed";

/**
 * Safe trailer metadata intentionally excludes provider job identifiers and
 * prompts. The server is the only place those implementation details exist.
 */
export type PublicStoryTrailer = {
  id?: string;
  worldId: string;
  chapterId: string;
  chapterRevision: number;
  status: StoryTrailerStatus;
  progress: number;
  videoUrl?: string;
  errorCode?: string;
  updatedAt: string;
};

export type StoryTrailerRequestError = Error & {
  status: number;
  code?: string;
};

type TrailerResponse = { trailer: PublicStoryTrailer | null };

const statusValues = new Set<StoryTrailerStatus>(["queued", "in_progress", "ready", "failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTrailer(value: unknown): value is PublicStoryTrailer {
  if (!isRecord(value)) return false;
  return typeof value.worldId === "string"
    && typeof value.chapterId === "string"
    && typeof value.chapterRevision === "number"
    && typeof value.status === "string"
    && statusValues.has(value.status as StoryTrailerStatus)
    && typeof value.progress === "number"
    && typeof value.updatedAt === "string"
    && (value.id === undefined || typeof value.id === "string")
    && (value.videoUrl === undefined || typeof value.videoUrl === "string")
    && (value.errorCode === undefined || typeof value.errorCode === "string");
}

function safeMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const candidate = payload.error ?? payload.message;
  return typeof candidate === "string" && candidate.trim() ? candidate : fallback;
}

function safeCode(payload: unknown): string | undefined {
  return isRecord(payload) && typeof payload.code === "string" && payload.code.trim() ? payload.code : undefined;
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Some proxies return an empty or HTML response for a failed job. Do not
    // expose that body to readers, but still preserve the HTTP failure below.
    await response.text().catch(() => undefined);
    return null;
  }
  return response.json().catch(() => null);
}

function trailerError(message: string, status: number, code?: string): StoryTrailerRequestError {
  const error = new Error(message) as StoryTrailerRequestError;
  error.status = status;
  if (code) error.code = code;
  return error;
}

async function request(path: string, init?: RequestInit): Promise<TrailerResponse> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...init, headers });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw trailerError(
      safeMessage(payload, "The trailer service could not complete that request."),
      response.status,
      safeCode(payload),
    );
  }
  if (!isRecord(payload) || !("trailer" in payload) || (payload.trailer !== null && !isTrailer(payload.trailer))) {
    throw trailerError("The trailer service returned an invalid response.", response.status);
  }
  return { trailer: payload.trailer as PublicStoryTrailer | null };
}

export function getStoryTrailer(
  worldId: string,
  init?: Pick<RequestInit, "signal">,
): Promise<TrailerResponse> {
  return request(`/api/worlds/${encodeURIComponent(worldId)}/story/trailer`, init);
}

export function requestStoryTrailer(
  worldId: string,
  options: { retry?: boolean; signal?: AbortSignal } = {},
): Promise<TrailerResponse> {
  return request(`/api/worlds/${encodeURIComponent(worldId)}/story/trailer`, {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(options.retry ? { retry: true } : {}),
  });
}

export function isStoryTrailerRequestError(error: unknown): error is StoryTrailerRequestError {
  return error instanceof Error && "status" in error && typeof (error as { status?: unknown }).status === "number";
}
