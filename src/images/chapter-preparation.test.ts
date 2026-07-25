import { describe, expect, it, vi } from "vitest";
import { prepareChapterImages } from "./chapter-preparation";

describe("prepareChapterImages", () => {
  const beats = ["one", "two", "three"].map((id) => ({ id, description: id, caption: id }));

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
});
