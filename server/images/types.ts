export type ImageStatus = "pending" | "ready" | "failed" | "fallback";
/** Generic story surfaces only. A persisted world supplies the actual scene details. */
export type ImageMoment = "world_cover" | "chapter_scene" | "perspective_scene";

/** Server-only representation; `prompt` and retry metadata never leave the API. */
export type StoredStoryImage = {
  id: string;
  cacheKey: string;
  worldId: string;
  branchId?: string;
  sceneId: string;
  protagonistId?: string;
  characterIds: string[];
  promptVersion: string;
  prompt: string;
  status: ImageStatus;
  imageUrl?: string;
  fallbackUrl: string;
  provider?: string;
  providerAssetId?: string;
  errorCode?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type NewStoryImage = Pick<StoredStoryImage,
  "cacheKey" | "worldId" | "branchId" | "sceneId" | "protagonistId" |
  "characterIds" | "promptVersion" | "prompt" | "fallbackUrl">;

export type PublicStoryImage = Omit<StoredStoryImage, "prompt" | "retryCount" | "providerAssetId">;

export type ImageRequest = {
  worldId: string;
  sceneId: string;
  moment: ImageMoment;
  branchId?: string;
  protagonistId?: string;
  /** True only for an explicit, user initiated retry. */
  retry?: boolean;
};

export type ImageGenerationInput = {
  prompt: string;
  cacheKey: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  quality: "low" | "medium" | "high";
};

export type GeneratedImage = {
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  provider: string;
  providerAssetId?: string;
};

export type ImageGenerator = {
  readonly name: string;
  readonly isAvailable: boolean;
  generate(input: ImageGenerationInput): Promise<GeneratedImage>;
};

export class ImageGenerationError extends Error {
  public constructor(
    public readonly code: "disabled" | "timeout" | "provider_error" | "invalid_response" | "persistence_failed",
    message: string,
    /** Safe, non-prompt provider metadata for structured operational logs. */
    public readonly safeDetails: Record<string, string | number | boolean | undefined> = {},
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

export function toPublicStoryImage(image: StoredStoryImage): PublicStoryImage {
  return {
    id: image.id, cacheKey: image.cacheKey, worldId: image.worldId, branchId: image.branchId,
    sceneId: image.sceneId, protagonistId: image.protagonistId, characterIds: image.characterIds,
    promptVersion: image.promptVersion, status: image.status, imageUrl: image.imageUrl,
    fallbackUrl: image.fallbackUrl, provider: image.provider, errorCode: image.errorCode,
    createdAt: image.createdAt, updatedAt: image.updatedAt,
  };
}
