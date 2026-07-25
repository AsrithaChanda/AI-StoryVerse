import { afterEach, describe, expect, it, vi } from "vitest";
import { streamCharacterPerspective, streamCommandStory, streamNextChapter, streamReviseChapter, streamStoryGeneration } from "./story-stream";

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("story generation SSE transport", () => {
  it("parses fragmented phase, narration, and complete events across arbitrary chunks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      "event: ph", "ase\ndata: {\"stage\":\"writi", "ng\"}\n\n",
      "event: narration\ndata: {\"text\":\"The first ", "line.\"}\n\n",
      "event: phase\ndata: {\"stage\":\"validating\"}\n\n",
      "event: complete\ndata: {\"story\":{\"worldId\":\"test-world\"},\"chapter\":{\"id\":\"chapter-2\"}}\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const phases: string[] = [];
    const narration: string[] = [];

    const complete = await streamStoryGeneration<{ story: { worldId: string }; chapter: { id: string } }>(
      "/api/test-stream",
      { method: "POST", body: "{}" },
      { onPhase: (stage) => phases.push(stage), onNarration: (text) => narration.push(text) },
    );

    expect(complete).toEqual({ story: { worldId: "test-world" }, chapter: { id: "chapter-2" } });
    expect(phases).toEqual(["writing", "validating"]);
    expect(narration).toEqual(["The first line."]);
    expect(fetchMock).toHaveBeenCalledWith("/api/test-stream", expect.objectContaining({
      method: "POST",
      headers: expect.any(Headers),
    }));
    const headers = fetchMock.mock.calls[0]?.[1].headers as Headers;
    expect(headers.get("Accept")).toBe("text/event-stream");
  });

  it("surfaces an error event before a terminal complete event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      "event: error\ndata: {\"error\":\"Generation failed safely.\"}\n\n",
    ])));

    await expect(streamStoryGeneration("/api/test-stream", { method: "POST" })).rejects.toThrow("Generation failed safely.");
  });

  it("surfaces a friendly error from a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "World not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(streamStoryGeneration("/api/test-stream", { method: "POST" })).rejects.toThrow("World not found");
  });

  it("parses a complete event when it is the final unterminated SSE record and builds wrapper paths", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(["event: complete\ndata: {\"story\":{\"worldId\":\"one\"}}"] ))
      .mockResolvedValueOnce(sseResponse(["event: complete\ndata: {\"story\":{\"worldId\":\"two\"}}\n\n"]))
      .mockResolvedValueOnce(sseResponse(["event: complete\ndata: {\"story\":{\"worldId\":\"three\"}}\n\n"]))
      .mockResolvedValueOnce(sseResponse(["event: complete\ndata: {\"story\":{\"worldId\":\"four\"},\"chapter\":{\"id\":\"chapter-1\"}}\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamNextChapter("world / one")).resolves.toMatchObject({ story: { worldId: "one" } });
    await expect(streamCommandStory("world-two", "Continue.")).resolves.toMatchObject({ story: { worldId: "two" } });
    await expect(streamCharacterPerspective("world-three", "character-one")).resolves.toMatchObject({ story: { worldId: "three" } });
    await expect(streamReviseChapter("world-four", "Make the test scene more suspenseful.")).resolves.toMatchObject({ story: { worldId: "four" }, chapter: { id: "chapter-1" } });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/worlds/world%20%2F%20one/story/next/stream",
      "/api/worlds/world-two/story/command/stream",
      "/api/worlds/world-three/story/perspective/stream",
      "/api/worlds/world-four/story/revise/stream",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1].body))).toEqual({ command: "Continue." });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1].body))).toEqual({ characterId: "character-one" });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1].body))).toEqual({ prompt: "Make the test scene more suspenseful." });
  });
});
