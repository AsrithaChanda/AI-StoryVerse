import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { WorldStore } from "../worlds.js";
import { LocalImageAssetStore } from "./assets.js";
import { StoryImagePipeline } from "./pipeline.js";
import { buildImagePrompt, imageCacheKey } from "./prompts.js";
import { DisabledImageGenerator, MockImageGenerator } from "./provider.js";

function setup(generator: MockImageGenerator | DisabledImageGenerator): StoryImagePipeline {
  const store = new WorldStore(new DatabaseSync(":memory:"));
  return new StoryImagePipeline(store, generator, new LocalImageAssetStore(join(tmpdir(), `storyverse-image-test-${Math.random().toString(16).slice(2)}`)));
}

describe("story image pipeline", () => {
  it("uses a stable branch-specific cache key and keeps Ravi away from Kael's private motive", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = store.get("the-last-ember")!;
    const trust = { worldId: world.id, sceneId: "bridge-outcome", moment: "trust_kael" as const, branchId: "timeline-a" };
    const expose = { ...trust, moment: "expose_kael" as const, branchId: "timeline-b" };
    expect(imageCacheKey(trust)).toBe(imageCacheKey(trust));
    expect(imageCacheKey(trust)).not.toBe(imageCacheKey(expose));
    const raviPrompt = buildImagePrompt(world, { worldId: world.id, sceneId: "ravi-continuation", moment: "ravi_pov", branchId: "timeline-a", protagonistId: "ravi" }).prompt;
    expect(raviPrompt).toContain("no private motive revealed");
    expect(raviPrompt).not.toContain("private secret");
  });

  it("persists a generated asset once and reuses the same image record", async () => {
    const mock = new MockImageGenerator();
    const pipeline = setup(mock);
    const request = { worldId: "the-last-ember", sceneId: "eastern-bridge", moment: "opening" as const };
    const first = await pipeline.generate(request);
    const second = await pipeline.generate(request);
    expect(first.status).toBe("ready");
    expect(first.imageUrl).toMatch(/^\/api\/images\/assets\//);
    expect(second.id).toBe(first.id);
    expect(mock.calls).toBe(1);
  });

  it("makes a polished fallback without a provider key", async () => {
    const image = await setup(new DisabledImageGenerator()).generate({ worldId: "the-last-ember", sceneId: "eastern-bridge", moment: "opening" });
    expect(image.status).toBe("fallback");
    expect(image.fallbackUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("retries a provider exactly once then caches its terminal failure", async () => {
    const mock = new MockImageGenerator("error");
    const pipeline = setup(mock);
    const request = { worldId: "the-last-ember", sceneId: "bridge-outcome", moment: "trust_kael" as const, branchId: "timeline-a" };
    expect((await pipeline.generate(request)).status).toBe("failed");
    expect(mock.calls).toBe(2);
    await pipeline.generate(request);
    expect(mock.calls).toBe(2);
  });
});
