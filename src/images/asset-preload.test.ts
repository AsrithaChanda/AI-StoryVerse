import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadChapterImageAssets } from "./asset-preload";
import type { PreparedChapterImage } from "./chapter-preparation";

const entry = (): PreparedChapterImage => ({
  beat: { id: "beat-1", caption: "A scene", description: "A prepared visual" },
  request: { worldId: "world-1", sceneId: "beat-1", moment: "chapter_scene" },
  image: {
    id: "image-1",
    cacheKey: "cache-1",
    worldId: "world-1",
    sceneId: "beat-1",
    characterIds: [],
    promptVersion: "v1",
    status: "ready",
    imageUrl: "/api/images/assets/cache-1.webp",
    fallbackUrl: "data:image/svg+xml;base64,fallback",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  },
});

describe("preloadChapterImageAssets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a ready image when its asset is loaded and decoded before reveal", async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    class ReadyImage {
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public decode = decode;
      public set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", ReadyImage);

    const result = await preloadChapterImageAssets([entry()]);

    expect(result[0]?.image?.status).toBe("ready");
    expect(decode).toHaveBeenCalledOnce();
  });

  it("turns an unreadable ready asset into a stable reader fallback", async () => {
    class BrokenImage {
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal("Image", BrokenImage);

    const result = await preloadChapterImageAssets([entry()]);

    expect(result[0]?.image).toBeNull();
  });

  it("is a no-op during non-browser rendering", async () => {
    vi.stubGlobal("Image", undefined);
    const entries = [entry()];

    await expect(preloadChapterImageAssets(entries)).resolves.toBe(entries);
  });
});
