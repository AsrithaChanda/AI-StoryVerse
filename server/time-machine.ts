import type { StoryImagePipeline } from "./images/pipeline.js";
import { logInfo, logWarn } from "./logger.js";
import type {
  StoredTimeMachineJob,
  StoryStore,
  VersionedStoryStore,
  VersionedWorldStory,
} from "./persistence/store.js";
import {
  generateInitialStory,
  generateNextChapter,
  type StoryChapter,
  type WorldStory,
} from "./story.js";
import type { World } from "./worlds.js";

type TimeMachineRequest = {
  targetChapterId: string;
  changePrompt: string;
  futurePrompt?: string;
};

function isVersionedStore(store: StoryStore): store is VersionedStoryStore {
  return "getWorldStoryRecord" in store && typeof store.getWorldStoryRecord === "function";
}

async function snapshot(store: StoryStore, worldId: string): Promise<VersionedWorldStory | null> {
  if (isVersionedStore(store)) return store.getWorldStoryRecord(worldId);
  const story = await store.getWorldStory(worldId);
  return story ? { story, version: 0 } : null;
}

function revisedChapter(chapter: StoryChapter, oldChapter: StoryChapter | undefined): StoryChapter {
  const revision = Math.max(1, oldChapter?.revision ?? 1) + 1;
  const id = `chapter-${chapter.number}`;
  return {
    ...chapter,
    id,
    revision,
    beats: chapter.beats.map((beat, index) => ({
      ...beat,
      id: `${id}-r${revision}-beat-${index + 1}`,
    })),
  };
}

function timelineInstruction(job: StoredTimeMachineJob, chapterNumber: number): string {
  const future = job.futurePrompt?.trim()
    ? `Future timeline guidance: ${job.futurePrompt.trim()}`
    : "Let later events follow naturally and consistently from this changed decision.";
  return [
    `Story Time Machine rewrite beginning at Chapter ${job.targetChapterNumber}.`,
    `Changed decision: ${job.changePrompt.trim()}`,
    future,
    `Write replacement Chapter ${chapterNumber}.`,
    "Treat the changed decision as canon. Do not restore events that it contradicts.",
    "Keep continuity with every retained and already-regenerated chapter.",
  ].join(" ");
}

function worldStateAfter(chapter: StoryChapter, fallback: string): string {
  if (!chapter.transition) return fallback;
  return [
    `Timeline is canonical through Chapter ${chapter.number}.`,
    `Resolved event: ${chapter.transition.resolvedBeat}`,
    `Current position: ${chapter.transition.closingImage}`,
    `Facts to preserve: ${chapter.transition.carryForward.join("; ") || "Continue from the closing event."}`,
  ].join(" ");
}

/**
 * Builds the replacement future entirely in memory. The caller persists it
 * only after all model outputs validate, so readers never see half a timeline.
 */
export async function regenerateTimeline(
  world: World,
  original: WorldStory,
  job: StoredTimeMachineJob,
  onChapter: (completed: number) => Promise<void>,
): Promise<WorldStory | null> {
  const targetIndex = original.chapters.findIndex((chapter) => chapter.id === job.targetChapterId);
  if (targetIndex < 0 || targetIndex !== job.targetChapterNumber - 1) return null;
  const oldByNumber = new Map(original.chapters.map((chapter) => [chapter.number, chapter]));
  let working: WorldStory;
  let completed = 0;

  if (targetIndex === 0) {
    const changedWorld: World = {
      ...world,
      creatorPrompt: `${world.creatorPrompt}\nStory Time Machine change: ${job.changePrompt}\n${job.futurePrompt ? `Future guidance: ${job.futurePrompt}` : ""}`,
    };
    const initial = await generateInitialStory(changedWorld);
    if (!initial.chapters[0]) return null;
    const first = revisedChapter(initial.chapters[0], oldByNumber.get(1));
    working = {
      ...initial,
      chapters: [first],
      characters: initial.characters.map((character) => ({ ...character, introducedInChapter: first.id })),
      createdAt: original.createdAt,
      upcomingDirections: [],
    };
    completed = 1;
    await onChapter(completed);
  } else {
    const retained = original.chapters.slice(0, targetIndex);
    const retainedIds = new Set(retained.map((chapter) => chapter.id));
    working = {
      ...original,
      chapters: retained,
      characters: original.characters.filter((character) => retainedIds.has(character.introducedInChapter ?? retained[0]!.id)),
      perspectives: original.perspectives.filter((perspective) => retainedIds.has(perspective.chapterId)),
      upcomingDirections: [job.changePrompt, ...(job.futurePrompt ? [job.futurePrompt] : [])],
      worldState: worldStateAfter(retained.at(-1)!, original.worldState),
    };
  }

  for (let number = working.chapters.length + 1; number <= original.chapters.length; number += 1) {
    const guided: WorldStory = {
      ...working,
      upcomingDirections: [job.changePrompt, ...(job.futurePrompt ? [job.futurePrompt] : [])],
    };
    const generated = await generateNextChapter(world, guided, timelineInstruction(job, number));
    if (!generated) return null;
    const chapter = revisedChapter(generated.chapter, oldByNumber.get(number));
    working = {
      ...working,
      chapters: [...working.chapters, chapter],
      characters: [
        ...working.characters,
        ...generated.newCharacters.map((character) => ({ ...character, introducedInChapter: chapter.id })),
      ],
      upcomingDirections: [],
      worldState: worldStateAfter(chapter, working.worldState),
    };
    completed += 1;
    await onChapter(completed);
  }

  return {
    ...working,
    perspectives: working.perspectives.filter((perspective) => perspective.chapterId.startsWith("chapter-") && Number(perspective.chapterId.slice(8)) < job.targetChapterNumber),
    upcomingDirections: [],
    updatedAt: new Date().toISOString(),
  };
}

export class TimeMachineService {
  private readonly running = new Set<string>();

  public constructor(
    private readonly store: StoryStore,
    private readonly images: StoryImagePipeline,
  ) {}

  public async start(worldId: string, request: TimeMachineRequest): Promise<{ job: StoredTimeMachineJob; created: boolean } | null> {
    const current = await snapshot(this.store, worldId);
    if (!current) return null;
    const index = current.story.chapters.findIndex((chapter) => chapter.id === request.targetChapterId);
    if (index < 0) return null;
    const reservation = await this.store.reserveTimeMachineJob({
      worldId,
      targetChapterId: request.targetChapterId,
      targetChapterNumber: index + 1,
      changePrompt: request.changePrompt.trim(),
      futurePrompt: request.futurePrompt?.trim() || undefined,
      baseStoryVersion: current.version,
      baseStoryUpdatedAt: current.story.updatedAt,
      totalChapters: current.story.chapters.length - index,
    });
    if (reservation.created || reservation.job.status === "queued") this.launch(reservation.job.id);
    return reservation;
  }

  public launch(jobId: string): void {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    queueMicrotask(() => void this.run(jobId).finally(() => this.running.delete(jobId)));
  }

  private async run(jobId: string): Promise<void> {
    const claimed = await this.store.claimTimeMachineJob(jobId);
    if (!claimed || claimed.status !== "running") return;
    let timelineApplied = false;
    try {
      const [world, current] = await Promise.all([this.store.get(claimed.worldId), snapshot(this.store, claimed.worldId)]);
      if (!world || !current) throw new Error("source_missing");
      if (current.version !== claimed.baseStoryVersion || current.story.updatedAt !== claimed.baseStoryUpdatedAt) {
        throw new Error("timeline_changed");
      }
      logInfo("time_machine.started", { worldId: claimed.worldId, chapter: claimed.targetChapterNumber, jobId });
      const replacement = await regenerateTimeline(world, current.story, claimed, async (completed) => {
        const progress = 5 + Math.round((completed / claimed.totalChapters) * 70);
        await this.store.markTimeMachineJobProgress(jobId, "running", progress, completed);
      });
      if (!replacement) throw new Error("generation_failed");
      const saved = isVersionedStore(this.store)
        ? await this.store.saveWorldStory(replacement, { expectedVersion: claimed.baseStoryVersion })
        : current.story.updatedAt === (await this.store.getWorldStory(claimed.worldId))?.updatedAt
          ? await this.store.saveWorldStory(replacement)
          : null;
      if (!saved) throw new Error("timeline_changed");
      timelineApplied = true;

      await this.store.markTimeMachineJobProgress(jobId, "illustrating", 78, claimed.totalChapters);
      const affected = saved.chapters.filter((chapter) => chapter.number >= claimed.targetChapterNumber);
      const beats = affected.flatMap((chapter) => chapter.beats);
      let illustrated = 0;
      for (const beat of beats) {
        try {
          await this.images.generate({ worldId: saved.worldId, sceneId: beat.id, moment: "chapter_scene" });
        } catch {
          // A failed image remains retryable from its chapter. The rewritten
          // story is valid and must not be rolled back because art failed.
        }
        illustrated += 1;
        await this.store.markTimeMachineJobProgress(
          jobId, "illustrating", 78 + Math.round((illustrated / Math.max(1, beats.length)) * 20), claimed.totalChapters,
        );
      }
      await this.store.markTimeMachineJobCompleted(jobId);
      logInfo("time_machine.completed", { worldId: claimed.worldId, chapter: claimed.targetChapterNumber, jobId });
    } catch (error) {
      const code = error instanceof Error && /^[a-z_]{3,40}$/.test(error.message) ? error.message : "generation_failed";
      if (timelineApplied) {
        // The canonical rewrite is already committed. Illustration is
        // best-effort and each missing scene remains retryable from the UI.
        await this.store.markTimeMachineJobCompleted(jobId);
        logWarn("time_machine.completed_with_image_errors", { worldId: claimed.worldId, chapter: claimed.targetChapterNumber, jobId, errorCode: code });
      } else {
        await this.store.markTimeMachineJobFailed(jobId, code);
        logWarn("time_machine.failed", { worldId: claimed.worldId, chapter: claimed.targetChapterNumber, jobId, errorCode: code });
      }
    }
  }
}
