import { useEffect, useMemo, useState } from "react";
import {
  editStoryTrailer,
  getStoryTrailer,
  isStoryTrailerRequestError,
  requestStoryTrailer,
  type PublicStoryTrailer,
  type StoryTrailerKind,
} from "../api/story-trailer";
import "../styles/story-trailer.css";

export type StoryTrailerProps = {
  worldId: string;
  chapterId: string;
  chapterRevision: number;
  chapterCount: number;
  disabled?: boolean;
};

type TrailerError = { message: string; code?: string };
type TrailerMap<T> = Partial<Record<StoryTrailerKind, T>>;

const POLL_INTERVAL_MS = 10_000;
const VIDEO_KINDS: StoryTrailerKind[] = ["chapter", "story_so_far"];
const VIDEO_COPY: Record<StoryTrailerKind, { title: string; description: string; scope: string }> = {
  chapter: {
    title: "This chapter",
    description: "A focused film of the events and emotion in this chapter only.",
    scope: "CHAPTER VIDEO",
  },
  story_so_far: {
    title: "Story so far",
    description: "A film covering the important moments from Chapter 1 up to this chapter.",
    scope: "STORY VIDEO",
  },
};

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function isPending(trailer: PublicStoryTrailer | null | undefined): boolean {
  return trailer?.status === "queued" || trailer?.status === "in_progress";
}

function isCurrentTrailer(
  trailer: PublicStoryTrailer | null,
  worldId: string,
  chapterId: string,
  chapterRevision: number,
  kind: StoryTrailerKind,
): trailer is PublicStoryTrailer {
  return Boolean(trailer
    && trailer.worldId === worldId
    && trailer.chapterId === chapterId
    && trailer.chapterRevision === chapterRevision
    && trailer.kind === kind);
}

function friendlyFailure(code?: string): string {
  switch (code) {
    case "video_provider_unavailable":
    case "video_model_unavailable":
      return "Video generation is not available right now. Check the video provider and try again.";
    case "provider_policy":
    case "content_policy":
      return "This video direction needs a more original approach. Change the direction and try again.";
    case "video_timed_out":
      return "The video took longer than expected. You can safely try again.";
    default:
      return "The video service could not finish this film. Your story is safe, and you can try again.";
  }
}

function friendlyRequestError(error: unknown): TrailerError {
  if (isStoryTrailerRequestError(error)) {
    return { message: error.message || friendlyFailure(error.code), code: error.code };
  }
  return { message: error instanceof Error && error.message ? error.message : "The video request could not be started." };
}

function progressValue(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export default function StoryTrailer({
  worldId,
  chapterId,
  chapterRevision,
  chapterCount,
  disabled = false,
}: StoryTrailerProps) {
  const [trailers, setTrailers] = useState<TrailerMap<PublicStoryTrailer | null>>({});
  const [checked, setChecked] = useState<TrailerMap<boolean>>({});
  const [selected, setSelected] = useState<Record<StoryTrailerKind, boolean>>({
    chapter: true,
    story_so_far: false,
  });
  const [starting, setStarting] = useState<TrailerMap<boolean>>({});
  const [errors, setErrors] = useState<TrailerMap<TrailerError>>({});
  const [editKind, setEditKind] = useState<StoryTrailerKind | null>(null);
  const [editPrompts, setEditPrompts] = useState<TrailerMap<string>>({});
  const [editing, setEditing] = useState<TrailerMap<boolean>>({});

  useEffect(() => {
    const controller = new AbortController();
    for (const kind of VIDEO_KINDS) {
      void getStoryTrailer(worldId, chapterId, kind, { signal: controller.signal })
        .then(({ trailer }) => {
          if (controller.signal.aborted) return;
          setTrailers((current) => ({
            ...current,
            [kind]: isCurrentTrailer(trailer, worldId, chapterId, chapterRevision, kind) ? trailer : null,
          }));
          setErrors((current) => ({ ...current, [kind]: undefined }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return;
          setErrors((current) => ({ ...current, [kind]: friendlyRequestError(error) }));
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecked((current) => ({ ...current, [kind]: true }));
        });
    }
    return () => controller.abort();
  }, [chapterId, chapterRevision, worldId]);

  const pendingKinds = useMemo(
    () => VIDEO_KINDS.filter((kind) => isPending(trailers[kind])),
    [trailers],
  );
  const pendingIdentity = pendingKinds.map((kind) => `${kind}:${trailers[kind]?.id ?? ""}:${trailers[kind]?.status}`).join("|");

  useEffect(() => {
    if (!pendingIdentity) return;
    const kindsToPoll = pendingIdentity
      .split("|")
      .map((identity) => identity.split(":")[0])
      .filter((kind): kind is StoryTrailerKind => kind === "chapter" || kind === "story_so_far");
    const controller = new AbortController();
    let timer: number | undefined;
    let disposed = false;
    const refresh = async () => {
      await Promise.all(kindsToPoll.map(async (kind) => {
        try {
          const { trailer } = await getStoryTrailer(worldId, chapterId, kind, { signal: controller.signal });
          if (disposed || controller.signal.aborted) return;
          if (!isCurrentTrailer(trailer, worldId, chapterId, chapterRevision, kind)) return;
          setTrailers((current) => ({ ...current, [kind]: trailer }));
          setErrors((current) => ({ ...current, [kind]: undefined }));
        } catch (error) {
          if (disposed || controller.signal.aborted || isAbortError(error)) return;
          setErrors((current) => ({
            ...current,
            [kind]: { message: "We could not check this video just now. We will try again automatically." },
          }));
        }
      }));
      if (!disposed && !controller.signal.aborted) timer = window.setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    };
    timer = window.setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [chapterId, chapterRevision, pendingIdentity, worldId]);

  const startOne = async (kind: StoryTrailerKind, retry = false) => {
    if (disabled || starting[kind]) return;
    setStarting((current) => ({ ...current, [kind]: true }));
    setErrors((current) => ({ ...current, [kind]: undefined }));
    try {
      const { trailer } = await requestStoryTrailer(worldId, chapterId, kind, { retry });
      if (!isCurrentTrailer(trailer, worldId, chapterId, chapterRevision, kind)) {
        throw new Error("The video did not match the chapter currently on screen.");
      }
      setTrailers((current) => ({ ...current, [kind]: trailer }));
    } catch (error) {
      setErrors((current) => ({ ...current, [kind]: friendlyRequestError(error) }));
    } finally {
      setStarting((current) => ({ ...current, [kind]: false }));
      setChecked((current) => ({ ...current, [kind]: true }));
    }
  };

  const generateSelected = async () => {
    const kinds = VIDEO_KINDS.filter((kind) => selected[kind]);
    await Promise.all(kinds.map((kind) => startOne(kind)));
  };

  const editOne = async (kind: StoryTrailerKind) => {
    const prompt = (editPrompts[kind] ?? "").replace(/\s+/g, " ").trim();
    if (disabled || editing[kind] || prompt.length < 3 || prompt.length > 800) return;
    setEditing((current) => ({ ...current, [kind]: true }));
    setErrors((current) => ({ ...current, [kind]: undefined }));
    try {
      const { trailer } = await editStoryTrailer(worldId, chapterId, kind, prompt);
      if (!isCurrentTrailer(trailer, worldId, chapterId, chapterRevision, kind)) {
        throw new Error("The edited video did not match the chapter currently on screen.");
      }
      setTrailers((current) => ({ ...current, [kind]: trailer }));
      setEditKind(null);
    } catch (error) {
      setErrors((current) => ({ ...current, [kind]: friendlyRequestError(error) }));
    } finally {
      setEditing((current) => ({ ...current, [kind]: false }));
    }
  };

  const selectedCount = VIDEO_KINDS.filter((kind) => selected[kind]).length;
  const anyStarting = VIDEO_KINDS.some((kind) => starting[kind]);

  return <section className="story-trailer" aria-labelledby="story-trailer-heading">
    <header className="story-trailer__header">
      <div>
        <p className="story-trailer__eyebrow"><span aria-hidden="true" /> STORY FILMS</p>
        <h2 id="story-trailer-heading">Choose what you want to <em>watch.</em></h2>
      </div>
      <p className="story-trailer__scope">12 SECONDS EACH</p>
    </header>

    <div className="story-trailer__selector">
      <p>Select one or both. Each option creates and saves a separate 12-second video.</p>
      <div>
        {VIDEO_KINDS.map((kind) => <label key={kind}>
          <input
            type="checkbox"
            checked={selected[kind]}
            onChange={(event) => setSelected((current) => ({ ...current, [kind]: event.target.checked }))}
          />
          <span><b>{VIDEO_COPY[kind].title}</b><small>{VIDEO_COPY[kind].description}</small></span>
        </label>)}
      </div>
      <button
        type="button"
        onClick={() => void generateSelected()}
        disabled={disabled || anyStarting || selectedCount === 0}
      >
        {anyStarting ? "Starting selected videos…" : `Generate selected ${selectedCount === 1 ? "video" : "videos"}`}
      </button>
    </div>

    <div className="story-trailer__options">
      {VIDEO_KINDS.map((kind) => {
        const trailer = trailers[kind];
        const error = errors[kind];
        const pending = starting[kind] || editing[kind] || isPending(trailer);
        const progress = progressValue(trailer?.progress);
        const prompt = editPrompts[kind] ?? "";
        return <article className="story-trailer__option" key={kind} aria-busy={pending}>
          <header>
            <div><span>{VIDEO_COPY[kind].scope}</span><h3>{VIDEO_COPY[kind].title}</h3></div>
            <small>{kind === "chapter" ? `CHAPTER ${chapterCount}` : `CHAPTERS 1–${chapterCount}`}</small>
          </header>

          {trailer?.status === "ready" && trailer.videoUrl
            ? <>
              <video controls playsInline preload="metadata" src={trailer.videoUrl}>
                Your browser cannot play this video.
              </video>
              <footer>
                <span>SAVED TO THIS CHAPTER</span>
                <button type="button" onClick={() => setEditKind((current) => current === kind ? null : kind)} disabled={disabled}>
                  {editKind === kind ? "Cancel edit" : "Edit with prompt"}
                </button>
              </footer>
            </>
            : pending
              ? <div className="story-trailer__option-progress" role="status">
                <b>{starting[kind] || editing[kind] ? "Preparing the request…" : "Generating your video…"}</b>
                <p>You can continue reading. The video will remain saved when it is ready.</p>
                <i><em style={{ width: `${progress}%` }} /></i>
                <small>{progress > 0 ? `${progress}% complete` : "Waiting for progress"}</small>
              </div>
              : trailer?.status === "failed"
                ? <div className="story-trailer__option-error" role="alert">
                  <p>{friendlyFailure(trailer.errorCode)}</p>
                  <button type="button" onClick={() => void startOne(kind, true)} disabled={disabled}>Try again</button>
                </div>
                : <div className="story-trailer__option-empty">
                  <p>{checked[kind] ? "No saved video for this version of the chapter." : "Checking for a saved video…"}</p>
                </div>}

          {editKind === kind && trailer?.status === "ready" && <form onSubmit={(event) => {
            event.preventDefault();
            void editOne(kind);
          }}>
            <label htmlFor={`video-edit-${chapterId}-${kind}`}>Describe the changes</label>
            <textarea
              id={`video-edit-${chapterId}-${kind}`}
              value={prompt}
              onChange={(event) => setEditPrompts((current) => ({ ...current, [kind]: event.target.value }))}
              minLength={3}
              maxLength={800}
              rows={3}
              placeholder="For example: Make the ending more tense, with slower camera movement and softer music."
              required
            />
            {error && <p className="story-trailer__edit-error" role="alert">{error.message}</p>}
            <button type="submit" disabled={disabled || editing[kind] || prompt.trim().length < 3}>Generate edited video</button>
            <small>The current video stays saved. The edited video becomes the latest version when ready.</small>
          </form>}
          {error && editKind !== kind && trailer?.status !== "failed" && <p className="story-trailer__option-note" role="alert">{error.message}</p>}
        </article>;
      })}
    </div>
  </section>;
}
