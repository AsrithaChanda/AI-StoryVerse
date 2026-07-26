import { createHash } from "node:crypto";
import { logInfo, logWarn } from "./logger.js";
import {
  toPublicStoryTrailer,
  type PublicStoryTrailer,
  type StoredStoryTrailer,
  type StoryStore,
} from "./persistence/store.js";
import type { AssetStore, StoredAsset } from "./storage/index.js";
import type { StoryChapter, WorldStory } from "./story.js";
import type { World } from "./worlds.js";

/** Bump when the trailer prompt contract changes so old renders are never reused. */
export const STORY_TRAILER_PROMPT_VERSION = "storyverse-trailer-v1";

const OPENAI_VIDEO_URL = "https://api.openai.com/v1/videos";
const videoFilename = /^[a-f0-9]{64}\.mp4$/i;
const supportedSeconds = [4, 8, 12] as const;
const supportedSizes = ["1280x720", "720x1280", "1792x1024", "1024x1792"] as const;

export type StoryTrailerSeconds = (typeof supportedSeconds)[number];
export type StoryTrailerSize = (typeof supportedSizes)[number];
export type StoryTrailerProviderStatus = "queued" | "in_progress" | "completed" | "failed";

export type StoryTrailerGenerationInput = {
  prompt: string;
  seconds: StoryTrailerSeconds;
  size: StoryTrailerSize;
};

export type StoryTrailerProviderJob = {
  id: string;
  status: StoryTrailerProviderStatus;
  /** The Videos API reports a 0–100 percentage while a job is rendering. */
  progress: number;
  providerAssetId?: string;
  errorCode?: string;
};

export type GeneratedStoryTrailer = {
  bytes: Uint8Array;
  contentType: "video/mp4";
  providerAssetId?: string;
};

/** Provider seam kept deliberately small so tests never create a paid video job. */
export interface StoryTrailerProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  create(input: StoryTrailerGenerationInput): Promise<StoryTrailerProviderJob>;
  retrieve(jobId: string): Promise<StoryTrailerProviderJob>;
  download(jobId: string): Promise<GeneratedStoryTrailer>;
}

export type StoryTrailerErrorCode =
  | "world_not_found"
  | "story_not_generated"
  | "provider_disabled"
  | "provider_error"
  | "timeout"
  | "invalid_response"
  | "persistence_failed";

/** Messages are intentionally safe for the API: never include provider bodies or credentials. */
export class StoryTrailerError extends Error {
  public constructor(
    public readonly code: StoryTrailerErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "StoryTrailerError";
  }
}

export type OpenAIStoryTrailerProviderOptions = {
  apiKey?: string;
  model?: string;
  seconds?: StoryTrailerSeconds;
  size?: StoryTrailerSize;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

/**
 * Thin server-only adapter for the asynchronous OpenAI Videos API. It exposes
 * only job state and bytes; provider URLs and credentials never reach routes.
 */
export class OpenAIStoryTrailerProvider implements StoryTrailerProvider {
  public readonly name = "openai-sora";
  public readonly isAvailable: boolean;
  public readonly seconds: StoryTrailerSeconds;
  public readonly size: StoryTrailerSize;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;

  public constructor(options: OpenAIStoryTrailerProviderOptions = {}) {
    this.apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
    this.model = safeModel(options.model ?? process.env.OPENAI_VIDEO_MODEL ?? "sora-2");
    this.seconds = options.seconds ?? configuredSeconds(process.env.STORYVERSE_TRAILER_SECONDS);
    this.size = options.size ?? configuredSize(process.env.STORYVERSE_TRAILER_SIZE);
    this.timeoutMs = boundedTimeout(options.timeoutMs ?? process.env.STORYVERSE_TRAILER_TIMEOUT_MS);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.isAvailable = Boolean(this.apiKey) && typeof this.fetcher === "function";
  }

  public async create(input: StoryTrailerGenerationInput): Promise<StoryTrailerProviderJob> {
    this.assertAvailable();
    const body = new FormData();
    body.set("model", this.model);
    body.set("prompt", input.prompt);
    body.set("seconds", String(input.seconds));
    body.set("size", input.size);
    const response = await this.request(OPENAI_VIDEO_URL, { method: "POST", body });
    return parseVideoJob(await responseJson(response));
  }

  public async retrieve(jobId: string): Promise<StoryTrailerProviderJob> {
    this.assertAvailable();
    const response = await this.request(`${OPENAI_VIDEO_URL}/${encodedJobId(jobId)}`, { method: "GET" });
    return parseVideoJob(await responseJson(response));
  }

  public async download(jobId: string): Promise<GeneratedStoryTrailer> {
    this.assertAvailable();
    const response = await this.request(`${OPENAI_VIDEO_URL}/${encodedJobId(jobId)}/content`, { method: "GET" });
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxTrailerBytes()) {
      throw new StoryTrailerError("invalid_response", "The rendered trailer was unexpectedly large.", 502);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new StoryTrailerError("invalid_response", "The video provider returned unreadable trailer content.", 502);
    }
    if (bytes.byteLength < 16 || bytes.byteLength > maxTrailerBytes()) {
      throw new StoryTrailerError("invalid_response", "The video provider returned invalid trailer content.", 502);
    }
    return { bytes, contentType: "video/mp4", providerAssetId: jobId };
  }

  private assertAvailable(): void {
    if (!this.isAvailable) {
      throw new StoryTrailerError("provider_disabled", "Video generation is not configured. Add a video-capable OpenAI key and try again.", 503);
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) throw new StoryTrailerError("timeout", "The video provider timed out. Please try again.", 504);
      throw new StoryTrailerError("provider_error", "The video provider could not be reached. Please try again.", 502);
    }
    if (!response.ok) {
      // Do not read or relay the provider body: it can include implementation
      // details and must never leak through our API or structured logs.
      throw new StoryTrailerError("provider_error", "The video provider could not start or retrieve this trailer. Please try again.", 502);
    }
    return response;
  }
}

/** A disabled adapter preserves the same runtime contract without making network calls. */
export class DisabledStoryTrailerProvider implements StoryTrailerProvider {
  public readonly name = "disabled";
  public readonly isAvailable = false;

  public async create(): Promise<StoryTrailerProviderJob> { return this.unavailable(); }
  public async retrieve(): Promise<StoryTrailerProviderJob> { return this.unavailable(); }
  public async download(): Promise<GeneratedStoryTrailer> { return this.unavailable(); }

  private unavailable(): never {
    throw new StoryTrailerError("provider_disabled", "Video generation is not configured. Add a video-capable OpenAI key and try again.", 503);
  }
}

export function createStoryTrailerProviderFromEnvironment(): StoryTrailerProvider {
  return new OpenAIStoryTrailerProvider();
}

export type StoryTrailerServiceOptions = {
  store: StoryStore;
  assets: AssetStore;
  provider?: StoryTrailerProvider;
};

type PreparedTrailer = {
  world: World;
  story: WorldStory;
  chapter: StoryChapter;
  chapterRevision: number;
  cacheKey: string;
  prompt: string;
};

/**
 * A durable orchestrator for a single current-chapter trailer. POST reserves
 * and launches work, while GET only polls an already-reserved job. This keeps
 * paid renders idempotent across refreshes, remounts, and concurrent readers.
 */
export class StoryTrailerService {
  private readonly provider: StoryTrailerProvider;

  public constructor(
    private readonly options: StoryTrailerServiceOptions,
  ) {
    this.provider = options.provider ?? createStoryTrailerProviderFromEnvironment();
  }

  public async start(worldId: string, retry = false): Promise<PublicStoryTrailer> {
    const prepared = await this.prepare(worldId);
    const reservation = await this.options.store.reserveStoryTrailer({
      cacheKey: prepared.cacheKey,
      worldId: prepared.world.id,
      chapterId: prepared.chapter.id,
      chapterRevision: prepared.chapterRevision,
      promptVersion: STORY_TRAILER_PROMPT_VERSION,
      prompt: prepared.prompt,
    });
    let trailer = reservation.trailer;

    if (!reservation.created) {
      if (trailer.status !== "failed" || !retry) {
        logInfo("story_trailer.request.reused", trailerLogFields(trailer));
        return toPublicStoryTrailer(trailer);
      }
      const requeued = await this.options.store.requeueFailedStoryTrailer(prepared.cacheKey);
      if (!requeued || requeued.status !== "queued") return toPublicStoryTrailer(await this.latestTrailer(prepared, trailer));
      trailer = requeued;
      logInfo("story_trailer.request.requeued", trailerLogFields(trailer));
    } else {
      logInfo("story_trailer.request.reserved", trailerLogFields(trailer));
    }

    return this.launch(prepared, trailer);
  }

  /** Returns the current canonical chapter's record and polls only pending work. */
  public async get(worldId: string): Promise<PublicStoryTrailer | null> {
    const prepared = await this.prepare(worldId);
    const trailer = await this.options.store.getStoryTrailerByCacheKey(prepared.cacheKey);
    if (!trailer) return null;
    if (trailer.status === "queued" || trailer.status === "in_progress") {
      return toPublicStoryTrailer(await this.refresh(prepared, trailer));
    }
    return toPublicStoryTrailer(trailer);
  }

  /** Binary assets are retrieved only by a content-addressed filename. */
  public async getAsset(filename: string): Promise<StoredAsset | null> {
    if (!videoFilename.test(filename)) return null;
    return this.options.assets.read(this.assetKey(filename));
  }

  private async launch(prepared: PreparedTrailer, trailer: StoredStoryTrailer): Promise<PublicStoryTrailer> {
    if (!this.provider.isAvailable) {
      await this.persistFailure(prepared.cacheKey, "provider_disabled", prepared, trailer);
      throw new StoryTrailerError("provider_disabled", "Video generation is not configured. Add a video-capable OpenAI key and try again.", 503);
    }
    try {
      const job = await this.provider.create({
        prompt: prepared.prompt,
        seconds: configuredSeconds(process.env.STORYVERSE_TRAILER_SECONDS),
        size: configuredSize(process.env.STORYVERSE_TRAILER_SIZE),
      });
      if (job.status === "failed") {
        await this.persistFailure(prepared.cacheKey, normalizeProviderErrorCode(job.errorCode), prepared, trailer);
        throw new StoryTrailerError("provider_error", "The video provider could not start this trailer. Please try again.", 502);
      }
      const queued = await this.options.store.markStoryTrailerQueued(prepared.cacheKey, {
        provider: this.provider.name,
        providerJobId: job.id,
        providerAssetId: job.providerAssetId,
        status: job.status === "in_progress" ? "in_progress" : "queued",
        progress: job.progress,
      });
      const durable = await this.latestTrailer(prepared, queued ?? trailer);
      logInfo("story_trailer.job.queued", { ...trailerLogFields(durable), provider: this.provider.name });
      if (job.status === "completed" && durable.status !== "ready") return toPublicStoryTrailer(await this.refresh(prepared, durable));
      return toPublicStoryTrailer(durable);
    } catch (error) {
      if (error instanceof StoryTrailerError && error.code === "provider_error" && error.message.includes("could not start")) throw error;
      const failure = asTrailerError(error);
      await this.persistFailure(prepared.cacheKey, failure.code, prepared, trailer);
      throw failure;
    }
  }

  private async refresh(prepared: PreparedTrailer, trailer: StoredStoryTrailer): Promise<StoredStoryTrailer> {
    // A second request can arrive between reservation and provider job storage.
    // It must wait for that existing launcher instead of creating another paid job.
    if (!trailer.providerJobId || !this.provider.isAvailable) return trailer;
    try {
      const job = await this.provider.retrieve(trailer.providerJobId);
      if (job.status === "queued" || job.status === "in_progress") {
        const progressed = await this.options.store.markStoryTrailerProgress(prepared.cacheKey, job.progress, job.status);
        const durable = await this.latestTrailer(prepared, progressed ?? trailer);
        logInfo("story_trailer.job.progress", { ...trailerLogFields(durable), progress: job.progress });
        return durable;
      }
      if (job.status === "failed") {
        return this.persistFailure(prepared.cacheKey, normalizeProviderErrorCode(job.errorCode), prepared, trailer);
      }
      const video = await this.provider.download(trailer.providerJobId);
      const filename = `${prepared.cacheKey}.mp4`;
      await this.options.assets.put(this.assetKey(filename), video.bytes, video.contentType);
      const ready = await this.options.store.markStoryTrailerReady(prepared.cacheKey, {
        videoUrl: `/api/worlds/${prepared.world.id}/story/trailer/assets/${filename}`,
        provider: this.provider.name,
        providerAssetId: video.providerAssetId ?? job.providerAssetId,
      });
      const durable = await this.latestTrailer(prepared, ready ?? trailer);
      if (durable.status === "ready") logInfo("story_trailer.job.ready", { ...trailerLogFields(durable), provider: this.provider.name });
      return durable;
    } catch (error) {
      const failure = asTrailerError(error);
      return this.persistFailure(prepared.cacheKey, failure.code, prepared, trailer);
    }
  }

  private async persistFailure(
    cacheKey: string,
    code: StoryTrailerErrorCode | string,
    prepared: PreparedTrailer,
    fallback: StoredStoryTrailer,
  ): Promise<StoredStoryTrailer> {
    const failed = await this.options.store.markStoryTrailerFailed(cacheKey, safeFailureCode(code));
    const durable = await this.latestTrailer(prepared, failed ?? fallback);
    logWarn("story_trailer.job.failed", { ...trailerLogFields(durable), errorCode: safeFailureCode(code) });
    return durable;
  }

  /** Guarded persistence writes return null if another poll won the terminal transition. */
  private async latestTrailer(prepared: PreparedTrailer, fallback: StoredStoryTrailer): Promise<StoredStoryTrailer> {
    return (await this.options.store.getStoryTrailerByCacheKey(prepared.cacheKey)) ?? fallback;
  }

  private async prepare(worldId: string): Promise<PreparedTrailer> {
    const [world, story] = await Promise.all([
      this.options.store.get(worldId),
      this.options.store.getWorldStory(worldId),
    ]);
    if (!world) throw new StoryTrailerError("world_not_found", "World not found.", 404);
    const chapter = story?.chapters.at(-1);
    if (!story || !chapter) throw new StoryTrailerError("story_not_generated", "Generate Chapter 1 before creating a story trailer.", 409);
    const chapterRevision = normalizedRevision(chapter.revision);
    return {
      world,
      story,
      chapter,
      chapterRevision,
      cacheKey: storyTrailerCacheKey(world, story, chapter),
      prompt: buildStoryTrailerPrompt(world, story, chapter),
    };
  }

  private assetKey(filename: string): string {
    return `videos/${filename}`;
  }
}

/** Cache identity covers the full canonical history, not merely the current ID. */
export function storyTrailerCacheKey(world: World, story: WorldStory, latestChapter: StoryChapter): string {
  const narrativeIdentity = {
    version: STORY_TRAILER_PROMPT_VERSION,
    worldId: world.id,
    world: {
      premise: world.premise,
      genre: world.genre,
      creatorPrompt: world.creatorPrompt,
      openingScene: world.openingScene,
    },
    worldState: story.worldState,
    latest: {
      id: latestChapter.id,
      number: latestChapter.number,
      revision: normalizedRevision(latestChapter.revision),
    },
    chapters: story.chapters.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      revision: normalizedRevision(chapter.revision),
      title: chapter.title,
      narration: chapter.narration,
      beats: chapter.beats.map((beat) => ({ description: beat.description, caption: beat.caption })),
      transition: chapter.transition,
    })),
  };
  return createHash("sha256").update(JSON.stringify(narrativeIdentity)).digest("hex");
}

/**
 * Builds a bounded prompt from persisted canonical facts. It intentionally
 * avoids the user-supplied title and character names, then strips known names
 * from supporting prose, so an evocative title cannot turn into franchise
 * imitation in the video request.
 */
export function buildStoryTrailerPrompt(world: World, story: WorldStory, latestChapter: StoryChapter): string {
  const identities = [
    world.title,
    ...world.characters.map((character) => character.name),
    ...story.characters.map((character) => character.name),
  ];
  const selected = selectTrailerChapters(story.chapters);
  const moments = selected.map((chapter, index) => {
    const transition = chapter.transition;
    const text = transition
      ? `${transition.resolvedBeat}. ${transition.closingImage}. ${transition.nextChapterHook}`
      : chapter.beats.map((beat) => `${beat.description}. ${beat.caption}.`).join(" ") || chapter.narration;
    return `${index + 1}. ${sanitizeCreativeText(text, identities, 330)}`;
  });
  const premise = sanitizeCreativeText(world.premise, identities, 420);
  const direction = sanitizeCreativeText(world.creatorPrompt, identities, 280);
  const worldState = sanitizeCreativeText(story.worldState, identities, 220);
  const currentEnding = sanitizeCreativeText(
    latestChapter.transition?.closingImage ?? latestChapter.beats.at(-1)?.description ?? latestChapter.narration,
    identities,
    300,
  );
  return [
    "Create an eight-second, 16:9 cinematic trailer glimpse for an original fictional story universe.",
    `Genre and atmosphere: ${sanitizeCreativeText(world.genre, identities, 160)}.`,
    `Original premise: ${premise}. Creator direction: ${direction}. Current world pressure: ${worldState}.`,
    "Tell one coherent visual rise in three to four rapid, connected shots: establish the world, reveal a central conflict, escalate the danger, and end on a clean, emotionally charged final image that invites the next chapter.",
    "Use unnamed, original characters with distinct but non-iconic silhouettes. Preserve broad setting, emotional continuity, and cause-and-effect from these saved story moments:",
    ...moments,
    `Final image to earn: ${currentEnding}.`,
    "Use entirely original people, objects, costumes, places, and plot details. Do not depict or reference protected characters, franchises, brands, logos, trademarked costumes, famous people, actors, real people, copyrighted scenes, recognizable music, lyrics, spoken dialogue, text overlays, captions, or watermarks.",
    "No readable text anywhere in the video. Do not imitate a named film, game, artist, studio, or animation franchise.",
  ].join("\n");
}

function selectTrailerChapters(chapters: StoryChapter[]): StoryChapter[] {
  if (chapters.length <= 6) return chapters;
  return [...chapters.slice(0, 2), ...chapters.slice(-4)];
}

function sanitizeCreativeText(value: string, identities: string[], maximum: number): string {
  let output = value.replace(/\s+/g, " ").trim();
  const terms = [...identities, ...protectedTerms]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .sort((left, right) => right.length - left.length);
  for (const term of terms) output = output.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "giu"), "an original figure");
  // The story engine can preserve user-created names in prose. Remove remaining
  // title-cased identity-like tokens rather than forwarding them to the model.
  output = output.replace(/\b[A-Z][\p{L}\p{M}'-]{2,}\b/gu, "an original figure");
  output = output.replace(/\s+/g, " ").trim();
  if (!output) return "an original unfolding conflict";
  return output.length > maximum ? `${output.slice(0, maximum - 1).trimEnd()}…` : output;
}

const protectedTerms = [
  "avengers", "marvel", "dc comics", "star wars", "harry potter", "lord of the rings", "game of thrones", "bahubali", "baahubali", "disney", "pixar", "netflix",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

function configuredSeconds(value: unknown): StoryTrailerSeconds {
  const number = Number(value);
  return (supportedSeconds as readonly number[]).includes(number) ? number as StoryTrailerSeconds : 8;
}

function configuredSize(value: unknown): StoryTrailerSize {
  return typeof value === "string" && (supportedSizes as readonly string[]).includes(value) ? value as StoryTrailerSize : "1280x720";
}

function safeModel(value: string): string {
  const normalized = value.trim();
  return /^[a-zA-Z0-9._-]{1,128}$/.test(normalized) ? normalized : "sora-2";
}

function boundedTimeout(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 120_000;
  return Math.min(300_000, Math.max(5_000, Math.floor(number)));
}

function maxTrailerBytes(): number {
  const configured = Number(process.env.STORYVERSE_TRAILER_MAX_BYTES);
  if (!Number.isFinite(configured)) return 256 * 1024 * 1024;
  return Math.min(512 * 1024 * 1024, Math.max(1_024 * 1_024, Math.floor(configured)));
}

function encodedJobId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new StoryTrailerError("invalid_response", "The video provider returned an invalid job identifier.", 502);
  return encodeURIComponent(value);
}

function parseVideoJob(value: unknown): StoryTrailerProviderJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoryTrailerError("invalid_response", "The video provider returned an invalid job.", 502);
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id : "";
  const status = source.status;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !["queued", "in_progress", "completed", "failed"].includes(String(status))) {
    throw new StoryTrailerError("invalid_response", "The video provider returned an invalid job.", 502);
  }
  const rawProgress = typeof source.progress === "number" && Number.isFinite(source.progress) ? source.progress : status === "completed" ? 100 : 0;
  const progress = Math.max(0, Math.min(100, Math.round(rawProgress)));
  const providerAssetId = typeof source.output_file_id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(source.output_file_id)
    ? source.output_file_id
    : undefined;
  const error = source.error;
  const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { id, status: status as StoryTrailerProviderStatus, progress, providerAssetId, errorCode };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new StoryTrailerError("invalid_response", "The video provider returned invalid job data.", 502);
  }
}

function asTrailerError(error: unknown): StoryTrailerError {
  if (error instanceof StoryTrailerError) return error;
  if (isTimeout(error)) return new StoryTrailerError("timeout", "The video provider timed out. Please try again.", 504);
  return new StoryTrailerError("provider_error", "The video provider could not complete this trailer. Please try again.", 502);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function normalizeProviderErrorCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : "provider_error";
}

function safeFailureCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : "provider_error";
}

function trailerLogFields(trailer: StoredStoryTrailer): { worldId: string; chapterId: string; status: string; cacheKey: string } {
  return {
    worldId: trailer.worldId,
    chapterId: trailer.chapterId,
    status: trailer.status,
    cacheKey: trailer.cacheKey.slice(0, 12),
  };
}
