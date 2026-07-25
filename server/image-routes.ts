import { existsSync } from "node:fs";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { WorldStore } from "./worlds.js";
import { LocalImageAssetStore } from "./images/assets.js";
import { createStoryImagePipeline, StoryImagePipeline } from "./images/pipeline.js";
import { ImageGenerationError, type ImageGenerator, type ImageRequest } from "./images/types.js";

const momentSchema = z.enum(["world_cover", "chapter_scene", "perspective_scene"]);
const idSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Invalid identifier");
const imageRequestSchema = z.object({
  worldId: idSchema,
  sceneId: idSchema,
  moment: momentSchema,
  branchId: idSchema.optional(),
  protagonistId: idSchema.optional(),
  retry: z.boolean().optional(),
}).strict();

export type ImageRouterOptions = {
  store: WorldStore;
  generator?: ImageGenerator;
  assets?: LocalImageAssetStore;
  pipeline?: StoryImagePipeline;
};

/**
 * Mount with `app.use("/api", createImageRouter({ store }))`.
 * There is deliberately no raw-prompt endpoint: every prompt is rebuilt from
 * a stored world and an allow-listed story moment.
 */
export function createImageRouter(options: ImageRouterOptions): Router {
  const router = Router();
  const assets = options.assets ?? new LocalImageAssetStore();
  const pipeline = options.pipeline ?? createStoryImagePipeline(options.store, { generator: options.generator, assets });

  router.get("/images/assets/:filename", (request: Request, response: Response) => {
    const path = typeof request.params.filename === "string" ? assets.pathFor(request.params.filename) : null;
    if (!path || !existsSync(path)) return response.status(404).json({ error: "Image asset not found" });
    return response.sendFile(path);
  });

  router.get("/images/cache/:cacheKey", (request: Request, response: Response) => {
    const parsed = z.string().regex(/^[a-f0-9]{40}$/i).safeParse(request.params.cacheKey);
    if (!parsed.success) return response.status(400).json({ error: "Invalid image cache key" });
    const image = options.store.getStoryImageByCacheKey(parsed.data);
    return image ? response.json({ image: {
      id: image.id, cacheKey: image.cacheKey, worldId: image.worldId, branchId: image.branchId,
      sceneId: image.sceneId, protagonistId: image.protagonistId, characterIds: image.characterIds,
      promptVersion: image.promptVersion, status: image.status, imageUrl: image.imageUrl,
      fallbackUrl: image.fallbackUrl, provider: image.provider, errorCode: image.errorCode,
      createdAt: image.createdAt, updatedAt: image.updatedAt,
    } }) : response.status(404).json({ error: "Image not found" });
  });

  router.get("/images/:sceneId", (request: Request, response: Response) => {
    const parsed = z.object({
      sceneId: idSchema, worldId: idSchema,
      branchId: idSchema.optional(), protagonistId: idSchema.optional(),
    }).safeParse({ sceneId: request.params.sceneId, worldId: request.query.worldId, branchId: request.query.branchId, protagonistId: request.query.protagonistId });
    if (!parsed.success) return response.status(400).json({ error: "worldId and sceneId are required identifiers" });
    const image = pipeline.get(parsed.data);
    return image ? response.json({ image }) : response.status(404).json({ error: "Image not found" });
  });

  router.post("/images/generate", async (request: Request, response: Response) => {
    const parsed = imageRequestSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid image generation request" });
    return respondWithImage(pipeline, parsed.data, response);
  });

  router.post("/worlds/:worldId/cover", async (request: Request, response: Response) => {
    const worldId = idSchema.safeParse(request.params.worldId);
    if (!worldId.success) return response.status(400).json({ error: "Invalid world identifier" });
    if (!options.store.get(worldId.data)) return response.status(404).json({ error: "World not found" });
    // Body accepts one constrained Boolean only; it never accepts prompt text.
    const body = z.object({ retry: z.boolean().optional() }).strict().safeParse(request.body ?? {});
    if (!body.success) return response.status(400).json({ error: "Invalid cover generation request" });
    return respondWithImage(pipeline, { worldId: worldId.data, sceneId: "world-cover", moment: "world_cover", retry: body.data.retry }, response);
  });
  return router;
}

async function respondWithImage(pipeline: StoryImagePipeline, request: ImageRequest, response: Response): Promise<Response> {
  try {
    const image = await pipeline.generate(request);
    // A durable failed image record is returned with the provider failure
    // status. The client still receives fallback/retry metadata, while API
    // consumers no longer mistake an image failure for a successful render.
    return response.status(image.status === "failed" ? 502 : 200).json({ image });
  } catch (error) {
    if (error instanceof ImageGenerationError && error.message === "World not found") return response.status(404).json({ error: "World not found" });
    return response.status(500).json({ error: "Unable to prepare story image" });
  }
}
