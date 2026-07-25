import { randomUUID } from "node:crypto";
import type {
  CreateWorldInput,
  StoryChapterDeletion,
  StoryChapterDeletionFailure,
  StoryChapterDeletionResult,
  World,
} from "../worlds.js";
import type { NewStoryImage, StoredStoryImage } from "../images/types.js";
import type { StoryChapter, WorldStory } from "../story.js";
import { POSTGRES_MIGRATIONS_TABLE, POSTGRES_SCHEMA_MIGRATIONS } from "./schema.js";
import type {
  StoryImageReservation,
  StoryWriteOptions,
  VersionedStoryStore,
  VersionedWorldStory,
} from "./store.js";

/** Minimal pg-compatible surface. Keeping it structural lets unit tests use a fake pool. */
export type PgQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export type PgQueryExecutor = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PgQueryResult<Row>>;
};

export type PgClient = PgQueryExecutor & { release(error?: Error): void };
export type PgPool = PgQueryExecutor & {
  connect(): Promise<PgClient>;
  end?(): Promise<void>;
};

export type PostgresConnectionConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: { rejectUnauthorized: boolean };
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  application_name?: string;
};

export type PostgresWorldStoreOptions = {
  now?: () => Date;
  createId?: () => string;
};

export type CreatePostgresWorldStoreOptions = PostgresWorldStoreOptions & {
  /** Tests and hosts with their own pool lifecycle may inject a pool directly. */
  pool?: PgPool;
  environment?: Record<string, string | undefined>;
  /** Defaults to true so a returned store is ready for request traffic. */
  initialize?: boolean;
};

const MIGRATION_LOCK_KEY = 8_104_202_501;

type WorldRow = Record<string, unknown> & {
  id: string;
  title: string;
  premise: string;
  genre: string;
  creator_prompt: string;
  opening_scene: string;
  characters_json: unknown;
  source: World["source"];
  created_at: string | Date;
};

type StoryRow = Record<string, unknown> & {
  story_json: unknown;
  version: number | string;
};

type StoryImageRow = Record<string, unknown> & {
  id: string;
  cache_key: string;
  world_id: string;
  branch_id: string | null;
  scene_id: string;
  protagonist_id: string | null;
  character_ids_json: unknown;
  prompt_version: string;
  prompt: string;
  status: StoredStoryImage["status"];
  image_url: string | null;
  fallback_url: string;
  provider: string | null;
  provider_asset_id: string | null;
  error_code: string | null;
  retry_count: number | string;
  created_at: string | Date;
  updated_at: string | Date;
};

function toIso(value: string | Date | undefined, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  const parsed = jsonValue(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? [...parsed] : [];
}

function rowToWorld(row: WorldRow): World {
  return {
    id: row.id,
    title: row.title,
    premise: row.premise,
    genre: row.genre,
    creatorPrompt: row.creator_prompt,
    openingScene: row.opening_scene,
    characters: (Array.isArray(jsonValue(row.characters_json)) ? jsonValue(row.characters_json) : []) as World["characters"],
    source: row.source,
    createdAt: toIso(row.created_at, new Date(0).toISOString()),
  };
}

function rowToStoryImage(row: StoryImageRow): StoredStoryImage {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    worldId: row.world_id,
    branchId: row.branch_id ?? undefined,
    sceneId: row.scene_id,
    protagonistId: row.protagonist_id ?? undefined,
    characterIds: stringArray(row.character_ids_json),
    promptVersion: row.prompt_version,
    prompt: row.prompt,
    status: row.status,
    imageUrl: row.image_url ?? undefined,
    fallbackUrl: row.fallback_url,
    provider: row.provider ?? undefined,
    providerAssetId: row.provider_asset_id ?? undefined,
    errorCode: row.error_code ?? undefined,
    retryCount: Number(row.retry_count),
    createdAt: toIso(row.created_at, new Date(0).toISOString()),
    updatedAt: toIso(row.updated_at, new Date(0).toISOString()),
  };
}

function parseStory(row: StoryRow): VersionedWorldStory | null {
  const parsed = jsonValue(row.story_json);
  if (!parsed || typeof parsed !== "object") return null;
  const story = parsed as WorldStory;
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return { story: normalizeLegacyCharacterOrigins(story), version };
}

/** Old JSON stories did not store character origin; keep those characters on chapter 1. */
function normalizeLegacyCharacterOrigins(story: WorldStory): WorldStory {
  const validChapterIds = new Set(story.chapters.map((chapter) => chapter.id));
  const legacyOrigin = story.chapters[0]?.id ?? "chapter-1";
  let changed = false;
  const characters = story.characters.map((character) => {
    const origin = character.introducedInChapter;
    const introducedInChapter = origin && validChapterIds.has(origin) ? origin : legacyOrigin;
    if (origin === introducedInChapter) return character;
    changed = true;
    return { ...character, introducedInChapter };
  });
  return changed ? { ...story, characters } : story;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "untitled-world";
}

function isSslMode(value: string | undefined): boolean {
  return ["require", "verify-ca", "verify-full", "prefer"].includes(value?.toLowerCase() ?? "");
}

function sslModeFromConnectionString(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined;
  try {
    return new URL(connectionString).searchParams.get("sslmode") ?? undefined;
  } catch {
    return undefined;
  }
}

function hostFromConnectionString(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined;
  try {
    return new URL(connectionString).hostname || undefined;
  } catch {
    return undefined;
  }
}

function passwordFromConnectionString(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined;
  try {
    return new URL(connectionString).password || undefined;
  } catch {
    return undefined;
  }
}

function isLakebaseHost(host: string | undefined): boolean {
  return Boolean(host && /(^|\.)lakebase\.[^.]*databricks\.com$/i.test(host));
}

/**
 * Reads only standard PostgreSQL/libpq variables. Lakebase exposes a regular
 * PostgreSQL endpoint, so DATABASE_URL is preferred; Databricks SQL warehouse
 * credentials are intentionally not consulted here.
 */
export function postgresConfigFromEnv(
  environment: Record<string, string | undefined> = process.env,
): PostgresConnectionConfig | null {
  const connectionString = environment.DATABASE_URL?.trim() || undefined;
  const host = environment.PGHOST?.trim() || undefined;
  if (!connectionString && !host) return null;

  const rawPort = environment.PGPORT?.trim();
  const port = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : undefined;
  const explicitSslMode = environment.PGSSLMODE?.trim().toLowerCase();
  const connectionSslMode = sslModeFromConnectionString(connectionString)?.toLowerCase();
  const resolvedHost = host ?? hostFromConnectionString(connectionString);
  const useSsl = explicitSslMode === "disable"
    ? false
    : isSslMode(explicitSslMode) || isSslMode(connectionSslMode) || isLakebaseHost(resolvedHost);
  const rejectUnauthorized = environment.PGSSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() !== "false";
  const max = numberEnv(environment.STORYVERSE_PG_POOL_MAX, 10);
  const idleTimeoutMillis = numberEnv(environment.STORYVERSE_PG_IDLE_TIMEOUT_MS, 30_000);
  const connectionTimeoutMillis = numberEnv(environment.STORYVERSE_PG_CONNECT_TIMEOUT_MS, 10_000);
  // Lakebase's native database password is preferred. An OAuth token is only
  // a short-lived fallback for local smoke tests where the DSN has no password.
  const password = environment.PGPASSWORD
    ?? (passwordFromConnectionString(connectionString) ? undefined : environment.DATABRICKS_OAUTH_TOKEN);

  return {
    ...(connectionString ? { connectionString, ...(password ? { password } : {}) } : {
      host,
      port,
      database: environment.PGDATABASE?.trim() || undefined,
      user: environment.PGUSER?.trim() || undefined,
      password,
    }),
    ...(useSsl ? { ssl: { rejectUnauthorized } } : {}),
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    application_name: environment.PGAPPNAME?.trim() || "storyverse",
  };
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Avoids a static pg import so SQLite-only development does not need pg installed. */
async function loadPgPoolConstructor(): Promise<new (config: PostgresConnectionConfig) => PgPool> {
  const moduleName = "pg";
  const imported = await import(moduleName) as unknown as { Pool?: new (config: PostgresConnectionConfig) => PgPool };
  if (!imported.Pool) throw new Error("PostgreSQL is configured but the 'pg' package is not installed");
  return imported.Pool;
}

export async function createPostgresPoolFromEnv(
  environment: Record<string, string | undefined> = process.env,
): Promise<PgPool | null> {
  const config = postgresConfigFromEnv(environment);
  if (!config) return null;
  const Pool = await loadPgPoolConstructor();
  return new Pool(config);
}

/**
 * Factory used by server/index.ts. It returns null when Postgres is not
 * configured, enabling the existing local SQLite fallback without guessing.
 */
export async function createPostgresWorldStoreFromEnv(
  options: CreatePostgresWorldStoreOptions = {},
): Promise<PostgresWorldStore | null> {
  const pool = options.pool ?? await createPostgresPoolFromEnv(options.environment);
  if (!pool) return null;
  const store = new PostgresWorldStore(pool, options);
  if (options.initialize !== false) await store.initialize();
  return store;
}

/**
 * PostgreSQL/Lakebase persistence for worlds, stories, and image cache state.
 * Story JSON remains the canonical aggregate for now, while `version` gives
 * routes a compare-and-swap primitive as concurrent creators arrive.
 */
export class PostgresWorldStore implements VersionedStoryStore {
  private initialized = false;
  private initializing: Promise<void> | undefined;
  private readonly now: () => Date;
  private readonly createId: () => string;

  public constructor(
    private readonly pool: PgPool,
    options: PostgresWorldStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  /** Idempotent and retryable initialization guarded across app instances. */
  public initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.initializing) {
      this.initializing = this.runMigrations()
        .then(() => { this.initialized = true; })
        .catch((error: unknown) => {
          this.initializing = undefined;
          throw error;
        });
    }
    return this.initializing;
  }

  public async close(): Promise<void> {
    await this.pool.end?.();
    this.initialized = false;
  }

  private async runMigrations(): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`CREATE TABLE IF NOT EXISTS ${POSTGRES_MIGRATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL
      )`);
      for (const migration of POSTGRES_SCHEMA_MIGRATIONS) {
        const applied = await client.query<{ id: string }>(
          `SELECT id FROM ${POSTGRES_MIGRATIONS_TABLE} WHERE id = $1`,
          [migration.id],
        );
        if (applied.rowCount && applied.rowCount > 0) continue;
        for (const statement of migration.statements) await client.query(statement);
        await client.query(
          `INSERT INTO ${POSTGRES_MIGRATIONS_TABLE} (id, applied_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [migration.id, this.now().toISOString()],
        );
      }
    });
  }

  private async ready(): Promise<void> {
    await this.initialize();
  }

  private async inTransaction<T>(operation: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original query error when rollback itself is unavailable.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async list(): Promise<World[]> {
    await this.ready();
    const result = await this.pool.query<WorldRow>(`SELECT id, title, premise, genre, creator_prompt, opening_scene,
      characters_json, source, created_at FROM worlds ORDER BY created_at DESC`);
    return result.rows.map(rowToWorld);
  }

  public async get(worldId: string): Promise<World | null> {
    await this.ready();
    const result = await this.pool.query<WorldRow>(`SELECT id, title, premise, genre, creator_prompt, opening_scene,
      characters_json, source, created_at FROM worlds WHERE id = $1`, [worldId]);
    return result.rows[0] ? rowToWorld(result.rows[0]) : null;
  }

  public async create(
    input: CreateWorldInput,
    generated: Pick<World, "openingScene" | "characters" | "source">,
  ): Promise<World> {
    await this.ready();
    const world: World = {
      id: `${slug(input.title)}-${this.createId().slice(0, 8)}`,
      ...input,
      ...generated,
      createdAt: this.now().toISOString(),
    };
    await this.pool.query(`INSERT INTO worlds (
      id, title, premise, genre, creator_prompt, opening_scene, characters_json, source, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`, [
      world.id, world.title, world.premise, world.genre, world.creatorPrompt,
      world.openingScene, JSON.stringify(world.characters), world.source, world.createdAt,
    ]);
    return world;
  }

  /** FK cascades make this one atomic deletion of relational records. */
  public async deleteWorld(worldId: string): Promise<boolean> {
    await this.ready();
    return this.inTransaction(async (client) => {
      const deleted = await client.query<{ id: string }>("DELETE FROM worlds WHERE id = $1 RETURNING id", [worldId]);
      return Boolean(deleted.rowCount && deleted.rowCount > 0);
    });
  }

  public async getWorldStory(worldId: string): Promise<WorldStory | null> {
    const record = await this.getWorldStoryRecord(worldId);
    return record?.story ?? null;
  }

  public async getWorldStoryRecord(worldId: string): Promise<VersionedWorldStory | null> {
    await this.ready();
    const result = await this.pool.query<StoryRow>("SELECT story_json, version FROM world_stories WHERE world_id = $1", [worldId]);
    return result.rows[0] ? parseStory(result.rows[0]) : null;
  }

  /**
   * `expectedVersion` enables optimistic locking. Passing 0 attempts an
   * insert-only write; passing a read version writes only if it is still
   * current. Legacy callers may omit it during the SQLite-to-Postgres rollout.
   */
  public async saveWorldStory(story: WorldStory, options: StoryWriteOptions = {}): Promise<WorldStory | null> {
    await this.ready();
    const expectedVersion = options.expectedVersion;
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
      throw new TypeError("expectedVersion must be a non-negative integer");
    }
    const existing = await this.getWorldStoryRecord(story.worldId);
    const timestamp = this.now().toISOString();
    const normalized = normalizeLegacyCharacterOrigins({
      ...story,
      createdAt: existing?.story.createdAt ?? story.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    const storyJson = JSON.stringify(normalized);

    if (expectedVersion === 0) {
      const inserted = await this.pool.query<Record<string, unknown>>(`INSERT INTO world_stories (
        world_id, story_json, version, created_at, updated_at
      ) VALUES ($1, $2::jsonb, 1, $3, $4) ON CONFLICT (world_id) DO NOTHING RETURNING version`, [
        normalized.worldId, storyJson, normalized.createdAt, normalized.updatedAt,
      ]);
      return inserted.rows[0] ? normalized : null;
    }

    if (expectedVersion !== undefined) {
      const updated = await this.pool.query<Record<string, unknown>>(`UPDATE world_stories
        SET story_json = $2::jsonb, version = version + 1, updated_at = $3
        WHERE world_id = $1 AND version = $4 RETURNING version`, [
        normalized.worldId, storyJson, normalized.updatedAt, expectedVersion,
      ]);
      return updated.rows[0] ? normalized : null;
    }

    await this.pool.query(`INSERT INTO world_stories (
      world_id, story_json, version, created_at, updated_at
    ) VALUES ($1, $2::jsonb, 1, $3, $4)
    ON CONFLICT (world_id) DO UPDATE SET
      story_json = EXCLUDED.story_json,
      version = world_stories.version + 1,
      updated_at = EXCLUDED.updated_at`, [
      normalized.worldId, storyJson, normalized.createdAt, normalized.updatedAt,
    ]);
    return normalized;
  }

  public async deleteLatestChapter(worldId: string, chapterId: string): Promise<StoryChapterDeletionResult> {
    await this.ready();
    return this.inTransaction(async (client) => {
      const record = await this.readStoryForUpdate(client, worldId);
      if (!record) return { ok: false, reason: "story_not_found" };
      const index = record.story.chapters.findIndex((chapter) => chapter.id === chapterId);
      if (index < 0) return { ok: false, reason: "chapter_not_found" };
      if (index !== record.story.chapters.length - 1) return { ok: false, reason: "chapter_is_not_latest" };
      if (index === 0) return { ok: false, reason: "chapter_has_no_previous" };
      return { ok: true, value: await this.deleteStoryChapters(client, record, record.story.chapters.slice(index)) };
    });
  }

  public async deleteFutureChapters(worldId: string, chapterId: string): Promise<StoryChapterDeletionResult> {
    await this.ready();
    return this.inTransaction(async (client) => {
      const record = await this.readStoryForUpdate(client, worldId);
      if (!record) return { ok: false, reason: "story_not_found" };
      const index = record.story.chapters.findIndex((chapter) => chapter.id === chapterId);
      if (index < 0) return { ok: false, reason: "chapter_not_found" };
      const chapter = record.story.chapters[index]!;
      const removed = record.story.chapters.slice(index + 1);
      if (removed.length === 0) return { ok: true, value: { story: record.story, chapter, removedChapterIds: [] } };
      return { ok: true, value: await this.deleteStoryChapters(client, record, removed) };
    });
  }

  private async readStoryForUpdate(client: PgClient, worldId: string): Promise<VersionedWorldStory | null> {
    const result = await client.query<StoryRow>("SELECT story_json, version FROM world_stories WHERE world_id = $1 FOR UPDATE", [worldId]);
    return result.rows[0] ? parseStory(result.rows[0]) : null;
  }

  private async deleteStoryChapters(
    client: PgClient,
    record: VersionedWorldStory,
    removed: StoryChapter[],
  ): Promise<StoryChapterDeletion> {
    const removedChapterIds = removed.map((chapter) => chapter.id);
    const removedIds = new Set(removedChapterIds);
    const retainedChapters = record.story.chapters.filter((chapter) => !removedIds.has(chapter.id));
    if (retainedChapters.length === 0) throw new Error("Chapter deletion removed every chapter");
    const normalized = normalizeLegacyCharacterOrigins(record.story);
    const updated: WorldStory = {
      ...normalized,
      chapters: retainedChapters,
      perspectives: normalized.perspectives.filter((perspective) => !removedIds.has(perspective.chapterId)),
      characters: normalized.characters.filter((character) => !removedIds.has(character.introducedInChapter ?? "chapter-1")),
      updatedAt: this.now().toISOString(),
    };
    await this.deleteStoryImagesForChapters(client, updated.worldId, removedChapterIds);
    const persisted = await this.saveWorldStoryInTransaction(client, updated, record.version);
    if (!persisted) throw new Error("Story changed while chapter rollback was being committed");
    return { story: persisted, chapter: persisted.chapters.at(-1)!, removedChapterIds };
  }

  /** Deletes canonical, revision, and perspective image namespaces in the same transaction. */
  private async deleteStoryImagesForChapters(client: PgClient, worldId: string, chapterIds: string[]): Promise<void> {
    if (chapterIds.length === 0) return;
    await client.query(`DELETE FROM story_images
      WHERE world_id = $1
        AND (scene_id = ANY($2::text[]) OR scene_id LIKE ANY($3::text[]))`, [
      worldId,
      chapterIds,
      chapterIds.map((chapterId) => `${chapterId}-%`),
    ]);
  }

  private async saveWorldStoryInTransaction(
    client: PgClient,
    story: WorldStory,
    expectedVersion: number,
  ): Promise<WorldStory | null> {
    const normalized = normalizeLegacyCharacterOrigins(story);
    const updated = await client.query<Record<string, unknown>>(`UPDATE world_stories
      SET story_json = $2::jsonb, version = version + 1, updated_at = $3
      WHERE world_id = $1 AND version = $4 RETURNING version`, [
      normalized.worldId, JSON.stringify(normalized), normalized.updatedAt, expectedVersion,
    ]);
    return updated.rows[0] ? normalized : null;
  }

  public async visualBeat(worldId: string, sceneId: string): Promise<string | null> {
    const story = await this.getWorldStory(worldId);
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
   * INSERT ... ON CONFLICT makes cache reservation safe across API instances:
   * only the request that receives RETURNING data may pay for image generation.
   */
  public async reserveStoryImage(input: NewStoryImage): Promise<StoryImageReservation> {
    await this.ready();
    const timestamp = this.now().toISOString();
    const image: StoredStoryImage = {
      id: this.createId(),
      ...input,
      status: "pending",
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const inserted = await this.pool.query<StoryImageRow>(`INSERT INTO story_images (
      id, cache_key, world_id, branch_id, scene_id, protagonist_id, character_ids_json,
      prompt_version, prompt, status, image_url, fallback_url, provider, provider_asset_id,
      error_code, retry_count, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NULL, $11, NULL, NULL, NULL, $12, $13, $14
    ) ON CONFLICT (cache_key) DO NOTHING RETURNING *`, [
      image.id, image.cacheKey, image.worldId, image.branchId ?? null, image.sceneId,
      image.protagonistId ?? null, JSON.stringify(image.characterIds), image.promptVersion,
      image.prompt, image.status, image.fallbackUrl, image.retryCount, image.createdAt, image.updatedAt,
    ]);
    if (inserted.rows[0]) return { image: rowToStoryImage(inserted.rows[0]), created: true };

    // In the unlikely window where a conflicting transaction is still ending,
    // retry the read once before declaring a storage failure.
    const existing = await this.getStoryImageByCacheKey(input.cacheKey)
      ?? await this.getStoryImageByCacheKey(input.cacheKey);
    if (!existing) throw new Error("Image reservation conflicted but no cache record was readable");
    return { image: existing, created: false };
  }

  public async getStoryImageByCacheKey(cacheKey: string): Promise<StoredStoryImage | null> {
    await this.ready();
    const result = await this.pool.query<StoryImageRow>("SELECT * FROM story_images WHERE cache_key = $1", [cacheKey]);
    return result.rows[0] ? rowToStoryImage(result.rows[0]) : null;
  }

  public async findStoryImage(
    worldId: string,
    sceneId: string,
    branchId?: string,
    protagonistId?: string,
    promptVersion?: string,
  ): Promise<StoredStoryImage | null> {
    await this.ready();
    const result = await this.pool.query<StoryImageRow>(`SELECT * FROM story_images
      WHERE world_id = $1 AND scene_id = $2
        AND ((branch_id IS NULL AND $3::text IS NULL) OR branch_id = $3)
        AND ((protagonist_id IS NULL AND $4::text IS NULL) OR protagonist_id = $4)
        AND ($5::text IS NULL OR prompt_version = $5)
      ORDER BY updated_at DESC LIMIT 1`, [
      worldId, sceneId, branchId ?? null, protagonistId ?? null, promptVersion ?? null,
    ]);
    return result.rows[0] ? rowToStoryImage(result.rows[0]) : null;
  }

  public async markStoryImageReady(
    cacheKey: string,
    result: { imageUrl: string; provider: string; providerAssetId?: string },
  ): Promise<StoredStoryImage | null> {
    return this.updateStoryImage(`UPDATE story_images
      SET status = 'ready', image_url = $2, provider = $3, provider_asset_id = $4,
        error_code = NULL, updated_at = $5
      WHERE cache_key = $1 RETURNING *`, [
      cacheKey, result.imageUrl, result.provider, result.providerAssetId ?? null, this.now().toISOString(),
    ]);
  }

  public async markStoryImageFallback(cacheKey: string, errorCode?: string): Promise<StoredStoryImage | null> {
    return this.updateStoryImage(`UPDATE story_images
      SET status = 'fallback', error_code = $2, updated_at = $3
      WHERE cache_key = $1 RETURNING *`, [cacheKey, errorCode ?? null, this.now().toISOString()]);
  }

  public async markStoryImageFailed(cacheKey: string, errorCode: string): Promise<StoredStoryImage | null> {
    return this.updateStoryImage(`UPDATE story_images
      SET status = 'failed', error_code = $2, retry_count = retry_count + 1, updated_at = $3
      WHERE cache_key = $1 RETURNING *`, [cacheKey, errorCode, this.now().toISOString()]);
  }

  public async requeueFailedStoryImage(cacheKey: string): Promise<StoredStoryImage | null> {
    return this.updateStoryImage(`UPDATE story_images
      SET status = 'pending', error_code = NULL, retry_count = retry_count + 1, updated_at = $2
      WHERE cache_key = $1 AND status = 'failed' AND retry_count < 2 RETURNING *`, [cacheKey, this.now().toISOString()]);
  }

  private async updateStoryImage(sql: string, values: readonly unknown[]): Promise<StoredStoryImage | null> {
    await this.ready();
    const result = await this.pool.query<StoryImageRow>(sql, values);
    return result.rows[0] ? rowToStoryImage(result.rows[0]) : null;
  }
}

/** Keep imported deletion types visible to consumers of this module. */
export type { StoryChapterDeletionFailure };
