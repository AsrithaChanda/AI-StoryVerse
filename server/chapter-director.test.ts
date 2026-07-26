import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChapterDirector,
  proposeChapterDirectorChange,
  validateChapterDirectorProposal,
  type ChapterDirectorModelAdapter,
  type ChapterDirectorModelRequest,
} from "./chapter-director.js";
import type { StoryChapter } from "./story.js";

function currentChapter(overrides: Partial<StoryChapter> = {}): StoryChapter {
  return {
    id: "chapter-7",
    number: 7,
    revision: 2,
    title: "The bridge holds its breath",
    narration: "A".repeat(430),
    beats: [
      { id: "chapter-7-r2-beat-1", description: "A lantern sways above the silent bridge while the river churns below.", caption: "The waiting bridge" },
      { id: "chapter-7-r2-beat-2", description: "Kael watches the far bank and closes his hand around a broken seal.", caption: "A guarded signal" },
      { id: "chapter-7-r2-beat-3", description: "Mira hears a bell beneath the thunder and chooses not to look away.", caption: "The unspoken warning" },
    ],
    audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "danger", intensity: 0.72, bgmCue: "suspense", narrationDelivery: "close and controlled" },
    transition: {
      resolvedBeat: "Mira keeps the bridge crossing closed until the bell's warning can be understood.",
      closingImage: "A rain-dark lantern swings over the bridge while the broken seal shines in Kael's hand.",
      nextChapterHook: "At dawn, the bell will reveal whether the warning came from the far bank or inside the city.",
      carryForward: ["Mira has delayed the crossing.", "Kael still holds the broken seal.", "The bell's source remains unknown."],
    },
    command: "Keep the bridge confrontation intimate.",
    ...overrides,
  };
}

function modelPayload(overrides: Record<string, unknown> = {}) {
  return {
    directorIntent: "Tighten the bridge encounter while making Kael's hesitation feel protective rather than evasive.",
    changes: [
      { category: "characterization", summary: "Reframes Kael's pause as a protective choice.", rationale: "It lets the chapter earn sympathy without adding backstory.", affectedBeatIds: ["chapter-7-r2-beat-2"] },
      { category: "foreshadowing", summary: "Places the bell warning earlier in the sequence.", rationale: "The later decision carries a clearer undertone of consequence.", affectedBeatIds: ["chapter-7-r2-beat-1", "chapter-7-r2-beat-3"] },
    ],
    proposedChapter: {
      title: "The bridge keeps its secret",
      narration: `${"B".repeat(519)}.`,
      beats: [
        { description: "The bridge lantern bends in the storm as Mira follows the bell's first muted strike.", caption: "A bell in the rain" },
        { description: "Kael shields the broken seal from the wind, revealing a quiet fear for the people below.", caption: "The guarded seal" },
        { description: "Mira steps toward the river as the last light exposes the choice waiting between them.", caption: "The revealed crossing" },
      ],
      audioDirection: { primaryEmotion: "suspense", secondaryEmotion: "reflection", intensity: 0.68, bgmCue: "suspense", narrationDelivery: "restrained and intimate" },
      transition: {
        resolvedBeat: "Mira chooses to protect the seal instead of forcing Kael to confess in the storm.",
        closingImage: "The bridge lantern settles as Mira and Kael face the river without crossing it.",
        nextChapterHook: "The bell's next strike will decide whether the far bank can still be trusted.",
        carryForward: ["Mira safeguards the broken seal.", "Kael's protective hesitation is now visible.", "The bell remains an unresolved warning."],
      },
    },
    ...overrides,
  };
}

function adapterWith(payload: unknown): { adapter: ChapterDirectorModelAdapter; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async () => payload);
  return { adapter: { generate }, generate };
}

describe("chapter director", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns a structured, chapter-scoped proposal with fresh next-revision scene IDs", async () => {
    vi.stubEnv("OPENAI_MODEL", "test-director-model");
    const { adapter, generate } = adapterWith(modelPayload());

    const proposal = await createChapterDirector(adapter).propose(currentChapter(), "Make Kael more sympathetic and foreshadow the cost of the crossing.");

    expect(proposal).toMatchObject({
      chapterId: "chapter-7",
      baseRevision: 2,
      directive: "Make Kael more sympathetic and foreshadow the cost of the crossing.",
      proposedChapter: { id: "chapter-7", number: 7, revision: 3 },
    });
    expect(proposal?.proposedChapter.beats.map((beat) => beat.id)).toEqual(["chapter-7-r3-beat-1", "chapter-7-r3-beat-2", "chapter-7-r3-beat-3"]);
    const request = generate.mock.calls[0]?.[0] as ChapterDirectorModelRequest;
    expect(request.model).toBe("test-director-model");
    expect(request.responseSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["directorIntent", "changes", "proposedChapter"] });
    expect((request.responseSchema as { properties: { proposedChapter: { properties: Record<string, unknown> } } }).properties.proposedChapter.properties).not.toHaveProperty("id");
  });

  it("rejects malformed model output rather than returning a partial proposal", async () => {
    const { adapter } = adapterWith(modelPayload({ proposedChapter: { title: "Too short" } }));

    await expect(createChapterDirector(adapter).propose(currentChapter(), "Slow the pacing at the bridge."))
      .resolves.toBeNull();
  });

  it("requires a finished local handoff and a completed narration ending", async () => {
    const missingTransition = modelPayload();
    delete (missingTransition.proposedChapter as Record<string, unknown>).transition;
    const unfinished = modelPayload({
      proposedChapter: { ...(modelPayload().proposedChapter as Record<string, unknown>), narration: "B".repeat(520) },
    });

    await expect(createChapterDirector(adapterWith(missingTransition).adapter).propose(currentChapter(), "Slow the pacing at the bridge."))
      .resolves.toBeNull();
    await expect(createChapterDirector(adapterWith(unfinished).adapter).propose(currentChapter(), "Slow the pacing at the bridge."))
      .resolves.toBeNull();
  });

  it("keeps global and future story data out of the director model context", async () => {
    const unsafeChapter = Object.assign(currentChapter(), {
      worldState: "PRIVATE WORLD STATE MUST NEVER REACH THE DIRECTOR",
      characters: [{ id: "private-cast", secret: "PRIVATE CAST SECRET" }],
      previousChapters: [{ narration: "PRIVATE PREVIOUS CHAPTER" }],
      futureChapters: [{ narration: "PRIVATE FUTURE CHAPTER" }],
      perspectives: [{ narration: "PRIVATE PERSPECTIVE" }],
      upcomingDirections: ["PRIVATE QUEUED DIRECTION"],
    }) as StoryChapter;
    const { adapter, generate } = adapterWith(modelPayload());

    await createChapterDirector(adapter).propose(unsafeChapter, "Slow the pacing at the bridge.");

    const input = (generate.mock.calls[0]?.[0] as ChapterDirectorModelRequest).input;
    expect(input).toContain("Slow the pacing at the bridge.");
    expect(input).not.toContain("PRIVATE WORLD STATE");
    expect(input).not.toContain("PRIVATE CAST SECRET");
    expect(input).not.toContain("PRIVATE PREVIOUS CHAPTER");
    expect(input).not.toContain("PRIVATE FUTURE CHAPTER");
    expect(input).not.toContain("PRIVATE PERSPECTIVE");
    expect(input).not.toContain("PRIVATE QUEUED DIRECTION");
    expect(input).not.toContain("Keep the bridge confrontation intimate.");
  });

  it("rejects a change that references an ID outside the current chapter", async () => {
    const payload = modelPayload();
    const changes = payload.changes as Array<Record<string, unknown>>;
    changes[0] = { ...changes[0], affectedBeatIds: ["chapter-8-r1-beat-1"] };
    const { adapter } = adapterWith(payload);

    await expect(createChapterDirector(adapter).propose(currentChapter(), "Make Kael more sympathetic."))
      .resolves.toBeNull();
  });

  it("revalidates proposal identity and rejects stale revisions or non-fresh beat namespaces", async () => {
    const chapter = currentChapter();
    const { adapter } = adapterWith(modelPayload());
    const proposal = await createChapterDirector(adapter).propose(chapter, "Foreshadow the betrayal without changing the plot.");
    if (!proposal) throw new Error("Expected a valid director proposal");

    expect(validateChapterDirectorProposal(proposal, chapter)).toEqual(proposal);
    expect(validateChapterDirectorProposal({ ...proposal, baseRevision: 1 }, chapter)).toBeNull();
    expect(validateChapterDirectorProposal({ ...proposal, proposedChapter: { ...proposal.proposedChapter, id: "chapter-8" } }, chapter)).toBeNull();
    expect(validateChapterDirectorProposal({ ...proposal, proposedChapter: { ...proposal.proposedChapter, revision: 2 } }, chapter)).toBeNull();
    expect(validateChapterDirectorProposal({ ...proposal, proposedChapter: { ...proposal.proposedChapter, beats: proposal.proposedChapter.beats.map((beat, index) => ({ ...beat, id: `chapter-7-r3-beat-${index + 2}` })) } }, chapter)).toBeNull();
  });

  it("fails safely when the production adapter has no configured key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(proposeChapterDirectorChange(currentChapter(), "Slow the pacing at the bridge.")).resolves.toBeNull();
  });
});
