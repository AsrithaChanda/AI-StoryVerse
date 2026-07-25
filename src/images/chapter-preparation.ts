import type { StoryBeat } from "../api/story";
import type { StoryImage } from "./contracts";

export type ChapterImageRequest = {
  worldId: string;
  sceneId: string;
  moment: "chapter_scene" | "perspective_scene";
  protagonistId?: string;
};

export type PrepareChapterImagesOptions = {
  worldId: string;
  beats: StoryBeat[];
  /** Resolves an absent or pending cache record to a terminal image state. */
  generate(request: ChapterImageRequest): Promise<StoryImage | null>;
  /**
   * Optional cache-only probe. Supplying this makes `allCached` authoritative:
   * a missing or pending record is sent to `generate`, while terminal records
   * are reused without provider work.
   */
  loadCached?(request: ChapterImageRequest): Promise<StoryImage | null>;
  onProgress(completed: number, total: number): void;
  onImage?(beat: StoryBeat, image: StoryImage | null): void;
  moment?: ChapterImageRequest["moment"];
  protagonistId?: string;
};

export type PreparedChapterImage = {
  beat: StoryBeat;
  request: ChapterImageRequest;
  /** Always terminal: ready, failed, fallback, or null for an unavailable image. */
  image: StoryImage | null;
};

export type ChapterImageBatch = {
  /** Preserves beat order so callers can reveal an entire chapter atomically. */
  entries: PreparedChapterImage[];
  /** Convenience view of `entries`, retained for simple rendering code. */
  images: (StoryImage | null)[];
  /** True only when every image came from the provided cache-only probe. */
  allCached: boolean;
  /** Number of beats that needed generation or pending-state resolution. */
  resolvedCount: number;
  /** Number of images unavailable after resolution, represented as null. */
  unavailableCount: number;
};

/**
 * Runs a terminal batch for a chapter's visual sequence. Two concurrent jobs
 * balance provider resilience with a controlled request rate. Callers that
 * need an atomic reveal should await `prepareChapterImageBatch` and commit its
 * ordered entries together; the legacy helper below keeps its array contract.
 */
export async function prepareChapterImageBatch({ worldId, beats, generate, loadCached, onProgress, onImage, moment = "chapter_scene", protagonistId }: PrepareChapterImagesOptions): Promise<ChapterImageBatch> {
  const results: (StoryImage | null)[] = Array.from({ length: beats.length }, () => null);
  let next = 0;
  let completed = 0;
  let resolvedCount = loadCached ? 0 : beats.length;
  let unavailableCount = 0;
  const worker = async () => {
    while (next < beats.length) {
      const index = next;
      next += 1;
      const request: ChapterImageRequest = { worldId, sceneId: beats[index].id, moment, protagonistId };
      try {
        const cached = loadCached ? await loadCached(request) : null;
        if (isTerminal(cached)) {
          results[index] = cached;
        } else {
          if (loadCached) resolvedCount += 1;
          results[index] = terminalImage(await generate(request));
        }
      } catch {
        // SceneImage will render its stable fallback and expose its retry UI.
        results[index] = null;
      } finally {
        if (!results[index]) unavailableCount += 1;
        onImage?.(beats[index], results[index]);
        completed += 1;
        onProgress(completed, beats.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, beats.length) }, worker));
  const entries = beats.map((beat, index) => ({
    beat,
    request: { worldId, sceneId: beat.id, moment, protagonistId },
    image: results[index],
  }));
  return {
    entries,
    images: results,
    allCached: Boolean(loadCached) && resolvedCount === 0,
    resolvedCount,
    unavailableCount,
  };
}

/**
 * Backward-compatible array helper. New callers that need to distinguish a
 * durable cache fast path from work that required resolution should use
 * `prepareChapterImageBatch`.
 */
export async function prepareChapterImages(options: PrepareChapterImagesOptions): Promise<(StoryImage | null)[]> {
  return (await prepareChapterImageBatch(options)).images;
}

function isTerminal(image: StoryImage | null): image is StoryImage {
  return image !== null && image.status !== "pending";
}

/** A pending result violates the resolver contract; never leak it into a batch. */
function terminalImage(image: StoryImage | null): StoryImage | null {
  return image?.status === "pending" ? null : image;
}
