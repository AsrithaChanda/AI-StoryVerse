import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWorld } from "./generation.js";
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
    saveStory(target.id);
    saveStory(survivor.id);
    reserveImage(target.id);
    reserveImage(survivor.id);

    expect(store.deleteWorld(target.id)).toBe(true);
    expect(store.get(target.id)).toBeNull();
    expect(store.getWorldStory(target.id)).toBeNull();
    expect(store.findStoryImage(target.id, "chapter-1-beat-1")).toBeNull();
    expect(store.get(survivor.id)?.title).toBe("Keep Me");
    expect(store.getWorldStory(survivor.id)).not.toBeNull();
    expect(store.findStoryImage(survivor.id, "chapter-1-beat-1")).not.toBeNull();
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
});
