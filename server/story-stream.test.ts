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

function nextPayload(narration: string): StoryChapter {
  return {
    id: "provider-chapter", number: 99, title: "The Test Bell", narration,
    beats: [
      { id: "beat_01", description: "The test bell glows at dusk.", caption: "Test bell" },
      { id: "beat_02", description: "A test gate opens.", caption: "Test gate" },
      { id: "beat_03", description: "The test city waits under rain.", caption: "Test rain" },
    ],
    audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.7, bgmCue: "suspense", narrationDelivery: "measured and close" },
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

type RouteHandler = { handle: (request: unknown, response: unknown, next: () => void) => unknown };
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: RouteHandler[] } };

function postRoute(store: WorldStore, path: string): RouteHandler {
  const router = createStoryRouter(store) as unknown as { stack: RouteLayer[] };
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods.post)?.route;
  if (!route) throw new Error(`Route not found: ${path}`);
  return route.stack[0]!;
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
    expect(chapter).toMatchObject({ id: "chapter-2", number: 2, narration });
    expect(chapter?.beats.map((beat) => beat.id)).toEqual(["chapter-2-beat-1", "chapter-2-beat-2", "chapter-2-beat-3"]);
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

  it("publishes all three POST stream routes", () => {
    const router = createStoryRouter(new WorldStore(new DatabaseSync(":memory:"))) as unknown as { stack: RouteLayer[] };
    const paths = router.stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route?.path);
    expect(paths).toEqual(expect.arrayContaining([
      "/worlds/:worldId/story/next/stream",
      "/worlds/:worldId/story/command/stream",
      "/worlds/:worldId/story/perspective/stream",
    ]));
  });
});
