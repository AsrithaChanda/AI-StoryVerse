import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInitialStory, generateNextChapter, type ChapterTransition, type WorldStory } from "./story.js";
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

function completedNarration(letter: string): string {
  return `${letter.repeat(419)}.`;
}

function generatedTransition(label = "test"): ChapterTransition {
  return {
    resolvedBeat: `The ${label} chapter resolves its immediate test pressure.`,
    closingImage: `A final ${label} lantern remains above the test gate.`,
    nextChapterHook: `The next test chapter must answer the waiting signal.`,
    carryForward: [`The ${label} gate remains watched.`, `The ${label} signal has changed.`],
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
          id: "provider-chapter", number: 1, title: "Test Opening", narration: completedNarration("A"), transition: generatedTransition("opening"),
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
    const requestBody = JSON.parse(String(request.body)) as { text: { format: { schema: { properties: Record<string, { required?: string[] }> } } } };

    expect(requestBody.text.format.schema.properties.characters).not.toHaveProperty("maxItems");
    expect(requestBody.text.format.schema.properties.chapter?.required).toContain("transition");
    expect(story.characters).toHaveLength(5);
    expect(story.characters.map((character) => character.id)).toEqual(["test-character-1", "test-character-2", "test-character-3", "test-character-4", "test-character-5"]);
  });

  it("gives repeated provider beat labels distinct chapter-scoped scene identities", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "chapter_02", number: 2, title: "Test Second Chapter", narration: completedNarration("A"), transition: generatedTransition("second"),
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
    expect(requestBody.text.format.schema.required).toContain("transition");
    expect(requestBody.text.format.schema.required).toContain("newCharacters");
    expect(requestBody.text.format.schema.properties.newCharacters).not.toHaveProperty("maxItems");
  });

  it("includes queued directions in the next-chapter prompt and does not truncate direction-driven new characters", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "provider-chapter", number: 2, title: "Test Arrival", narration: completedNarration("A"), transition: generatedTransition("arrival"),
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

  it("normalizes and persists the complete canonical chapter transition", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const rawTransition = {
      resolvedBeat: "  Mira settles the bridge signal before the storm reaches the gate.  ",
      closingImage: " The last lantern turns gold above the river. ",
      nextChapterHook: " Who sent the second bell from the far bank? ",
      carryForward: [" The broken seal now belongs to Mira. ", " Kael heard the second bell.  "],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify({
      id: "provider-chapter", number: 2, title: "The second bell", narration: completedNarration("C"), transition: rawTransition,
      beats: ["first", "second", "third"].map((caption) => ({ id: "provider", description: `${caption} normalized transition visual.`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.65, bgmCue: "suspense", narrationDelivery: "controlled and close" },
      newCharacters: [],
    }) })));
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id, characters: [generatedCharacter(1)],
      chapters: [{ id: "chapter-1", number: 1, title: "Legacy test", narration: "The first test bell resolves at dusk.", beats: [{ id: "chapter-1-beat-1", description: "The legacy test bell settles.", caption: "Legacy bell" }] }],
      perspectives: [], worldState: "The test gate remains watched.", source: "openai", createdAt: "now", updatedAt: "now",
    };

    const generated = await generateNextChapter(world, story);

    expect(generated?.chapter.transition).toEqual({
      resolvedBeat: "Mira settles the bridge signal before the storm reaches the gate.",
      closingImage: "The last lantern turns gold above the river.",
      nextChapterHook: "Who sent the second bell from the far bank?",
      carryForward: ["The broken seal now belongs to Mira.", "Kael heard the second bell."],
    });
  });

  it("rejects missing or malformed provider transitions and literal prose cutoffs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const valid = {
      id: "provider-chapter", number: 2, title: "The strict test", narration: completedNarration("D"), transition: generatedTransition("strict"),
      beats: ["first", "second", "third"].map((caption) => ({ id: "provider", description: `${caption} strict transition visual.`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.65, bgmCue: "suspense", narrationDelivery: "controlled and close" },
      newCharacters: [],
    };
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.transition;
    const malformed = { ...valid, transition: { ...generatedTransition("malformed"), carryForward: [] } };
    const cutoff = { ...valid, narration: "D".repeat(420) };
    const responses = [missing, missing, malformed, malformed, cutoff, cutoff];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify(responses.shift()) })));
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id, characters: [generatedCharacter(1)],
      chapters: [{ id: "chapter-1", number: 1, title: "Test", narration: "The previous chapter closes correctly.", beats: [{ id: "chapter-1-beat-1", description: "The prior signal settles.", caption: "Prior signal" }] }],
      perspectives: [], worldState: "The test gate remains watched.", source: "openai", createdAt: "now", updatedAt: "now",
    };

    await expect(generateNextChapter(world, story)).resolves.toBeNull();
    await expect(generateNextChapter(world, story)).resolves.toBeNull();
    await expect(generateNextChapter(world, story)).resolves.toBeNull();
  });

  it("re-generates once when a complete JSON chapter lacks a closing sentence without imposing a schema prose ceiling", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const cutoff = {
      id: "provider-chapter", number: 2, title: "The cut off chapter", narration: "C".repeat(1900), transition: generatedTransition("cutoff"),
      beats: ["first", "second", "third"].map((caption) => ({ id: "provider", description: `${caption} cutoff repair visual.`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.65, bgmCue: "suspense", narrationDelivery: "controlled and close" },
      newCharacters: [],
    };
    const repaired = { ...cutoff, title: "The completed chapter", narration: completedNarration("R"), transition: generatedTransition("repaired") };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify(fetchMock.mock.calls.length === 1 ? cutoff : repaired) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id, characters: [generatedCharacter(1)],
      chapters: [{ id: "chapter-1", number: 1, title: "Previous", narration: "The previous chapter concludes at the gate.", beats: [{ id: "chapter-1-beat-1", description: "The previous signal settles.", caption: "Prior signal" }] }],
      perspectives: [], worldState: "The test gate remains watched.", source: "openai", createdAt: "now", updatedAt: "now",
    };

    const generated = await generateNextChapter(world, story);

    expect(generated?.chapter).toMatchObject({ title: "The completed chapter", transition: generatedTransition("repaired") });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { text: { format: { schema: { properties: { narration: { minLength?: number; maxLength?: number } } } } } };
    const repair = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { instructions: string };
    // gpt-5.6-luna treated a JSON Schema maxLength as an exact writing target,
    // repeatedly ending at that character count. Keep the lower quality floor,
    // but let the prompt determine the intended short chapter range.
    expect(first.text.format.schema.properties.narration.minLength).toBe(350);
    expect(first.text.format.schema.properties.narration).not.toHaveProperty("maxLength");
    expect(repair.instructions).toContain("reserve a final closing paragraph");
  });

  it("retries a max-output incomplete Responses result with a bounded larger budget", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const recovered = {
      id: "provider-chapter", number: 2, title: "The recovered chapter", narration: completedNarration("M"), transition: generatedTransition("recovered"),
      beats: ["first", "second", "third"].map((caption) => ({ id: "provider", description: `${caption} recovered output visual.`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.65, bgmCue: "suspense", narrationDelivery: "controlled and close" },
      newCharacters: [],
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return fetchMock.mock.calls.length === 1
        ? new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }))
        : new Response(JSON.stringify({ output_text: JSON.stringify(recovered) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id, characters: [generatedCharacter(1)],
      chapters: [{ id: "chapter-1", number: 1, title: "Previous", narration: "The previous chapter concludes at the gate.", beats: [{ id: "chapter-1-beat-1", description: "The prior signal settles.", caption: "Prior signal" }] }],
      perspectives: [], worldState: "The test gate remains watched.", source: "openai", createdAt: "now", updatedAt: "now",
    };

    await expect(generateNextChapter(world, story)).resolves.toMatchObject({ chapter: { title: "The recovered chapter" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { max_output_tokens: number };
    const second = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { max_output_tokens: number };
    expect([first.max_output_tokens, second.max_output_tokens]).toEqual([6000, 12000]);
  });

  it("accepts a compatible completed Responses text content part before canonical validation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const recovered = {
      id: "provider-chapter", number: 2, title: "Compatible response", narration: completedNarration("T"), transition: generatedTransition("compatible"),
      beats: ["first", "second", "third"].map((caption) => ({ id: "provider", description: `${caption} compatible output visual.`, caption })),
      audioDirection: { primaryEmotion: "reflection", secondaryEmotion: "suspense", intensity: 0.4, bgmCue: "reflection", narrationDelivery: "measured and clear" },
      newCharacters: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "text", text: JSON.stringify(recovered) }] }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id, characters: [generatedCharacter(1)],
      chapters: [{ id: "chapter-1", number: 1, title: "Previous", narration: "The previous chapter concludes at the gate.", beats: [{ id: "chapter-1-beat-1", description: "The prior signal settles.", caption: "Prior signal" }] }],
      perspectives: [], worldState: "The test gate remains watched.", source: "openai", createdAt: "now", updatedAt: "now",
    };

    await expect(generateNextChapter(world, story)).resolves.toMatchObject({ chapter: { title: "Compatible response" } });
  });

  it("adds a derived compact transition for legacy chapters while preserving their full previous prose", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        id: "provider-chapter", number: 2, title: "Legacy continuation", narration: completedNarration("E"), transition: generatedTransition("continuation"),
        beats: ["first", "second", "third"].map((caption) => ({ id: "provider", description: `${caption} legacy continuity visual.`, caption })),
        audioDirection: { primaryEmotion: "reflection", secondaryEmotion: "suspense", intensity: 0.4, bgmCue: "reflection", narrationDelivery: "measured and clear" },
        newCharacters: [],
      }) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const legacyNarration = "The legacy lantern dims after the gatekeeper keeps the river signal from crossing.";
    const story: WorldStory = {
      worldId: world.id, characters: [generatedCharacter(1)],
      chapters: [{ id: "chapter-1", number: 1, title: "Legacy chapter", narration: legacyNarration, beats: [{ id: "chapter-1-beat-1", description: "The gatekeeper steadies the legacy lantern.", caption: "Legacy lantern" }] }],
      perspectives: [], worldState: "The test gate remains watched.", source: "openai", createdAt: "now", updatedAt: "now",
    };

    await expect(generateNextChapter(world, story)).resolves.toMatchObject({ chapter: { transition: generatedTransition("continuation") } });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { input: string; instructions: string };
    expect(body.input).toContain(`Previous chapter: ${legacyNarration}`);
    expect(body.input).toContain("Prior chapter transition (compact continuity contract):");
    expect(body.input).toContain("Carry forward the immediate consequence");
    expect(body.instructions).toContain("Address or escalate the prior transition's nextChapterHook in an immediate beat early in this chapter");
  });

  it("clamps structured-output budget and treats incomplete Responses results as failed generation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("STORYVERSE_STORY_MAX_OUTPUT_TOKENS", "999999");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{}" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);

    const story = await generateInitialStory(world);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ max_output_tokens: 16_000 });
    expect(story).toMatchObject({ source: "fallback", chapters: [], characters: [] });
  });
});
