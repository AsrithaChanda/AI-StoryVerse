import type { PreparedChapterImage } from "./chapter-preparation";

const ASSET_PRELOAD_TIMEOUT_MS = 25_000;

/**
 * Warms ready image URLs before a chapter is committed to the reader. The
 * URLs stay behind StoryVerse's asset route, so this works identically when
 * bytes come from local development storage or a private Databricks Volume.
 */
export async function preloadChapterImageAssets(entries: PreparedChapterImage[]): Promise<PreparedChapterImage[]> {
  if (typeof Image === "undefined") return entries;

  return Promise.all(entries.map(async (entry) => {
    const source = entry.image?.status === "ready" ? entry.image.imageUrl : undefined;
    if (!source) return entry;
    return await preloadAsset(source) ? entry : { ...entry, image: null };
  }));
}

function preloadAsset(source: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      if (timer.id) clearTimeout(timer.id);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    image.onload = () => {
      // `onload` is enough for older browsers; decode avoids a flash while the
      // image is being painted in modern browsers.
      if (typeof image.decode !== "function") return finish(true);
      void image.decode().then(() => finish(true), () => finish(true));
    };
    image.onerror = () => finish(false);
    // A slow or unavailable Volume proxy must not strand the entire chapter
    // assembly view. The reader will reveal a stable fallback for that frame.
    timer.id = setTimeout(() => finish(false), ASSET_PRELOAD_TIMEOUT_MS);
    image.src = source;
  });
}
