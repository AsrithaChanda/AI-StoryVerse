import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterAudioDirector } from "./chapter-audio-director.js";
import type { WorldStory } from "./story.js";
import { WorldStore, type World } from "./worlds.js";

function createTestWorld(store: WorldStore): World {
  return store.create(
    {
      title: "Test World",
      genre: "Test genre",
      premise: "A neutral premise used only to verify chapter audio behavior.",
      creatorPrompt: "Use test-only narration direction.",
    },
    {
      source: "fallback",
      openingScene: "A neutral test opening begins.",
      characters: [],
    },
  );
}

describe("chapter audio director", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalNarrationModel = process.env.OPENAI_NARRATION_MODEL;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalNarrationModel === undefined) delete process.env.OPENAI_NARRATION_MODEL;
    else process.env.OPENAI_NARRATION_MODEL = originalNarrationModel;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("couples an emotion-selected local BGM with an explicit narrator persona", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id,
      source: "openai",
      createdAt: "now",
      updatedAt: "now",
      worldState: "A test storm is gathering.",
      characters: [],
      perspectives: [],
      chapters: [{ id: "chapter-1", number: 1, title: "Test pursuit", narration: "The test group attacks through thunder while moving across the test route.", beats: [] }],
    };
    store.saveWorldStory(story);
    const plan = new ChapterAudioDirector(store).plan(world.id, "chapter-1");
    expect(plan).toMatchObject({ mood: "conflict", bgm: { id: "urgent", url: "/bgm/urgent.mp3" }, narrator: { genderPresentation: "neutral", ageTone: "mature", voice: "sage" } });
  });

  it("uses the selected character, rather than the world genre, for POV voice presentation", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id,
      source: "openai",
      createdAt: "now",
      updatedAt: "now",
      worldState: "The test signal is active.",
      chapters: [{ id: "chapter-1", number: 1, title: "Test choice", narration: "A test question waits.", beats: [] }],
      characters: [
        { id: "character-feminine", name: "Test Character Feminine", role: "Female test role", visualDescription: "A young woman in a test coat.", personality: "Brave", goal: "Complete the test", memories: [] },
        { id: "character-masculine", name: "Test Character Masculine", role: "Male test role", visualDescription: "A young man in a test coat.", personality: "Guarded", goal: "Protect the test", memories: [] },
      ],
      perspectives: [
        { characterId: "character-feminine", chapterId: "chapter-1", narration: "I observe the test route.", beats: [] },
        { characterId: "character-masculine", chapterId: "chapter-1", narration: "I pause at the test signal.", beats: [] },
      ],
    };
    store.saveWorldStory(story);
    const director = new ChapterAudioDirector(store);
    expect(director.plan(world.id, "chapter-1", "character-feminine")?.narrator).toMatchObject({ genderPresentation: "feminine", voice: "coral" });
    expect(director.plan(world.id, "chapter-1", "character-masculine")?.narrator).toMatchObject({ genderPresentation: "masculine", voice: "onyx" });
    expect(director.plan(world.id, "chapter-1", "character-feminine")).toMatchObject({ narrationSource: { kind: "character", label: "Test Character Feminine's perspective" }, narrationText: "I observe the test route." });
  });

  it("uses the model-authored chapter direction before the keyword fallback", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id,
      source: "openai",
      createdAt: "now",
      updatedAt: "now",
      worldState: "The test location waits.",
      characters: [],
      perspectives: [],
      chapters: [{ id: "chapter-1", number: 1, title: "Test activity", narration: "The test group attacks through thunder.", beats: [], audioDirection: { primaryEmotion: "grief", secondaryEmotion: "reflection", intensity: 0.8, bgmCue: "grief", narrationDelivery: "restrained and sorrowful" } }],
    };
    store.saveWorldStory(story);
    expect(new ChapterAudioDirector(store).plan(world.id, "chapter-1")).toMatchObject({ mood: "grief", bgm: { id: "transmission" }, narrator: { delivery: "restrained and sorrowful" } });
  });

  it("sends the exact selected POV prose to the dedicated speech endpoint", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story: WorldStory = {
      worldId: world.id,
      source: "openai",
      createdAt: "now",
      updatedAt: "now",
      worldState: "The test signal is active.",
      chapters: [{ id: "chapter-1", number: 1, title: "Test choice", narration: "The canonical test account is not read.", beats: [] }],
      characters: [{ id: "character-feminine", name: "Test Character Feminine", role: "Female test role", visualDescription: "A young woman in a test coat.", personality: "Brave", goal: "Complete the test", memories: [] }],
      perspectives: [{ characterId: "character-feminine", chapterId: "chapter-1", narration: "I observe the test route from the rain.", beats: [] }],
    };
    store.saveWorldStory(story);
    const directory = await mkdtemp(join(tmpdir(), "storyverse-audio-"));
    temporaryDirectories.push(directory);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_NARRATION_MODEL = "gpt-4o-mini-tts";
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(44), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const plan = new ChapterAudioDirector(store, directory).plan(world.id, "chapter-1", "character-feminine");
    const narration = await new ChapterAudioDirector(store, directory).narrate(plan!);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(narration.status).toBe("ready");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(String(request.body))).toMatchObject({ model: "gpt-4o-mini-tts", voice: "coral", input: "I observe the test route from the rain.", response_format: "wav" });
  });
});
