import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { NewStoryImage, StoredStoryImage } from "./images/types.js";
import type {
  NewStoryTrailer,
  StoredStoryTrailer,
  StoryTrailerRetryReservation,
  StoryTrailerStatus,
} from "./persistence/store.js";
import { MAX_UPCOMING_DIRECTIONS, type StoryChapter, type WorldStory } from "./story.js";

export type World = {
  id: string;
  title: string;
  premise: string;
  genre: string;
  creatorPrompt: string;
  openingScene: string;
  characters: Array<{ name: string; role: string; trait: string }>;
  source: "openai" | "fallback";
  createdAt: string;
};

export type CreateWorldInput = Pick<World, "title" | "premise" | "genre" | "creatorPrompt">;

type WorldRow = Omit<World, "characters" | "source"> & { characters_json: string; source: World["source"] };

export type StoryChapterDeletion = {
  story: WorldStory;
  /** The surviving canonical chapter: prior for a latest deletion, selected for a future trim. */
  chapter: StoryChapter;
  removedChapterIds: string[];
};

export type StoryChapterDeletionFailure = "story_not_found" | "chapter_not_found" | "chapter_is_not_latest" | "chapter_has_no_previous";
export type StoryChapterDeletionResult = { ok: true; value: StoryChapterDeletion } | { ok: false; reason: StoryChapterDeletionFailure };

/**
 * The former demo universe was seeded under this ID. Keep only the stable ID
 * long enough to safely clean it from existing local databases; no story copy
 * or seed data remains in the application.
 */
const LEGACY_SEEDED_WORLD_ID = "the-last-ember";

function rowToWorld(row: WorldRow): World {
  return { id: row.id, title: row.title, premise: row.premise, genre: row.genre, creatorPrompt: row.creatorPrompt, openingScene: row.openingScene, characters: JSON.parse(row.characters_json) as World["characters"], source: row.source, createdAt: row.createdAt };
}

export class WorldStore {
  public constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, premise TEXT NOT NULL, genre TEXT NOT NULL,
      creator_prompt TEXT NOT NULL, opening_scene TEXT NOT NULL, characters_json TEXT NOT NULL,
      source TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS story_images (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL,
      branch_id TEXT,
      scene_id TEXT NOT NULL,
      protagonist_id TEXT,
      character_ids_json TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      image_url TEXT,
      fallback_url TEXT NOT NULL,
      provider TEXT,
      provider_asset_id TEXT,
      error_code TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(world_id) REFERENCES worlds(id)
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS story_images_scene_idx ON story_images(world_id, scene_id)");
    db.exec(`CREATE TABLE IF NOT EXISTS story_trailers (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_revision INTEGER NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      video_url TEXT,
      provider TEXT,
      provider_job_id TEXT,
      provider_asset_id TEXT,
      error_code TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(world_id) REFERENCES worlds(id)
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS story_trailers_lookup_idx ON story_trailers(world_id, chapter_id, chapter_revision, updated_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS story_trailers_status_idx ON story_trailers(status, updated_at DESC)");
    db.exec(`CREATE TABLE IF NOT EXISTS world_stories (
      world_id TEXT PRIMARY KEY,
      story_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(world_id) REFERENCES worlds(id)
    )`);
    this.removeLegacySeededWorld();
    this.normalizeLegacyFallbackBlueprints();
  }

  /**
   * Existing local installs may still contain the retired demo world. Delete
   * exactly its related records before its world row, in one transaction. The
   * predicates deliberately use the stable legacy ID so user-created worlds,
   * including worlds with similar titles or genres, are untouched.
   */
  private removeLegacySeededWorld(): void {
    this.inTransaction(() => this.deleteWorldRecords(LEGACY_SEEDED_WORLD_ID));
  }

  private inTransaction<T>(operation: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original database error if a rollback itself fails.
      }
      throw error;
    }
  }

  /** Deletes the relational records for one known world; callers own the transaction. */
  private deleteWorldRecords(worldId: string): void {
    this.db.prepare("DELETE FROM story_images WHERE world_id = ?").run(worldId);
    this.db.prepare("DELETE FROM story_trailers WHERE world_id = ?").run(worldId);
    this.db.prepare("DELETE FROM world_stories WHERE world_id = ?").run(worldId);
    this.db.prepare("DELETE FROM worlds WHERE id = ?").run(worldId);
  }

  /** Removes the former canned fallback prose/cast from already-created worlds. */
  private normalizeLegacyFallbackBlueprints(): void {
    const rows = this.db.prepare("SELECT id, title, premise, opening_scene, characters_json FROM worlds WHERE source = 'fallback'").all() as Array<{ id: string; title: string; premise: string; opening_scene: string; characters_json: string }>;
    for (const row of rows) {
      try {
        const names = (JSON.parse(row.characters_json) as Array<{ name?: string }>).map((character) => character.name);
        const legacyCast = names.length === 3 && names.includes("Ari Vale") && names.includes("Sable Orr") && names.includes("The Warden");
        const legacyOpening = row.opening_scene.startsWith(`At the edge of ${row.title}, the first impossible sign appears before dawn.`);
        if (legacyCast || legacyOpening) {
          this.db.prepare("UPDATE worlds SET characters_json = ?, opening_scene = ? WHERE id = ?")
            .run(legacyCast ? "[]" : row.characters_json, legacyOpening ? `The story opens in ${row.title}. ${row.premise}` : row.opening_scene, row.id);
        }
      } catch {
        // Preserve any unrelated user data that cannot be parsed.
      }
    }
  }

  private insert(world: World): void {
    this.db.prepare(`INSERT INTO worlds (id,title,premise,genre,creator_prompt,opening_scene,characters_json,source,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(world.id, world.title, world.premise, world.genre, world.creatorPrompt, world.openingScene, JSON.stringify(world.characters), world.source, world.createdAt);
  }

  public list(): World[] {
    return (this.db.prepare("SELECT id, title, premise, genre, creator_prompt as creatorPrompt, opening_scene as openingScene, characters_json, source, created_at as createdAt FROM worlds ORDER BY created_at DESC").all() as unknown as WorldRow[]).map(rowToWorld);
  }

  public get(id: string): World | null {
    const row = this.db.prepare("SELECT id, title, premise, genre, creator_prompt as creatorPrompt, opening_scene as openingScene, characters_json, source, created_at as createdAt FROM worlds WHERE id = ?").get(id) as unknown as WorldRow | undefined;
    return row ? rowToWorld(row) : null;
  }

  public create(input: CreateWorldInput, generated: Pick<World, "openingScene" | "characters" | "source">): World {
    const world: World = { id: `${slug(input.title)}-${randomUUID().slice(0, 8)}`, ...input, ...generated, createdAt: new Date().toISOString() };
    this.insert(world);
    return world;
  }

  /**
   * Delete one persisted world and only its database-owned dependent records.
   * Local image assets are intentionally not removed: their filenames are
   * content-addressed and do not safely map back to a single world.
   */
  public deleteWorld(worldId: string): boolean {
    return this.inTransaction(() => {
      const existing = this.db.prepare("SELECT 1 FROM worlds WHERE id = ?").get(worldId);
      if (!existing) return false;
      this.deleteWorldRecords(worldId);
      return true;
    });
  }

  public getWorldStory(worldId: string): WorldStory | null {
    const row = this.db.prepare("SELECT story_json FROM world_stories WHERE world_id = ?").get(worldId) as { story_json?: string } | undefined;
    if (!row?.story_json) return null;
    try {
      const story = JSON.parse(row.story_json) as WorldStory;
      const migrated = migrateLegacyChapterSceneIds(story);
      if (migrated !== story) this.db.prepare("UPDATE world_stories SET story_json = ?, updated_at = ? WHERE world_id = ?").run(JSON.stringify(migrated), new Date().toISOString(), worldId);
      return migrated;
    } catch { return null; }
  }

  public saveWorldStory(story: WorldStory): WorldStory {
    const now = new Date().toISOString();
    const existing = this.getWorldStory(story.worldId);
    const normalized = migrateLegacyChapterSceneIds(story);
    const persisted = { ...normalized, createdAt: existing?.createdAt ?? normalized.createdAt ?? now, updatedAt: now };
    this.db.prepare(`INSERT INTO world_stories (world_id, story_json, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(world_id) DO UPDATE SET story_json = excluded.story_json, updated_at = excluded.updated_at`)
      .run(persisted.worldId, JSON.stringify(persisted), persisted.createdAt, persisted.updatedAt);
    return persisted;
  }

  /**
   * Remove one canonical chapter only when it is the current latest chapter
   * and a prior chapter remains. Story JSON, POV records, and all cached art
   * in the deleted chapter's scene namespace change together in one SQLite
   * transaction.
   */
  public deleteLatestChapter(worldId: string, chapterId: string): StoryChapterDeletionResult {
    return this.inTransaction(() => {
      const story = this.getWorldStory(worldId);
      if (!story) return { ok: false, reason: "story_not_found" };
      const index = story.chapters.findIndex((chapter) => chapter.id === chapterId);
      if (index < 0) return { ok: false, reason: "chapter_not_found" };
      if (index !== story.chapters.length - 1) return { ok: false, reason: "chapter_is_not_latest" };
      if (index === 0) return { ok: false, reason: "chapter_has_no_previous" };
      return { ok: true, value: this.deleteStoryChapters(story, story.chapters.slice(index)) };
    });
  }

  /**
   * Retain the selected chapter and remove every later chapter. This is
   * intentionally idempotent for the current latest chapter.
   */
  public deleteFutureChapters(worldId: string, chapterId: string): StoryChapterDeletionResult {
    return this.inTransaction(() => {
      const story = this.getWorldStory(worldId);
      if (!story) return { ok: false, reason: "story_not_found" };
      const index = story.chapters.findIndex((chapter) => chapter.id === chapterId);
      if (index < 0) return { ok: false, reason: "chapter_not_found" };
      const chapter = story.chapters[index]!;
      const removed = story.chapters.slice(index + 1);
      if (removed.length === 0) return { ok: true, value: { story, chapter, removedChapterIds: [] } };
      return { ok: true, value: this.deleteStoryChapters(story, removed) };
    });
  }

  /** Call only inside an open transaction after the target chapters are validated. */
  private deleteStoryChapters(story: WorldStory, removed: StoryChapter[]): StoryChapterDeletion {
    const removedChapterIds = removed.map((chapter) => chapter.id);
    const removedIds = new Set(removedChapterIds);
    const retainedChapters = story.chapters.filter((chapter) => !removedIds.has(chapter.id));
    const updated: WorldStory = {
      ...story,
      chapters: retainedChapters,
      perspectives: story.perspectives.filter((perspective) => !removedIds.has(perspective.chapterId)),
      // Missing origins are migrated to chapter 1 before this point, but the
      // fallback keeps an old in-memory record safe if callers bypass reload.
      characters: story.characters.filter((character) => !removedIds.has(character.introducedInChapter ?? "chapter-1")),
    };
    this.deleteStoryImagesForChapters(story.worldId, removedChapterIds);
    this.deleteStoryTrailersForChapters(story.worldId, removedChapterIds);
    const persisted = this.saveWorldStory(updated);
    const chapter = persisted.chapters.at(-1);
    if (!chapter) throw new Error("Chapter deletion removed every chapter");
    return { story: persisted, chapter, removedChapterIds };
  }

  /**
   * Scene IDs use a chapter-owned prefix for canonical, POV, and revision
   * variants. Clearing the whole namespace prevents a regenerated chapter
   * with the same ID from finding stale art from an earlier timeline.
   */
  private deleteStoryImagesForChapters(worldId: string, chapterIds: string[]): void {
    const statement = this.db.prepare("DELETE FROM story_images WHERE world_id = ? AND (scene_id = ? OR scene_id LIKE ?)");
    for (const chapterId of chapterIds) statement.run(worldId, chapterId, `${chapterId}-%`);
  }

  /** Trailer records are snapshots of one canonical chapter revision. */
  private deleteStoryTrailersForChapters(worldId: string, chapterIds: string[]): void {
    if (chapterIds.length === 0) return;
    const statement = this.db.prepare("DELETE FROM story_trailers WHERE world_id = ? AND chapter_id = ?");
    for (const chapterId of chapterIds) statement.run(worldId, chapterId);
  }

  public visualBeat(worldId: string, sceneId: string): string | null {
    const story = this.getWorldStory(worldId);
    if (!story) return null;
    for (const chapter of story.chapters) {
      const beat = chapter.beats.find((candidate) => candidate.id === sceneId);
      if (beat) return beat.description;
    }
    for (const perspective of story.perspectives) {
      const beat = perspective.beats.find((candidate) => candidate.id === sceneId);
      if (beat) return beat.description;
    }
    return null;
  }

  /**
   * Atomically reserves a deterministic visual cache entry.  Consumers should
   * only call a provider when `created` is true; this is the idempotency guard
   * that prevents duplicate paid generations from double clicks or remounts.
   */
  public reserveStoryImage(input: NewStoryImage): { image: StoredStoryImage; created: boolean } {
    const existing = this.getStoryImageByCacheKey(input.cacheKey);
    if (existing) return { image: existing, created: false };
    const now = new Date().toISOString();
    const image: StoredStoryImage = {
      id: randomUUID(),
      ...input,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
    };
    try {
      this.db.prepare(`INSERT INTO story_images (
        id, cache_key, world_id, branch_id, scene_id, protagonist_id,
        character_ids_json, prompt_version, prompt, status, image_url,
        fallback_url, provider, provider_asset_id, error_code, retry_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          image.id, image.cacheKey, image.worldId, image.branchId ?? null, image.sceneId,
          image.protagonistId ?? null, JSON.stringify(image.characterIds), image.promptVersion,
          image.prompt, image.status, null, image.fallbackUrl, null, null, null, image.retryCount,
          image.createdAt, image.updatedAt,
        );
      return { image, created: true };
    } catch (error) {
      // A different request won the UNIQUE(cache_key) race. Return its record
      // rather than sending a second request to a provider.
      const raced = this.getStoryImageByCacheKey(input.cacheKey);
      if (raced) return { image: raced, created: false };
      throw error;
    }
  }

  public getStoryImageByCacheKey(cacheKey: string): StoredStoryImage | null {
    const row = this.db.prepare("SELECT * FROM story_images WHERE cache_key = ?").get(cacheKey) as unknown as StoryImageRow | undefined;
    return row ? rowToStoryImage(row) : null;
  }

  public findStoryImage(worldId: string, sceneId: string, branchId?: string, protagonistId?: string, promptVersion?: string): StoredStoryImage | null {
    const row = this.db.prepare(`SELECT * FROM story_images
      WHERE world_id = ? AND scene_id = ?
        AND ((branch_id IS NULL AND ? IS NULL) OR branch_id = ?)
        AND ((protagonist_id IS NULL AND ? IS NULL) OR protagonist_id = ?)
        AND (? IS NULL OR prompt_version = ?)
      ORDER BY updated_at DESC LIMIT 1`)
      .get(worldId, sceneId, branchId ?? null, branchId ?? null, protagonistId ?? null, protagonistId ?? null, promptVersion ?? null, promptVersion ?? null) as unknown as StoryImageRow | undefined;
    return row ? rowToStoryImage(row) : null;
  }

  public markStoryImageReady(cacheKey: string, result: { imageUrl: string; provider: string; providerAssetId?: string }): StoredStoryImage | null {
    this.db.prepare(`UPDATE story_images
      SET status = 'ready', image_url = ?, provider = ?, provider_asset_id = ?, error_code = NULL, updated_at = ?
      WHERE cache_key = ?`)
      .run(result.imageUrl, result.provider, result.providerAssetId ?? null, new Date().toISOString(), cacheKey);
    return this.getStoryImageByCacheKey(cacheKey);
  }

  public markStoryImageFallback(cacheKey: string, errorCode?: string): StoredStoryImage | null {
    this.db.prepare(`UPDATE story_images
      SET status = 'fallback', error_code = ?, updated_at = ? WHERE cache_key = ?`)
      .run(errorCode ?? null, new Date().toISOString(), cacheKey);
    return this.getStoryImageByCacheKey(cacheKey);
  }

  public markStoryImageFailed(cacheKey: string, errorCode: string): StoredStoryImage | null {
    this.db.prepare(`UPDATE story_images
      SET status = 'failed', error_code = ?, retry_count = retry_count + 1, updated_at = ? WHERE cache_key = ?`)
      .run(errorCode, new Date().toISOString(), cacheKey);
    return this.getStoryImageByCacheKey(cacheKey);
  }

  /** A failed image may be manually retried once; cache records are never duplicated. */
  public requeueFailedStoryImage(cacheKey: string): StoredStoryImage | null {
    this.db.prepare(`UPDATE story_images
      SET status = 'pending', error_code = NULL, retry_count = retry_count + 1, updated_at = ?
      WHERE cache_key = ? AND status = 'failed' AND retry_count < 2`)
      .run(new Date().toISOString(), cacheKey);
    return this.getStoryImageByCacheKey(cacheKey);
  }

  /**
   * Atomically reserves one trailer render for a canonical chapter revision.
   * The unique cache key prevents double-clicks and multiple app instances
   * from starting duplicate paid video jobs.
   */
  public reserveStoryTrailer(input: NewStoryTrailer): { trailer: StoredStoryTrailer; created: boolean } {
    const existing = this.getStoryTrailerByCacheKey(input.cacheKey);
    if (existing) return { trailer: existing, created: false };
    const now = new Date().toISOString();
    const trailer: StoredStoryTrailer = {
      id: randomUUID(),
      ...input,
      status: "queued",
      progress: 0,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.db.prepare(`INSERT INTO story_trailers (
        id, cache_key, world_id, chapter_id, chapter_revision, prompt_version,
        prompt, status, progress, video_url, provider, provider_job_id,
        provider_asset_id, error_code, retry_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          trailer.id, trailer.cacheKey, trailer.worldId, trailer.chapterId,
          trailer.chapterRevision, trailer.promptVersion, trailer.prompt, trailer.status,
          trailer.progress, null, null, null, null, null, trailer.retryCount,
          trailer.createdAt, trailer.updatedAt,
        );
      return { trailer, created: true };
    } catch (error) {
      const raced = this.getStoryTrailerByCacheKey(input.cacheKey);
      if (raced) return { trailer: raced, created: false };
      throw error;
    }
  }

  public getStoryTrailerByCacheKey(cacheKey: string): StoredStoryTrailer | null {
    const row = this.db.prepare("SELECT * FROM story_trailers WHERE cache_key = ?").get(cacheKey) as unknown as StoryTrailerRow | undefined;
    return row ? rowToStoryTrailer(row) : null;
  }

  public findStoryTrailer(worldId: string, chapterId: string, chapterRevision: number): StoredStoryTrailer | null {
    const row = this.db.prepare(`SELECT * FROM story_trailers
      WHERE world_id = ? AND chapter_id = ? AND chapter_revision = ?
      ORDER BY updated_at DESC LIMIT 1`)
      .get(worldId, chapterId, chapterRevision) as unknown as StoryTrailerRow | undefined;
    return row ? rowToStoryTrailer(row) : null;
  }

  public markStoryTrailerQueued(
    cacheKey: string,
    result: { provider: string; providerJobId: string; providerAssetId?: string; status?: "queued" | "in_progress"; progress?: number },
  ): StoredStoryTrailer | null {
    const status = result.status ?? "queued";
    const progress = normalizeTrailerProgress(result.progress, 0);
    this.db.prepare(`UPDATE story_trailers
      SET status = ?, progress = ?, provider = ?, provider_job_id = ?, provider_asset_id = ?,
        error_code = NULL, updated_at = ?
      WHERE cache_key = ? AND status IN ('queued', 'in_progress')`)
      .run(status, progress, result.provider, result.providerJobId, result.providerAssetId ?? null, new Date().toISOString(), cacheKey);
    return this.getStoryTrailerByCacheKey(cacheKey);
  }

  public markStoryTrailerProgress(
    cacheKey: string,
    progress: number,
    status: "queued" | "in_progress",
  ): StoredStoryTrailer | null {
    this.db.prepare(`UPDATE story_trailers
      SET status = ?, progress = ?, updated_at = ?
      WHERE cache_key = ? AND status IN ('queued', 'in_progress')`)
      .run(status, normalizeTrailerProgress(progress, 0), new Date().toISOString(), cacheKey);
    return this.getStoryTrailerByCacheKey(cacheKey);
  }

  public markStoryTrailerReady(
    cacheKey: string,
    result: { videoUrl: string; provider: string; providerAssetId?: string },
  ): StoredStoryTrailer | null {
    this.db.prepare(`UPDATE story_trailers
      SET status = 'ready', progress = 100, video_url = ?, provider = ?, provider_asset_id = ?,
        error_code = NULL, updated_at = ?
      WHERE cache_key = ? AND status IN ('queued', 'in_progress')`)
      .run(result.videoUrl, result.provider, result.providerAssetId ?? null, new Date().toISOString(), cacheKey);
    return this.getStoryTrailerByCacheKey(cacheKey);
  }

  public markStoryTrailerFailed(cacheKey: string, errorCode: string): StoredStoryTrailer | null {
    this.db.prepare(`UPDATE story_trailers
      SET status = 'failed', error_code = ?, retry_count = retry_count + 1, updated_at = ?
      WHERE cache_key = ? AND status IN ('queued', 'in_progress')`)
      .run(errorCode, new Date().toISOString(), cacheKey);
    return this.getStoryTrailerByCacheKey(cacheKey);
  }

  /**
   * A failed trailer may be retried without creating another cache record.
   * SQLite's affected-row count makes the retry winner explicit, so a second
   * simultaneous browser click cannot start another paid render.
   */
  public requeueFailedStoryTrailer(cacheKey: string): StoryTrailerRetryReservation | null {
    const result = this.db.prepare(`UPDATE story_trailers
      SET status = 'queued', progress = 0, video_url = NULL, provider = NULL, provider_job_id = NULL,
        provider_asset_id = NULL, error_code = NULL, retry_count = retry_count + 1, updated_at = ?
      WHERE cache_key = ? AND status = 'failed'`)
      .run(new Date().toISOString(), cacheKey);
    const trailer = this.getStoryTrailerByCacheKey(cacheKey);
    return trailer ? { trailer, requeued: result.changes > 0 } : null;
  }

}

type StoryImageRow = {
  id: string; cache_key: string; world_id: string; branch_id: string | null; scene_id: string;
  protagonist_id: string | null; character_ids_json: string; prompt_version: string; prompt: string;
  status: StoredStoryImage["status"]; image_url: string | null; fallback_url: string;
  provider: string | null; provider_asset_id: string | null; error_code: string | null;
  retry_count: number; created_at: string; updated_at: string;
};

type StoryTrailerRow = {
  id: string; cache_key: string; world_id: string; chapter_id: string;
  chapter_revision: number; prompt_version: string; prompt: string;
  status: StoryTrailerStatus; progress: number; video_url: string | null;
  provider: string | null; provider_job_id: string | null; provider_asset_id: string | null;
  error_code: string | null; retry_count: number; created_at: string; updated_at: string;
};


/** Migrate old provider-supplied labels such as `beat_01` to stable,
 * chapter-owned scene IDs. This keeps historical chapter image caches apart. */
function migrateLegacyChapterSceneIds(story: WorldStory): WorldStory {
  let changed = false;
  // Earlier versions appended raw user commands to worldState. They are
  // instructions, not world truth, and must not be rendered or re-prompted.
  const worldState = story.worldState.replace(/\s+Author direction:[\s\S]*$/i, "").trim();
  if (worldState !== story.worldState) changed = true;
  const chapterIdMap = new Map<string, string>();
  const chapterRevisionMap = new Map<string, number>();
  const chapters = story.chapters.map((chapter) => {
    let chapterChanged = false;
    const revision = typeof chapter.revision === "number" && Number.isInteger(chapter.revision) && chapter.revision >= 1 ? chapter.revision : 1;
    const id = `chapter-${chapter.number}`;
    const beatPrefix = revision > 1 ? `${id}-r${revision}` : id;
    const beats = chapter.beats.map((beat, index) => {
      const beatId = `${beatPrefix}-beat-${index + 1}`;
      if (beat.id === beatId) return beat;
      changed = true;
      chapterChanged = true;
      return { ...beat, id: beatId };
    });
    chapterIdMap.set(chapter.id, id);
    chapterRevisionMap.set(id, revision);
    if (chapter.id !== id || chapter.revision !== revision) { changed = true; chapterChanged = true; }
    return chapterChanged ? { ...chapter, id, revision, beats } : chapter;
  });
  const canonicalChapterIds = new Set(chapters.map((chapter) => chapter.id));
  const characters = story.characters.map((character) => {
    const suppliedOrigin = typeof character.introducedInChapter === "string" ? character.introducedInChapter : undefined;
    const mappedOrigin = suppliedOrigin ? (chapterIdMap.get(suppliedOrigin) ?? suppliedOrigin) : undefined;
    // Older persisted stories did not track origins. Treat their cast as
    // Chapter 1 characters so truncating a later chapter cannot erase them.
    const introducedInChapter = mappedOrigin && canonicalChapterIds.has(mappedOrigin) ? mappedOrigin : "chapter-1";
    if (character.introducedInChapter === introducedInChapter) return character;
    changed = true;
    return { ...character, introducedInChapter };
  });
  const perspectives = story.perspectives.map((perspective) => {
    const chapterId = chapterIdMap.get(perspective.chapterId) ?? perspective.chapterId;
    const revision = chapterRevisionMap.get(chapterId) ?? 1;
    const beatPrefix = revision > 1 ? `${chapterId}-r${revision}-${perspective.characterId}` : `${chapterId}-${perspective.characterId}`;
    const beats = perspective.beats.map((beat, index) => {
      const id = `${beatPrefix}-beat-${index + 1}`;
      if (beat.id === id) return beat;
      changed = true;
      return { ...beat, id };
    });
    if (chapterId === perspective.chapterId && beats.every((beat, index) => beat === perspective.beats[index])) return perspective;
    changed = true;
    return { ...perspective, chapterId, beats };
  });
  const upcomingDirections = normalizeUpcomingDirections(story.upcomingDirections);
  if (!sameStringArray(story.upcomingDirections, upcomingDirections)) changed = true;
  return changed ? { ...story, characters, chapters, perspectives, worldState, upcomingDirections } : story;
}

function normalizeUpcomingDirections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const directions: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const direction = entry.trim().replace(/\s+/g, " ");
    if (direction.length < 3 || direction.length > 1000) continue;
    const identity = direction.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    directions.push(direction);
    if (directions.length === MAX_UPCOMING_DIRECTIONS) break;
  }
  return directions;
}

function sameStringArray(value: unknown, expected: string[]): value is string[] {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function rowToStoryImage(row: StoryImageRow): StoredStoryImage {
  return {
    id: row.id, cacheKey: row.cache_key, worldId: row.world_id, branchId: row.branch_id ?? undefined,
    sceneId: row.scene_id, protagonistId: row.protagonist_id ?? undefined,
    characterIds: JSON.parse(row.character_ids_json) as string[], promptVersion: row.prompt_version,
    prompt: row.prompt, status: row.status, imageUrl: row.image_url ?? undefined,
    fallbackUrl: row.fallback_url, provider: row.provider ?? undefined,
    providerAssetId: row.provider_asset_id ?? undefined, errorCode: row.error_code ?? undefined,
    retryCount: row.retry_count, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToStoryTrailer(row: StoryTrailerRow): StoredStoryTrailer {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    worldId: row.world_id,
    chapterId: row.chapter_id,
    chapterRevision: row.chapter_revision,
    promptVersion: row.prompt_version,
    prompt: row.prompt,
    status: row.status,
    progress: row.progress,
    videoUrl: row.video_url ?? undefined,
    provider: row.provider ?? undefined,
    providerJobId: row.provider_job_id ?? undefined,
    providerAssetId: row.provider_asset_id ?? undefined,
    errorCode: row.error_code ?? undefined,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTrailerProgress(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "untitled-world";
}
