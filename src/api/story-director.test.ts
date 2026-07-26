import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyChapterDirection,
  proposeChapterDirection,
  type ChapterDirectorProposal,
} from "./story-director";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const proposal: ChapterDirectorProposal = {
  chapterId: "chapter-1",
  baseRevision: 2,
  directive: "Increase the unease before the reveal.",
  directorIntent: "Escalate tension while preserving the protagonist's uncertainty.",
  changes: [{
    category: "pacing",
    summary: "Delay the reveal by one beat.",
    rationale: "Lets the uncertainty build before the reveal.",
    affectedBeatIds: ["beat-2"],
  }],
  proposedChapter: {
    id: "chapter-1",
    number: 1,
    title: "The Door Below",
    narration: "The corridor held its breath.",
    beats: [{ id: "beat-2", description: "The door shudders.", caption: "A door in the dark" }],
    revision: 3,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("chapter director API client", () => {
  it("encodes route identifiers, sends the proposal prompt, and returns the proposed chapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ proposal }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(proposeChapterDirection("world / one", "chapter / one", proposal.directive)).resolves.toEqual({ proposal });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%20one/director/propose",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: proposal.directive }),
      }),
    );
  });

  it("encodes route identifiers, sends the entire proposal, and returns the applied chapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      story: { worldId: "world-1", chapters: [proposal.proposedChapter] },
      chapter: proposal.proposedChapter,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(applyChapterDirection("world / one", "chapter / one", proposal)).resolves.toMatchObject({
      story: { worldId: "world-1" },
      chapter: { id: "chapter-1", revision: 3 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worlds/world%20%2F%20one/story/chapters/chapter%20%2F%20one/director/apply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ proposal }),
      }),
    );
  });

  it("surfaces server-provided errors for proposal and apply requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "A director prompt is required" }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: "This chapter has changed since the proposal" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(proposeChapterDirection("world-1", "chapter-1", "")).rejects.toThrow("A director prompt is required");
    await expect(applyChapterDirection("world-1", "chapter-1", proposal)).rejects.toThrow("This chapter has changed since the proposal");
  });
});
