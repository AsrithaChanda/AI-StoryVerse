import type { Perspective, StoryChapter, WorldStory } from "./story";

export type StoryGenerationStage = "writing" | "validating";

export type StoryGenerationHandlers = {
  onPhase?: (stage: StoryGenerationStage) => void;
  onNarration?: (text: string) => void;
};

export type NextChapterStreamResult = { story: WorldStory; chapter?: StoryChapter };
export type CommandStoryStreamResult = { story: WorldStory; chapter?: StoryChapter };
export type CharacterPerspectiveStreamResult = { story: WorldStory; perspective?: Perspective };
export type ReviseChapterStreamResult = { story: WorldStory; chapter: StoryChapter };

type SseEvent = { name: string; data: string };

const defaultError = "The story engine could not complete that request.";

function parseJson(data: string, eventName: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    throw new Error(`The story engine sent an invalid ${eventName} event.`);
  }
}

function errorMessage(payload: unknown, fallback = defaultError): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

function responseError(response: Response): Promise<Error> {
  return response.json()
    .then((payload: unknown) => new Error(errorMessage(payload)))
    .catch(() => new Error(defaultError));
}

function requestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "text/event-stream");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return headers;
}

/**
 * Reads a one-shot server-sent-event story generation stream. The parser is
 * line based so it is safe when UTF-8 bytes, SSE fields, or complete events
 * arrive across arbitrary network chunks.
 */
export async function streamStoryGeneration<T>(
  path: string,
  init: RequestInit,
  handlers: StoryGenerationHandlers = {},
): Promise<T> {
  const response = await fetch(path, { ...init, headers: requestHeaders(init) });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error("The story engine did not return a generation stream.");

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffered = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let complete: T | undefined;
  let hasComplete = false;

  const dispatch = (): void => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }
    const event: SseEvent = { name: eventName, data: dataLines.join("\n") };
    eventName = "message";
    dataLines = [];
    if (event.name === "phase") {
      const payload = parseJson(event.data, "phase");
      if (!payload || typeof payload !== "object" || !["writing", "validating"].includes((payload as { stage?: unknown }).stage as string)) {
        throw new Error("The story engine sent an invalid phase event.");
      }
      handlers.onPhase?.((payload as { stage: StoryGenerationStage }).stage);
      return;
    }
    if (event.name === "narration") {
      const payload = parseJson(event.data, "narration");
      if (!payload || typeof payload !== "object" || typeof (payload as { text?: unknown }).text !== "string") {
        throw new Error("The story engine sent an invalid narration event.");
      }
      handlers.onNarration?.((payload as { text: string }).text);
      return;
    }
    if (event.name === "error") {
      throw new Error(errorMessage(parseJson(event.data, "error")));
    }
    if (event.name === "complete") {
      complete = parseJson(event.data, "complete") as T;
      hasComplete = true;
    }
  };

  const processLine = (line: string): void => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    if (field === "data") dataLines.push(value);
  };

  const processChunk = (chunk: string, flush = false): void => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      buffered = buffered.slice(newline + 1);
      processLine(line);
      if (hasComplete) return;
      newline = buffered.indexOf("\n");
    }
    if (flush && buffered) {
      processLine(buffered.replace(/\r$/, ""));
      buffered = "";
    }
    if (flush && !hasComplete && dataLines.length > 0) dispatch();
  };

  try {
    while (!hasComplete) {
      const { done, value } = await reader.read();
      if (done) break;
      processChunk(decoder.decode(value, { stream: true }));
    }
    if (!hasComplete) processChunk(decoder.decode(), true);
    if (!hasComplete) throw new Error("The story engine ended before completing generation.");
    return complete as T;
  } finally {
    reader.releaseLock();
  }
}

export function streamNextChapter(
  worldId: string,
  handlers: StoryGenerationHandlers = {},
): Promise<NextChapterStreamResult> {
  return streamStoryGeneration<NextChapterStreamResult>(
    `/api/worlds/${encodeURIComponent(worldId)}/story/next/stream`,
    { method: "POST", body: "{}" },
    handlers,
  );
}

export function streamCommandStory(
  worldId: string,
  command: string,
  handlers: StoryGenerationHandlers = {},
): Promise<CommandStoryStreamResult> {
  return streamStoryGeneration<CommandStoryStreamResult>(
    `/api/worlds/${encodeURIComponent(worldId)}/story/command/stream`,
    { method: "POST", body: JSON.stringify({ command }) },
    handlers,
  );
}

export function streamCharacterPerspective(
  worldId: string,
  characterId: string,
  handlers: StoryGenerationHandlers = {},
): Promise<CharacterPerspectiveStreamResult> {
  return streamStoryGeneration<CharacterPerspectiveStreamResult>(
    `/api/worlds/${encodeURIComponent(worldId)}/story/perspective/stream`,
    { method: "POST", body: JSON.stringify({ characterId }) },
    handlers,
  );
}

export function streamReviseChapter(
  worldId: string,
  prompt: string,
  handlers: StoryGenerationHandlers = {},
): Promise<ReviseChapterStreamResult> {
  return streamStoryGeneration<ReviseChapterStreamResult>(
    `/api/worlds/${encodeURIComponent(worldId)}/story/revise/stream`,
    { method: "POST", body: JSON.stringify({ prompt }) },
    handlers,
  );
}
