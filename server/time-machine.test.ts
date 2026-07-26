import { describe, expect, it } from "vitest";
import type { WorldStory } from "./story.js";
import { affectedTimelineChapters } from "./time-machine.js";

function fourChapterStory(): WorldStory {
  const timestamp = "2026-07-26T10:00:00.000Z";
  return {
    worldId: "world-1",
    characters: [],
    perspectives: [],
    worldState: "The world is ready for a timeline rewrite.",
    source: "fallback",
    createdAt: timestamp,
    updatedAt: timestamp,
    chapters: [1, 2, 3, 4].map((number) => ({
      id: `chapter-${number}`,
      number,
      title: `Chapter ${number}`,
      narration: `Canonical narration for chapter ${number}.`,
      beats: [],
    })),
  };
}

describe("Story Time Machine affected chapter count", () => {
  it("counts the selected chapter and only the chapters after it", () => {
    expect(affectedTimelineChapters(fourChapterStory(), "chapter-2").map((chapter) => chapter.number))
      .toEqual([2, 3, 4]);
  });

  it("does not include an earlier chapter in a later rewrite", () => {
    expect(affectedTimelineChapters(fourChapterStory(), "chapter-4").map((chapter) => chapter.number))
      .toEqual([4]);
  });
});
