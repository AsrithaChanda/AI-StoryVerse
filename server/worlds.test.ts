import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWorld } from "./generation.js";
import { WorldStore } from "./worlds.js";

describe("world archive", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("seeds The Last Ember and persists a created world in SQLite", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    expect(store.list()).toHaveLength(1);
    const created = store.create({ title: "The Glass Horizon", genre: "Solarpunk mystery", premise: "A city sails between storms.", creatorPrompt: "Tender, strange, and suspenseful." }, { source: "fallback", openingScene: "The first storm speaks in the old language at dawn, and everyone on the deck hears their own name.", characters: [{ name: "Ari", role: "Navigator", trait: "Fearless" }, { name: "Sol", role: "Archivist", trait: "Patient" }, { name: "Vale", role: "Warden", trait: "Secretive" }] });
    expect(store.get(created.id)?.title).toBe("The Glass Horizon");
    expect(store.list()).toHaveLength(2);
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

  it("migrates old repeated beat labels into distinct saved chapter image identities", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    store.saveWorldStory({
      worldId: "the-last-ember", characters: [], perspectives: [], worldState: "The city is waiting for the next signal from the eastern bridge.", source: "openai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      chapters: [
        { id: "chapter_01", number: 1, title: "One", narration: "The opening chapter preserves a first visual memory for this world.", beats: [{ id: "beat_01", description: "A gold bridge", caption: "Gold bridge" }] },
        { id: "chapter_02", number: 2, title: "Two", narration: "The second chapter preserves a different visual memory for the same world.", beats: [{ id: "beat_01", description: "A violet storm", caption: "Violet storm" }] },
      ],
    });
    const migrated = store.getWorldStory("the-last-ember")!;
    expect(migrated.chapters.map((chapter) => chapter.id)).toEqual(["chapter-1", "chapter-2"]);
    expect(migrated.chapters.map((chapter) => chapter.beats[0].id)).toEqual(["chapter-1-beat-1", "chapter-2-beat-1"]);
    expect(store.getWorldStory("the-last-ember")?.chapters[1].beats[0].id).toBe("chapter-2-beat-1");
  });

  it("removes legacy raw author commands from visible world state", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    store.saveWorldStory({ worldId: "the-last-ember", characters: [], chapters: [], perspectives: [], source: "openai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", worldState: "A storm threatens Chandraka. Author direction: add thunder. Author direction: save Arin." });
    expect(store.getWorldStory("the-last-ember")?.worldState).toBe("A storm threatens Chandraka.");
  });
});
