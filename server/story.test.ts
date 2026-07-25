import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInitialStory, generateNextChapter, type WorldStory } from "./story.js";
import { WorldStore } from "./worlds.js";

describe("persistent created-world stories", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("persists chapters, cast, and character perspective records across store instances", () => {
    const database = new DatabaseSync(":memory:");
    const store = new WorldStore(database);
    const story = store.saveWorldStory({ worldId: "the-last-ember", characters: [{ id: "arya", name: "Arya", role: "Scout", visualDescription: "Indigo coat", personality: "Patient", goal: "Protect the pass", memories: ["The gate was open at dawn."] }], chapters: [{ id: "chapter-1", number: 1, title: "Dawn Gate", narration: "A long opening chapter that establishes a persistent world and the choice waiting beneath its gates.", beats: [{ id: "gate-beat", description: "Arya reaches the old gate as dawn breaks.", caption: "Dawn at the gate" }] }], perspectives: [{ characterId: "arya", chapterId: "chapter-1", narration: "Arya sees the gate open.", beats: [{ id: "arya-gate-beat", description: "The gate opens in Arya's view.", caption: "A scout's warning" }] }], worldState: "The northern gate is open.", source: "openai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const reloaded = new WorldStore(database).getWorldStory("the-last-ember");
    expect(reloaded?.chapters[0]?.title).toBe("Dawn Gate");
    expect(reloaded?.characters[0]?.memories).toContain("The gate was open at dawn.");
    expect(reloaded?.perspectives[0]?.characterId).toBe("arya");
    expect(new WorldStore(database).visualBeat("the-last-ember", "chapter-1-arya-beat-1")).toContain("Arya's view");
    expect(story.worldId).toBe("the-last-ember");
  });

  it("does not invent a generic story or cast when no model key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const story = await generateInitialStory(store.get("the-last-ember")!);
    expect(story.source).toBe("fallback");
    expect(story.characters).toEqual([]);
    expect(story.chapters).toEqual([]);
  });

  it("gives repeated provider beat labels distinct chapter-scoped scene identities", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify({
      id: "chapter_02", number: 2, title: "The Second Horizon", narration: "A".repeat(420),
      beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} distinct visual moment`, caption })),
    }) }))));
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const existing: WorldStory = {
      worldId: "the-last-ember", characters: [{ id: "aria", name: "Aria", role: "Pilot", visualDescription: "Blue coat", personality: "Steady", goal: "Reach the gate", memories: [] }],
      chapters: [{ id: "chapter-1", number: 1, title: "First Horizon", narration: "A".repeat(420), beats: [{ id: "chapter-1-beat-1", description: "The first distinct visual moment", caption: "first" }] }],
      perspectives: [], worldState: "The gate remains closed while the city waits for a signal.", source: "openai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const next = await generateNextChapter(store.get("the-last-ember")!, existing);
    expect(next?.id).toBe("chapter-2");
    expect(next?.beats.map((beat) => beat.id)).toEqual(["chapter-2-beat-1", "chapter-2-beat-2", "chapter-2-beat-3"]);
    expect(next?.beats.map((beat) => beat.id)).not.toContain("chapter-1-beat-1");
  });
});
