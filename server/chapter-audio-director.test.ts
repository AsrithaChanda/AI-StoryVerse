import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterAudioDirector } from "./chapter-audio-director.js";
import type { WorldStory } from "./story.js";
import { WorldStore } from "./worlds.js";

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
    const story: WorldStory = { worldId: "the-last-ember", source: "openai", createdAt: "now", updatedAt: "now", worldState: "A storm is gathering over Astra.", characters: [], perspectives: [], chapters: [{ id: "chapter-1", number: 1, title: "The pursuit", narration: "The army attacks through thunder while Mira runs across the bridge.", beats: [] }] };
    store.saveWorldStory(story);
    const plan = new ChapterAudioDirector(store).plan("the-last-ember", "chapter-1");
    expect(plan).toMatchObject({ mood: "conflict", bgm: { id: "urgent", url: "/bgm/urgent.mp3" }, narrator: { genderPresentation: "feminine", ageTone: "mature", voice: "coral" } });
  });

  it("uses the selected character, rather than the world genre, for POV voice presentation", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const story: WorldStory = { worldId: "the-last-ember", source: "openai", createdAt: "now", updatedAt: "now", worldState: "The bell rings.", chapters: [{ id: "chapter-1", number: 1, title: "The choice", narration: "A secret waits.", beats: [] }], characters: [{ id: "mira", name: "Mira", role: "Heroine", visualDescription: "A young woman in blue.", personality: "Brave", goal: "Protect the city", memories: [] }, { id: "kael", name: "Kael", role: "Prince", visualDescription: "A young man in silver.", personality: "Guarded", goal: "Keep a secret", memories: [] }], perspectives: [{ characterId: "mira", chapterId: "chapter-1", narration: "I watch the bridge.", beats: [] }, { characterId: "kael", chapterId: "chapter-1", narration: "I hold my breath.", beats: [] }] };
    store.saveWorldStory(story); const director = new ChapterAudioDirector(store);
    expect(director.plan("the-last-ember", "chapter-1", "mira")?.narrator).toMatchObject({ genderPresentation: "feminine", voice: "coral" });
    expect(director.plan("the-last-ember", "chapter-1", "kael")?.narrator).toMatchObject({ genderPresentation: "masculine", voice: "onyx" });
    expect(director.plan("the-last-ember", "chapter-1", "mira")).toMatchObject({ narrationSource: { kind: "character", label: "Mira's perspective" }, narrationText: "I watch the bridge." });
  });

  it("uses the model-authored chapter direction before the keyword fallback", () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const story: WorldStory = { worldId: "the-last-ember", source: "openai", createdAt: "now", updatedAt: "now", worldState: "The city waits.", characters: [], perspectives: [], chapters: [{ id: "chapter-1", number: 1, title: "The battle", narration: "The army attacks through thunder.", beats: [], audioDirection: { primaryEmotion: "grief", secondaryEmotion: "reflection", intensity: 0.8, bgmCue: "grief", narrationDelivery: "restrained and sorrowful" } }] };
    store.saveWorldStory(story);
    expect(new ChapterAudioDirector(store).plan("the-last-ember", "chapter-1")).toMatchObject({ mood: "grief", bgm: { id: "transmission" }, narrator: { delivery: "restrained and sorrowful" } });
  });

  it("sends the exact selected POV prose to the dedicated speech endpoint", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const story: WorldStory = { worldId: "the-last-ember", source: "openai", createdAt: "now", updatedAt: "now", worldState: "The bell rings.", chapters: [{ id: "chapter-1", number: 1, title: "The choice", narration: "The canonical account is not read.", beats: [] }], characters: [{ id: "mira", name: "Mira", role: "Heroine", visualDescription: "A young woman in blue.", personality: "Brave", goal: "Protect the city", memories: [] }], perspectives: [{ characterId: "mira", chapterId: "chapter-1", narration: "I watch the bridge from the rain.", beats: [] }] };
    store.saveWorldStory(story);
    const directory = await mkdtemp(join(tmpdir(), "storyverse-audio-"));
    temporaryDirectories.push(directory);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_NARRATION_MODEL = "gpt-4o-mini-tts";
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(44), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const plan = new ChapterAudioDirector(store, directory).plan("the-last-ember", "chapter-1", "mira");
    const narration = await new ChapterAudioDirector(store, directory).narrate(plan!);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(narration.status).toBe("ready");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(String(request.body))).toMatchObject({ model: "gpt-4o-mini-tts", voice: "coral", input: "I watch the bridge from the rain.", response_format: "wav" });
  });
});
