import type { StoryBeat } from "../api/story";
import type { StoryImage } from "./contracts";

export type ChapterImageRequest = {
  worldId: string;
  sceneId: string;
  moment: "chapter_scene" | "perspective_scene";
  protagonistId?: string;
};

type PrepareChapterImagesOptions = {
  worldId: string;
  beats: StoryBeat[];
  generate(request: ChapterImageRequest): Promise<StoryImage | null>;
  onProgress(completed: number, total: number): void;
  onImage?(beat: StoryBeat, image: StoryImage | null): void;
  moment?: ChapterImageRequest["moment"];
  protagonistId?: string;
};

/**
 * Prepares the next chapter's complete visual sequence before the reader
 * changes chapters. Two concurrent jobs balance a cinematic wait with
 * provider resilience and avoid a burst of paid image requests.
 */
export async function prepareChapterImages({ worldId, beats, generate, onProgress, onImage, moment = "chapter_scene", protagonistId }: PrepareChapterImagesOptions): Promise<(StoryImage | null)[]> {
  const results: (StoryImage | null)[] = Array.from({ length: beats.length }, () => null);
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < beats.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await generate({ worldId, sceneId: beats[index].id, moment, protagonistId });
      } catch {
        // SceneImage will render its stable fallback and expose its retry UI.
        results[index] = null;
      } finally {
        onImage?.(beats[index], results[index]);
        completed += 1;
        onProgress(completed, beats.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, beats.length) }, worker));
  return results;
}
