import { useEffect, useMemo, useRef, useState } from "react";
import {
  getStoryTrailer,
  isStoryTrailerRequestError,
  requestStoryTrailer,
  type PublicStoryTrailer,
} from "../api/story-trailer";
import "../styles/story-trailer.css";

export type StoryTrailerProps = {
  worldId: string;
  chapterId: string;
  chapterRevision: number;
  chapterCount: number;
  /** Keeps the control visible but prevents a render while another story state owns the reader. */
  disabled?: boolean;
};

type TrailerError = { message: string; code?: string };

const POLL_INTERVAL_MS = 10_000;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function isPending(trailer: PublicStoryTrailer | null): boolean {
  return trailer?.status === "queued" || trailer?.status === "in_progress";
}

function isCurrentTrailer(
  trailer: PublicStoryTrailer | null,
  worldId: string,
  chapterId: string,
  chapterRevision: number,
): trailer is PublicStoryTrailer {
  return Boolean(trailer
    && trailer.worldId === worldId
    && trailer.chapterId === chapterId
    && trailer.chapterRevision === chapterRevision);
}

function clampedProgress(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function chapterRange(count: number): string {
  if (count <= 1) return "CHAPTER 01";
  return `CHAPTERS 01–${String(count).padStart(2, "0")}`;
}

function friendlyFailure(code?: string): string {
  switch (code) {
    case "video_provider_unavailable":
    case "video_model_unavailable":
      return "Video rendering is not available for this world right now. Enable a video-capable provider, then try again.";
    case "provider_policy":
    case "content_policy":
      return "This trailer direction needs a more original, world-specific take. Adjust the world direction and try again.";
    case "video_timed_out":
      return "The render took longer than expected and did not finish. You can safely try another take.";
    default:
      return "The video service could not finish this trailer. Your story is unchanged—try another take when ready.";
  }
}

function friendlyRequestError(error: unknown): TrailerError {
  if (isStoryTrailerRequestError(error)) {
    if (error.code === "video_provider_unavailable" || error.code === "video_model_unavailable") {
      return { message: friendlyFailure(error.code), code: error.code };
    }
    return { message: error.message || friendlyFailure(error.code), code: error.code };
  }
  return { message: error instanceof Error && error.message ? error.message : "The trailer request could not be started." };
}

/**
 * An intentionally independent, non-blocking UI around an asynchronous video
 * render. Its polling uses the durable server record, so leaving the reader or
 * refreshing never abandons a completed trailer.
 */
export default function StoryTrailer({
  worldId,
  chapterId,
  chapterRevision,
  chapterCount,
  disabled = false,
}: StoryTrailerProps) {
  const [trailer, setTrailer] = useState<PublicStoryTrailer | null>(null);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ key: string; error: TrailerError } | null>(null);
  const requestVersion = useRef(0);
  const currentKey = `${worldId}:${chapterId}:${chapterRevision}`;
  const currentTrailer = useMemo(
    () => isCurrentTrailer(trailer, worldId, chapterId, chapterRevision) ? trailer : null,
    [chapterId, chapterRevision, trailer, worldId],
  );
  const checking = checkedKey !== currentKey;
  const starting = startingKey === currentKey;
  const currentRequestError = requestError?.key === currentKey ? requestError.error : null;
  const rendering = starting || isPending(currentTrailer);
  const progress = clampedProgress(currentTrailer?.progress);

  // Read once when the displayed final chapter changes. Bumping the version
  // means an earlier world's request can never replace a later world's state.
  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;

    void getStoryTrailer(worldId, { signal: controller.signal })
      .then(({ trailer: next }) => {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        setTrailer(isCurrentTrailer(next, worldId, chapterId, chapterRevision) ? next : null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error) || requestVersion.current !== version) return;
        setRequestError({ key: currentKey, error: friendlyRequestError(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted && requestVersion.current === version) setCheckedKey(currentKey);
      });

    return () => controller.abort();
  }, [chapterId, chapterRevision, currentKey, worldId]);

  // Jobs are owned by the server. A ten-second refresh is deliberate: Sora
  // jobs often take minutes, and readers should not need to hold this page open
  // or hammer the provider while they wait.
  useEffect(() => {
    if (!currentTrailer || !isPending(currentTrailer)) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let disposed = false;
    const expectedTrailerId = currentTrailer.id;

    const refresh = async () => {
      try {
        const { trailer: next } = await getStoryTrailer(worldId, { signal: controller.signal });
        if (disposed || controller.signal.aborted) return;
        if (!isCurrentTrailer(next, worldId, chapterId, chapterRevision)) {
          setTrailer(null);
          return;
        }
        if (expectedTrailerId && next.id && next.id !== expectedTrailerId) return;
        setTrailer(next);
        setRequestError(null);
      } catch (error) {
        if (disposed || controller.signal.aborted || isAbortError(error)) return;
        // Keep the durable queued record visible; a temporary cache/network
        // miss should never look like a failed provider render.
        setRequestError({
          key: currentKey,
          error: { message: "We could not check the render just now. We’ll keep trying automatically." },
        });
      } finally {
        if (!disposed && !controller.signal.aborted) timer = window.setTimeout(() => void refresh(), POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [chapterId, chapterRevision, currentKey, currentTrailer, worldId]);

  const startTrailer = async (retry = false) => {
    if (disabled || starting) return;
    const version = ++requestVersion.current;
    setStartingKey(currentKey);
    setRequestError(null);
    try {
      const { trailer: next } = await requestStoryTrailer(worldId, { retry });
      if (requestVersion.current !== version) return;
      if (!isCurrentTrailer(next, worldId, chapterId, chapterRevision)) {
        throw new Error("The trailer request did not match the chapter currently on screen.");
      }
      setTrailer(next);
    } catch (error) {
      if (requestVersion.current === version) setRequestError({ key: currentKey, error: friendlyRequestError(error) });
    } finally {
      if (requestVersion.current === version) {
        setCheckedKey(currentKey);
        setStartingKey((key) => key === currentKey ? null : key);
      }
    }
  };

  const failure = currentTrailer?.status === "failed"
    ? { message: friendlyFailure(currentTrailer.errorCode), code: currentTrailer.errorCode }
    : currentRequestError;
  const statusLabel = starting
    ? "Preparing a trailer request"
    : currentTrailer?.status === "queued"
      ? "Trailer request queued"
      : currentTrailer?.status === "in_progress"
        ? "Rendering your trailer"
        : "";

  return <section className="story-trailer" aria-labelledby="story-trailer-heading" aria-busy={rendering}>
    <header className="story-trailer__header">
      <div>
        <p className="story-trailer__eyebrow"><span aria-hidden="true" /> STORY TRAILER</p>
        <h2 id="story-trailer-heading">A glimpse of the <em>world so far.</em></h2>
      </div>
      <p className="story-trailer__scope">{chapterRange(chapterCount)}</p>
    </header>

    {currentTrailer?.status === "ready" && currentTrailer.videoUrl
      ? <div className="story-trailer__ready">
        <video
          className="story-trailer__video"
          controls
          playsInline
          preload="metadata"
          src={currentTrailer.videoUrl}
          aria-label={`Story trailer through chapter ${chapterCount}`}
        >
          Your browser cannot play this story trailer.
        </video>
        <div className="story-trailer__ready-footer">
          <p><span aria-hidden="true">✦</span> A cinematic glimpse through Chapter {chapterCount}.</p>
          <small>SAVED TO THIS WORLD</small>
        </div>
      </div>
      : rendering
        ? <div className="story-trailer__rendering" role="status" aria-live="polite">
          <div className="story-trailer__rendering-mark" aria-hidden="true"><i /><i /><i /></div>
          <div className="story-trailer__rendering-copy">
            <p>{statusLabel}</p>
            <b>{currentTrailer?.status === "queued" ? "Your story is in the render queue." : "We’re composing a cinematic glimpse from your world."}</b>
            <small>You can keep reading—this can take a few minutes.</small>
          </div>
          <div
            className={`story-trailer__progress${progress === null ? " story-trailer__progress--indeterminate" : ""}`}
            role="progressbar"
            aria-label="Story trailer rendering progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
          >
            <i style={progress === null ? undefined : { width: `${progress}%` }} />
          </div>
          <p className="story-trailer__progress-label">{progress === null ? "Render status will update here." : `${progress}% rendered`}</p>
          {currentRequestError && <p className="story-trailer__check-note">{currentRequestError.message}</p>}
        </div>
        : failure
          ? <div className="story-trailer__failure" role="alert">
            <span className="story-trailer__failure-mark" aria-hidden="true">!</span>
            <div>
              <p>THE TRAILER NEEDS ANOTHER TAKE</p>
              <b>{failure.message}</b>
            </div>
            <button type="button" onClick={() => void startTrailer(true)} disabled={disabled || checking}>
              Try again <span aria-hidden="true">→</span>
            </button>
          </div>
          : <div className="story-trailer__idle">
            <div>
              <p className="story-trailer__idle-label">ON-DEMAND CINEMATIC RECAP</p>
              <p>Generate an approximately eight-second, original-world trailer shaped by the turning points from Chapters 1–{chapterCount}.</p>
              {checking && <small role="status" aria-live="polite">Checking for a saved trailer…</small>}
              {disabled && <small>Return to the canonical final chapter to create a trailer.</small>}
            </div>
            <button type="button" onClick={() => void startTrailer()} disabled={disabled || starting}>
              Generate story trailer <span aria-hidden="true">→</span>
            </button>
          </div>}
  </section>;
}
