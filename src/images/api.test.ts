import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSceneImage, waitForSceneImage } from "./api";
import type { StoryImage } from "./contracts";

const request = {
  worldId: "world-01",
  sceneId: "chapter-01-beat-01",
  moment: "chapter_scene" as const,
};

function image(status: StoryImage["status"]): StoryImage {
  return {
    id: `image-${status}`,
    cacheKey: `cache-${status}`,
    worldId: request.worldId,
    sceneId: request.sceneId,
    characterIds: [],
    promptVersion: "storyverse-cinematic-v1",
    status,
    imageUrl: status === "ready" ? "https://assets.example.test/scene.png" : undefined,
    fallbackUrl: "data:image/svg+xml;base64,fallback",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}

function imageResponse(value: StoryImage, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue({ image: value }),
  } as unknown as Response;
}

function notFoundResponse(): Response {
  return { status: 404, ok: false, json: vi.fn() } as unknown as Response;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("waitForSceneImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rechecks a pending cache record until it becomes ready without posting generation", async () => {
    vi.useFakeTimers();
    const pending = image("pending");
    const ready = image("ready");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse(pending))
      .mockResolvedValueOnce(imageResponse(ready));
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForSceneImage(request, { initialIntervalMs: 10, maxIntervalMs: 10, maxWaitMs: 100 });
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toEqual(ready);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method !== "POST")).toBe(true);
  });

  it("returns a failed record after polling a pending image", async () => {
    vi.useFakeTimers();
    const pending = image("pending");
    const failed = image("failed");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse(pending))
      .mockResolvedValueOnce(imageResponse(failed));
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForSceneImage(request, { initialIntervalMs: 10, maxIntervalMs: 10, maxWaitMs: 100 });
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toEqual(failed);
  });

  it("returns null when a cache record remains pending past the wait budget", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse(image("pending")))
      .mockResolvedValueOnce(imageResponse(image("pending")));
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForSceneImage(request, { initialIntervalMs: 10, maxIntervalMs: 10, maxWaitMs: 10 });
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops polling when its AbortSignal is cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(image("pending")));
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForSceneImage(request, {
      signal: controller.signal,
      initialIntervalMs: 10,
      maxIntervalMs: 10,
      maxWaitMs: 100,
    });
    await flushAsyncWork();
    controller.abort();

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ensureSceneImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shares one cache check, generation request, and pending resolver for concurrent callers", async () => {
    vi.useFakeTimers();
    const pending = image("pending");
    const ready = image("ready");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(imageResponse(pending))
      .mockResolvedValueOnce(imageResponse(ready));
    vi.stubGlobal("fetch", fetchMock);

    const options = { initialIntervalMs: 10, maxIntervalMs: 10, maxWaitMs: 100 };
    const first = ensureSceneImage(request, options);
    const second = ensureSceneImage(request, options);
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(10);

    await expect(Promise.all([first, second])).resolves.toEqual([ready, ready]);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
