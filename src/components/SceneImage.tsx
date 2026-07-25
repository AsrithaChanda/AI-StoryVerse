import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  /**
   * The controller resolves this request to a terminal image state. If a cached image is
   * still pending, the controller waits for its cache record rather than returning that
   * transient metadata to the frame. The frame aborts that wait when its request
   * changes or unmounts; the host may keep any shared server-side job alive.
   */
  loadImage?(request: SceneImageRequest, signal?: AbortSignal): Promise<StoryImage | null | undefined>;
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
type LocalResolution = { key: string; image: StoryImage | null | undefined };
type ImageLoadTask = {
  key: string;
  controller: AbortController;
  subscribers: number;
  abortScheduled: boolean;
  promise: Promise<StoryImage | null | undefined>;
};

function isUsable(image: StoryImage | null | undefined): image is UsableStoryImage {
  return Boolean(image && image.status === "ready" && image.imageUrl);
}

function isTerminal(image: StoryImage | null | undefined): boolean {
  return Boolean(image && (image.status === "ready" || image.status === "failed" || image.status === "fallback"));
}

function sceneIdFor(request: SceneImageRequest): string {
  return request.sceneId ?? `${request.moment}-${request.branchId ?? "root"}`;
}

/** Ignore a frame's old canonical metadata while a new POV/branch is mounting. */
function matchesRequest(image: StoryImage | null | undefined, request: SceneImageRequest): image is StoryImage {
  return Boolean(
    image
    && image.worldId === request.worldId
    && image.sceneId === sceneIdFor(request)
    && image.branchId === request.branchId
    && image.protagonistId === request.protagonistId,
  );
}

/**
 * A completed local request is fresher than a parent pending snapshot. Parent ready
 * metadata still wins over a non-ready local value, which protects the successful
 * image if an older request settles after a controller update.
 */
function reconcileImage(parent: StoryImage | null | undefined, local: StoryImage | null | undefined): StoryImage | null | undefined {
  if (!parent) return local;
  if (!local) return parent;
  const parentUpdatedAt = Date.parse(parent.updatedAt);
  const localUpdatedAt = Date.parse(local.updatedAt);
  const localIsAtLeastAsNew = !Number.isFinite(parentUpdatedAt) || !Number.isFinite(localUpdatedAt) || localUpdatedAt >= parentUpdatedAt;

  if (isUsable(local) && isUsable(parent)) return localIsAtLeastAsNew ? local : parent;
  if (isUsable(local)) return local;
  if (isUsable(parent)) return parent;
  if (isTerminal(local) && !isTerminal(parent)) return local;
  if (isTerminal(parent) && !isTerminal(local)) return parent;
  return localIsAtLeastAsNew ? local : parent;
}

/**
 * Stable cinematic image frame for the reader and timeline comparison.
 * It renders its CSS fallback synchronously and only replaces it after a usable URL loads.
 */
export default function SceneImage({ image, moment, worldId, sceneId, branchId, protagonistId, title, description, loadImage, preparing = false, retryImage, className = "" }: SceneImageProps) {
  const request = useMemo<SceneImageRequest>(() => ({ worldId, sceneId, branchId, moment, protagonistId }), [worldId, sceneId, branchId, moment, protagonistId]);
  const requestKey = `${worldId}:${sceneId ?? "auto"}:${branchId ?? "root"}:${moment}:${protagonistId ?? "ensemble"}`;
  const [resolved, setResolved] = useState<LocalResolution>();
  const [retryingKey, setRetryingKey] = useState<string>();
  const [failedKey, setFailedKey] = useState<string>();
  const loadImageRef = useRef(loadImage);
  const latestRequestKeyRef = useRef(requestKey);
  const resolutionVersionRef = useRef(0);
  const loadTaskRef = useRef<ImageLoadTask | undefined>(undefined);
  const statusId = useId();

  // Keep non-reactive callbacks/identity guards current without allowing a changing
  // inline callback from the host to start another request for the same frame.
  useEffect(() => {
    loadImageRef.current = loadImage;
    latestRequestKeyRef.current = requestKey;
  }, [loadImage, requestKey]);

  const parentImage = matchesRequest(image, request) ? image : undefined;
  const localImage = resolved?.key === requestKey ? resolved.image : undefined;
  const shown = reconcileImage(parentImage, localImage);
  const ready = isUsable(shown);
  const retrying = retryingKey === requestKey;
  const failed = failedKey === requestKey || shown?.status === "failed";
  const shouldLoad = Boolean(loadImage && !preparing && !retrying && !failed && !isTerminal(shown));

  useEffect(() => {
    const resolutionVersion = ++resolutionVersionRef.current;
    let active = true;
    if (!shouldLoad) return () => { active = false; };

    let task = loadTaskRef.current;
    if (!task || task.key !== requestKey || task.controller.signal.aborted) {
      // Deferring the invocation lets React StrictMode tear down its first effect
      // before any network work begins. The second effect reuses this same task.
      const controller = new AbortController();
      task = {
        key: requestKey,
        controller,
        subscribers: 0,
        abortScheduled: false,
        promise: Promise.resolve().then(() => {
          if (latestRequestKeyRef.current !== requestKey) return null;
          return loadImageRef.current?.(request, controller.signal);
        }),
      };
      loadTaskRef.current = task;
    }
    task.subscribers += 1;
    task.abortScheduled = false;
    const subscribedTask = task;

    void task.promise.then((next) => {
      if (!active || resolutionVersionRef.current !== resolutionVersion || latestRequestKeyRef.current !== requestKey) return;
      setResolved({ key: requestKey, image: next });
      if (!next || next.status === "failed") setFailedKey(requestKey);
      else setFailedKey((current) => current === requestKey ? undefined : current);
    }).catch(() => {
      if (active && resolutionVersionRef.current === resolutionVersion && latestRequestKeyRef.current === requestKey) setFailedKey(requestKey);
    });
    return () => {
      active = false;
      subscribedTask.subscribers = Math.max(0, subscribedTask.subscribers - 1);
      if (subscribedTask.subscribers > 0 || subscribedTask.controller.signal.aborted) return;
      // React StrictMode immediately tears down and reinstates effects. Deferring an
      // abort by one microtask preserves one shared request in that development cycle
      // while still cancelling a poll for a genuinely abandoned frame.
      subscribedTask.abortScheduled = true;
      queueMicrotask(() => {
        if (!subscribedTask.abortScheduled || subscribedTask.subscribers > 0 || subscribedTask.controller.signal.aborted) return;
        subscribedTask.controller.abort();
        if (loadTaskRef.current === subscribedTask) loadTaskRef.current = undefined;
      });
    };
  }, [request, requestKey, shouldLoad]);

  const accent = moment === "perspective_scene" ? "violet" : "amber";
  const pov = Boolean(protagonistId);
  const queuedForRendering = preparing && !ready && !failed;
  const automaticLoading = Boolean(queuedForRendering || (loadImage && !isTerminal(shown) && !failed && !retrying));
  const status = retrying ? "loading" : failed ? "failed" : automaticLoading || shown?.status === "pending" ? "loading" : ready ? "ready" : "fallback";
  const retry = async () => {
    if (!retryImage || retrying) return;
    const resolutionVersion = ++resolutionVersionRef.current;
    setRetryingKey(requestKey);
    setFailedKey((current) => current === requestKey ? undefined : current);
    try {
      const next = await retryImage(request);
      if (resolutionVersion !== resolutionVersionRef.current || latestRequestKeyRef.current !== requestKey) return;
      setResolved({ key: requestKey, image: next });
      if (!next || next.status === "failed") setFailedKey(requestKey);
      else setFailedKey((current) => current === requestKey ? undefined : current);
    } catch {
      if (resolutionVersion === resolutionVersionRef.current && latestRequestKeyRef.current === requestKey) setFailedKey(requestKey);
    } finally {
      if (resolutionVersion === resolutionVersionRef.current && latestRequestKeyRef.current === requestKey) setRetryingKey((current) => current === requestKey ? undefined : current);
    }
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
