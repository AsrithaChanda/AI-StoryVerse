import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIStoryTrailerProvider,
  StoryTrailerService,
  StoryTrailerError,
  type StoryTrailerProvider,
  createStoryTrailerProviderFromEnvironment,
} from "./story-trailer.js";
import type { AssetStore, StoredAsset } from "./storage/index.js";
import { WorldStore } from "./worlds.js";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe("OpenAI story trailer provider", () => {
  it("uses the configured server environment key", () => {
    process.env.OPENAI_API_KEY = "server-test-key";
    expect(createStoryTrailerProviderFromEnvironment().isAvailable).toBe(true);
  });

  it("starts a video job using multipart fields without exposing the key", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/videos");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-test-key");
      expect(init?.body).toBeInstanceOf(FormData);
      const body = init?.body as FormData;
      expect(body.get("model")).toBe("sora-2");
      expect(body.get("prompt")).toBe("An original cinematic world.");
      expect(body.get("seconds")).toBe("8");
      expect(body.get("size")).toBe("1280x720");
      return Response.json({ id: "video_job_123", status: "queued", progress: 0 });
    });
    const provider = new OpenAIStoryTrailerProvider({
      apiKey: "server-test-key",
      fetch: fetcher,
      timeoutMs: 5_000,
    });

    await expect(provider.create({
      prompt: "An original cinematic world.",
      seconds: 8,
      size: "1280x720",
    })).resolves.toEqual({
      id: "video_job_123",
      status: "queued",
      progress: 0,
      providerAssetId: undefined,
      errorCode: undefined,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("remains disabled without an API key", async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIStoryTrailerProvider({ apiKey: "" });
    expect(provider.isAvailable).toBe(false);
    await expect(provider.create({
      prompt: "A trailer.",
      seconds: 8,
      size: "1280x720",
    })).rejects.toMatchObject({ code: "provider_disabled", statusCode: 503 } satisfies Partial<StoryTrailerError>);
  });

  it("starts a prompt-driven remix from a completed video id", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/videos/video_123/remix");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(init?.body).toBe(JSON.stringify({ prompt: "Make the ending more suspenseful." }));
      return Response.json({ id: "video_456", status: "queued", progress: 0 });
    });
    const provider = new OpenAIStoryTrailerProvider({
      apiKey: "server-test-key",
      fetch: fetcher,
      timeoutMs: 5_000,
    });

    await expect(provider.remix("video_123", "Make the ending more suspenseful."))
      .resolves.toMatchObject({ id: "video_456", status: "queued" });
  });
});

describe("chapter trailer service", () => {
  it("keeps one video per chapter and saves a prompt remix as a new version", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = store.create(
      {
        title: "The Quiet Orbit",
        premise: "A drifting observatory hears a signal from inside a dead moon.",
        genre: "Cinematic science-fiction mystery",
        creatorPrompt: "Build wonder into mounting suspense.",
      },
      {
        source: "fallback",
        openingScene: "The observatory turns toward the silent moon.",
        characters: [],
      },
    );
    const timestamp = "2026-07-26T10:00:00.000Z";
    store.saveWorldStory({
      worldId: world.id,
      characters: [],
      perspectives: [],
      worldState: "The signal has changed the observatory's course.",
      source: "fallback",
      createdAt: timestamp,
      updatedAt: timestamp,
      chapters: [
        {
          id: "chapter-1",
          number: 1,
          revision: 1,
          title: "The Signal",
          narration: "The observatory receives an impossible signal and turns toward the moon.",
          beats: [{ id: "beat-1", description: "A lone observatory turns against a field of stars.", caption: "The course changes." }],
        },
        {
          id: "chapter-2",
          number: 2,
          revision: 1,
          title: "Under the Crust",
          narration: "The crew follows the signal beneath the moon's fractured crust.",
          beats: [{ id: "beat-2", description: "A small vessel descends into a luminous lunar fracture.", caption: "The descent begins." }],
        },
      ],
    });

    let created = 0;
    const createPrompts: string[] = [];
    const createDurations: number[] = [];
    const remixCalls: Array<{ source: string; prompt: string }> = [];
    const provider: StoryTrailerProvider = {
      name: "test-video",
      isAvailable: true,
      async create(input) {
        created += 1;
        createPrompts.push(input.prompt);
        createDurations.push(input.seconds);
        return { id: `video_${created}`, status: "completed", progress: 100 };
      },
      async remix(source, prompt) {
        remixCalls.push({ source, prompt });
        return { id: "video_remix_1", status: "completed", progress: 100 };
      },
      async retrieve(jobId) {
        return { id: jobId, status: "completed", progress: 100 };
      },
      async download(jobId) {
        return { bytes: new Uint8Array(32).fill(7), contentType: "video/mp4", providerAssetId: jobId };
      },
    };
    const saved = new Map<string, StoredAsset>();
    const assets: AssetStore = {
      async put(key, bytes, contentType) { saved.set(key, { bytes, contentType }); },
      async exists(key) { return saved.has(key); },
      async read(key) { return saved.get(key) ?? null; },
    };
    const service = new StoryTrailerService({ store, assets, provider });

    const chapterOne = await service.startForChapter(world.id, "chapter-1", "story_so_far");
    const chapterTwo = await service.startForChapter(world.id, "chapter-2", "story_so_far");
    const chapterTwoOnly = await service.startForChapter(world.id, "chapter-2", "chapter");
    expect(chapterOne).toMatchObject({ chapterId: "chapter-1", status: "ready" });
    expect(chapterTwo).toMatchObject({ chapterId: "chapter-2", kind: "story_so_far", status: "ready" });
    expect(chapterTwoOnly).toMatchObject({ chapterId: "chapter-2", kind: "chapter", status: "ready" });
    expect(chapterOne.videoUrl).not.toBe(chapterTwo.videoUrl);
    expect(chapterTwo.videoUrl).not.toBe(chapterTwoOnly.videoUrl);
    expect(createPrompts[1]).toContain("observatory turns");
    expect(createPrompts[1]).toContain("luminous lunar fracture");
    expect(createPrompts[2]).not.toContain("observatory turns");
    expect(createPrompts[2]).toContain("luminous lunar fracture");
    expect(createDurations).toEqual([12, 12, 12]);

    const edited = await service.remix(world.id, "chapter-1", "story_so_far", "Use a slower final camera move and a darker score.");
    expect(edited).toMatchObject({ chapterId: "chapter-1", status: "ready" });
    expect(edited.videoUrl).not.toBe(chapterOne.videoUrl);
    expect(remixCalls).toHaveLength(1);
    expect(remixCalls[0].source).toBe("video_1");
    expect(await service.getForChapter(world.id, "chapter-1", "story_so_far")).toMatchObject({ videoUrl: edited.videoUrl });
    expect(await service.getForChapter(world.id, "chapter-2", "story_so_far")).toMatchObject({ videoUrl: chapterTwo.videoUrl });
    expect(saved.size).toBe(4);

    const currentStory = store.getWorldStory(world.id);
    expect(currentStory).not.toBeNull();
    store.saveWorldStory({
      ...currentStory!,
      chapters: currentStory!.chapters.map((chapter) => chapter.id === "chapter-2"
        ? { ...chapter, revision: 2, narration: `${chapter.narration} The revised ending is now canonical.` }
        : chapter),
      updatedAt: "2026-07-26T11:00:00.000Z",
    });
    expect(await service.getForChapter(world.id, "chapter-2", "chapter")).toBeNull();
    expect(await service.getForChapter(world.id, "chapter-2", "story_so_far")).toBeNull();
    expect(await service.getForChapter(world.id, "chapter-1", "story_so_far"))
      .toMatchObject({ videoUrl: edited.videoUrl });
  });
});
