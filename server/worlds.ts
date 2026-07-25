import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { NewStoryImage, StoredStoryImage } from "./images/types.js";
import type { WorldStory } from "./story.js";

export type World = {
  id: string;
  title: string;
  premise: string;
  genre: string;
  creatorPrompt: string;
  openingScene: string;
  characters: Array<{ name: string; role: string; trait: string }>;
  source: "seed" | "openai" | "fallback";
  createdAt: string;
};

export type CreateWorldInput = Pick<World, "title" | "premise" | "genre" | "creatorPrompt">;

type WorldRow = Omit<World, "characters" | "source"> & { characters_json: string; source: World["source"] };

const lastEmber: Omit<World, "createdAt"> = {
  id: "the-last-ember", title: "The Last Ember", genre: "Fantasy mystery",
  premise: "A floating city survives on a failing Ember Core. At the eastern bridge, a courier must decide whether a prince’s secret is worth saving Astra.",
  creatorPrompt: "A cinematic fantasy mystery about trust, a failing power source, and a city above the clouds.",
  openingScene: "Warning bells cross the eastern bridge. Mira Sen corners Prince Kael beneath the amber lamps, and the stolen Ember fragment glows once between them.",
  characters: [{ name: "Mira Sen", role: "Palace courier", trait: "Brave and impulsive" }, { name: "Ravi", role: "Retired royal guard", trait: "Protective and suspicious" }, { name: "Prince Kael", role: "Heir to Astra", trait: "Idealistic and secretive" }],
  source: "seed",
};

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
    db.exec(`CREATE TABLE IF NOT EXISTS world_stories (
      world_id TEXT PRIMARY KEY,
      story_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(world_id) REFERENCES worlds(id)
    )`);
    this.normalizeLegacyFallbackBlueprints();
    this.seed();
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

  private seed(): void {
    const exists = this.db.prepare("SELECT id FROM worlds WHERE id = ?").get(lastEmber.id);
    if (exists) return;
    this.insert({ ...lastEmber, createdAt: "2026-01-01T00:00:00.000Z" });
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
    const persisted = { ...story, createdAt: existing?.createdAt ?? story.createdAt ?? now, updatedAt: now };
    this.db.prepare(`INSERT INTO world_stories (world_id, story_json, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(world_id) DO UPDATE SET story_json = excluded.story_json, updated_at = excluded.updated_at`)
      .run(persisted.worldId, JSON.stringify(persisted), persisted.createdAt, persisted.updatedAt);
    return persisted;
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

}

type StoryImageRow = {
  id: string; cache_key: string; world_id: string; branch_id: string | null; scene_id: string;
  protagonist_id: string | null; character_ids_json: string; prompt_version: string; prompt: string;
  status: StoredStoryImage["status"]; image_url: string | null; fallback_url: string;
  provider: string | null; provider_asset_id: string | null; error_code: string | null;
  retry_count: number; created_at: string; updated_at: string;
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
  const chapters = story.chapters.map((chapter) => {
    let chapterChanged = false;
    const beats = chapter.beats.map((beat, index) => {
      const id = `chapter-${chapter.number}-beat-${index + 1}`;
      if (beat.id === id) return beat;
      changed = true;
      chapterChanged = true;
      return { ...beat, id };
    });
    const id = `chapter-${chapter.number}`;
    chapterIdMap.set(chapter.id, id);
    if (chapter.id !== id) { changed = true; chapterChanged = true; }
    return chapterChanged ? { ...chapter, id, beats } : chapter;
  });
  const perspectives = story.perspectives.map((perspective) => {
    const chapterId = chapterIdMap.get(perspective.chapterId) ?? perspective.chapterId;
    const beats = perspective.beats.map((beat, index) => {
      const id = `${chapterId}-${perspective.characterId}-beat-${index + 1}`;
      if (beat.id === id) return beat;
      changed = true;
      return { ...beat, id };
    });
    if (chapterId === perspective.chapterId && beats.every((beat, index) => beat === perspective.beats[index])) return perspective;
    changed = true;
    return { ...perspective, chapterId, beats };
  });
  return changed ? { ...story, chapters, perspectives, worldState } : story;
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "untitled-world";
}
