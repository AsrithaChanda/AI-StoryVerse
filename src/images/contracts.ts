export type ImageStatus = "pending" | "ready" | "failed" | "fallback";
export type ImageMoment = "world_cover" | "opening" | "trust_kael" | "expose_kael" | "ravi_pov" | "chapter_scene" | "perspective_scene";

export type StoryImage = {
  id: string;
  cacheKey: string;
  worldId: string;
  branchId?: string;
  sceneId: string;
  protagonistId?: string;
  characterIds: string[];
  promptVersion: string;
  status: ImageStatus;
  imageUrl?: string;
  fallbackUrl: string;
  provider?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};
