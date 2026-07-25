import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInitialStory, generateNextChapter, reviseLatestChapter, type WorldStory } from "./story.js";
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

function generatedCharacter(index: number) {
  return {
    id: `test-character-${index}`,
    name: `Test Character ${index}`,
    role: `Test role ${index}`,
    visualDescription: `Test visual ${index}.`,
    personality: `Test trait ${index}.`,
    goal: `Complete test goal ${index}.`,
    memories: [`Test memory ${index}.`],
  };
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

  it("uses an uncapped cast schema for initial generation and retains every returned persistent character", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        characters: Array.from({ length: 5 }, (_, index) => generatedCharacter(index + 1)),
        chapter: {
          id: "provider-chapter", number: 1, title: "Test Opening", narration: "A".repeat(420),
          beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} initial test visual moment`, caption })),
          audioDirection: { primaryEmotion: "reflection", secondaryEmotion: "suspense", intensity: 0.4, bgmCue: "reflection", narrationDelivery: "clear and measured" },
        },
        worldState: "The test world holds a stable opening state while all persistent test characters are introduced.",
      }) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);

    const story = await generateInitialStory(world);
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected the initial model request to include an init object");
    const requestBody = JSON.parse(String(request.body)) as { text: { format: { schema: { properties: Record<string, Record<string, unknown>> } } } };

    expect(requestBody.text.format.schema.properties.characters).not.toHaveProperty("maxItems");
    expect(story.characters).toHaveLength(5);
    expect(story.characters.map((character) => character.id)).toEqual(["test-character-1", "test-character-2", "test-character-3", "test-character-4", "test-character-5"]);
  });

  it("gives repeated provider beat labels distinct chapter-scoped scene identities", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "chapter_02", number: 2, title: "Test Second Chapter", narration: "A".repeat(420),
        beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} distinct test visual moment`, caption })),
        newCharacters: [],
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
    expect(next?.chapter.id).toBe("chapter-2");
    expect(next?.chapter.beats.map((beat) => beat.id)).toEqual(["chapter-2-beat-1", "chapter-2-beat-2", "chapter-2-beat-3"]);
    expect(next?.chapter.beats.map((beat) => beat.id)).not.toContain("chapter-1-beat-1");
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected the model request to include an init object");
    const requestBody = JSON.parse(String(request.body)) as { text: { format: { schema: { required: string[]; properties: Record<string, Record<string, unknown>> } } } };
    expect(requestBody.text.format.schema.required).toContain("audioDirection");
    expect(requestBody.text.format.schema.required).toContain("newCharacters");
    expect(requestBody.text.format.schema.properties.newCharacters).not.toHaveProperty("maxItems");
  });

  it("includes queued directions in the next-chapter prompt and does not truncate direction-driven new characters", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "provider-chapter", number: 2, title: "Test Arrival", narration: "A".repeat(420),
        beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} test visual moment`, caption })),
        audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.6, bgmCue: "suspense", narrationDelivery: "careful and immediate" },
        newCharacters: Array.from({ length: 5 }, (_, index) => generatedCharacter(index + 2)),
      }) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing: WorldStory = {
      worldId: world.id,
      characters: [{ id: "test-character", name: "Test Character", role: "Test role", visualDescription: "Test coat", personality: "Steady", goal: "Reach the test gate", memories: [] }],
      chapters: [{ id: "chapter-1", number: 1, title: "Test First Chapter", narration: "A".repeat(420), beats: [{ id: "chapter-1-beat-1", description: "The first test visual moment", caption: "first" }] }],
      perspectives: [],
      upcomingDirections: ["Introduce a helpful Test Guide in the next chapter."],
      worldState: "The test gate remains closed while the test city waits for a signal.",
      source: "openai",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const generated = await generateNextChapter(world, existing);
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected the model request to include an init object");
    const requestBody = JSON.parse(String(request.body)) as { input: string };

    expect(requestBody.input).toContain('Queued directions for this chapter: ["Introduce a helpful Test Guide in the next chapter."]');
    expect(generated?.newCharacters).toHaveLength(5);
    expect(generated?.newCharacters.map((character) => character.id)).toEqual(["test-character-2", "test-character-3", "test-character-4", "test-character-5", "test-character-6"]);
    expect(generated?.chapter.id).toBe("chapter-2");
  });

  it("uses an unbounded new-character schema for revisions and returns every valid addition", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "provider-revision", number: 99, title: "Revised Test Chapter", narration: "B".repeat(420),
        beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} revised test visual moment`, caption })),
        audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.7, bgmCue: "suspense", narrationDelivery: "careful and immediate" },
        newCharacters: [generatedCharacter(2), generatedCharacter(3), generatedCharacter(4)],
      }) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing: WorldStory = {
      worldId: world.id,
      characters: [{ id: "test-character", name: "Test Character", role: "Test role", visualDescription: "Test coat", personality: "Steady", goal: "Reach the test gate", memories: [] }],
      chapters: [{ id: "chapter-1", number: 1, revision: 1, title: "Test First Chapter", narration: "A".repeat(420), beats: [{ id: "chapter-1-beat-1", description: "The first test visual moment", caption: "first" }] }],
      perspectives: [],
      worldState: "The test gate remains closed while the test city waits for a signal.",
      source: "openai",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const generated = await reviseLatestChapter(world, existing, "Introduce three test characters while revising this scene.");
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected the revision model request to include an init object");
    const requestBody = JSON.parse(String(request.body)) as { text: { format: { schema: { required: string[]; properties: Record<string, Record<string, unknown>> } } } };

    expect(requestBody.text.format.schema.required).toContain("newCharacters");
    expect(requestBody.text.format.schema.properties.newCharacters).not.toHaveProperty("maxItems");
    expect(generated?.newCharacters.map((character) => character.id)).toEqual(["test-character-2", "test-character-3", "test-character-4"]);
    expect(generated?.chapter).toMatchObject({ id: "chapter-1", number: 1, revision: 2 });
  });
});
