import type {
  CreateWorldInput,
  StoryChapterDeletionResult,
  World,
} from "../worlds.js";
import type { NewStoryImage, StoredStoryImage } from "../images/types.js";
import type { WorldStory } from "../story.js";

/** A store can be local/synchronous in development or remote/asynchronous in production. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * A failed compare-and-swap save returns null. Callers should reload the story
 * and either retry their intent or tell the creator that somebody else changed
 * the same world first.
 */
export type StoryWriteOptions = {
  /** Version returned by getWorldStoryRecord. Omit for legacy/local writes. */
  expectedVersion?: number;
};

export type VersionedWorldStory = {
  story: WorldStory;
  /** Monotonically increasing database version, separate from narrative data. */
  version: number;
};

export type StoryImageReservation = {
  image: StoredStoryImage;
  /** True only for the request that won cache_key creation. */
  created: boolean;
};

/** Lifecycle state for an on-demand, asynchronous story trailer render. */
export type StoryTrailerStatus = "queued" | "in_progress" | "ready" | "failed";

/**
 * Input persisted before a paid video render is requested. `cacheKey` is a
 * deterministic snapshot identity, so concurrent clicks cannot create two
 * render jobs for the same world chapter and revision.
 */
export type NewStoryTrailer = {
  cacheKey: string;
  worldId: string;
  chapterId: string;
  chapterRevision: number;
  promptVersion: string;
  /** Server-only generation instructions. Never return this to browsers. */
  prompt: string;
};

/** Durable trailer state. Video bytes live in the configured asset store. */
export type StoredStoryTrailer = NewStoryTrailer & {
  id: string;
  status: StoryTrailerStatus;
  progress: number;
  videoUrl?: string;
  provider?: string;
  providerJobId?: string;
  providerAssetId?: string;
  errorCode?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type StoryTrailerReservation = {
  trailer: StoredStoryTrailer;
  /** True only for the request that won cache_key creation. */
  created: boolean;
};

/**
 * Result of an explicit retry. Only the caller with `requeued: true` may
 * submit a new provider job; every other concurrent caller receives the
 * durable current record with `requeued: false`.
 */
export type StoryTrailerRetryReservation = {
  trailer: StoredStoryTrailer;
  requeued: boolean;
};

/** Browser-safe trailer shape. Prompt and provider implementation IDs stay server-side. */
export type PublicStoryTrailer = Omit<
  StoredStoryTrailer,
  "cacheKey" | "prompt" | "providerJobId" | "providerAssetId"
>;

export function toPublicStoryTrailer(trailer: StoredStoryTrailer): PublicStoryTrailer {
  const {
    cacheKey: _cacheKey,
    prompt: _prompt,
    providerJobId: _providerJobId,
    providerAssetId: _providerAssetId,
    ...publicTrailer
  } = trailer;
  return publicTrailer;
}

/**
 * Shared persistence contract used by the HTTP layer. Every method permits a
 * Promise so the existing SQLite WorldStore remains a development fallback
 * while Postgres/Lakebase can be used without a second route implementation.
 */
export interface StoryStore {
  /** Optional because the existing SQLite fallback initializes in its constructor. */
  initialize?(): Promise<void>;
  close?(): Promise<void>;

  list(): MaybePromise<World[]>;
  get(worldId: string): MaybePromise<World | null>;
  create(
    input: CreateWorldInput,
    generated: Pick<World, "openingScene" | "characters" | "source">,
  ): MaybePromise<World>;
  deleteWorld(worldId: string): MaybePromise<boolean>;

  getWorldStory(worldId: string): MaybePromise<WorldStory | null>;
  saveWorldStory(story: WorldStory, options?: StoryWriteOptions): MaybePromise<WorldStory | null>;
  deleteLatestChapter(worldId: string, chapterId: string): MaybePromise<StoryChapterDeletionResult>;
  deleteFutureChapters(worldId: string, chapterId: string): MaybePromise<StoryChapterDeletionResult>;
  visualBeat(worldId: string, sceneId: string): MaybePromise<string | null>;

  reserveStoryImage(input: NewStoryImage): MaybePromise<StoryImageReservation>;
  getStoryImageByCacheKey(cacheKey: string): MaybePromise<StoredStoryImage | null>;
  findStoryImage(
    worldId: string,
    sceneId: string,
    branchId?: string,
    protagonistId?: string,
    promptVersion?: string,
  ): MaybePromise<StoredStoryImage | null>;
  markStoryImageReady(
    cacheKey: string,
    result: { imageUrl: string; provider: string; providerAssetId?: string },
  ): MaybePromise<StoredStoryImage | null>;
  markStoryImageFallback(cacheKey: string, errorCode?: string): MaybePromise<StoredStoryImage | null>;
  markStoryImageFailed(cacheKey: string, errorCode: string): MaybePromise<StoredStoryImage | null>;
  requeueFailedStoryImage(cacheKey: string): MaybePromise<StoredStoryImage | null>;

  reserveStoryTrailer(input: NewStoryTrailer): MaybePromise<StoryTrailerReservation>;
  getStoryTrailerByCacheKey(cacheKey: string): MaybePromise<StoredStoryTrailer | null>;
  findStoryTrailer(
    worldId: string,
    chapterId: string,
    chapterRevision: number,
  ): MaybePromise<StoredStoryTrailer | null>;
  markStoryTrailerQueued(
    cacheKey: string,
    result: { provider: string; providerJobId: string; providerAssetId?: string; status?: "queued" | "in_progress"; progress?: number },
  ): MaybePromise<StoredStoryTrailer | null>;
  markStoryTrailerProgress(
    cacheKey: string,
    progress: number,
    status: "queued" | "in_progress",
  ): MaybePromise<StoredStoryTrailer | null>;
  markStoryTrailerReady(
    cacheKey: string,
    result: { videoUrl: string; provider: string; providerAssetId?: string },
  ): MaybePromise<StoredStoryTrailer | null>;
  markStoryTrailerFailed(cacheKey: string, errorCode: string): MaybePromise<StoredStoryTrailer | null>;
  requeueFailedStoryTrailer(cacheKey: string): MaybePromise<StoryTrailerRetryReservation | null>;
}

/** Adds explicit version reads for request handlers that need CAS protection. */
export interface VersionedStoryStore extends StoryStore {
  getWorldStoryRecord(worldId: string): Promise<VersionedWorldStory | null>;
}
