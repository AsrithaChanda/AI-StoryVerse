import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInitialStory, generateNextChapter, type WorldStory } from "./story.js";
import { WorldStore, type World } from "./worlds.js";

function createTestWorld(store: WorldStore): World {
  return store.create(
    {
      title: "Test World",
      genre: "Test genre",
      premise: "A neutral premise used only to verify story persistence.",
      creatorPrompt: "Use original test-only story data.",
    },
    {
      source: "fallback",
      openingScene: "A neutral test opening begins.",
      characters: [],
    },
  );
}

describe("persistent created-world stories", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("persists chapters, cast, and character perspective records across store instances", () => {
    const database = new DatabaseSync(":memory:");
    const store = new WorldStore(database);
    const world = createTestWorld(store);
    const story = store.saveWorldStory({
      worldId: world.id,
      characters: [{ id: "test-character", name: "Test Character", role: "Test role", visualDescription: "Test visual", personality: "Patient", goal: "Complete the test", memories: ["The test gate was open at dawn."] }],
      chapters: [{ id: "chapter-1", number: 1, title: "Test Chapter", narration: "A long test opening chapter establishes persistence and a later choice at the test gate.", beats: [{ id: "chapter-1-beat-1", description: "Test Character reaches the test gate as dawn breaks.", caption: "Test gate" }] }],
      perspectives: [{ characterId: "test-character", chapterId: "chapter-1", narration: "Test Character sees the test gate open.", beats: [{ id: "chapter-1-test-character-beat-1", description: "The test gate opens in Test Character's view.", caption: "A test warning" }] }],
      worldState: "The test gate is open.",
      source: "openai",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const reloaded = new WorldStore(database).getWorldStory(world.id);
    expect(reloaded?.chapters[0]?.title).toBe("Test Chapter");
    expect(reloaded?.characters[0]?.memories).toContain("The test gate was open at dawn.");
    expect(reloaded?.perspectives[0]?.characterId).toBe("test-character");
    expect(new WorldStore(database).visualBeat(world.id, "chapter-1-test-character-beat-1")).toContain("Test Character's view");
    expect(story.worldId).toBe(world.id);
  });

  it("does not invent a generic story or cast when no model key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story = await generateInitialStory(world);
    expect(story.source).toBe("fallback");
    expect(story.characters).toEqual([]);
    expect(story.chapters).toEqual([]);
  });

  it("gives repeated provider beat labels distinct chapter-scoped scene identities", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "chapter_02", number: 2, title: "Test Second Chapter", narration: "A".repeat(420),
        beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} distinct test visual moment`, caption })),
      }) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing: WorldStory = {
      worldId: world.id,
      characters: [{ id: "test-character", name: "Test Character", role: "Test role", visualDescription: "Test coat", personality: "Steady", goal: "Reach the test gate", memories: [] }],
      chapters: [{ id: "chapter-1", number: 1, title: "Test First Chapter", narration: "A".repeat(420), beats: [{ id: "chapter-1-beat-1", description: "The first distinct test visual moment", caption: "first" }] }],
      perspectives: [],
      worldState: "The test gate remains closed while the test city waits for a signal.",
      source: "openai",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const next = await generateNextChapter(world, existing);
    expect(next?.id).toBe("chapter-2");
    expect(next?.beats.map((beat) => beat.id)).toEqual(["chapter-2-beat-1", "chapter-2-beat-2", "chapter-2-beat-3"]);
    expect(next?.beats.map((beat) => beat.id)).not.toContain("chapter-1-beat-1");
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected the model request to include an init object");
    const requestBody = JSON.parse(String(request.body)) as { text: { format: { schema: { required: string[] } } } };
    expect(requestBody.text.format.schema.required).toContain("audioDirection");
  });
});
