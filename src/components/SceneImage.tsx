import { useEffect, useId, useMemo, useState } from "react";
import type { ImageMoment, StoryImage } from "../images/contracts";
import "../styles/images.css";

/** A provider-neutral request the host can use to load (or start) one scene image. */
export type SceneImageRequest = {
  worldId: string;
  sceneId?: string;
  branchId?: string;
  moment: Exclude<ImageMoment, "world_cover">;
  protagonistId?: string;
};

export type SceneImageProps = {
  /** Canonical metadata already held by the story controller, if available. */
  image?: StoryImage | null;
  /** Identifies the canonical moment; UI never accepts a raw prompt. */
  moment: SceneImageRequest["moment"];
  worldId: string;
  sceneId?: string;
  branchId?: string;
  protagonistId?: string;
  /** Human-readable scene label, used for the accessible description. */
  title: string;
  /** Optional description that replaces the default decorative image description. */
  description?: string;
  /** The controller may asynchronously fetch cached metadata or request generation. */
  loadImage?(request: SceneImageRequest): Promise<StoryImage | null | undefined>;
  /** A chapter-level illustration queue is working on this image. This lets
   * the host avoid duplicate image calls while the frame remains truthful. */
  preparing?: boolean;
  /** Retrying remains an explicit user action after a failed image request. */
  retryImage?(request: SceneImageRequest): Promise<StoryImage | null | undefined>;
  className?: string;
};

const MOMENT_LABEL: Record<SceneImageRequest["moment"], string> = {
  chapter_scene: "Chapter illustration",
  perspective_scene: "Character perspective",
};

type UsableStoryImage = StoryImage & { status: "ready"; imageUrl: string };

function isUsable(image: StoryImage | null | undefined): image is UsableStoryImage {
  return Boolean(image && image.status === "ready" && image.imageUrl);
}

/**
 * Stable cinematic image frame for the reader and timeline comparison.
 * It renders its CSS fallback synchronously and only replaces it after a usable URL loads.
 */
export default function SceneImage({ image, moment, worldId, sceneId, branchId, protagonistId, title, description, loadImage, preparing = false, retryImage, className = "" }: SceneImageProps) {
  const request = useMemo<SceneImageRequest>(() => ({ worldId, sceneId, branchId, moment, protagonistId }), [worldId, sceneId, branchId, moment, protagonistId]);
  const requestKey = `${worldId}:${sceneId ?? "auto"}:${branchId ?? "root"}:${moment}:${protagonistId ?? "ensemble"}`;
  const [resolved, setResolved] = useState<{ key: string; image: StoryImage | null | undefined }>();
  const [retrying, setRetrying] = useState(false);
  const [failedKey, setFailedKey] = useState<string>();
  const statusId = useId();

  useEffect(() => {
    let active = true;
    if (!loadImage || isUsable(image) || image?.status === "failed") return () => { active = false; };

    void loadImage(request)
      .then((next) => { if (active && next) { setResolved({ key: requestKey, image: next }); if (next.status === "failed") setFailedKey(requestKey); } else if (active) setFailedKey(requestKey); })
      .catch(() => { if (active) setFailedKey(requestKey); });
    return () => { active = false; };
  }, [image, loadImage, request, requestKey]);

  const shown = image ?? (resolved?.key === requestKey ? resolved.image : undefined);
  const ready = isUsable(shown);
  const accent = moment === "perspective_scene" ? "violet" : "amber";
  const pov = Boolean(protagonistId);
  const failed = failedKey === requestKey || shown?.status === "failed";
  const queuedForRendering = preparing && !ready && !failed;
  const automaticLoading = Boolean(queuedForRendering || (loadImage && !ready && !failed && shown?.status !== "failed"));
  const status = failed ? "failed" : retrying || automaticLoading || shown?.status === "pending" ? "loading" : ready ? "ready" : "fallback";
  const retry = async () => {
    if (!retryImage || retrying) return;
    setRetrying(true);
    setFailedKey(undefined);
    try {
      const next = await retryImage(request);
      if (next) { setResolved({ key: requestKey, image: next }); if (next.status === "failed") setFailedKey(requestKey); }
    } catch { setFailedKey(requestKey); }
    finally { setRetrying(false); }
  };

  return <figure className={`story-image story-image--${accent} story-image--${status} ${className}`.trim()} aria-describedby={statusId}>
    <div className="story-image__canvas">
      <div className="story-image__fallback" aria-hidden="true"><span className="story-image__moon" /><span className="story-image__bridge" /><span className="story-image__ember" /></div>
      {ready && <img className="story-image__asset" src={shown.imageUrl} alt={description ?? `${title}. Cinematic story image.`} onError={() => setFailedKey(requestKey)} />}
      <div className="story-image__veil" aria-hidden="true" />
      <div className="story-image__chrome"><span className="story-image__label">{MOMENT_LABEL[moment]}</span>{pov && <span className="story-image__pov">CHARACTER POV</span>}</div>
      {!ready && <div className="story-image__brief" aria-hidden="true"><span>{status === "loading" ? "SCENE IS RENDERING" : "SCENE BRIEF"}</span><b>{title}</b>{description && <p>{description}</p>}</div>}
      <div className="story-image__status" id={statusId} aria-live="polite">
        {status === "loading" && (queuedForRendering ? "This illustration is rendering in the background…" : "Loading this scene’s illustration…")}
        {status === "failed" && "A remembered illustration could not arrive. The scene is still yours."}
        {status === "fallback" && "Illustrated from the StoryVerse archive."}
      </div>
      {status === "failed" && retryImage && <button className="story-image__retry" type="button" onClick={() => void retry()} disabled={retrying}>Retry image</button>}
    </div>
    <figcaption className="story-image__caption">{title}</figcaption>
  </figure>;
}
