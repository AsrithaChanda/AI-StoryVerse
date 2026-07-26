import { afterEach, describe, expect, it, vi } from "vitest";
import { addUpcomingDirection, deleteFutureChapters, deleteLatestChapter } from "./story";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("story direction and timeline API client", () => {
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

  it("uses the selected rollback endpoints and returns their surviving chapter contract", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ story: { worldId: "test-world" }, chapter: { id: "chapter-2", number: 2, title: "Two", narration: "", beats: [] } }))
      .mockResolvedValueOnce(jsonResponse({ story: { worldId: "test-world" }, chapter: { id: "chapter-1", number: 1, title: "One", narration: "", beats: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteLatestChapter("world / one", "chapter / 2")).resolves.toMatchObject({ chapter: { id: "chapter-2", number: 2 } });
    await expect(deleteFutureChapters("world-two", "chapter-1")).resolves.toMatchObject({ chapter: { id: "chapter-1", number: 1 } });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%202",
      "/api/worlds/world-two/story/chapters/chapter-1/future",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });
});
