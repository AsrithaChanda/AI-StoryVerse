import { Router } from "express";
import { z } from "zod";
import { ChapterAudioDirector } from "./chapter-audio-director.js";
import type { StoryStore } from "./persistence/store.js";
import type { AssetStore } from "./storage/index.js";

const id = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const body = z.object({ chapterId: id, protagonistId: id.optional(), contentHash: z.string().regex(/^[a-f0-9]{16}$/i).optional() }).strict();

/** All binary narration is served through the app, regardless of whether it
 * is stored locally or in a private Unity Catalog Volume. */
export function createChapterAudioRouter(store: StoryStore, assets?: AssetStore): Router {
  const router = Router();
  const director = assets ? new ChapterAudioDirector(store, assets, "narrations") : new ChapterAudioDirector(store);

  router.post("/worlds/:worldId/story/audio-plan", async (request, response) => {
    const parsed = body.safeParse(request.body);
    const worldId = id.safeParse(request.params.worldId);
    if (!parsed.success || !worldId.success) return response.status(400).json({ error: "Invalid chapter audio request" });
    const plan = await director.plan(worldId.data, parsed.data.chapterId, parsed.data.protagonistId);
    return plan ? response.json({ plan: { ...plan, narrationText: undefined } }) : response.status(404).json({ error: "Chapter or perspective not found" });
  });

  router.post("/worlds/:worldId/story/narration", async (request, response) => {
    const parsed = body.safeParse(request.body);
    const worldId = id.safeParse(request.params.worldId);
    if (!parsed.success || !worldId.success) return response.status(400).json({ error: "Invalid narration request" });
    const plan = await director.plan(worldId.data, parsed.data.chapterId, parsed.data.protagonistId);
    if (!plan) return response.status(404).json({ error: "Chapter or perspective not found" });
    if (parsed.data.contentHash && parsed.data.contentHash !== plan.contentHash) return response.status(409).json({ error: "The displayed perspective changed. Prepare narration again." });
    return response.json({ narration: await director.narrate(plan) });
  });

  router.get("/narrations/assets/:filename", async (request, response) => {
    try {
      const asset = await director.getAsset(request.params.filename);
      return asset ? response.type(asset.contentType).send(Buffer.from(asset.bytes)) : response.status(404).json({ error: "Narration asset not found" });
    } catch {
      return response.status(500).json({ error: "Unable to read narration asset" });
    }
  });
  return router;
}
