import { afterEach, describe, expect, it, vi } from "vitest";
import { addUpcomingDirection, reviseChapter } from "./story";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("story revision and direction API client", () => {
  it("adds an upcoming direction using the constrained directions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ story: { worldId: "test-world", upcomingDirections: ["Build suspense next."] } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(addUpcomingDirection("world / one", "Build suspense next.")).resolves.toMatchObject({
      story: { worldId: "test-world", upcomingDirections: ["Build suspense next."] },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/worlds/world%20%2F%20one/story/directions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ direction: "Build suspense next." }),
    }));
  });

  it("revises the current chapter and preserves the returned chapter alongside story state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      story: { worldId: "test-world", upcomingDirections: [] },
      chapter: { id: "chapter-1", number: 1, title: "Test Chapter", narration: "Revised text.", beats: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reviseChapter("test-world", "Make the current scene more tense.")).resolves.toMatchObject({
      story: { worldId: "test-world", upcomingDirections: [] },
      chapter: { id: "chapter-1", narration: "Revised text." },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/worlds/test-world/story/revise", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ prompt: "Make the current scene more tense." }),
    }));
  });

  it("surfaces a backend error for a rejected revision request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "A revision prompt is required" }, 400)));

    await expect(reviseChapter("test-world", "")).rejects.toThrow("A revision prompt is required");
  });
});
