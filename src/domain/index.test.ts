import { describe, expect, it } from "vitest";
import {
  commitDecision,
  createAlternateBranch,
  createInitialState,
  getCharacterView,
  getStoryViewState,
  resetStory,
  switchBranch,
  switchProtagonist,
} from "./index";

describe("The Last Ember deterministic engine", () => {
  it("commits Trust Kael with exact world, relationship, memory, and belief effects", () => {
    const start = createInitialState();
    const result = commitDecision(start, "TRUST_KAEL", "trust-click");
    const branch = result.branches.timeline_a!;
    expect(branch.world.cityAlert).toBe("Elevated");
    expect(branch.world.kaelStatus).toBe("Suspected");
    expect(branch.characters.kael.relationships.mira).toBe(65);
    expect(branch.characters.ravi.relationships.mira).toBe(60);
    expect(branch.characters.mira.memories.at(-1)?.text).toBe("I protected Kael at the bridge.");
    expect(branch.characters.ravi.beliefs.at(-1)?.text).toBe("Mira may be hiding something.");
    expect(branch.events).toHaveLength(1);
    expect(start.branches.timeline_a!.events).toHaveLength(0);
  });

  it("commits Expose Kael with exact deterministic consequences", () => {
    const result = commitDecision(createInitialState(), "EXPOSE_KAEL");
    const branch = result.branches.timeline_a!;
    expect(branch.world.cityAlert).toBe("Critical");
    expect(branch.world.kaelStatus).toBe("Detained");
    expect(branch.characters.kael.relationships.mira).toBe(10);
    expect(branch.characters.ravi.relationships.mira).toBe(85);
    expect(branch.characters.mira.memories.at(-1)?.text).toBe("I exposed Kael to Ravi.");
    expect(branch.characters.ravi.memories.at(-1)?.text).toBe("Mira trusted me with the truth.");
  });

  it("is idempotent and preserves immutable event history", () => {
    const committed = commitDecision(createInitialState(), "TRUST_KAEL", "same-action");
    expect(commitDecision(committed, "TRUST_KAEL", "same-action")).toBe(committed);
    expect(commitDecision(committed, "EXPOSE_KAEL", "second-click")).toBe(committed);
    expect(committed.branches.timeline_a!.events[0]).not.toBe(createInitialState().branches.timeline_a!.events[0]);
  });

  it("forks from the opening snapshot without changing Timeline A", () => {
    const timelineA = commitDecision(createInitialState(), "TRUST_KAEL");
    const forked = createAlternateBranch(timelineA);
    expect(forked.activeBranchId).toBe("timeline_b");
    expect(forked.branches.timeline_a!.selectedDecision).toBe("TRUST_KAEL");
    expect(forked.branches.timeline_b!.selectedDecision).toBe("EXPOSE_KAEL");
    expect(forked.branches.timeline_a!.world.cityAlert).toBe("Elevated");
    expect(forked.branches.timeline_b!.world.cityAlert).toBe("Critical");
    expect(forked.branches.timeline_b!.characters.mira.memories).toHaveLength(2);
    expect(switchBranch(forked, "timeline_a").branches.timeline_a!.world.kaelStatus).toBe("Suspected");
  });

  it("switches branch safely, switches Ravi's POV, and can reset", () => {
    const branch = commitDecision(createInitialState(), "TRUST_KAEL");
    const ravi = switchProtagonist(branch, "ravi");
    expect(ravi.branches.timeline_a!.protagonistId).toBe("ravi");
    expect(ravi.branches.timeline_a!.scene.protagonistId).toBe("ravi");
    expect(switchBranch(ravi, "missing")).toBe(ravi);
    const reset = resetStory();
    expect(reset.branches.timeline_a!.selectedDecision).toBeNull();
    expect(reset.activeBranchId).toBe("timeline_a");
  });

  it("keeps Kael's secret in Kael knowledge and out of Ravi's view/context projection", () => {
    const result = commitDecision(createInitialState(), "TRUST_KAEL");
    const ravi = getCharacterView(result, "ravi");
    const kael = getCharacterView(result, "kael");
    const raviText = JSON.stringify(ravi);
    expect(raviText).not.toContain("larger reaction");
    expect(raviText).not.toContain("removed the fragment");
    expect(JSON.stringify(kael)).toContain("larger reaction");
    expect(getStoryViewState(result).world).not.toHaveProperty("kaelFragmentPurpose");
  });
});
