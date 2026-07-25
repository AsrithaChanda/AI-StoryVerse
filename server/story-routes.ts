import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { generateInitialStory, generateNextChapter, generateNextChapterStream, generatePerspective, generatePerspectiveStream, type StoryStreamCallbacks, type WorldStory } from "./story.js";
import type { WorldStore } from "./worlds.js";

const id = z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const commandSchema = z.object({ command: z.string().trim().min(3).max(1000) }).strict();
const characterSchema = z.object({ characterId: id }).strict();

type StreamPhase = { stage: "writing" | "validating" };

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

function streamError(response: Response, error: string): void {
  writeSse(response, "error", { error });
  response.end();
}

function streamComplete(response: Response, payload: unknown): void {
  writeSse(response, "complete", payload);
  response.end();
}

export function createStoryRouter(store: WorldStore): Router {
  const router = Router();
  router.get("/worlds/:worldId/story", (request, response) => {
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const story = store.getWorldStory(worldId.data);
    return story ? response.json({ story }) : response.status(404).json({ error: "Story has not been generated" });
  });
  router.post("/worlds/:worldId/story/bootstrap", async (request, response) => {
    const world = store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    // Empty fallback records are intentionally retried when the user opens the
    // world later (for example after adding a valid model key).
    if (existing && existing.chapters.length > 0) return response.json({ story: existing });
    const generated = await generateInitialStory(world);
    if (generated.chapters.length === 0) return response.status(503).json({ error: "Chapter 1 could not be generated. Check the server log for the safe provider status, then try again." });
    const story = store.saveWorldStory(generated);
    return response.json({ story });
  });
  router.post("/worlds/:worldId/story/next", async (request, response) => {
    const world = store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    if (!existing) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const chapter = await generateNextChapter(world, existing);
    if (!chapter) return response.status(503).json({ error: "The next chapter could not be generated" });
    return response.json({ story: store.saveWorldStory({ ...existing, chapters: [...existing.chapters, chapter] }) });
  });
  router.post("/worlds/:worldId/story/next/stream", async (request, response) => {
    const world = store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    if (!existing) return response.status(409).json({ error: "Generate Chapter 1 first" });
    beginSse(response);
    writeSse(response, "phase", { stage: "writing" } satisfies StreamPhase);
    const chapter = await generateNextChapterStream(world, existing, storyStreamCallbacks(response));
    if (!chapter) return streamError(response, "The next chapter could not be generated");
    try {
      const story = store.saveWorldStory({ ...existing, chapters: [...existing.chapters, chapter] });
      streamComplete(response, { story, chapter });
    } catch {
      streamError(response, "The next chapter could not be saved");
    }
  });
  router.post("/worlds/:worldId/story/command", async (request, response) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A 3–1000 character story command is required" });
    const world = store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    if (!existing) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const chapter = await generateNextChapter(world, existing, parsed.data.command);
    if (!chapter) return response.status(503).json({ error: "The command could not be applied" });
    // The command is retained on the generated chapter for auditability, but
    // must never leak into reader-facing world state or later model context.
    return response.json({ story: store.saveWorldStory({ ...existing, chapters: [...existing.chapters, chapter] }) });
  });
  router.post("/worlds/:worldId/story/command/stream", async (request, response) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A 3–1000 character story command is required" });
    const world = store.get(request.params.worldId);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    if (!existing) return response.status(409).json({ error: "Generate Chapter 1 first" });
    beginSse(response);
    writeSse(response, "phase", { stage: "writing" } satisfies StreamPhase);
    const chapter = await generateNextChapterStream(world, existing, storyStreamCallbacks(response), parsed.data.command);
    if (!chapter) return streamError(response, "The command could not be applied");
    try {
      const story = store.saveWorldStory({ ...existing, chapters: [...existing.chapters, chapter] });
      streamComplete(response, { story, chapter });
    } catch {
      streamError(response, "The command could not be saved");
    }
  });
  router.post("/worlds/:worldId/story/perspective", async (request: Request, response: Response) => {
    const parsed = characterSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A valid character identifier is required" });
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const world = store.get(worldId.data);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    if (!existing) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const chapterId = existing.chapters.at(-1)?.id;
    const cached = existing.perspectives.find((entry) => entry.characterId === parsed.data.characterId && entry.chapterId === chapterId);
    const perspective = cached ?? await generatePerspective(world, existing, parsed.data.characterId);
    if (!perspective) return response.status(503).json({ error: "The character perspective could not be generated" });
    const updated: WorldStory = cached ? existing : { ...existing, perspectives: [...existing.perspectives.filter((entry) => entry.chapterId !== chapterId || entry.characterId !== parsed.data.characterId), perspective] };
    return response.json({ story: store.saveWorldStory(updated), perspective });
  });
  router.post("/worlds/:worldId/story/perspective/stream", async (request: Request, response: Response) => {
    const parsed = characterSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A valid character identifier is required" });
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const world = store.get(worldId.data);
    if (!world) return response.status(404).json({ error: "World not found" });
    const existing = store.getWorldStory(world.id);
    if (!existing) return response.status(409).json({ error: "Generate Chapter 1 first" });
    const chapterId = existing.chapters.at(-1)?.id;
    const cached = existing.perspectives.find((entry) => entry.characterId === parsed.data.characterId && entry.chapterId === chapterId);
    beginSse(response);
    writeSse(response, "phase", { stage: "writing" } satisfies StreamPhase);
    if (cached) {
      writeSse(response, "phase", { stage: "validating" } satisfies StreamPhase);
      return streamComplete(response, { story: existing, perspective: cached });
    }
    const perspective = await generatePerspectiveStream(world, existing, parsed.data.characterId, storyStreamCallbacks(response));
    if (!perspective) return streamError(response, "The character perspective could not be generated");
    try {
      const updated: WorldStory = { ...existing, perspectives: [...existing.perspectives.filter((entry) => entry.chapterId !== chapterId || entry.characterId !== parsed.data.characterId), perspective] };
      const story = store.saveWorldStory(updated);
      streamComplete(response, { story, perspective });
    } catch {
      streamError(response, "The character perspective could not be saved");
    }
  });
  return router;
}
