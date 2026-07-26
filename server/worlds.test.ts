import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWorld } from "./generation.js";
import { toPublicStoryTrailer } from "./persistence/store.js";
import { WorldStore } from "./worlds.js";

function createWorld(store: WorldStore, title = "The Glass Horizon") {
  return store.create(
    { title, genre: "Solarpunk mystery", premise: "A city sails between storms.", creatorPrompt: "Tender, strange, and suspenseful." },
    { source: "fallback", openingScene: "The first storm speaks in the old language at dawn, and everyone on the deck hears their own name.", characters: [] },
  );
}

describe("world archive", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts with an empty archive and persists a created world in SQLite", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    expect(store.list()).toEqual([]);
    const created = createWorld(store);
    expect(store.get(created.id)?.title).toBe("The Glass Horizon");
    expect(store.list()).toHaveLength(1);
  });

  it("deletes only the selected world's story and database image records", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const target = createWorld(store, "Delete Me");
    const survivor = createWorld(store, "Keep Me");
    const timestamp = "2026-01-01T00:00:00.000Z";
    const saveStory = (worldId: string) => store.saveWorldStory({
      worldId, characters: [], chapters: [], perspectives: [],
      source: "fallback", createdAt: timestamp, updatedAt: timestamp,
      worldState: "A saved state that belongs only to this world.",
    });
    const reserveImage = (worldId: string) => store.reserveStoryImage({
      cacheKey: `image-${worldId}`, worldId, sceneId: "chapter-1-beat-1",
      characterIds: [], promptVersion: "test", prompt: "A test image.",
      fallbackUrl: "data:image/svg+xml;base64,",
    });
    const reserveTrailer = (worldId: string) => store.reserveStoryTrailer({
      cacheKey: `trailer-${worldId}`, worldId, chapterId: "chapter-1", chapterRevision: 1,
      kind: "story_so_far" as const,
      promptVersion: "test", prompt: "A concise trailer prompt that is never returned to a browser.",
    });
    saveStory(target.id);
    saveStory(survivor.id);
    reserveImage(target.id);
    reserveImage(survivor.id);
    reserveTrailer(target.id);
    reserveTrailer(survivor.id);

    expect(store.deleteWorld(target.id)).toBe(true);
    expect(store.get(target.id)).toBeNull();
    expect(store.getWorldStory(target.id)).toBeNull();
    expect(store.findStoryImage(target.id, "chapter-1-beat-1")).toBeNull();
    expect(store.findStoryTrailer(target.id, "chapter-1", 1, "story_so_far")).toBeNull();
    expect(store.get(survivor.id)?.title).toBe("Keep Me");
    expect(store.getWorldStory(survivor.id)).not.toBeNull();
    expect(store.findStoryImage(survivor.id, "chapter-1-beat-1")).not.toBeNull();
    expect(store.findStoryTrailer(survivor.id, "chapter-1", 1, "story_so_far")).not.toBeNull();
    expect(store.deleteWorld("missing-world")).toBe(false);
  });

  it("keeps offline world blueprints free of invented character records", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const generated = await generateWorld({ title: "Hollow Atlas", genre: "Science fantasy", premise: "Maps change the terrain.", creatorPrompt: "Vivid and intimate." });
    expect(generated.source).toBe("fallback");
    expect(generated.characters).toEqual([]);
    expect(generated.openingScene).toContain("Hollow Atlas");
    expect(generated.openingScene).toContain("Maps change the terrain.");
  });

  it("removes legacy canned fallback copy without changing other stored worlds", () => {
    const database = new DatabaseSync(":memory:");
    new WorldStore(database);
    database.prepare("INSERT INTO worlds (id,title,premise,genre,creator_prompt,opening_scene,characters_json,source,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("bahubali", "Bahubali", "A kingdom faces its past.", "Epic", "Grounded", "At the edge of Bahubali, the first impossible sign appears before dawn. The people closest to it must choose whether to protect the familiar world or step into the danger named in their own stories.", JSON.stringify([{ name: "Ari Vale" }, { name: "Sable Orr" }, { name: "The Warden" }]), "fallback", "2026-01-02T00:00:00.000Z");
    const migrated = new WorldStore(database);
    expect(migrated.get("bahubali")?.characters).toEqual([]);
    expect(migrated.get("bahubali")?.openingScene).toBe("The story opens in Bahubali. A kingdom faces its past.");
  });

  it("removes only the retired seeded world and its stored story and image rows", () => {
    const database = new DatabaseSync(":memory:");
    const initial = new WorldStore(database);
    const created = createWorld(initial, "A User-Created Archive");
    const timestamp = "2026-01-01T00:00:00.000Z";

    database.prepare(`INSERT INTO worlds (id,title,premise,genre,creator_prompt,opening_scene,characters_json,source,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("the-last-ember", "The Last Ember", "Retired demo", "Fantasy", "Retired demo", "Retired demo opening.", "[]", "seed", timestamp);
    database.prepare("INSERT INTO world_stories (world_id, story_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("the-last-ember", JSON.stringify({ worldId: "the-last-ember", chapters: [] }), timestamp, timestamp);
    database.prepare(`INSERT INTO story_images (
      id, cache_key, world_id, branch_id, scene_id, protagonist_id,
      character_ids_json, prompt_version, prompt, status, image_url,
      fallback_url, provider, provider_asset_id, error_code, retry_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("legacy-image", "legacy-image-cache-key", "the-last-ember", null, "legacy-scene", null, "[]", "legacy", "legacy image", "ready", "https://example.test/legacy.png", "data:image/svg+xml;base64,", null, null, null, 0, timestamp, timestamp);

    const migrated = new WorldStore(database);
    expect(migrated.get("the-last-ember")).toBeNull();
    expect(migrated.get(created.id)?.title).toBe("A User-Created Archive");
    expect(database.prepare("SELECT COUNT(*) AS count FROM world_stories WHERE world_id = ?").get("the-last-ember")).toMatchObject({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM story_images WHERE world_id = ?").get("the-last-ember")).toMatchObject({ count: 0 });
  });

  it("migrates old repeated beat labels into distinct saved chapter image identities", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createWorld(store, "Image Archive");
    store.saveWorldStory({
      worldId: world.id, characters: [], perspectives: [], worldState: "The city is waiting for the next signal from the eastern bridge.", source: "openai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      chapters: [
        { id: "chapter_01", number: 1, title: "One", narration: "The opening chapter preserves a first visual memory for this world.", beats: [{ id: "beat_01", description: "A gold bridge", caption: "Gold bridge" }] },
        { id: "chapter_02", number: 2, title: "Two", narration: "The second chapter preserves a different visual memory for the same world.", beats: [{ id: "beat_01", description: "A violet storm", caption: "Violet storm" }] },
      ],
    });
    const migrated = store.getWorldStory(world.id)!;
    expect(migrated.chapters.map((chapter) => chapter.id)).toEqual(["chapter-1", "chapter-2"]);
    expect(migrated.chapters.map((chapter) => chapter.beats[0].id)).toEqual(["chapter-1-beat-1", "chapter-2-beat-1"]);
    expect(store.getWorldStory(world.id)?.chapters[1].beats[0].id).toBe("chapter-2-beat-1");
  });

  it("preserves revision-specific chapter and perspective beat identities during migration", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createWorld(store, "Revision Archive");
    store.saveWorldStory({
      worldId: world.id,
      characters: [{ id: "test-character", name: "Test Character", role: "Watcher", visualDescription: "Test coat", personality: "Careful", goal: "Observe the test signal", memories: [] }],
      worldState: "The test signal remains active while the current chapter is revised.",
      source: "openai",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      chapters: [{
        id: "chapter_01",
        number: 1,
        revision: 2,
        title: "Revised Test Chapter",
        narration: "The revised test chapter keeps its own visual identity so old generated assets cannot be reused.",
        beats: [{ id: "provider_beat", description: "A revised test signal", caption: "Revised signal" }],
      }],
      perspectives: [{
        characterId: "test-character",
        chapterId: "chapter_01",
        narration: "I observe the revised test signal.",
        beats: [{ id: "provider_perspective_beat", description: "The revised test view", caption: "Revised view" }],
      }],
    });

    const migrated = store.getWorldStory(world.id)!;
    expect(migrated.chapters[0]).toMatchObject({ id: "chapter-1", number: 1, revision: 2 });
    expect(migrated.chapters[0]?.beats.map((beat) => beat.id)).toEqual(["chapter-1-r2-beat-1"]);
    expect(migrated.perspectives[0]).toMatchObject({ chapterId: "chapter-1", characterId: "test-character" });
    expect(migrated.perspectives[0]?.beats.map((beat) => beat.id)).toEqual(["chapter-1-r2-test-character-beat-1"]);
    expect(store.getWorldStory(world.id)?.chapters[0]?.beats[0]?.id).toBe("chapter-1-r2-beat-1");
  });

  it("removes legacy raw author commands from visible world state", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createWorld(store, "State Archive");
    store.saveWorldStory({ worldId: world.id, characters: [], chapters: [], perspectives: [], source: "openai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", worldState: "A storm threatens Chandraka. Author direction: add thunder. Author direction: save Arin." });
    expect(store.getWorldStory(world.id)?.worldState).toBe("A storm threatens Chandraka.");
  });

  it("reserves one trailer per cache key and advances its durable render lifecycle", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createWorld(store, "Trailer Archive");
    const input = {
      cacheKey: "trailer-cache-key",
      worldId: world.id,
      chapterId: "chapter-1",
      chapterRevision: 2,
      kind: "story_so_far" as const,
      promptVersion: "storyverse-trailer-v1",
      prompt: "A server-only cinematic trailer prompt for the current story snapshot.",
    };

    const first = store.reserveStoryTrailer(input);
    const duplicate = store.reserveStoryTrailer(input);
    expect(first).toMatchObject({ created: true, trailer: { status: "queued", progress: 0, retryCount: 0 } });
    expect(duplicate).toMatchObject({ created: false, trailer: { id: first.trailer.id } });
    const publicTrailer = toPublicStoryTrailer(first.trailer);
    expect(publicTrailer).not.toHaveProperty("prompt");
    expect(publicTrailer).not.toHaveProperty("providerJobId");
    expect(publicTrailer).not.toHaveProperty("cacheKey");

    expect(store.markStoryTrailerQueued(input.cacheKey, {
      provider: "sora-2", providerJobId: "video_123", status: "in_progress", progress: 18,
    })).toMatchObject({ status: "in_progress", progress: 18, providerJobId: "video_123" });
    expect(store.markStoryTrailerProgress(input.cacheKey, 63.7, "in_progress"))
      .toMatchObject({ status: "in_progress", progress: 64 });
    expect(store.markStoryTrailerReady(input.cacheKey, {
      videoUrl: "/api/worlds/trailer/content", provider: "sora-2", providerAssetId: "volumes/path/trailer.mp4",
    })).toMatchObject({ status: "ready", progress: 100, videoUrl: "/api/worlds/trailer/content" });
    expect(store.findReadyStoryTrailer(world.id, input.chapterId, input.chapterRevision, input.kind))
      .toMatchObject({ cacheKey: input.cacheKey, status: "ready" });

    // A stale provider poll must not turn a completed trailer back into a pending one.
    expect(store.markStoryTrailerProgress(input.cacheKey, 30, "in_progress"))
      .toMatchObject({ status: "ready", progress: 100 });

    const failedInput = { ...input, cacheKey: "failed-trailer-cache-key", chapterRevision: 1 };
    store.reserveStoryTrailer(failedInput);
    expect(store.markStoryTrailerFailed(failedInput.cacheKey, "provider_error"))
      .toMatchObject({ status: "failed", errorCode: "provider_error", retryCount: 1 });
    expect(store.requeueFailedStoryTrailer(failedInput.cacheKey))
      .toMatchObject({ requeued: true, trailer: { status: "queued", progress: 0, errorCode: undefined, retryCount: 2, providerJobId: undefined } });
    expect(store.requeueFailedStoryTrailer(failedInput.cacheKey))
      .toMatchObject({ requeued: false, trailer: { status: "queued", retryCount: 2 } });
  });

  it("removes only trailers for rolled-back future chapters", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createWorld(store, "Trailer Timeline");
    store.saveWorldStory({
      worldId: world.id,
      characters: [],
      perspectives: [],
      worldState: "The first chapter remains the canonical point after the future is removed.",
      source: "fallback",
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T10:00:00.000Z",
      chapters: [
        { id: "chapter-1", number: 1, title: "First", narration: "The first chapter ends with a clear handoff into the second.", beats: [] },
        { id: "chapter-2", number: 2, title: "Second", narration: "The second chapter is eligible for a trailer until it is removed.", beats: [] },
      ],
    });
    store.reserveStoryTrailer({ cacheKey: "trailer-first", worldId: world.id, chapterId: "chapter-1", chapterRevision: 1, kind: "story_so_far", promptVersion: "v1", prompt: "First trailer." });
    store.reserveStoryTrailer({ cacheKey: "trailer-second", worldId: world.id, chapterId: "chapter-2", chapterRevision: 1, kind: "story_so_far", promptVersion: "v1", prompt: "Second trailer." });

    const result = store.deleteFutureChapters(world.id, "chapter-1");
    expect(result).toMatchObject({ ok: true, value: { removedChapterIds: ["chapter-2"] } });
    expect(store.findStoryTrailer(world.id, "chapter-1", 1, "story_so_far")).not.toBeNull();
    expect(store.findStoryTrailer(world.id, "chapter-2", 1, "story_so_far")).toBeNull();
  });

  it("persists one active Time Machine job per world and records its progress", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createWorld(store, "Time Machine World");
    const input = {
      worldId: world.id,
      targetChapterId: "chapter-2",
      targetChapterNumber: 2,
      changePrompt: "The hero chooses to tell the truth.",
      futurePrompt: "Keep the family together while the mystery grows.",
      baseStoryVersion: 0,
      baseStoryUpdatedAt: "2026-07-26T10:00:00.000Z",
      totalChapters: 3,
    };
    const first = store.reserveTimeMachineJob(input);
    const duplicate = store.reserveTimeMachineJob({ ...input, changePrompt: "A competing rewrite." });
    expect(first).toMatchObject({ created: true, job: { status: "queued", progress: 0 } });
    expect(duplicate).toMatchObject({ created: false, job: { id: first.job.id } });

    expect(store.claimTimeMachineJob(first.job.id)).toMatchObject({ status: "running", progress: 2 });
    expect(store.markTimeMachineJobProgress(first.job.id, "illustrating", 84, 3))
      .toMatchObject({ status: "illustrating", progress: 84, completedChapters: 3 });
    expect(store.markTimeMachineJobCompleted(first.job.id, 3))
      .toMatchObject({ status: "completed", progress: 100, completedChapters: 3 });
    expect(store.findLatestTimeMachineJob(world.id)).toMatchObject({ id: first.job.id, status: "completed" });

    expect(store.reserveTimeMachineJob({ ...input, changePrompt: "A later rewrite." }))
      .toMatchObject({ created: true, job: { status: "queued" } });
  });
});
