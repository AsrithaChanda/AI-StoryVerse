import { describe, expect, it } from "vitest";
import { buildSceneInput, createSceneGenerator, MockSceneProvider } from "./index";

const input = buildSceneInput({
  branchId: "timeline_a",
  branchName: "Timeline A",
  protagonistId: "mira",
  protagonistName: "Mira Sen",
  protagonist: {
    personality: ["brave", "impulsive"],
    knownFacts: ["I saw Kael near the vault."],
    memories: ["The warning bells began at the bridge."],
    beliefs: ["Kael may be afraid of something larger."],
  },
  worldState: { emberStability: 42, cityAlert: "Elevated", kaelStatus: "Suspected" },
  recentEvents: ["Mira confronted Kael on the eastern bridge."],
  requiredConsequences: ["Kael remains free.", "Ravi distrusts Mira slightly."],
  decision: "TRUST_KAEL",
  mode: "decision",
});

const validScene = {
  title: "Lanterns on the Bridge",
  narration:
    "Mira held the bridge while Astra's festival lanterns swung in the wind. Kael's answer gave her no certainty, only a narrow path between panic and patience. The bells kept sounding over the river, and each note reminded her that every second mattered to the Ember Core below the palace.",
  dialogue: [{ characterId: "kael", text: "Trust is not safety, Mira. It is only time." }],
  closingHook: "A single ember blinked in the dark water beneath the bridge.",
};

describe("scene generation", () => {
  it("returns a validated structured provider scene", async () => {
    const provider = new MockSceneProvider([validScene]);
    const scene = await createSceneGenerator({ provider }).generate(input);
    expect(scene).toMatchObject({ ...validScene, source: "provider" });
    expect(provider.inputs).toHaveLength(1);
  });

  it("retries an invalid JSON/schema response then uses a prepared fallback", async () => {
    const provider = new MockSceneProvider(["not JSON", { title: "too short" }]);
    const scene = await createSceneGenerator({ provider, retries: 1 }).generate(input);
    expect(provider.inputs).toHaveLength(2);
    expect(scene.source).toBe("fallback");
    expect(scene.fallbackReason).toBe("invalid_response");
    expect(scene.title).toBe("The Bell Kept Ringing");
  });

  it("times out, retries once, and preserves the demo through a fallback", async () => {
    const never = () => new Promise<unknown>(() => undefined);
    const provider = new MockSceneProvider([never, never]);
    const scene = await createSceneGenerator({ provider, timeoutMs: 2, retries: 1 }).generate(input);
    expect(provider.inputs).toHaveLength(2);
    expect(scene).toMatchObject({ source: "fallback", fallbackReason: "timeout" });
  });

  it("retries a provider error and accepts a later valid response", async () => {
    const provider = new MockSceneProvider([new Error("network down"), validScene]);
    const scene = await createSceneGenerator({ provider, retries: 1 }).generate(input);
    expect(provider.inputs).toHaveLength(2);
    expect(scene.source).toBe("provider");
  });

  it("uses a fallback if the provider remains unavailable", async () => {
    const provider = new MockSceneProvider([new Error("network down")]);
    const scene = await createSceneGenerator({ provider, retries: 1 }).generate(input);
    expect(provider.inputs).toHaveLength(2);
    expect(scene).toMatchObject({ source: "fallback", fallbackReason: "provider_error" });
  });

  it("works with no API key or provider through decision-specific fallback copy", async () => {
    const scene = await createSceneGenerator().generate({ ...input, decision: "EXPOSE_KAEL" });
    expect(scene).toMatchObject({ source: "fallback", fallbackReason: "no_provider", title: "A Crown in Custody" });
  });

  it("builds Ravi-only context without Kael's private motive", () => {
    const raviInput = buildSceneInput({
      ...input,
      protagonistId: "ravi",
      protagonistName: "Ravi",
      protagonist: {
        personality: ["observant", "protective"],
        knownFacts: ["Kael removed the fragment to stop a larger reaction."],
        memories: ["The royal family concealed an earlier Ember failure."],
        beliefs: ["Mira may be hiding something."],
      },
      mode: "protagonist",
      recentEvents: ["Kael removed the fragment to stop a larger reaction."],
      requiredConsequences: ["Kael removed the fragment to stop a larger reaction."],
    });
    const context = JSON.stringify(raviInput);
    expect(context).not.toMatch(/removed the fragment to stop a larger reaction/i);
    expect(context).toContain("earlier Ember failure");
    expect(context).not.toContain("Kael's private secret");
  });
});
