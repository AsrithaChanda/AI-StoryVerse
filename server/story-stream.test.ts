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

function nextPayload(narration: string, newCharacters: NewCharacterPayload[] = []): StoryChapter & { newCharacters: NewCharacterPayload[] } {
  return {
    id: "provider-chapter", number: 99, title: "The Test Bell", narration,
    beats: [
      { id: "beat_01", description: "The test bell glows at dusk.", caption: "Test bell" },
      { id: "beat_02", description: "A test gate opens.", caption: "Test gate" },
      { id: "beat_03", description: "The test city waits under rain.", caption: "Test rain" },
    ],
    audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.7, bgmCue: "suspense", narrationDelivery: "measured and close" },
    newCharacters,
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

function responseFromDeltas(deltas: string[], transportSplit = false): Response {
  const sse = [
    ...deltas.map((delta) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`),
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`,
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
    expect(recorder.events().at(-1)?.payload).toEqual({ error: "The next chapter could not be generated" });
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
    expect(recorder.payload()).toEqual({ error: "The next chapter could not be generated" });
    expect(store.getWorldStory(world.id)?.upcomingDirections).toEqual(["Keep the test signal unresolved."]);
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
      id: "provider-revision", number: 99, title: "Revised Test Opening", narration: "B".repeat(420),
      beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} revised test visual moment`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.8, bgmCue: "suspense", narrationDelivery: "more immediate" },
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
      id: "provider-revision", number: 99, title: "Rejected Revision", narration: "B".repeat(420),
      beats: ["first", "second", "third"].map((caption) => ({ id: "beat_01", description: `${caption} rejected test visual moment`, caption })),
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.8, bgmCue: "suspense", narrationDelivery: "more immediate" },
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

  it("publishes all supported stream and rollback routes", () => {
    const router = createStoryRouter(new WorldStore(new DatabaseSync(":memory:"))) as unknown as { stack: RouteLayer[] };
    const postPaths = router.stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route?.path);
    const deletePaths = router.stack.filter((layer) => layer.route?.methods.delete).map((layer) => layer.route?.path);
    expect(postPaths).toEqual(expect.arrayContaining([
      "/worlds/:worldId/story/next/stream",
      "/worlds/:worldId/story/command/stream",
      "/worlds/:worldId/story/perspective/stream",
      "/worlds/:worldId/story/revise/stream",
    ]));
    expect(deletePaths).toEqual(expect.arrayContaining([
      "/worlds/:worldId/story/chapters/:chapterId",
      "/worlds/:worldId/story/chapters/:chapterId/future",
    ]));
  });
});
