import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { NewStoryImage } from "../images/types.js";
import type { WorldStory } from "../story.js";
import { WorldStore } from "../worlds.js";
import {
  LakebaseDatabaseCredentialProvider,
  PostgresWorldStore,
  postgresConfigFromEnv,
  type PgClient,
  type PgPool,
  type PgQueryResult,
} from "./postgres.js";
import type { StoryStore } from "./store.js";

type QueryCall = { text: string; values: readonly unknown[] | undefined };
type QueryHandler = (call: QueryCall) => PgQueryResult<Record<string, unknown>> | Promise<PgQueryResult<Record<string, unknown>>>;

class RecordingPool implements PgPool {
  public readonly calls: QueryCall[] = [];
  public connections = 0;
  public releases = 0;

  public constructor(private readonly handler: QueryHandler = () => ({ rows: [], rowCount: 0 })) {}

  public async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PgQueryResult<Row>> {
    const call = { text: text.replace(/\s+/g, " ").trim(), values };
    this.calls.push(call);
    return this.handler(call) as PgQueryResult<Row>;
  }

  public async connect(): Promise<PgClient> {
    this.connections += 1;
    return {
      query: this.query.bind(this),
      release: () => { this.releases += 1; },
    };
  }
}

const fixedNow = () => new Date("2026-07-26T10:00:00.000Z");
const testOptions = { now: fixedNow, createId: () => "00000000-0000-4000-8000-000000000001" };

function includes(call: QueryCall, fragment: string): boolean {
  return call.text.includes(fragment);
}

async function initializedStore(pool: RecordingPool): Promise<PostgresWorldStore> {
  const store = new PostgresWorldStore(pool, testOptions);
  await store.initialize();
  pool.calls.length = 0;
  return store;
}

function chapter(number: number) {
  return {
    id: `chapter-${number}`,
    number,
    title: `Chapter ${number}`,
    narration: `Chapter ${number} carries enough narrative detail for persistence tests.`,
    beats: [{ id: `chapter-${number}-beat-1`, description: `Visual beat ${number}`, caption: `Beat ${number}` }],
  };
}

function testStory(): WorldStory {
  return {
    worldId: "world-1",
    characters: [
      { id: "mira", name: "Mira", role: "Lead", visualDescription: "Blue coat", personality: "Brave", goal: "Protect the city", memories: [], introducedInChapter: "chapter-1" },
      { id: "ravi", name: "Ravi", role: "New ally", visualDescription: "Green coat", personality: "Careful", goal: "Find the signal", memories: [], introducedInChapter: "chapter-2" },
    ],
    chapters: [chapter(1), chapter(2), chapter(3)],
    perspectives: [{
      characterId: "ravi",
      chapterId: "chapter-3",
      narration: "Ravi sees the last chapter differently.",
      beats: [{ id: "chapter-3-ravi-beat-1", description: "Ravi visual", caption: "Ravi" }],
    }],
    upcomingDirections: ["Keep the signal unresolved."],
    worldState: "The city stays guarded while its signal grows louder each night.",
    source: "openai",
    createdAt: "2026-07-26T09:00:00.000Z",
    updatedAt: "2026-07-26T09:00:00.000Z",
  };
}

function storyRow(story: WorldStory, version = 1): PgQueryResult<Record<string, unknown>> {
  return { rows: [{ story_json: story, version }], rowCount: 1 };
}

function imageRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "image-1",
    cache_key: "image-key",
    world_id: "world-1",
    branch_id: null,
    scene_id: "chapter-1-beat-1",
    protagonist_id: null,
    character_ids_json: [],
    prompt_version: "v1",
    prompt: "A cinematic test scene",
    status: "pending",
    image_url: null,
    fallback_url: "data:image/svg+xml;base64,",
    provider: null,
    provider_asset_id: null,
    error_code: null,
    retry_count: 0,
    created_at: "2026-07-26T10:00:00.000Z",
    updated_at: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

function trailerRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "trailer-1",
    cache_key: "trailer-key",
    world_id: "world-1",
    chapter_id: "chapter-3",
    chapter_revision: 1,
    kind: "story_so_far",
    prompt_version: "storyverse-trailer-v1",
    prompt: "A private trailer prompt that must not leave the server.",
    status: "queued",
    progress: 0,
    video_url: null,
    provider: null,
    provider_job_id: null,
    provider_asset_id: null,
    error_code: null,
    retry_count: 0,
    created_at: "2026-07-26T10:00:00.000Z",
    updated_at: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("PostgresWorldStore configuration", () => {
  it("keeps the existing synchronous SQLite store assignable to the async-capable contract", () => {
    const sqlite: StoryStore = new WorldStore(new DatabaseSync(":memory:"));
    expect(sqlite.list()).toEqual([]);
  });

  it("uses DATABASE_URL first and honors a TLS Lakebase-compatible connection string", () => {
    const config = postgresConfigFromEnv({
      DATABASE_URL: "postgresql://writer:secret@db.example.test:5432/storyverse?sslmode=require",
      PGHOST: "should-not-be-used",
      PGSSLMODE: "require",
      STORYVERSE_PG_POOL_MAX: "14",
    });
    expect(config).toMatchObject({
      connectionString: "postgresql://writer:secret@db.example.test:5432/storyverse?sslmode=require",
      ssl: { rejectUnauthorized: true },
      max: 14,
    });
    expect(config).not.toHaveProperty("host");
  });

  it("supports standard PG variables, explicit SSL disable, and leaves SQLite fallback available", () => {
    expect(postgresConfigFromEnv({})).toBeNull();
    expect(postgresConfigFromEnv({
      PGHOST: "127.0.0.1",
      PGPORT: "5433",
      PGDATABASE: "storyverse",
      PGUSER: "storyverse",
      PGPASSWORD: "local-only",
      PGSSLMODE: "disable",
    })).toMatchObject({
      host: "127.0.0.1",
      port: 5433,
      database: "storyverse",
      user: "storyverse",
    });
    expect(postgresConfigFromEnv({
      DATABASE_URL: "postgresql://writer@db.example.test/storyverse?sslmode=require",
      DATABRICKS_OAUTH_TOKEN: "short-lived-smoke-test-token",
    })).toMatchObject({
      password: "short-lived-smoke-test-token",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("generates and caches the Lakebase database password without exposing workspace credentials", async () => {
    const workspaceTokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue("workspace-oauth-token"),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      token: "lakebase-database-token",
      expire_time: "2026-07-26T11:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new LakebaseDatabaseCredentialProvider({
      host: "https://workspace.cloud.databricks.com",
      endpoint: "projects/ai-storyverse/branches/production/endpoints/primary",
      workspaceTokenProvider,
      fetch: fetcher,
      now: () => Date.parse("2026-07-26T10:00:00.000Z"),
    });

    await expect(Promise.all([provider.getPassword(), provider.getPassword()])).resolves.toEqual([
      "lakebase-database-token",
      "lakebase-database-token",
    ]);
    expect(workspaceTokenProvider.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://workspace.cloud.databricks.com/api/2.0/postgres/credentials");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ endpoint: "projects/ai-storyverse/branches/production/endpoints/primary" }),
    });
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer workspace-oauth-token");
  });

  it("configures an isolated app schema for Lakebase connections", () => {
    expect(postgresConfigFromEnv({
      PGHOST: "ep-example.database.us-east-2.cloud.databricks.com",
      PGDATABASE: "databricks_postgres",
      PGUSER: "service-principal-id",
      PGSSLMODE: "require",
      ENDPOINT_NAME: "projects/ai-storyverse/branches/production/endpoints/primary",
      STORYVERSE_PG_SCHEMA: "storyverse_v2",
    })).toMatchObject({
      options: "-c search_path=storyverse_v2",
      ssl: { rejectUnauthorized: true },
    });
    expect(() => postgresConfigFromEnv({
      PGHOST: "ep-example.database.us-east-2.cloud.databricks.com",
      ENDPOINT_NAME: "projects/ai-storyverse/branches/production/endpoints/primary",
      STORYVERSE_PG_SCHEMA: "public; DROP SCHEMA public",
    })).toThrow(/STORYVERSE_PG_SCHEMA/);
  });
});

describe("PostgresWorldStore migrations", () => {
  it("runs one guarded schema migration for concurrent initialize calls", async () => {
    const pool = new RecordingPool();
    const store = new PostgresWorldStore(pool, testOptions);
    await Promise.all([store.initialize(), store.initialize(), store.initialize()]);

    expect(pool.connections).toBe(1);
    expect(pool.calls.filter((call) => call.text === "BEGIN")).toHaveLength(1);
    expect(pool.calls.some((call) => includes(call, "pg_advisory_xact_lock"))).toBe(true);
    expect(pool.calls.some((call) => includes(call, "CREATE TABLE IF NOT EXISTS worlds"))).toBe(true);
    expect(pool.calls.some((call) => includes(call, "CREATE TABLE IF NOT EXISTS world_stories"))).toBe(true);
    expect(pool.calls.some((call) => includes(call, "CREATE TABLE IF NOT EXISTS story_images"))).toBe(true);
    expect(pool.calls.some((call) => includes(call, "CREATE TABLE IF NOT EXISTS story_trailers"))).toBe(true);
    expect(pool.calls.some((call) => includes(call, "ADD COLUMN IF NOT EXISTS kind"))).toBe(true);
    expect(pool.releases).toBe(1);
  });

  it("clears a failed initialization promise so a later attempt can recover", async () => {
    let attempts = 0;
    const pool = new RecordingPool((call) => {
      if (includes(call, "pg_advisory_xact_lock")) {
        attempts += 1;
        if (attempts === 1) throw new Error("temporarily unavailable");
      }
      return { rows: [], rowCount: 0 };
    });
    const store = new PostgresWorldStore(pool, testOptions);
    await expect(store.initialize()).rejects.toThrow("temporarily unavailable");
    await expect(store.initialize()).resolves.toBeUndefined();
    expect(pool.calls.filter((call) => call.text === "BEGIN")).toHaveLength(2);
    expect(pool.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(1);
  });
});

describe("PostgresWorldStore story concurrency and rollback", () => {
  it("uses expected version compare-and-swap and returns null on a conflict", async () => {
    const story = testStory();
    const pool = new RecordingPool((call) => {
      if (includes(call, "SELECT story_json, version FROM world_stories")) return storyRow(story, 4);
      if (includes(call, "UPDATE world_stories")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);

    await expect(store.saveWorldStory({ ...story, worldState: "Another draft tries to overwrite the current version." }, { expectedVersion: 4 })).resolves.toBeNull();
    const update = pool.calls.find((call) => includes(call, "WHERE world_id = $1 AND version = $4"));
    expect(update?.values?.at(-1)).toBe(4);
  });

  it("rolls back future chapters, introduced cast, POVs, and all removed chapter image namespaces atomically", async () => {
    const story = testStory();
    const pool = new RecordingPool((call) => {
      if (includes(call, "SELECT story_json, version FROM world_stories WHERE world_id = $1 FOR UPDATE")) return storyRow(story, 7);
      if (includes(call, "UPDATE world_stories")) return { rows: [{ version: 8 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);

    const result = await store.deleteFutureChapters("world-1", "chapter-1");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected deletion result");
    expect(result.value.chapter.id).toBe("chapter-1");
    expect(result.value.removedChapterIds).toEqual(["chapter-2", "chapter-3"]);
    expect(result.value.story.chapters.map((item) => item.id)).toEqual(["chapter-1"]);
    expect(result.value.story.characters.map((item) => item.id)).toEqual(["mira"]);
    expect(result.value.story.perspectives).toEqual([]);
    expect(result.value.story.upcomingDirections).toEqual(["Keep the signal unresolved."]);

    const imageDelete = pool.calls.find((call) => includes(call, "DELETE FROM story_images"));
    expect(imageDelete?.values).toEqual(["world-1", ["chapter-2", "chapter-3"], ["chapter-2-%", "chapter-3-%"]]);
    const trailerDelete = pool.calls.find((call) => includes(call, "DELETE FROM story_trailers"));
    expect(trailerDelete?.values).toEqual(["world-1", ["chapter-2", "chapter-3"]]);
    const ordered = pool.calls.map((call) => call.text);
    expect(ordered.findIndex((text) => text.includes("DELETE FROM story_images"))).toBeLessThan(ordered.findIndex((text) => text.includes("UPDATE world_stories")));
    expect(ordered.findIndex((text) => text.includes("DELETE FROM story_trailers"))).toBeLessThan(ordered.findIndex((text) => text.includes("UPDATE world_stories")));
    expect(ordered.at(-1)).toBe("COMMIT");
  });

  it("rolls database work back if the story compare-and-swap fails during timeline deletion", async () => {
    const story = testStory();
    const pool = new RecordingPool((call) => {
      if (includes(call, "SELECT story_json, version FROM world_stories WHERE world_id = $1 FOR UPDATE")) return storyRow(story, 2);
      if (includes(call, "UPDATE world_stories")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);

    await expect(store.deleteLatestChapter("world-1", "chapter-3")).rejects.toThrow("Story changed while chapter rollback");
    expect(pool.calls.some((call) => call.text === "ROLLBACK")).toBe(true);
    expect(pool.calls.some((call) => call.text === "COMMIT")).toBe(false);
  });
});

describe("PostgresWorldStore image cache", () => {
  it("uses INSERT ON CONFLICT for cross-instance image reservations and returns the existing record", async () => {
    const existing = imageRow({ status: "ready", image_url: "https://storage.example.test/scene.webp" });
    const pool = new RecordingPool((call) => {
      if (includes(call, "INSERT INTO story_images")) return { rows: [], rowCount: 0 };
      if (includes(call, "SELECT * FROM story_images WHERE cache_key")) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);
    const input: NewStoryImage = {
      cacheKey: "image-key",
      worldId: "world-1",
      sceneId: "chapter-1-beat-1",
      characterIds: [],
      promptVersion: "v1",
      prompt: "A cinematic test scene",
      fallbackUrl: "data:image/svg+xml;base64,",
    };

    const reserved = await store.reserveStoryImage(input);
    expect(reserved).toMatchObject({ created: false, image: { status: "ready", imageUrl: "https://storage.example.test/scene.webp" } });
    expect(pool.calls.find((call) => includes(call, "INSERT INTO story_images"))?.text).toContain("ON CONFLICT (cache_key) DO NOTHING RETURNING *");
  });

  it("returns the creating request's pending image record when INSERT succeeds", async () => {
    const pool = new RecordingPool((call) => {
      if (includes(call, "INSERT INTO story_images")) return { rows: [imageRow()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);
    const input: NewStoryImage = {
      cacheKey: "image-key",
      worldId: "world-1",
      sceneId: "chapter-1-beat-1",
      characterIds: [],
      promptVersion: "v1",
      prompt: "A cinematic test scene",
      fallbackUrl: "data:image/svg+xml;base64,",
    };
    const reserved = await store.reserveStoryImage(input);
    expect(reserved.created).toBe(true);
    expect(reserved.image).toMatchObject({ status: "pending", cacheKey: "image-key" });
  });
});

describe("PostgresWorldStore trailer cache", () => {
  it("looks up each saved video type independently", async () => {
    const pool = new RecordingPool((call) => includes(call, "SELECT * FROM story_trailers")
      ? { rows: [trailerRow({ kind: "chapter" })], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const store = await initializedStore(pool);

    await expect(store.findStoryTrailer("world-1", "chapter-3", 1, "chapter"))
      .resolves.toMatchObject({ kind: "chapter" });
    const lookup = pool.calls.find((call) => includes(call, "chapter_revision = $3 AND kind = $4"));
    expect(lookup?.values).toEqual(["world-1", "chapter-3", 1, "chapter"]);
  });

  it("uses INSERT ON CONFLICT for cross-instance trailer reservations and returns the existing render", async () => {
    const existing = trailerRow({ status: "ready", progress: 100, video_url: "/api/worlds/world-1/trailer/content", provider: "sora-2" });
    const pool = new RecordingPool((call) => {
      if (includes(call, "INSERT INTO story_trailers")) return { rows: [], rowCount: 0 };
      if (includes(call, "SELECT * FROM story_trailers WHERE cache_key")) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);
    const reserved = await store.reserveStoryTrailer({
      cacheKey: "trailer-key", worldId: "world-1", chapterId: "chapter-3", chapterRevision: 1,
      kind: "story_so_far",
      promptVersion: "storyverse-trailer-v1", prompt: "A private trailer prompt that must not leave the server.",
    });

    expect(reserved).toMatchObject({ created: false, trailer: { status: "ready", progress: 100, videoUrl: "/api/worlds/world-1/trailer/content" } });
    expect(pool.calls.find((call) => includes(call, "INSERT INTO story_trailers"))?.text)
      .toContain("ON CONFLICT (cache_key) DO NOTHING RETURNING *");
  });

  it("persists queued job metadata, progress, ready media, and retry state without stale progress overwriting ready", async () => {
    const pool = new RecordingPool((call) => {
      if (includes(call, "UPDATE story_trailers")) {
        const isReady = includes(call, "status = 'ready'");
        const isRetry = includes(call, "status = 'queued'") && includes(call, "provider_job_id = NULL");
        return {
          rows: [trailerRow({
            status: isReady ? "ready" : isRetry ? "queued" : "in_progress",
            progress: isReady ? 100 : isRetry ? 0 : 47,
            video_url: isReady ? "/api/worlds/world-1/trailer/content" : null,
            provider: isRetry ? null : "sora-2",
            provider_job_id: isRetry ? null : "video_123",
            retry_count: isRetry ? 2 : 0,
          })],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);

    await expect(store.markStoryTrailerQueued("trailer-key", {
      provider: "sora-2", providerJobId: "video_123", status: "in_progress", progress: 12,
    })).resolves.toMatchObject({ status: "in_progress", providerJobId: "video_123" });
    await expect(store.markStoryTrailerProgress("trailer-key", 47, "in_progress"))
      .resolves.toMatchObject({ status: "in_progress", progress: 47 });
    await expect(store.markStoryTrailerReady("trailer-key", {
      videoUrl: "/api/worlds/world-1/trailer/content", provider: "sora-2", providerAssetId: "volumes/trailer.mp4",
    })).resolves.toMatchObject({ status: "ready", progress: 100 });
    await expect(store.requeueFailedStoryTrailer("trailer-key"))
      .resolves.toMatchObject({ requeued: true, trailer: { status: "queued", progress: 0, retryCount: 2 } });

    const progressUpdate = pool.calls.find((call) => includes(call, "SET status = $2, progress = $3"));
    expect(progressUpdate?.text).toContain("status IN ('queued', 'in_progress')");
    expect(pool.calls.some((call) => includes(call, "provider_job_id = NULL"))).toBe(true);
  });

  it("does not authorize a second provider retry when another request already requeued the trailer", async () => {
    const current = trailerRow({ status: "queued", progress: 0, provider: "sora-2", provider_job_id: "video_123", retry_count: 2 });
    const pool = new RecordingPool((call) => {
      if (includes(call, "UPDATE story_trailers")) return { rows: [], rowCount: 0 };
      if (includes(call, "SELECT * FROM story_trailers WHERE cache_key")) return { rows: [current], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);

    await expect(store.requeueFailedStoryTrailer("trailer-key"))
      .resolves.toMatchObject({ requeued: false, trailer: { status: "queued", providerJobId: "video_123", retryCount: 2 } });
    expect(pool.calls.some((call) => includes(call, "WHERE cache_key = $1 AND status = 'failed' RETURNING *"))).toBe(true);
  });
});

describe("PostgresWorldStore world deletion", () => {
  it("uses a transaction and relies on schema foreign-key cascades for dependent rows", async () => {
    const pool = new RecordingPool((call) => {
      if (includes(call, "DELETE FROM worlds")) return { rows: [{ id: "world-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = await initializedStore(pool);
    await expect(store.deleteWorld("world-1")).resolves.toBe(true);
    expect(pool.calls.map((call) => call.text)).toEqual(["BEGIN", "DELETE FROM worlds WHERE id = $1 RETURNING id", "COMMIT"]);
  });
});
