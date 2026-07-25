import { describe, expect, it, vi } from "vitest";
import { prepareChapterImageBatch, prepareChapterImages } from "./chapter-preparation";
import type { StoryImage } from "./contracts";

describe("prepareChapterImages", () => {
  const beats = ["one", "two", "three"].map((id) => ({ id, description: id, caption: id }));

  const storyImage = (sceneId: string, status: StoryImage["status"] = "ready"): StoryImage => ({
    id: sceneId,
    status,
    cacheKey: sceneId,
    worldId: "world",
    sceneId,
    characterIds: [],
    promptVersion: "v",
    fallbackUrl: "fallback",
    createdAt: "now",
    updatedAt: "now",
  });

  it("prepares every beat and reports progress before a chapter becomes visible", async () => {
    const generate = vi.fn(async (request: { sceneId: string }) => ({ id: request.sceneId, status: "ready" as const, cacheKey: request.sceneId, worldId: "world", sceneId: request.sceneId, characterIds: [], promptVersion: "v", fallbackUrl: "fallback", createdAt: "now", updatedAt: "now" }));
    const progress: Array<[number, number]> = [];
    const saved = vi.fn();
    const results = await prepareChapterImages({ worldId: "world", beats, generate, onProgress: (completed, total) => progress.push([completed, total]), onImage: saved });

    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenNthCalledWith(1, { worldId: "world", sceneId: "one", moment: "chapter_scene" });
    expect(results.map((image) => image?.sceneId)).toEqual(["one", "two", "three"]);
    expect(saved).toHaveBeenCalledTimes(3);
    expect(progress).toContainEqual([3, 3]);
  });

  it("finishes the chapter preparation when a single illustration fails", async () => {
    const generate = vi.fn(async (request: { sceneId: string }) => {
      if (request.sceneId === "two") throw new Error("provider unavailable");
      return { id: request.sceneId, status: "ready" as const, cacheKey: request.sceneId, worldId: "world", sceneId: request.sceneId, characterIds: [], promptVersion: "v", fallbackUrl: "fallback", createdAt: "now", updatedAt: "now" };
    });
    const results = await prepareChapterImages({ worldId: "world", beats, generate, onProgress: () => undefined });
    expect(results[1]).toBeNull();
    expect(results[2]?.status).toBe("ready");
  });

  it("passes the selected character into a perspective image queue", async () => {
    const generate = vi.fn(async () => null);
    await prepareChapterImages({ worldId: "world", beats: beats.slice(0, 1), moment: "perspective_scene", protagonistId: "char_03", generate, onProgress: () => undefined });
    expect(generate).toHaveBeenCalledWith({ worldId: "world", sceneId: "one", moment: "perspective_scene", protagonistId: "char_03" });
  });

  it("returns an all-cache batch without resolving or generating another illustration", async () => {
    const loadCached = vi.fn(async (request: { sceneId: string }) => storyImage(request.sceneId));
    const generate = vi.fn(async () => storyImage("should-not-run"));
    const progress: Array<[number, number]> = [];

    const batch = await prepareChapterImageBatch({
      worldId: "world",
      beats,
      loadCached,
      generate,
      onProgress: (completed, total) => progress.push([completed, total]),
    });

    expect(batch.allCached).toBe(true);
    expect(batch.resolvedCount).toBe(0);
    expect(batch.unavailableCount).toBe(0);
    expect(batch.entries.map((entry) => entry.beat.id)).toEqual(["one", "two", "three"]);
    expect(batch.images.map((entry) => entry?.sceneId)).toEqual(["one", "two", "three"]);
    expect(generate).not.toHaveBeenCalled();
    expect(progress).toContainEqual([3, 3]);
  });

  it("resolves missing and pending cache records while preserving terminal batch order", async () => {
    const loadCached = vi.fn(async (request: { sceneId: string }) => {
      if (request.sceneId === "one") return storyImage("one", "pending");
      if (request.sceneId === "two") return null;
      return storyImage("three", "ready");
    });
    const generate = vi.fn(async (request: { sceneId: string }) => storyImage(request.sceneId, request.sceneId === "two" ? "failed" : "ready"));

    const batch = await prepareChapterImageBatch({ worldId: "world", beats, loadCached, generate, onProgress: () => undefined });

    expect(batch.allCached).toBe(false);
    expect(batch.resolvedCount).toBe(2);
    expect(batch.entries.map((entry) => entry.image?.status ?? null)).toEqual(["ready", "failed", "ready"]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledWith({ worldId: "world", sceneId: "one", moment: "chapter_scene", protagonistId: undefined });
    expect(generate).toHaveBeenCalledWith({ worldId: "world", sceneId: "two", moment: "chapter_scene", protagonistId: undefined });
  });

  it("never leaks a pending record into an atomic batch", async () => {
    const saved = vi.fn();
    const batch = await prepareChapterImageBatch({
      worldId: "world",
      beats: beats.slice(0, 1),
      loadCached: async () => storyImage("one", "pending"),
      generate: async () => storyImage("one", "pending"),
      onImage: saved,
      onProgress: () => undefined,
    });

    expect(batch.images).toEqual([null]);
    expect(batch.entries[0].image).toBeNull();
    expect(batch.unavailableCount).toBe(1);
    expect(saved).toHaveBeenCalledWith(beats[0], null);
  });
});
