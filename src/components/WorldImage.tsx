import { useEffect, useId, useMemo, useState } from "react";
import type { StoryImage } from "../images/contracts";
import "../styles/images.css";

export type WorldCoverRequest = { worldId: string };

export type WorldImageProps = {
  image?: StoryImage | null;
  worldId: string;
  title: string;
  genre?: string;
  description?: string;
  loadImage?(request: WorldCoverRequest): Promise<StoryImage | null | undefined>;
  retryImage?(request: WorldCoverRequest): Promise<StoryImage | null | undefined>;
  compact?: boolean;
  className?: string;
};

type UsableStoryImage = StoryImage & { status: "ready"; imageUrl: string };

function isUsable(image: StoryImage | null | undefined): image is UsableStoryImage {
  return Boolean(image && image.status === "ready" && image.imageUrl);
}

/** Provider-neutral persistent-world cover with an instant art-directed fallback. */
export default function WorldImage({ image, worldId, title, genre, description, loadImage, retryImage, compact = false, className = "" }: WorldImageProps) {
  const request = useMemo<WorldCoverRequest>(() => ({ worldId }), [worldId]);
  const [resolved, setResolved] = useState<{ key: string; image: StoryImage | null | undefined }>();
  const [retrying, setRetrying] = useState(false);
  const [failedKey, setFailedKey] = useState<string>();
  const statusId = useId();

  useEffect(() => {
    let active = true;
    if (!loadImage || isUsable(image) || image?.status === "failed") return () => { active = false; };
    void loadImage(request).then((next) => { if (active && next) { setResolved({ key: worldId, image: next }); if (next.status === "failed") setFailedKey(worldId); } else if (active) setFailedKey(worldId); }).catch(() => { if (active) setFailedKey(worldId); });
    return () => { active = false; };
  }, [image, loadImage, request, worldId]);

  const shown = image ?? (resolved?.key === worldId ? resolved.image : undefined);
  const ready = isUsable(shown);
  const failed = failedKey === worldId || shown?.status === "failed";
  const automaticLoading = Boolean(loadImage && !ready && !failed && shown?.status !== "failed");
  const status = failed ? "failed" : retrying || automaticLoading || shown?.status === "pending" ? "loading" : ready ? "ready" : "fallback";
  const retry = async () => {
    if (!retryImage || retrying) return;
    setRetrying(true); setFailedKey(undefined);
    try { const next = await retryImage(request); if (next) { setResolved({ key: worldId, image: next }); if (next.status === "failed") setFailedKey(worldId); } } catch { setFailedKey(worldId); } finally { setRetrying(false); }
  };
  return <figure className={`world-image world-image--${status} ${compact ? "world-image--compact" : ""} ${className}`.trim()} aria-describedby={statusId}>
    <div className="world-image__canvas">
      <div className="world-image__fallback" aria-hidden="true"><span /><span /><span /></div>
      {ready && <img className="world-image__asset" src={shown.imageUrl} alt={description ?? `${title}, a ${genre ?? "story"} world.`} onError={() => setFailedKey(worldId)} />}
      <div className="world-image__shade" aria-hidden="true" />
      <div className="world-image__chrome"><span>WORLD COVER</span>{genre && <b>{genre}</b>}</div>
      <div className="world-image__status" id={statusId} aria-live="polite">{status === "loading" ? "Imagining this world…" : status === "failed" ? "Cover art unavailable — this world is ready to explore." : ""}</div>
      {status === "failed" && retryImage && <button type="button" className="world-image__retry" onClick={() => void retry()} disabled={retrying}>Retry cover</button>}
    </div>
  </figure>;
}
