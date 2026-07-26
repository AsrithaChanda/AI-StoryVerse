import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  proposeChapterDirectorChange,
  validateChapterDirectorProposal,
  type ChapterDirectorProposal,
} from "./chapter-director.js";
import {
  generateInitialStory,
  generateNextChapter,
  generateNextChapterStream,
  generatePerspective,
  generatePerspectiveStream,
  MAX_UPCOMING_DIRECTIONS,
  type NextChapterGeneration,
  type StoryChapter,
  type StoryStreamCallbacks,
  type WorldStory,
} from "./story.js";
import { logWarn } from "./logger.js";
import type { StoryStore, VersionedStoryStore } from "./persistence/store.js";
import type { StoryChapterDeletionFailure } from "./worlds.js";

const id = z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const commandSchema = z.object({ command: z.string().trim().min(3).max(1000) }).strict();
const characterSchema = z.object({ characterId: id }).strict();
const directionSchema = z.object({ direction: z.string().trim().min(3).max(1000) }).strict();
const directorPromptSchema = z.object({ prompt: z.string().trim().min(3).max(600) }).strict();
const directorApplySchema = z.object({ proposal: z.unknown() }).strict();

type StreamPhase = { stage: "writing" | "validating" };
type StorySnapshot = { story: WorldStory; version?: number };
type NextChapterGenerationFailure = {
  error: string;
  code: "next_chapter_generation_failed";
  retryable: true;
  queuedDirectionsPreserved: true;
  queuedDirectionCount: number;
};

function beginSse(response: Response): void {
  response.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function writeSse(response: Response, event: "phase" | "narration" | "complete" | "error", payload: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function storyStreamCallbacks(response: Response): StoryStreamCallbacks {
  return {
    onNarration: (text) => writeSse(response, "narration", { text }),
    onPhase: (stage) => writeSse(response, "phase", { stage } satisfies StreamPhase),
  };
}

function streamError(response: Response, error: string | { error: string; [key: string]: unknown }): void {
  writeSse(response, "error", typeof error === "string" ? { error } : error);
  response.end();
}

function streamComplete(response: Response, payload: unknown): void {
  writeSse(response, "complete", payload);
  response.end();
}

function chapterDeletionError(response: Response, reason: StoryChapterDeletionFailure): Response {
  switch (reason) {
    case "story_not_found": return response.status(409).json({ error: "Generate Chapter 1 first" });
    case "chapter_not_found": return response.status(404).json({ error: "Chapter not found" });
    case "chapter_is_not_latest": return response.status(409).json({ error: "Only the latest chapter can be deleted individually" });
    case "chapter_has_no_previous": return response.status(409).json({ error: "Chapter 1 cannot be deleted" });
  }
}

function isVersionedStore(store: StoryStore): store is VersionedStoryStore {
  return "getWorldStoryRecord" in store && typeof store.getWorldStoryRecord === "function";
}

async function storySnapshot(store: StoryStore, worldId: string): Promise<StorySnapshot | null> {
  if (isVersionedStore(store)) {
    const record = await store.getWorldStoryRecord(worldId);
    return record ? { story: record.story, version: record.version } : null;
  }
  const story = await store.getWorldStory(worldId);
  return story ? { story } : null;
}

async function timeMachineActive(store: StoryStore, worldId: string): Promise<boolean> {
  const job = await store.findLatestTimeMachineJob(worldId);
  return job?.status === "queued" || job?.status === "running" || job?.status === "illustrating";
}

async function saveSnapshot(store: StoryStore, story: WorldStory, snapshot: StorySnapshot | null): Promise<WorldStory | null> {
  // The Time Machine owns the world version until its complete replacement is
  // committed. This second, save-time check closes the race where another
  // chapter request began just before the rewrite job was reserved.
  if (await timeMachineActive(store, story.worldId)) return null;
  if (isVersionedStore(store)) return store.saveWorldStory(story, { expectedVersion: snapshot?.version ?? 0 });
  return store.saveWorldStory(story);
}

async function rejectWhileTimeMachineRuns(store: StoryStore, worldId: string, response: Response): Promise<boolean> {
  if (!await timeMachineActive(store, worldId)) return false;
  response.status(423).json({ error: "The Story Time Machine is rewriting this world. Wait for it to finish before changing the timeline." });
  return true;
}

/**
 * A failed generation never constructs or saves the candidate append, so a
 * repeat of the same endpoint is safe: it starts from the existing chapter
 * and the persisted one-shot direction queue. Keep that guarantee explicit
 * in both the API payload and the human-readable SSE error the reader shows.
 */
function nextChapterGenerationFailure(story: WorldStory): NextChapterGenerationFailure {
  const queuedDirectionCount = story.upcomingDirections?.filter((direction) => typeof direction === "string" && direction.trim().length > 0).length ?? 0;
  const preservedState = queuedDirectionCount > 0
    ? `${queuedDirectionCount} queued direction${queuedDirectionCount === 1 ? " is" : "s are"} still saved.`
    : "Your current chapter is unchanged.";
  return {
    error: `The next chapter could not be generated. ${preservedState} Try again; if it keeps failing, check the AI provider connection and server logs.`,
    code: "next_chapter_generation_failed",
    retryable: true,
    queuedDirectionsPreserved: true,
    queuedDirectionCount,
  };
}

/** Generation helpers normally return null on a provider/validation failure,
 * but the route also protects its SSE response from an unexpected exception. */
async function safelyGenerateNextChapter(run: () => Promise<NextChapterGeneration | null>): Promise<NextChapterGeneration | null> {
  try {
    return await run();
  } catch (error) {
    const reason = error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name) ? error.name : "unexpected";
    logWarn("story.next_generation.route_failure", { reason });
    return null;
  }
}

function appendGeneratedChapter(existing: WorldStory, generated: NextChapterGeneration): WorldStory {
  return {
    ...existing,
    characters: [...existing.characters, ...generated.newCharacters],
    chapters: [...existing.chapters, generated.chapter],
    // Directions are a one-shot queue: they remain intact if generation or
    // persistence fails, then clear only in the successful saved result.
    upcomingDirections: [],
  };
}

/**
 * The Director is intentionally narrower than the general revision flow: it
 * replaces one reviewed canonical chapter, preserves the cast/world/future
 * queue byte-for-byte, and clears only POVs derived from that old chapter.
 */
function replaceLatestChapterFromDirector(existing: WorldStory, proposal: ChapterDirectorProposal): WorldStory | null {
  const current = existing.chapters.at(-1);
  const replacement = proposal.proposedChapter;
  if (!current || current.id !== proposal.chapterId || current.id !== replacement.id || current.number !== replacement.number) return null;
  return {
    ...existing,
    chapters: [...existing.chapters.slice(0, -1), replacement],
    perspectives: existing.perspectives.filter((entry) => entry.chapterId !== current.id),
  };
}

function latestDirectorChapter(snapshot: StorySnapshot, chapterId: string): StoryChapter | null {
  const current = snapshot.story.chapters.at(-1);
  return current?.id === chapterId ? current : null;
}

/**
 * Shared HTTP layer for the local SQLite store and transactional PostgreSQL.
 * Versioned stores use optimistic locking so two creators cannot silently
 * overwrite the same story aggregate while model work is in flight.
 */
export function createStoryRouter(store: StoryStore): Router {
  const router = Router();

  router.get("/worlds/:worldId/story", async (request, response) => {
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const snapshot = await storySnapshot(store, worldId.data);
    return snapshot ? response.json({ story: snapshot.story }) : response.status(404).json({ error: "Story has not been generated" });
  });

  // Retain chapterId and atomically remove every later chapter.
  router.delete("/worlds/:worldId/story/chapters/:chapterId/future", async (request, response) => {
    const worldId = id.safeParse(request.params.worldId);
    const chapterId = id.safeParse(request.params.chapterId);
    if (!worldId.success || !chapterId.success) return response.status(400).json({ error: "Invalid world or chapter identifier" });
    if (!await store.get(worldId.data)) return response.status(404).json({ error: "World not found" });
    if (await rejectWhileTimeMachineRuns(store, worldId.data, response)) return;
    const result = await store.deleteFutureChapters(worldId.data, chapterId.data);
    if (!result.ok) return chapterDeletionError(response, result.reason);
    return response.json({ story: result.value.story, chapter: result.value.chapter });
  });

  router.delete("/worlds/:worldId/story/chapters/:chapterId", async (request, response) => {
    const worldId = id.safeParse(request.params.worldId);
    const chapterId = id.safeParse(request.params.chapterId);
    if (!worldId.success || !chapterId.success) return response.status(400).json({ error: "Invalid world or chapter identifier" });
    if (!await store.get(worldId.data)) return response.status(404).json({ error: "World not found" });
    if (await rejectWhileTimeMachineRuns(store, worldId.data, response)) return;
    const result = await store.deleteLatestChapter(worldId.data, chapterId.data);
    if (!result.ok) return chapterDeletionError(response, result.reason);
    return response.json({ story: result.value.story, chapter: result.value.chapter });
  });

  router.post("/worlds/:worldId/story/bootstrap", async (request, response) => {
    const world = await store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = await storySnapshot(store, world.id);
    // Empty fallback records are retried after the creator configures a model.
    if (existing && existing.story.chapters.length > 0) return response.json({ story: existing.story });
    const generated = await generateInitialStory(world);
    if (generated.chapters.length === 0) return response.status(503).json({ error: "Chapter 1 could not be generated. Check the server log for the safe provider status, then try again." });
    const story = await saveSnapshot(store, generated, existing);
    if (story) return response.json({ story });
    // Another request can win an insert race. Returning its completed story
    // makes bootstrap idempotent instead of presenting a false failure.
    const concurrent = await storySnapshot(store, world.id);
    if (concurrent?.story.chapters.length) return response.json({ story: concurrent.story });
    return response.status(409).json({ error: "The story changed while Chapter 1 was being generated. Please retry." });
  });

  router.post("/worlds/:worldId/story/directions", async (request, response) => {
    const parsed = directionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A 3–1000 character upcoming direction is required" });
    const world = await store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const direction = parsed.data.direction.replace(/\s+/g, " ");
    const queued = snapshot.story.upcomingDirections ?? [];
    if (queued.some((entry) => entry.toLocaleLowerCase() === direction.toLocaleLowerCase())) return response.json({ story: snapshot.story });
    if (queued.length >= MAX_UPCOMING_DIRECTIONS) return response.status(409).json({ error: `You can queue up to ${MAX_UPCOMING_DIRECTIONS} directions before generating the next chapter` });
    const story = await saveSnapshot(store, { ...snapshot.story, upcomingDirections: [...queued, direction] }, snapshot);
    return story ? response.json({ story }) : response.status(409).json({ error: "The story changed while the direction was being saved. Reload and try again." });
  });

  /**
   * Proposal stage: only the latest canonical chapter is passed to the
   * bounded Director model. This endpoint never persists a story change.
   */
  router.post("/worlds/:worldId/story/chapters/:chapterId/director/propose", async (request, response) => {
    const parsed = directorPromptSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A 3–600 character Director prompt is required" });
    const worldId = id.safeParse(request.params.worldId);
    const chapterId = id.safeParse(request.params.chapterId);
    if (!worldId.success || !chapterId.success) return response.status(400).json({ error: "Invalid world or chapter identifier" });
    if (!await store.get(worldId.data)) return response.status(404).json({ error: "World not found" });
    const snapshot = await storySnapshot(store, worldId.data);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const current = latestDirectorChapter(snapshot, chapterId.data);
    if (!current) return response.status(409).json({ error: "AI Story Director can edit only the current canonical chapter" });
    const proposal = await proposeChapterDirectorChange(current, parsed.data.prompt);
    if (!proposal) return response.status(503).json({ error: "The AI Story Director could not prepare a chapter change" });
    return response.json({ proposal });
  });

  /**
   * Apply stage: no second model call. The previously displayed proposal is
   * structurally revalidated against the latest chapter before a CAS save.
   */
  router.post("/worlds/:worldId/story/chapters/:chapterId/director/apply", async (request, response) => {
    const parsed = directorApplySchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A Director proposal is required" });
    const worldId = id.safeParse(request.params.worldId);
    const chapterId = id.safeParse(request.params.chapterId);
    if (!worldId.success || !chapterId.success) return response.status(400).json({ error: "Invalid world or chapter identifier" });
    if (!await store.get(worldId.data)) return response.status(404).json({ error: "World not found" });
    const snapshot = await storySnapshot(store, worldId.data);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const current = latestDirectorChapter(snapshot, chapterId.data);
    if (!current) return response.status(409).json({ error: "AI Story Director can apply changes only to the current canonical chapter" });
    const proposal = validateChapterDirectorProposal(parsed.data.proposal, current);
    if (!proposal) return response.status(409).json({ error: "This chapter has changed since the Director preview. Preview the change again." });
    const updated = replaceLatestChapterFromDirector(snapshot.story, proposal);
    if (!updated) return response.status(409).json({ error: "This chapter has changed since the Director preview. Preview the change again." });
    const story = await saveSnapshot(store, updated, snapshot);
    if (!story) return response.status(409).json({ error: "This chapter changed before the Director proposal could be applied. Preview it again." });
    const chapter = story.chapters.at(-1);
    return chapter ? response.json({ story, chapter }) : response.status(500).json({ error: "The Director change could not be saved" });
  });

  router.post("/worlds/:worldId/story/next", async (request, response) => {
    const world = await store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    if (await rejectWhileTimeMachineRuns(store, world.id, response)) return;
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const generated = await safelyGenerateNextChapter(() => generateNextChapter(world, snapshot.story));
    if (!generated) return response.status(503).json(nextChapterGenerationFailure(snapshot.story));
    const story = await saveSnapshot(store, appendGeneratedChapter(snapshot.story, generated), snapshot);
    return story ? response.json({ story }) : response.status(409).json({ error: "The story changed while the next chapter was being generated. Reload and try again." });
  });

  router.post("/worlds/:worldId/story/next/stream", async (request, response) => {
    const world = await store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    if (await rejectWhileTimeMachineRuns(store, world.id, response)) return;
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    beginSse(response);
    writeSse(response, "phase", { stage: "writing" } satisfies StreamPhase);
    const generated = await safelyGenerateNextChapter(() => generateNextChapterStream(world, snapshot.story, storyStreamCallbacks(response)));
    if (!generated) return streamError(response, nextChapterGenerationFailure(snapshot.story));
    try {
      const story = await saveSnapshot(store, appendGeneratedChapter(snapshot.story, generated), snapshot);
      if (!story) return streamError(response, "The story changed while the next chapter was being generated. Reload and try again.");
      return streamComplete(response, { story, chapter: generated.chapter });
    } catch {
      return streamError(response, "The next chapter could not be saved");
    }
  });

  router.post("/worlds/:worldId/story/command", async (request, response) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A 3–1000 character story command is required" });
    const world = await store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    if (await rejectWhileTimeMachineRuns(store, world.id, response)) return;
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const generated = await generateNextChapter(world, snapshot.story, parsed.data.command);
    if (!generated) return response.status(503).json({ error: "The command could not be applied" });
    const story = await saveSnapshot(store, appendGeneratedChapter(snapshot.story, generated), snapshot);
    return story ? response.json({ story }) : response.status(409).json({ error: "The story changed while the command was being applied. Reload and try again." });
  });

  router.post("/worlds/:worldId/story/command/stream", async (request, response) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A 3–1000 character story command is required" });
    const world = await store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    if (await rejectWhileTimeMachineRuns(store, world.id, response)) return;
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    beginSse(response);
    writeSse(response, "phase", { stage: "writing" } satisfies StreamPhase);
    const generated = await generateNextChapterStream(world, snapshot.story, storyStreamCallbacks(response), parsed.data.command);
    if (!generated) return streamError(response, "The command could not be applied");
    try {
      const story = await saveSnapshot(store, appendGeneratedChapter(snapshot.story, generated), snapshot);
      if (!story) return streamError(response, "The story changed while the command was being applied. Reload and try again.");
      return streamComplete(response, { story, chapter: generated.chapter });
    } catch {
      return streamError(response, "The command could not be saved");
    }
  });

  router.post("/worlds/:worldId/story/perspective", async (request: Request, response: Response) => {
    const parsed = characterSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A valid character identifier is required" });
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const world = await store.get(worldId.data);
    if (!world) return response.status(404).json({ error: "World not found" });
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const chapterId = snapshot.story.chapters.at(-1)?.id;
    const cached = snapshot.story.perspectives.find((entry) => entry.characterId === parsed.data.characterId && entry.chapterId === chapterId);
    const perspective = cached ?? await generatePerspective(world, snapshot.story, parsed.data.characterId);
    if (!perspective) return response.status(503).json({ error: "The character perspective could not be generated" });
    const updated: WorldStory = cached ? snapshot.story : { ...snapshot.story, perspectives: [...snapshot.story.perspectives.filter((entry) => entry.chapterId !== chapterId || entry.characterId !== parsed.data.characterId), perspective] };
    if (cached) return response.json({ story: snapshot.story, perspective });
    const story = await saveSnapshot(store, updated, snapshot);
    return story ? response.json({ story, perspective }) : response.status(409).json({ error: "The story changed while this perspective was being generated. Reload and try again." });
  });

  router.post("/worlds/:worldId/story/perspective/stream", async (request: Request, response: Response) => {
    const parsed = characterSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A valid character identifier is required" });
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const world = await store.get(worldId.data);
    if (!world) return response.status(404).json({ error: "World not found" });
    const snapshot = await storySnapshot(store, world.id);
    if (!snapshot) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const chapterId = snapshot.story.chapters.at(-1)?.id;
    const cached = snapshot.story.perspectives.find((entry) => entry.characterId === parsed.data.characterId && entry.chapterId === chapterId);
    beginSse(response);
    writeSse(response, "phase", { stage: "writing" } satisfies StreamPhase);
    if (cached) {
      writeSse(response, "phase", { stage: "validating" } satisfies StreamPhase);
      return streamComplete(response, { story: snapshot.story, perspective: cached });
    }
    const perspective = await generatePerspectiveStream(world, snapshot.story, parsed.data.characterId, storyStreamCallbacks(response));
    if (!perspective) return streamError(response, "The character perspective could not be generated");
    try {
      const updated: WorldStory = { ...snapshot.story, perspectives: [...snapshot.story.perspectives.filter((entry) => entry.chapterId !== chapterId || entry.characterId !== parsed.data.characterId), perspective] };
      const story = await saveSnapshot(store, updated, snapshot);
      if (!story) return streamError(response, "The story changed while this perspective was being generated. Reload and try again.");
      return streamComplete(response, { story, perspective });
    } catch {
      return streamError(response, "The character perspective could not be saved");
    }
  });

  return router;
}
