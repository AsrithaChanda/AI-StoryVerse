import { Router } from "express";
import { z } from "zod";
import type { StoryStore } from "./persistence/store.js";
import { TimeMachineService } from "./time-machine.js";

const id = z.string().min(1).max(160);
const startSchema = z.object({
  targetChapterId: id,
  changePrompt: z.string().trim().min(3).max(2000),
  futurePrompt: z.string().trim().max(2000).optional(),
});

export function createTimeMachineRouter(options: { store: StoryStore; service: TimeMachineService }): Router {
  const router = Router();

  router.get("/worlds/:worldId/time-machine", async (request, response) => {
    const worldId = id.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    const job = await options.store.findLatestTimeMachineJob(worldId.data);
    if (job?.status === "queued") options.service.launch(job.id);
    return response.json({ job });
  });

  router.post("/worlds/:worldId/time-machine", async (request, response) => {
    const worldId = id.safeParse(request.params.worldId);
    const parsed = startSchema.safeParse(request.body);
    if (!worldId.success || !parsed.success) {
      return response.status(400).json({ error: "Choose a chapter and describe the decision to change." });
    }
    if (!await options.store.get(worldId.data)) return response.status(404).json({ error: "World not found" });
    const result = await options.service.start(worldId.data, parsed.data);
    if (!result) return response.status(404).json({ error: "The selected chapter was not found." });
    return response.status(result.created ? 202 : 409).json({
      job: result.job,
      ...(result.created ? {} : { error: "A Time Machine rewrite is already running for this world." }),
    });
  });

  return router;
}
