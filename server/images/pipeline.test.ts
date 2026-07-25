import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { WorldStory } from "../story.js";
import { WorldStore, type World } from "../worlds.js";
import { LocalImageAssetStore } from "./assets.js";
import { StoryImagePipeline } from "./pipeline.js";
import { buildImagePrompt, imageCacheKey } from "./prompts.js";
import { DisabledImageGenerator, MockImageGenerator } from "./provider.js";

function createTestWorld(store: WorldStore): World {
  return store.create(
    {
      title: "Test World",
      genre: "Test genre",
      premise: "A neutral premise used only to exercise image cache behavior.",
      creatorPrompt: "Use test-only visual continuity.",
    },
    {
      source: "fallback",
      openingScene: "A neutral test opening establishes a public signal.",
      characters: [
        { name: "Test Character One", role: "First test role", trait: "Measured" },
        { name: "Test Character Two", role: "Second test role", trait: "Observant" },
      ],
    },
  );
}

function saveTestStory(store: WorldStore, worldId: string): WorldStory {
  return store.saveWorldStory({
    worldId,
    source: "fallback",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    worldState: "The generic public test signal is active.",
    characters: [
      { id: "character-one", name: "Test Character One", role: "First test role", visualDescription: "A test coat.", personality: "Measured", goal: "Complete the test.", memories: ["private-test-marker"] },
      { id: "character-two", name: "Test Character Two", role: "Second test role", visualDescription: "A test notebook.", personality: "Observant", goal: "Verify the test.", memories: ["The public signal is visible."] },
    ],
    chapters: [{ id: "chapter-1", number: 1, title: "Test Chapter", narration: "A neutral test chapter records a public signal without exposing character-one's private-test-marker.", beats: [{ id: "chapter-1-beat-1", description: "Test Character One reaches the public test signal.", caption: "Public signal" }] }],
    perspectives: [{ characterId: "character-two", chapterId: "chapter-1", narration: "I can see the public signal but not the private context.", beats: [{ id: "chapter-1-character-two-beat-1", description: "Test Character Two observes the public test signal.", caption: "Observed signal" }] }],
  });
}

function setup(generator: MockImageGenerator | DisabledImageGenerator): { store: WorldStore; world: World; pipeline: StoryImagePipeline } {
  const store = new WorldStore(new DatabaseSync(":memory:"));
  const world = createTestWorld(store);
  saveTestStory(store, world.id);
  return { store, world, pipeline: new StoryImagePipeline(store, generator, new LocalImageAssetStore(join(tmpdir(), `storyverse-image-test-${Math.random().toString(16).slice(2)}`))) };
}

describe("story image pipeline", () => {
  it("uses a stable branch-specific cache key and keeps perspective prompts scoped to their saved beat", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    saveTestStory(store, world.id);
    const canonical = { worldId: world.id, sceneId: "chapter-1-beat-1", moment: "chapter_scene" as const, branchId: "test-branch-a" };
    const alternate = { ...canonical, branchId: "test-branch-b" };
    expect(imageCacheKey(canonical)).toBe(imageCacheKey(canonical));
    expect(imageCacheKey(canonical)).not.toBe(imageCacheKey(alternate));
    const perspective = buildImagePrompt(world, { worldId: world.id, sceneId: "chapter-1-character-two-beat-1", moment: "perspective_scene", branchId: "test-branch-a", protagonistId: "character-two" }, store.visualBeat(world.id, "chapter-1-character-two-beat-1")).prompt;
    expect(perspective).toContain("Test Character Two observes the public test signal.");
    expect(perspective).not.toContain("private-test-marker");
  });

  it("persists a generated asset once and reuses the same image record", async () => {
    const mock = new MockImageGenerator();
    const { pipeline, world } = setup(mock);
    const request = { worldId: world.id, sceneId: "chapter-1-beat-1", moment: "chapter_scene" as const };
    const first = await pipeline.generate(request);
    const second = await pipeline.generate(request);
    expect(first.status).toBe("ready");
    expect(first.imageUrl).toMatch(/^\/api\/images\/assets\//);
    expect(second.id).toBe(first.id);
    expect(mock.calls).toBe(1);
  });

  it("makes a polished fallback without a provider key", async () => {
    const { pipeline, world } = setup(new DisabledImageGenerator());
    const image = await pipeline.generate({ worldId: world.id, sceneId: "chapter-1-beat-1", moment: "chapter_scene" });
    expect(image.status).toBe("fallback");
    expect(image.fallbackUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("retries a provider exactly once then caches its terminal failure", async () => {
    const mock = new MockImageGenerator("error");
    const { pipeline, world } = setup(mock);
    const request = { worldId: world.id, sceneId: "chapter-1-beat-1", moment: "chapter_scene" as const, branchId: "test-branch-a" };
    expect((await pipeline.generate(request)).status).toBe("failed");
    expect(mock.calls).toBe(2);
    await pipeline.generate(request);
    expect(mock.calls).toBe(2);
  });
});
