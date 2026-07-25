import { describe, expect, it } from "vitest";
import { createInitialState } from "./domain";
import { LastEmberController } from "./controller";

describe("StoryVerse controller integration", () => {
  it("commits a single idempotent decision and supplies an offline fallback scene", async () => {
    const controller = new LastEmberController(createInitialState());
    await controller.enterUniverse();
    await controller.commitDecision("TRUST_KAEL");
    await controller.commitDecision("TRUST_KAEL");

    expect(controller.state.events).toHaveLength(1);
    expect(controller.state.world.kaelStatus).toBe("Suspected");
    expect(controller.state.scene.source).toBe("fallback");
  });

  it("keeps the original future unchanged while creating and switching to the alternate", async () => {
    const controller = new LastEmberController(createInitialState());
    await controller.commitDecision("TRUST_KAEL");
    await controller.createAlternateBranch();

    expect(controller.state.activeBranchId).toBe("timeline_b");
    expect(controller.state.world.kaelStatus).toBe("Detained");
    await controller.switchBranch("timeline_a");
    expect(controller.state.world.kaelStatus).toBe("Suspected");
  });

  it("continues in Ravi's limited point of view and resets the demo", async () => {
    const controller = new LastEmberController(createInitialState());
    await controller.commitDecision("EXPOSE_KAEL");
    await controller.switchProtagonist("ravi");

    expect(controller.state.activeBranch.protagonistId).toBe("ravi");
    expect(controller.state.scene.narration).not.toContain("removed the fragment to stop");
    await controller.resetDemo();
    expect(controller.state.entered).toBe(false);
    expect(controller.state.events).toHaveLength(0);
  });
});
