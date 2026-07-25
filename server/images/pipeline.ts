import type { StoryStore } from "../persistence/store.js";
import { LocalImageAssetStore, StoryImageAssetStore } from "./assets.js";
import { buildImagePrompt, fallbackImageUrl, IMAGE_PROMPT_VERSION, imageCacheKey } from "./prompts.js";
import { ImageGenerationError, type ImageGenerator, type ImageRequest, type PublicStoryImage, toPublicStoryImage } from "./types.js";
import { createImageGenerator } from "./provider.js";
import { logInfo, logWarn } from "../logger.js";

export class StoryImagePipeline {
  public constructor(
    private readonly store: StoryStore,
    private readonly generator: ImageGenerator,
    private readonly assets: StoryImageAssetStore = new LocalImageAssetStore(),
  ) {}

  public async get(request: Omit<ImageRequest, "retry" | "moment"> & { moment?: ImageRequest["moment"] }): Promise<PublicStoryImage | null> {
    const image = await this.store.findStoryImage(request.worldId, request.sceneId, request.branchId, request.protagonistId, IMAGE_PROMPT_VERSION);
    return image ? toPublicStoryImage(image) : null;
  }

  public async generate(request: ImageRequest): Promise<PublicStoryImage> {
    const world = await this.store.get(request.worldId);
    if (!world) throw new ImageGenerationError("invalid_response", "World not found");
    const canonical = { worldId: request.worldId, sceneId: request.sceneId, moment: request.moment, branchId: request.branchId, protagonistId: request.protagonistId };
    const cacheKey = imageCacheKey(canonical);
    logInfo("image.generation.requested", { worldId: canonical.worldId, sceneId: canonical.sceneId, moment: canonical.moment, cacheKey: cacheKey.slice(0, 12) });
    const [visualBeat, story] = await Promise.all([
      this.store.visualBeat(world.id, canonical.sceneId),
      this.store.getWorldStory(world.id),
    ]);
    const prompt = buildImagePrompt(
      world,
      canonical,
      visualBeat,
      story,
    );
    const reserved = await this.store.reserveStoryImage({
      cacheKey, worldId: canonical.worldId, branchId: canonical.branchId, sceneId: canonical.sceneId,
      protagonistId: canonical.protagonistId, characterIds: prompt.characterIds, promptVersion: IMAGE_PROMPT_VERSION,
      prompt: prompt.prompt, fallbackUrl: fallbackImageUrl(canonical.moment),
    });
    if (!reserved.created) {
      const retried = request.retry && reserved.image.status === "failed"
        ? await this.store.requeueFailedStoryImage(cacheKey) : null;
      if (!retried || retried.status !== "pending") {
        logInfo("image.generation.cache_hit", { worldId: canonical.worldId, sceneId: canonical.sceneId, status: reserved.image.status, cacheKey: cacheKey.slice(0, 12) });
        return toPublicStoryImage(reserved.image);
      }
    }
    if (!this.generator.isAvailable) {
      logWarn("image.generation.fallback", { worldId: canonical.worldId, sceneId: canonical.sceneId, reason: "provider_disabled", cacheKey: cacheKey.slice(0, 12) });
      const fallback = await this.store.markStoryImageFallback(cacheKey, "provider_disabled");
      if (!fallback) throw new ImageGenerationError("persistence_failed", "Could not save image fallback state");
      return toPublicStoryImage(fallback);
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
        const ready = await this.store.markStoryImageReady(cacheKey, { imageUrl, provider: generated.provider, providerAssetId: generated.providerAssetId });
        if (!ready) throw new ImageGenerationError("persistence_failed", "Could not save generated image state");
        return toPublicStoryImage(ready);
      } catch (error) {
        lastError = error;
      }
    }
    const code = lastError instanceof ImageGenerationError ? lastError.code : "provider_error";
    const safeDetails = lastError instanceof ImageGenerationError ? lastError.safeDetails : {};
    logWarn("image.generation.failed", { worldId: canonical.worldId, sceneId: canonical.sceneId, errorCode: code, cacheKey: cacheKey.slice(0, 12), ...safeDetails });
    const failed = await this.store.markStoryImageFailed(cacheKey, code);
    if (!failed) throw new ImageGenerationError("persistence_failed", "Could not save image failure state");
    return toPublicStoryImage(failed);
  }
}

/** Shared factory for route handlers and post-world-creation background work. */
export function createStoryImagePipeline(
  store: StoryStore,
  options: { generator?: ImageGenerator; assets?: StoryImageAssetStore } = {},
): StoryImagePipeline {
  return new StoryImagePipeline(store, options.generator ?? createImageGenerator(), options.assets ?? new LocalImageAssetStore());
}
