import { describe, expect, it } from "vitest";
import { buildStoryFlow, splitNarrationIntoParagraphs } from "./story-layout";

const beats = [
  { id: "beat-1", description: "Mira enters the rain-soaked archive", caption: "The archive opens" },
  { id: "beat-2", description: "Kael raises a lantern over the hidden map", caption: "A map in the dark" },
  { id: "beat-3", description: "The bridge collapses beneath the storm", caption: "The storm takes the bridge" },
];

describe("chapter story layout", () => {
  it("breaks dense generated prose into readable paragraphs", () => {
    const prose = "Mira enters the archive through rain. Dust rises from the sealed shelves. Kael waits beside a hidden map. His lantern catches the river marks. Thunder breaks above the old bridge. The stones begin to split.";
    expect(splitNarrationIntoParagraphs(prose, 4)).toEqual([
      "Mira enters the archive through rain. Dust rises from the sealed shelves.",
      "Kael waits beside a hidden map. His lantern catches the river marks.",
      "Thunder breaks above the old bridge.",
      "The stones begin to split.",
    ]);
  });

  it("keeps beat images ordered and places them between narrative paragraphs", () => {
    const prose = "Mira enters the rain-soaked archive. The shelves breathe dust.\n\nKael raises a lantern over a hidden map. The river marks tremble.\n\nThunder shakes the bridge. The storm breaks the stones.\n\nThey run toward the city before dawn.";
    const flow = buildStoryFlow(prose, beats);
    expect(flow.flatMap((item) => item.beats.map((beat) => beat.id))).toEqual(["beat-1", "beat-2", "beat-3"]);
    expect(flow.at(-1)?.beats).toEqual([]);
    expect(flow[0]?.beats[0]?.id).toBe("beat-1");
    expect(flow[1]?.beats[0]?.id).toBe("beat-2");
    expect(flow[2]?.beats[0]?.id).toBe("beat-3");
  });
});
