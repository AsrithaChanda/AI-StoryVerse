import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editStoryTrailer,
  getStoryTrailer,
  isStoryTrailerRequestError,
  requestStoryTrailer,
} from "./story-trailer";

const trailer = {
  id: "trailer-1",
  worldId: "world-1",
  chapterId: "chapter-1",
  chapterRevision: 2,
  kind: "story_so_far" as const,
  status: "queued" as const,
  progress: 0,
  updatedAt: "2026-07-26T10:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("story trailer API client", () => {
  it("reads trailer metadata from an encoded world route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ trailer }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStoryTrailer("world / one", "chapter / one", "story_so_far")).resolves.toEqual({ trailer });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%20one/trailers/story_so_far",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("starts a trailer once and sends retry only when explicitly requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ trailer }))
      .mockResolvedValueOnce(jsonResponse({ trailer: { ...trailer, status: "in_progress", progress: 28 } }));
    vi.stubGlobal("fetch", fetchMock);

    await requestStoryTrailer("world / one", "chapter / one", "story_so_far");
    await requestStoryTrailer("world / one", "chapter / one", "story_so_far", { retry: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%20one/trailers/story_so_far",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%20one/trailers/story_so_far",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ retry: true }) }),
    );
  });

  it("preserves a safe server error and its code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "Video rendering is not enabled for this project.",
      code: "video_provider_unavailable",
    }, 503)));

    try {
      await requestStoryTrailer("world-1", "chapter-1", "story_so_far");
      throw new Error("Expected requestStoryTrailer to reject");
    } catch (error) {
      expect(isStoryTrailerRequestError(error)).toBe(true);
      if (!isStoryTrailerRequestError(error)) return;
      expect(error.message).toBe("Video rendering is not enabled for this project.");
      expect(error.status).toBe(503);
      expect(error.code).toBe("video_provider_unavailable");
    }
  });

  it("rejects malformed successful payloads instead of rendering unsafe metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ trailer: { status: "ready" } })));

    await expect(getStoryTrailer("world-1", "chapter-1", "story_so_far")).rejects.toThrow("The trailer service returned an invalid response.");
  });

  it("submits a prompt-driven remix for one chapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ trailer }));
    vi.stubGlobal("fetch", fetchMock);

    await editStoryTrailer("world / one", "chapter / one", "story_so_far", "Use a slower final camera move.");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%20one/trailers/story_so_far/remix",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "Use a slower final camera move." }),
      }),
    );
  });
});
