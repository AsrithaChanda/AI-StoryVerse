import { describe, expect, it } from "vitest";
import { soundscapeForChapter } from "./soundscape";

describe("chapter soundscapes", () => {
  it("maps scene emotion to a distinct local BGM profile", () => {
    expect(soundscapeForChapter("Thunder breaks over the ruined gate.").mood).toBe("storm");
    expect(soundscapeForChapter("The army marches to battle at dawn.").mood).toBe("conflict");
    expect(soundscapeForChapter("She keeps the secret behind the sealed door.").mood).toBe("suspense");
  });

  it("derives stable but different motifs for different chapters with the same emotion", () => {
    const first = soundscapeForChapter("chapter-1|A storm breaks over the ruined gate.");
    const second = soundscapeForChapter("chapter-2|A storm breaks over the ruined gate.");
    expect(soundscapeForChapter("chapter-1|A storm breaks over the ruined gate.")).toEqual(first);
    expect({ rootHz: second.rootHz, pulseMs: second.pulseMs, motif: second.motif, shimmer: second.shimmer })
      .not.toEqual({ rootHz: first.rootHz, pulseMs: first.pulseMs, motif: first.motif, shimmer: first.shimmer });
  });
});
