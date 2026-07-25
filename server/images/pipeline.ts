import type { WorldStore } from "../worlds.js";
import { LocalImageAssetStore } from "./assets.js";
import { buildImagePrompt, fallbackImageUrl, IMAGE_PROMPT_VERSION, imageCacheKey } from "./prompts.js";
import { ImageGenerationError, type ImageGenerator, type ImageRequest, type PublicStoryImage, toPublicStoryImage } from "./types.js";
import { createImageGenerator } from "./provider.js";
import { logInfo, logWarn } from "../logger.js";

export class StoryImagePipeline {
  public constructor(
    private readonly store: WorldStore,
    private readonly generator: ImageGenerator,
    private readonly assets = new LocalImageAssetStore(),
  ) {}

  public get(request: Omit<ImageRequest, "retry" | "moment"> & { moment?: ImageRequest["moment"] }): PublicStoryImage | null {
    const image = this.store.findStoryImage(request.worldId, request.sceneId, request.branchId, request.protagonistId, IMAGE_PROMPT_VERSION);
    return image ? toPublicStoryImage(image) : null;
  }

  public async generate(request: ImageRequest): Promise<PublicStoryImage> {
    const world = this.store.get(request.worldId);
    if (!world) throw new ImageGenerationError("invalid_response", "World not found");
    const canonical = { worldId: request.worldId, sceneId: request.sceneId, moment: request.moment, branchId: request.branchId, protagonistId: request.protagonistId };
    const cacheKey = imageCacheKey(canonical);
    logInfo("image.generation.requested", { worldId: canonical.worldId, sceneId: canonical.sceneId, moment: canonical.moment, cacheKey: cacheKey.slice(0, 12) });
    const prompt = buildImagePrompt(world, canonical, this.store.visualBeat(world.id, canonical.sceneId));
    const reserved = this.store.reserveStoryImage({
      cacheKey, worldId: canonical.worldId, branchId: canonical.branchId, sceneId: canonical.sceneId,
      protagonistId: canonical.protagonistId, characterIds: prompt.characterIds, promptVersion: IMAGE_PROMPT_VERSION,
      prompt: prompt.prompt, fallbackUrl: fallbackImageUrl(canonical.moment),
    });
    if (!reserved.created) {
      const retried = request.retry && reserved.image.status === "failed"
        ? this.store.requeueFailedStoryImage(cacheKey) : null;
      if (!retried || retried.status !== "pending") {
        logInfo("image.generation.cache_hit", { worldId: canonical.worldId, sceneId: canonical.sceneId, status: reserved.image.status, cacheKey: cacheKey.slice(0, 12) });
        return toPublicStoryImage(reserved.image);
      }
    }
    if (!this.generator.isAvailable) {
      logWarn("image.generation.fallback", { worldId: canonical.worldId, sceneId: canonical.sceneId, reason: "provider_disabled", cacheKey: cacheKey.slice(0, 12) });
      return toPublicStoryImage(this.store.markStoryImageFallback(cacheKey, "provider_disabled")!);
    }

    // Exactly one automatic retry; a terminal failure is cached to contain cost.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const generated = await this.generator.generate({
          prompt: prompt.prompt, cacheKey,
          size: process.env.STORYVERSE_IMAGE_SIZE === "1024x1536" || process.env.STORYVERSE_IMAGE_SIZE === "1536x1024" ? process.env.STORYVERSE_IMAGE_SIZE : "1024x1024",
          quality: process.env.STORYVERSE_IMAGE_QUALITY === "low" || process.env.STORYVERSE_IMAGE_QUALITY === "high" ? process.env.STORYVERSE_IMAGE_QUALITY : "medium",
        });
        const imageUrl = await this.assets.persist(cacheKey, generated);
        logInfo("image.generation.ready", { worldId: canonical.worldId, sceneId: canonical.sceneId, provider: generated.provider, cacheKey: cacheKey.slice(0, 12) });
        return toPublicStoryImage(this.store.markStoryImageReady(cacheKey, { imageUrl, provider: generated.provider, providerAssetId: generated.providerAssetId })!);
      } catch (error) {
        lastError = error;
      }
    }
    const code = lastError instanceof ImageGenerationError ? lastError.code : "provider_error";
    const safeDetails = lastError instanceof ImageGenerationError ? lastError.safeDetails : {};
    logWarn("image.generation.failed", { worldId: canonical.worldId, sceneId: canonical.sceneId, errorCode: code, cacheKey: cacheKey.slice(0, 12), ...safeDetails });
    return toPublicStoryImage(this.store.markStoryImageFailed(cacheKey, code)!);
  }
}

/** Shared factory for route handlers and post-world-creation background work. */
export function createStoryImagePipeline(
  store: WorldStore,
  options: { generator?: ImageGenerator; assets?: LocalImageAssetStore } = {},
): StoryImagePipeline {
  return new StoryImagePipeline(store, options.generator ?? createImageGenerator(), options.assets ?? new LocalImageAssetStore());
}
