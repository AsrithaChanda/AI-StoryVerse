import { DatabaseSync } from "node:sqlite";
import type { Response as ExpressResponse } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoryRouter } from "./story-routes.js";
import { generateNextChapterStream, type StoryChapter, type WorldStory } from "./story.js";
import { WorldStore, type World } from "./worlds.js";

function createTestWorld(store: WorldStore): World {
  return store.create(
    { title: "Streaming Test World", genre: "Test fantasy", premise: "A safe test world waits for a streamed continuation.", creatorPrompt: "Use only test data." },
    { source: "fallback", openingScene: "A safe test opening begins.", characters: [] },
  );
}

function existingStory(worldId: string): WorldStory {
  return {
    worldId,
    characters: [{ id: "test-character", name: "Test Character", role: "Watcher", visualDescription: "A blue test cloak", personality: "Careful", goal: "Protect the test gate", memories: ["The test bell sounded once."] }],
    chapters: [{ id: "chapter-1", number: 1, title: "Test Opening", narration: "A".repeat(420), beats: [{ id: "chapter-1-beat-1", description: "A test lantern burns.", caption: "Test lantern" }] }],
    perspectives: [],
    worldState: "The test gate is closed while the city watches the horizon.",
    source: "openai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

type NewCharacterPayload = { id: string; name: string; role: string; visualDescription: string; personality: string; goal: string; memories: string[] };

type ChapterTransition = {
  resolvedBeat: string;
  closingImage: string;
  nextChapterHook: string;
  carryForward: string[];
};

type NextChapterPayload = StoryChapter & { newCharacters: NewCharacterPayload[]; transition?: ChapterTransition };

function nextPayload(
  narration: string,
  newCharacters: NewCharacterPayload[] = [],
  transition: ChapterTransition | null = chapterTransition("Generated chapter ending"),
): NextChapterPayload {
  const completedNarration = /[.!?…]$/.test(narration) ? narration : `${narration}.`;
  return {
    id: "provider-chapter", number: 99, title: "The Test Bell", narration: completedNarration,
    beats: [
      { id: "beat_01", description: "The test bell glows at dusk.", caption: "Test bell" },
      { id: "beat_02", description: "A test gate opens.", caption: "Test gate" },
      { id: "beat_03", description: "The test city waits under rain.", caption: "Test rain" },
    ],
    audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.7, bgmCue: "suspense", narrationDelivery: "measured and close" },
    newCharacters,
    ...(transition ? { transition } : {}),
  };
}

function chapterTransition(label: string): ChapterTransition {
  return {
    resolvedBeat: `${label}: Mira unbars the rain-soaked gate but chooses not to cross it yet.`,
    closingImage: `${label}: a blue lantern swings above the open gate while the road turns silver in rain.`,
    nextChapterHook: `${label}: at dawn, someone knocks from the far side carrying the missing seal.`,
    carryForward: [
      `${label}: Mira has opened the gate but remains outside it.`,
      `${label}: the stranger and missing seal remain unresolved.`,
    ],
  };
}

function transitionOf(chapter: StoryChapter): ChapterTransition | undefined {
  return (chapter as StoryChapter & { transition?: ChapterTransition }).transition;
}

function directorPayload(): Record<string, unknown> {
  return {
    directorIntent: "Slow the first exchange so the approaching decision feels earned rather than abrupt.",
    changes: [{
      category: "pacing",
      summary: "Lets the bell warning land before the choice.",
      rationale: "A held beat gives the reader time to feel the chapter's uncertainty.",
      affectedBeatIds: ["chapter-1-beat-1"],
    }],
    proposedChapter: {
      title: "The Bell Before Dawn",
      narration: `${"B".repeat(519)}.`,
      beats: [
        { description: "The bell's first note travels through the rain before anyone dares to name its source.", caption: "A bell in rain" },
        { description: "A waiting hand hovers over the gate latch while the city falls quiet behind it.", caption: "The held decision" },
        { description: "The lanterns turn toward the river as the choice finally asks to be made.", caption: "The river's answer" },
      ],
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.64, bgmCue: "suspense", narrationDelivery: "patient and intimate" },
      transition: chapterTransition("Director revision"),
    },
  };
}

function readable(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function responseFromDeltas(
  deltas: string[],
  transportSplit = false,
  completed: Record<string, unknown> = { type: "response.completed" },
): Response {
  const sse = [
    ...deltas.map((delta) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`),
    `event: response.completed\ndata: ${JSON.stringify(completed)}\n\n`,
  ].join("");
  const chunks = transportSplit ? [sse.slice(0, 23), sse.slice(23, 117), sse.slice(117)] : [sse];
  return new Response(readable(chunks), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function providerErrorResponse(): Response {
  return new Response(readable([`event: error\ndata: ${JSON.stringify({ type: "error", message: "provider detail must not be returned" })}\n\n`]), { status: 200 });
}

function modelJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify({ output_text: JSON.stringify(payload) }), { status, headers: { "content-type": "application/json" } });
}

type RouteHandler = { handle: (request: unknown, response: unknown, next: () => void) => unknown };
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: RouteHandler[] } };

function routeHandler(store: WorldStore, path: string, method: "post" | "delete"): RouteHandler {
  const router = createStoryRouter(store) as unknown as { stack: RouteLayer[] };
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route;
  if (!route) throw new Error(`Route not found: ${method} ${path}`);
  return route.stack[0]!;
}

function postRoute(store: WorldStore, path: string): RouteHandler {
  return routeHandler(store, path, "post");
}

function deleteRoute(store: WorldStore, path: string): RouteHandler {
  return routeHandler(store, path, "delete");
}

function streamRecorder(): { response: ExpressResponse; events: () => Array<{ event: string; payload: unknown }>; ended: () => boolean } {
  const writes: string[] = [];
  let wasEnded = false;
  const response = {
    status: () => response,
    set: () => response,
    json: () => response,
    write: (value: string) => { writes.push(value); return true; },
    end: () => { wasEnded = true; },
  };
  return {
    response: response as unknown as ExpressResponse,
    events: () => writes.join("").trim().split(/\n\n/).filter(Boolean).map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) throw new Error(`Invalid SSE block: ${block}`);
      return { event, payload: JSON.parse(data) };
    }),
    ended: () => wasEnded,
  };
}

function jsonRecorder(): { response: ExpressResponse; status: () => number; payload: () => unknown } {
  let statusCode = 200;
  let responsePayload: unknown;
  const response = {
    status: (code: number) => { statusCode = code; return response; },
    set: () => response,
    json: (payload: unknown) => { responsePayload = payload; return response; },
    write: () => true,
    end: () => undefined,
  };
  return { response: response as unknown as ExpressResponse, status: () => statusCode, payload: () => responsePayload };
}

function rollbackCharacter(id: string, introducedInChapter: string) {
  return {
    id,
    name: `Rollback ${id}`,
    role: "Test role",
    visualDescription: "A distinct rollback test visual.",
    personality: "Careful",
    goal: "Preserve the rollback contract.",
    memories: ["The rollback test began."],
    introducedInChapter,
  } as WorldStory["characters"][number];
}

function rollbackStory(worldId: string): WorldStory {
  const chapter = (number: number): StoryChapter => ({
    id: `chapter-${number}`,
    number,
    revision: 1,
    title: `Rollback Chapter ${number}`,
    narration: `Rollback chapter ${number} preserves a distinct test continuity state.`,
    beats: [{ id: `chapter-${number}-beat-1`, description: `Rollback chapter ${number} visual beat.`, caption: `Rollback ${number}` }],
  });
  return {
    worldId,
    characters: [rollbackCharacter("base-character", "chapter-1"), rollbackCharacter("chapter-two-character", "chapter-2"), rollbackCharacter("chapter-three-character", "chapter-3")],
    chapters: [chapter(1), chapter(2), chapter(3)],
    perspectives: [
      { characterId: "base-character", chapterId: "chapter-1", narration: "Chapter one view.", beats: [{ id: "chapter-1-base-character-beat-1", description: "Chapter one perspective.", caption: "One" }] },
      { characterId: "chapter-two-character", chapterId: "chapter-2", narration: "Chapter two view.", beats: [{ id: "chapter-2-chapter-two-character-beat-1", description: "Chapter two perspective.", caption: "Two" }] },
      { characterId: "chapter-three-character", chapterId: "chapter-3", narration: "Chapter three view.", beats: [{ id: "chapter-3-chapter-three-character-beat-1", description: "Chapter three perspective.", caption: "Three" }] },
    ],
    upcomingDirections: ["Keep this queued direction after rollback."],
    worldState: "The rollback test world preserves earlier canonical history.",
    source: "openai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function reserveRollbackImage(store: WorldStore, worldId: string, sceneId: string): void {
  store.reserveStoryImage({
    cacheKey: `rollback-${worldId}-${sceneId}`,
    worldId,
    sceneId,
    characterIds: [],
    promptVersion: "rollback-test",
    prompt: "A rollback test image.",
    fallbackUrl: "data:image/svg+xml;base64,",
  });
}

describe("progressive story generation", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("streams decoded narration only across escaped partial JSON and normalizes after validation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const narration = 'The test bell said, "wait."\nA blue ember answered.';
    const raw = JSON.stringify(nextPayload(narration));
    const quote = raw.indexOf('\\"') + 1;
    const newline = raw.indexOf("\\n") + 1;
    const deltas = [raw.slice(0, quote), raw.slice(quote, newline), raw.slice(newline)];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return responseFromDeltas(deltas, true);
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const fragments: string[] = [];
    const phases: string[] = [];

    const chapter = await generateNextChapterStream(world, existingStory(world.id), {
      onNarration: (text) => fragments.push(text),
      onPhase: (stage) => phases.push(stage),
    });

    expect(fragments.join("")).toBe(narration);
    expect(phases).toEqual(["validating"]);
    expect(chapter?.chapter).toMatchObject({ id: "chapter-2", number: 2, narration });
    expect(chapter?.chapter.beats.map((beat) => beat.id)).toEqual(["chapter-2-beat-1", "chapter-2-beat-2", "chapter-2-beat-3"]);
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected a streamed Responses request");
    const requestBody = JSON.parse(String(request.body)) as { stream: boolean; text: { format: { type: string; strict: boolean } } };
    expect(requestBody.stream).toBe(true);
    expect(requestBody.text.format).toMatchObject({ type: "json_schema", strict: true });
  });

  it("emits phase, narration, and complete events only after the new chapter persists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const narration = "The test bell sends a clear signal across the rain.";
    vi.stubGlobal("fetch", vi.fn(async () => responseFromDeltas([JSON.stringify(nextPayload(narration))])));
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    store.saveWorldStory(existingStory(world.id));
    const recorder = streamRecorder();

    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    const events = recorder.events();
    expect(recorder.ended()).toBe(true);
    expect(events[0]).toEqual({ event: "phase", payload: { stage: "writing" } });
    const streamedNarration = events.filter((entry) => entry.event === "narration")
      .map((entry) => (entry.payload as { text: string }).text).join("");
    expect(streamedNarration).toBe(narration);
    expect(events).toContainEqual({ event: "phase", payload: { stage: "validating" } });
    const complete = events.at(-1);
    expect(complete?.event).toBe("complete");
    expect((complete?.payload as { chapter: StoryChapter }).chapter.id).toBe("chapter-2");
    expect(store.getWorldStory(world.id)?.chapters).toHaveLength(2);
  });

  it("persists a non-streamed chapter ending and passes its compact handoff into the next generation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const firstTransition = chapterTransition("First ending");
    const secondTransition = chapterTransition("Second ending");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelJsonResponse(nextPayload("B".repeat(420), [], firstTransition)))
      .mockResolvedValueOnce(modelJsonResponse(nextPayload("C".repeat(420), [], secondTransition)));
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    store.saveWorldStory(existingStory(world.id));

    const firstRecorder = jsonRecorder();
    await postRoute(store, "/worlds/:worldId/story/next")
      .handle({ params: { worldId: world.id }, body: {} }, firstRecorder.response, () => undefined);

    const afterFirst = store.getWorldStory(world.id)!;
    expect(firstRecorder.status()).toBe(200);
    expect(transitionOf(afterFirst.chapters.at(-1)!)).toEqual(firstTransition);

    const secondRecorder = jsonRecorder();
    await postRoute(store, "/worlds/:worldId/story/next")
      .handle({ params: { worldId: world.id }, body: {} }, secondRecorder.response, () => undefined);

    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    if (!secondRequest) throw new Error("Expected a second next-chapter model request");
    const secondInput = JSON.parse(String(secondRequest.body)) as { input: string };
    expect(secondRecorder.status()).toBe(200);
    expect(secondInput.input).toContain(JSON.stringify(firstTransition));
    expect(transitionOf(store.getWorldStory(world.id)!.chapters.at(-1)!)).toEqual(secondTransition);
  });

  it("persists a streamed chapter ending and passes its compact handoff into the next generation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const firstTransition = chapterTransition("Streamed first ending");
    const secondTransition = chapterTransition("Streamed second ending");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFromDeltas([JSON.stringify(nextPayload("D".repeat(420), [], firstTransition))], true))
      .mockResolvedValueOnce(responseFromDeltas([JSON.stringify(nextPayload("E".repeat(420), [], secondTransition))], true));
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    store.saveWorldStory(existingStory(world.id));

    const firstRecorder = streamRecorder();
    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, firstRecorder.response, () => undefined);

    const firstComplete = firstRecorder.events().at(-1);
    expect(firstComplete?.event).toBe("complete");
    expect(transitionOf((firstComplete?.payload as { chapter: StoryChapter }).chapter)).toEqual(firstTransition);
    expect(transitionOf(store.getWorldStory(world.id)!.chapters.at(-1)!)).toEqual(firstTransition);

    const secondRecorder = streamRecorder();
    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, secondRecorder.response, () => undefined);

    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    if (!secondRequest) throw new Error("Expected a second streamed next-chapter model request");
    const secondInput = JSON.parse(String(secondRequest.body)) as { input: string };
    expect(secondRecorder.events().at(-1)?.event).toBe("complete");
    expect(secondInput.input).toContain(JSON.stringify(firstTransition));
    expect(transitionOf(store.getWorldStory(world.id)!.chapters.at(-1)!)).toEqual(secondTransition);
  });

  it("falls back to a legacy chapter's narration when no persisted handoff exists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(modelJsonResponse(nextPayload("F".repeat(420), [], chapterTransition("Legacy follow-up"))));
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const legacy = existingStory(world.id);
    store.saveWorldStory(legacy);
    const recorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/next")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    if (!request) throw new Error("Expected a legacy next-chapter model request");
    const input = JSON.parse(String(request.body)) as { input: string };
    expect(recorder.status()).toBe(200);
    expect(input.input).toContain(legacy.chapters[0]!.narration);
  });

  it("does not persist a non-streamed generated chapter when its ending handoff is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelJsonResponse(nextPayload("G".repeat(420), [], null))));
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const before = store.saveWorldStory(existingStory(world.id));
    const recorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/next")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    expect(recorder.status()).toBe(503);
    expect(recorder.payload()).toMatchObject({
      error: expect.stringContaining("The next chapter could not be generated."),
      code: "next_chapter_generation_failed",
      retryable: true,
      queuedDirectionsPreserved: true,
      queuedDirectionCount: 0,
    });
    expect(store.getWorldStory(world.id)).toEqual(before);
  });

  it("does not persist a streamed generated chapter when its ending handoff is malformed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const malformed = {
      ...nextPayload("H".repeat(420), [], chapterTransition("Malformed ending")),
      transition: {
        resolvedBeat: "Mira opens the gate.",
        closingImage: 42,
        nextChapterHook: "A stranger waits beyond the rain.",
        carryForward: "The missing seal is unresolved.",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromDeltas([JSON.stringify(malformed)])));
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const before = store.saveWorldStory(existingStory(world.id));
    const recorder = streamRecorder();

    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    expect(recorder.events().at(-1)).toMatchObject({
      event: "error",
      payload: {
        error: expect.stringContaining("The next chapter could not be generated."),
        code: "next_chapter_generation_failed",
        retryable: true,
        queuedDirectionsPreserved: true,
        queuedDirectionCount: 0,
      },
    });
    expect(store.getWorldStory(world.id)).toEqual(before);
  });

  it("does not persist a streamed chapter when the provider marks the completed response incomplete", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const payload = nextPayload("I".repeat(420), [], chapterTransition("Incomplete provider response"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromDeltas(
      [JSON.stringify(payload)],
      false,
      { type: "response.completed", response: { status: "incomplete" } },
    )));
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const before = store.saveWorldStory(existingStory(world.id));
    const recorder = streamRecorder();

    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    expect(recorder.events().at(-1)).toMatchObject({
      event: "error",
      payload: {
        error: expect.stringContaining("The next chapter could not be generated."),
        code: "next_chapter_generation_failed",
        retryable: true,
        queuedDirectionsPreserved: true,
        queuedDirectionCount: 0,
      },
    });
    expect(store.getWorldStory(world.id)).toEqual(before);
  });

  it("does not persist partial output when the provider emits an error event", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => providerErrorResponse()));
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const story = store.saveWorldStory(existingStory(world.id));
    const recorder = streamRecorder();

    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    expect(recorder.ended()).toBe(true);
    expect(recorder.events().map((entry) => entry.event)).toEqual(["phase", "error"]);
    expect(recorder.events().at(-1)?.payload).toMatchObject({
      error: expect.stringContaining("The next chapter could not be generated."),
      code: "next_chapter_generation_failed",
      retryable: true,
      queuedDirectionsPreserved: true,
      queuedDirectionCount: 0,
    });
    expect(store.getWorldStory(world.id)?.chapters).toHaveLength(story.chapters.length);
  });

  it("persists every direction-driven generated character and consumes directions only after a successful next chapter", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing = existingStory(world.id);
    existing.upcomingDirections = ["Introduce Test Guide in the next chapter."];
    store.saveWorldStory(existing);
    const additions: NewCharacterPayload[] = Array.from({ length: 5 }, (_, index) => {
      const number = index + 2;
      return {
        id: `test-character-${number}`,
        name: `Test Character ${number}`,
        role: `Test role ${number}`,
        visualDescription: `A distinct test coat ${number}.`,
        personality: `Test trait ${number}.`,
        goal: `Complete test goal ${number}.`,
        memories: [`Test memory ${number}.`],
      };
    });
    vi.stubGlobal("fetch", vi.fn(async () => modelJsonResponse(nextPayload("A".repeat(420), additions))));
    const recorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/next")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    const payload = recorder.payload() as { story: WorldStory };
    const persisted = store.getWorldStory(world.id)!;
    expect(recorder.status()).toBe(200);
    expect(payload.story.upcomingDirections).toEqual([]);
    expect(persisted.upcomingDirections).toEqual([]);
    expect(persisted.characters).toHaveLength(existing.characters.length + additions.length);
    expect(persisted.characters.map((character) => character.id)).toEqual([
      "test-character",
      "test-character-2",
      "test-character-3",
      "test-character-4",
      "test-character-5",
      "test-character-6",
    ]);
    expect(persisted.chapters).toHaveLength(2);
  });

  it("preserves queued directions when next-chapter generation fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing = existingStory(world.id);
    existing.upcomingDirections = ["Keep the test signal unresolved."];
    store.saveWorldStory(existing);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider failure", { status: 503 })));
    const recorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/next")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    expect(recorder.status()).toBe(503);
    expect(recorder.payload()).toMatchObject({
      error: expect.stringContaining("The next chapter could not be generated."),
      code: "next_chapter_generation_failed",
      retryable: true,
      queuedDirectionsPreserved: true,
      queuedDirectionCount: 1,
    });
    expect((recorder.payload() as { error: string }).error).toContain("1 queued direction is still saved.");
    expect(store.getWorldStory(world.id)?.upcomingDirections).toEqual(["Keep the test signal unresolved."]);
    expect(store.getWorldStory(world.id)?.chapters).toHaveLength(1);
  });

  it("returns a retryable streamed failure while retaining queued directions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing = existingStory(world.id);
    existing.upcomingDirections = ["Let the test guide arrive at dawn."];
    store.saveWorldStory(existing);
    vi.stubGlobal("fetch", vi.fn(async () => providerErrorResponse()));
    const recorder = streamRecorder();

    await postRoute(store, "/worlds/:worldId/story/next/stream")
      .handle({ params: { worldId: world.id }, body: {} }, recorder.response, () => undefined);

    expect(recorder.events().at(-1)).toMatchObject({
      event: "error",
      payload: {
        error: expect.stringContaining("1 queued direction is still saved. Try again"),
        code: "next_chapter_generation_failed",
        retryable: true,
        queuedDirectionsPreserved: true,
        queuedDirectionCount: 1,
      },
    });
    expect(store.getWorldStory(world.id)?.upcomingDirections).toEqual(["Let the test guide arrive at dawn."]);
    expect(store.getWorldStory(world.id)?.chapters).toHaveLength(1);
  });

  it("atomically persists revision-introduced characters with the rewritten chapter and clears stale current perspectives", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing = existingStory(world.id);
    existing.chapters[0] = { ...existing.chapters[0]!, revision: 1 };
    existing.upcomingDirections = ["Keep the next chapter's test signal unresolved."];
    existing.perspectives = [{
      characterId: "test-character",
      chapterId: "chapter-1",
      narration: "The prior test perspective must be regenerated after revision.",
      beats: [{ id: "chapter-1-test-character-beat-1", description: "The prior test view.", caption: "Prior view" }],
    }];
    store.saveWorldStory(existing);
    const additions: NewCharacterPayload[] = [2, 3, 4].map((number) => ({
      id: `revision-character-${number}`,
      name: `Revision Character ${number}`,
      role: `Revision role ${number}`,
      visualDescription: `A distinct revision visual ${number}.`,
      personality: `Revision trait ${number}.`,
      goal: `Complete revision goal ${number}.`,
      memories: [`Revision memory ${number}.`],
    }));
    vi.stubGlobal("fetch", vi.fn(async () => modelJsonResponse({
      id: "provider-revision", number: 99, title: "Revised Test Opening", narration: `${"B".repeat(420)}.`,
      beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} revised test visual moment`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.8, bgmCue: "suspense", narrationDelivery: "more immediate" },
      transition: chapterTransition("Revised opening"),
      newCharacters: additions,
    })));
    const recorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/revise")
      .handle({ params: { worldId: world.id }, body: { prompt: "Make the current test scene more suspenseful." } }, recorder.response, () => undefined);

    const payload = recorder.payload() as { story: WorldStory; chapter: StoryChapter };
    const persisted = store.getWorldStory(world.id)!;
    expect(recorder.status()).toBe(200);
    expect(payload.chapter).toMatchObject({ id: "chapter-1", number: 1, revision: 2 });
    expect(payload.chapter.beats.map((beat) => beat.id)).toEqual(["chapter-1-r2-beat-1", "chapter-1-r2-beat-2", "chapter-1-r2-beat-3"]);
    expect(persisted.chapters[0]).toMatchObject({ id: "chapter-1", number: 1, revision: 2 });
    expect(payload.story.characters).toHaveLength(1 + additions.length);
    expect(persisted.characters.map((character) => character.id)).toEqual([
      "test-character",
      "revision-character-2",
      "revision-character-3",
      "revision-character-4",
    ]);
    expect(persisted.perspectives).toEqual([]);
    expect(persisted.upcomingDirections).toEqual(["Keep the next chapter's test signal unresolved."]);
  });

  it.each([
    ["malformed", [{ id: "malformed-character", name: "Malformed Character", role: "Role", visualDescription: "Visual", personality: "Trait", memories: ["Memory"] }]],
    ["duplicate", [{ id: "test-character", name: "Duplicate Character", role: "Role", visualDescription: "Visual", personality: "Trait", goal: "Goal", memories: ["Memory"] }]],
  ] as const)("does not partially mutate cast or chapter when revision additions are %s", async (_kind, newCharacters) => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const existing = existingStory(world.id);
    existing.chapters[0] = { ...existing.chapters[0]!, revision: 1 };
    const before = store.saveWorldStory(existing);
    vi.stubGlobal("fetch", vi.fn(async () => modelJsonResponse({
      id: "provider-revision", number: 99, title: "Rejected Revision", narration: `${"B".repeat(420)}.`,
      beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} rejected test visual moment`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.8, bgmCue: "suspense", narrationDelivery: "more immediate" },
      transition: chapterTransition("Rejected revision"),
      newCharacters,
    })));
    const recorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/revise")
      .handle({ params: { worldId: world.id }, body: { prompt: "Attempt an invalid revision addition." } }, recorder.response, () => undefined);

    const persisted = store.getWorldStory(world.id)!;
    expect(recorder.status()).toBe(503);
    expect(recorder.payload()).toEqual({ error: "The current chapter could not be revised" });
    expect(persisted.characters).toEqual(before.characters);
    expect(persisted.chapters).toEqual(before.chapters);
  });

  it("guards delete-latest rollback against non-latest selection without mutating saved state", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const before = store.saveWorldStory(rollbackStory(world.id));
    reserveRollbackImage(store, world.id, "chapter-2-beat-1");
    const recorder = jsonRecorder();

    await deleteRoute(store, "/worlds/:worldId/story/chapters/:chapterId")
      .handle({ params: { worldId: world.id, chapterId: "chapter-2" }, body: {} }, recorder.response, () => undefined);

    expect(recorder.status()).toBe(409);
    expect(store.getWorldStory(world.id)).toEqual(before);
    expect(store.findStoryImage(world.id, "chapter-2-beat-1")).not.toBeNull();
  });

  it("rejects deleting the immutable first chapter and leaves its story assets intact", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const source = rollbackStory(world.id);
    const before = store.saveWorldStory({
      ...source,
      chapters: source.chapters.filter((chapter) => chapter.id === "chapter-1"),
      perspectives: source.perspectives.filter((perspective) => perspective.chapterId === "chapter-1"),
      characters: source.characters.filter((character) => character.introducedInChapter === "chapter-1"),
    });
    reserveRollbackImage(store, world.id, "chapter-1-beat-1");
    const recorder = jsonRecorder();

    await deleteRoute(store, "/worlds/:worldId/story/chapters/:chapterId")
      .handle({ params: { worldId: world.id, chapterId: "chapter-1" }, body: {} }, recorder.response, () => undefined);

    expect(recorder.status()).toBe(409);
    expect(recorder.payload()).toEqual({ error: "Chapter 1 cannot be deleted" });
    expect(store.getWorldStory(world.id)).toEqual(before);
    expect(store.findStoryImage(world.id, "chapter-1-beat-1")).not.toBeNull();
  });

  it("deletes only the latest chapter and returns the newly selected surviving chapter", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    store.saveWorldStory(rollbackStory(world.id));
    reserveRollbackImage(store, world.id, "chapter-2-beat-1");
    reserveRollbackImage(store, world.id, "chapter-3-beat-1");
    const recorder = jsonRecorder();

    await deleteRoute(store, "/worlds/:worldId/story/chapters/:chapterId")
      .handle({ params: { worldId: world.id, chapterId: "chapter-3" }, body: {} }, recorder.response, () => undefined);

    const payload = recorder.payload() as { story: WorldStory; chapter: StoryChapter };
    const persisted = store.getWorldStory(world.id)!;
    expect(recorder.status()).toBe(200);
    expect(payload.chapter).toMatchObject({ id: "chapter-2", number: 2 });
    expect(persisted.chapters.map((chapter) => chapter.id)).toEqual(["chapter-1", "chapter-2"]);
    expect(persisted.perspectives.map((perspective) => perspective.chapterId)).toEqual(["chapter-1", "chapter-2"]);
    expect(persisted.characters.map((character) => character.id)).toEqual(["base-character", "chapter-two-character"]);
    expect(persisted.upcomingDirections).toEqual(["Keep this queued direction after rollback."]);
    expect(store.findStoryImage(world.id, "chapter-2-beat-1")).not.toBeNull();
    expect(store.findStoryImage(world.id, "chapter-3-beat-1")).toBeNull();
  });

  it("deletes all future chapters, perspectives, cast additions, and image records while retaining the selected chapter", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    store.saveWorldStory(rollbackStory(world.id));
    reserveRollbackImage(store, world.id, "chapter-1-beat-1");
    reserveRollbackImage(store, world.id, "chapter-2-beat-1");
    reserveRollbackImage(store, world.id, "chapter-2-chapter-two-character-beat-1");
    reserveRollbackImage(store, world.id, "chapter-3-beat-1");
    reserveRollbackImage(store, world.id, "chapter-3-chapter-three-character-beat-1");
    const recorder = jsonRecorder();

    await deleteRoute(store, "/worlds/:worldId/story/chapters/:chapterId/future")
      .handle({ params: { worldId: world.id, chapterId: "chapter-1" }, body: {} }, recorder.response, () => undefined);

    const payload = recorder.payload() as { story: WorldStory; chapter: StoryChapter };
    const persisted = store.getWorldStory(world.id)!;
    expect(recorder.status()).toBe(200);
    expect(payload.chapter).toMatchObject({ id: "chapter-1", number: 1 });
    expect(persisted.chapters.map((chapter) => chapter.id)).toEqual(["chapter-1"]);
    expect(persisted.perspectives.map((perspective) => perspective.chapterId)).toEqual(["chapter-1"]);
    expect(persisted.characters.map((character) => character.id)).toEqual(["base-character"]);
    expect(persisted.upcomingDirections).toEqual(["Keep this queued direction after rollback."]);
    expect(store.findStoryImage(world.id, "chapter-1-beat-1")).not.toBeNull();
    expect(store.findStoryImage(world.id, "chapter-2-beat-1")).toBeNull();
    expect(store.findStoryImage(world.id, "chapter-2-chapter-two-character-beat-1")).toBeNull();
    expect(store.findStoryImage(world.id, "chapter-3-beat-1")).toBeNull();
    expect(store.findStoryImage(world.id, "chapter-3-chapter-three-character-beat-1")).toBeNull();
  });

  it("keeps the AI Story Director proposal scoped to the current chapter, then applies only its reviewed revision", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return modelJsonResponse(directorPayload());
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const source = existingStory(world.id);
    source.upcomingDirections = ["Keep the next chapter's test signal unresolved."];
    source.perspectives = [{
      characterId: "test-character",
      chapterId: "chapter-1",
      narration: "The old character lens must be regenerated after the director cut.",
      beats: [{ id: "chapter-1-test-character-beat-1", description: "The old test lens watches the gate.", caption: "Prior lens" }],
    }];
    const before = store.saveWorldStory(source);
    const proposalRecorder = jsonRecorder();

    await postRoute(store, "/worlds/:worldId/story/chapters/:chapterId/director/propose")
      .handle({ params: { worldId: world.id, chapterId: "chapter-1" }, body: { prompt: "Slow the pacing before the test gate opens." } }, proposalRecorder.response, () => undefined);

    const proposal = (proposalRecorder.payload() as { proposal: { chapterId: string; baseRevision: number; proposedChapter: StoryChapter } }).proposal;
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected the bounded Director model request");
    const requestBody = JSON.parse(String(request.body)) as { input: string };
    expect(proposalRecorder.status()).toBe(200);
    expect(proposal).toMatchObject({ chapterId: "chapter-1", baseRevision: 1, proposedChapter: { id: "chapter-1", number: 1, revision: 2 } });
    expect(proposal.proposedChapter.beats.map((beat) => beat.id)).toEqual(["chapter-1-r2-beat-1", "chapter-1-r2-beat-2", "chapter-1-r2-beat-3"]);
    expect(store.getWorldStory(world.id)).toEqual(before);
    expect(requestBody.input).not.toContain(source.worldState);
    expect(requestBody.input).not.toContain("Keep the next chapter's test signal unresolved.");
    expect(requestBody.input).not.toContain("The old character lens");

    const applyRecorder = jsonRecorder();
    await postRoute(store, "/worlds/:worldId/story/chapters/:chapterId/director/apply")
      .handle({ params: { worldId: world.id, chapterId: "chapter-1" }, body: { proposal } }, applyRecorder.response, () => undefined);

    const payload = applyRecorder.payload() as { story: WorldStory; chapter: StoryChapter };
    const persisted = store.getWorldStory(world.id)!;
    expect(applyRecorder.status()).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payload.chapter).toMatchObject({ id: "chapter-1", number: 1, revision: 2, title: "The Bell Before Dawn" });
    expect(persisted.characters).toEqual(before.characters);
    expect(persisted.worldState).toBe(before.worldState);
    expect(persisted.upcomingDirections).toEqual(before.upcomingDirections);
    expect(persisted.perspectives).toEqual([]);
  });

  it("rejects stale or non-current AI Story Director proposals without mutating the story", async () => {
    const store = new WorldStore(new DatabaseSync(":memory:"));
    const world = createTestWorld(store);
    const before = store.saveWorldStory(rollbackStory(world.id));
    const stale = {
      chapterId: "chapter-3",
      baseRevision: 99,
      directive: "Slow the pacing before the test gate opens.",
      directorIntent: "Slow the exchange.",
      changes: [{ category: "pacing", summary: "Hold the decision.", rationale: "The chapter needs room.", affectedBeatIds: ["chapter-3-beat-1"] }],
      proposedChapter: {
        id: "chapter-3", number: 3, revision: 2, title: "Stale director cut", narration: "C".repeat(420),
        beats: [
          { id: "chapter-3-r2-beat-1", description: "A stale scene one gathers over the gate.", caption: "One" },
          { id: "chapter-3-r2-beat-2", description: "A stale scene two holds the choice in silence.", caption: "Two" },
          { id: "chapter-3-r2-beat-3", description: "A stale scene three sends the bell across rain.", caption: "Three" },
        ],
        audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.6, bgmCue: "suspense", narrationDelivery: "patient and close" },
      },
    };
    const staleRecorder = jsonRecorder();
    await postRoute(store, "/worlds/:worldId/story/chapters/:chapterId/director/apply")
      .handle({ params: { worldId: world.id, chapterId: "chapter-3" }, body: { proposal: stale } }, staleRecorder.response, () => undefined);
    expect(staleRecorder.status()).toBe(409);
    expect(store.getWorldStory(world.id)).toEqual(before);

    const earlierRecorder = jsonRecorder();
    await postRoute(store, "/worlds/:worldId/story/chapters/:chapterId/director/propose")
      .handle({ params: { worldId: world.id, chapterId: "chapter-2" }, body: { prompt: "Slow the pacing before the test gate opens." } }, earlierRecorder.response, () => undefined);
    expect(earlierRecorder.status()).toBe(409);
    expect(store.getWorldStory(world.id)).toEqual(before);
  });

  it("publishes all supported stream and rollback routes", () => {
    const router = createStoryRouter(new WorldStore(new DatabaseSync(":memory:"))) as unknown as { stack: RouteLayer[] };
    const postPaths = router.stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route?.path);
    const deletePaths = router.stack.filter((layer) => layer.route?.methods.delete).map((layer) => layer.route?.path);
    expect(postPaths).toEqual(expect.arrayContaining([
      "/worlds/:worldId/story/next/stream",
      "/worlds/:worldId/story/command/stream",
      "/worlds/:worldId/story/perspective/stream",
      "/worlds/:worldId/story/revise/stream",
      "/worlds/:worldId/story/chapters/:chapterId/director/propose",
      "/worlds/:worldId/story/chapters/:chapterId/director/apply",
    ]));
    expect(deletePaths).toEqual(expect.arrayContaining([
      "/worlds/:worldId/story/chapters/:chapterId",
      "/worlds/:worldId/story/chapters/:chapterId/future",
    ]));
  });
});
