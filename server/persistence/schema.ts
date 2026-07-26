/**
 * PostgreSQL schema used by PostgresWorldStore.  It deliberately does not use
 * Databricks SQL warehouse objects: Lakebase's PostgreSQL endpoint is the
 * transactional request-path database.
 */
export const POSTGRES_SCHEMA_MIGRATIONS = [
  {
    id: "001_storyverse_core",
    statements: [
      `CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL UNIQUE,
        premise TEXT NOT NULL,
        genre TEXT NOT NULL,
        creator_prompt TEXT NOT NULL,
        opening_scene TEXT NOT NULL,
        characters_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        source TEXT NOT NULL CHECK (source IN ('openai', 'fallback')),
        created_at TIMESTAMPTZ NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS world_stories (
        world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
        story_json JSONB NOT NULL,
        version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS story_images (
        id TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,
        world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
        branch_id TEXT,
        scene_id TEXT NOT NULL,
        protagonist_id TEXT,
        character_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        prompt_version TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'fallback')),
        image_url TEXT,
        fallback_url TEXT NOT NULL,
        provider TEXT,
        provider_asset_id TEXT,
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS worlds_created_at_idx ON worlds(created_at DESC)",
      "CREATE INDEX IF NOT EXISTS world_stories_updated_at_idx ON world_stories(updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS story_images_scene_idx ON story_images(world_id, scene_id)",
      "CREATE INDEX IF NOT EXISTS story_images_lookup_idx ON story_images(world_id, scene_id, branch_id, protagonist_id, prompt_version, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS story_images_status_idx ON story_images(status, updated_at DESC)",
    ],
  },
  {
    id: "002_story_trailers",
    statements: [
      `CREATE TABLE IF NOT EXISTS story_trailers (
        id TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,
        world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL,
        chapter_revision INTEGER NOT NULL CHECK (chapter_revision >= 1),
        prompt_version TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'ready', 'failed')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        video_url TEXT,
        provider TEXT,
        provider_job_id TEXT,
        provider_asset_id TEXT,
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS story_trailers_lookup_idx ON story_trailers(world_id, chapter_id, chapter_revision, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS story_trailers_status_idx ON story_trailers(status, updated_at DESC)",
    ],
  },
  {
    id: "003_story_trailer_kinds",
    statements: [
      "ALTER TABLE story_trailers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'story_so_far'",
      "ALTER TABLE story_trailers DROP CONSTRAINT IF EXISTS story_trailers_kind_check",
      "ALTER TABLE story_trailers ADD CONSTRAINT story_trailers_kind_check CHECK (kind IN ('chapter', 'story_so_far'))",
      "CREATE INDEX IF NOT EXISTS story_trailers_kind_lookup_idx ON story_trailers(world_id, chapter_id, chapter_revision, kind, updated_at DESC)",
    ],
  },
] as const;

export const POSTGRES_MIGRATIONS_TABLE = "storyverse_schema_migrations";
