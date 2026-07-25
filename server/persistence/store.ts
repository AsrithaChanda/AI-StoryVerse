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
}

/** Adds explicit version reads for request handlers that need CAS protection. */
export interface VersionedStoryStore extends StoryStore {
  getWorldStoryRecord(worldId: string): Promise<VersionedWorldStory | null>;
}
