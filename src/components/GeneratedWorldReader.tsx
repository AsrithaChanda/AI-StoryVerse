import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoryBeat, StoryChapter, WorldStory } from "../api/story";
import { addUpcomingDirection, bootstrapStory, deleteFutureChapters, deleteLatestChapter } from "../api/story";
import { applyChapterDirection, proposeChapterDirection, type ChapterDirectorProposal } from "../api/story-director";
import { streamCharacterPerspective, streamNextChapter, type StoryGenerationStage as StoryGenerationPhase } from "../api/story-stream";
import type { World } from "../api/worlds";
import type { TimeMachineJob } from "../api/time-machine";
import { ensureSceneImage, generateSceneImage, loadSceneImage, waitForSceneImage } from "../images/api";
import { preloadChapterImageAssets } from "../images/asset-preload";
import { prepareChapterImageBatch, prepareChapterImages, type PreparedChapterImage } from "../images/chapter-preparation";
import type { StoryImage } from "../images/contracts";
import ChapterBgm from "./ChapterBgm";
import ChapterNarration from "./ChapterNarration";
import ChapterTimelineActions from "./ChapterTimelineActions";
import AIStoryDirector from "./AIStoryDirector";
import type { AudioPlan } from "../audio/chapter-audio";
import SceneImage, { type SceneImageRequest } from "./SceneImage";
import StoryAuthorControls from "./StoryAuthorControls";
import StoryGenerationStage, { type StoryIllustrationProgress } from "./StoryGenerationStage";
import StoryTrailer from "./StoryTrailer";
import StoryTimeMachine from "./StoryTimeMachine";
import WorldCast from "./WorldCast";
import { buildStoryFlow } from "../story-layout";
import "../styles/chapter-handoff.css";

type IllustrationProgress = { number: number; completed: number; total: number };
type PerspectiveLoading = { characterId: string; characterName: string };
type GenerationPhase = StoryGenerationPhase | "illustrating";
type StreamingGeneration = {
  kind: "chapter" | "perspective" | "revision";
  number?: number;
  characterName?: string;
  narration: string;
  phase: GenerationPhase;
  illustration?: StoryIllustrationProgress;
};
const MIN_PERSPECTIVE_LOADING_MS = 450;
const wait = (milliseconds: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

/**
 * Story beat ids can be similar across canonical and character views. Keep the
 * image metadata scoped to the exact server-side cache identity so a pending
 * response from one lens can never mask a ready response from another.
 */
function storedImageKey(request: SceneImageRequest): string {
  return [
    request.worldId,
    request.sceneId ?? `${request.moment}-${request.branchId ?? "root"}`,
    request.moment,
    request.branchId ?? "root",
    request.protagonistId ?? "canonical",
  ].join(":");
}

const IMAGE_STATE_PRIORITY: Record<StoryImage["status"], number> = {
  pending: 0,
  fallback: 1,
  failed: 2,
  ready: 3,
};

/** A late pending response must never replace a durable ready image. */
function preferredImage(current: StoryImage | null | undefined, incoming: StoryImage | null | undefined): StoryImage | null | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const currentPriority = IMAGE_STATE_PRIORITY[current.status];
  const incomingPriority = IMAGE_STATE_PRIORITY[incoming.status];
  if (incomingPriority < currentPriority) return current;
  if (incomingPriority === currentPriority && incoming.updatedAt < current.updatedAt) return current;
  return incoming;
}

function saveStoredImage(current: Record<string, StoryImage | null>, key: string, incoming: StoryImage | null): Record<string, StoryImage | null> {
  const chosen = preferredImage(current[key], incoming);
  if (chosen === current[key]) return current;
  return { ...current, [key]: chosen ?? null };
}

/** Commits a fully prepared batch at once, so a new chapter never opens with a half-populated image map. */
function savePreparedImages(current: Record<string, StoryImage | null>, entries: PreparedChapterImage[]): Record<string, StoryImage | null> {
  return entries.reduce((next, entry) => saveStoredImage(next, storedImageKey(entry.request), entry.image), current);
}

export default function GeneratedWorldReader({ world, close }: { world: World; close(): void }) {
  const [story, setStory] = useState<WorldStory | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [viewNarration, setViewNarration] = useState("");
  const [viewBeats, setViewBeats] = useState<StoryBeat[]>([]);
  const [storedImages, setStoredImages] = useState<Record<string, StoryImage | null>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [streamingGeneration, setStreamingGeneration] = useState<StreamingGeneration | null>(null);
  const [illustrationProgress, setIllustrationProgress] = useState<IllustrationProgress | null>(null);
  const [audioPlan, setAudioPlan] = useState<AudioPlan | null>(null);
  const [perspectiveLoading, setPerspectiveLoading] = useState<PerspectiveLoading | null>(null);
  const [rollbackVersion, setRollbackVersion] = useState(0);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [timeMachineJob, setTimeMachineJob] = useState<TimeMachineJob | null>();
  const illustrationTask = useRef(0);

  useEffect(() => {
    let active = true;
    const taskId = ++illustrationTask.current;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setBusy(true);
      setError(undefined);
      setStory(null);
      setSelectedChapterId(null);
      setActiveCharacter(null);
      setViewNarration("");
      setViewBeats([]);
      setStoredImages({});
      setAudioPlan(null);
      setPerspectiveLoading(null);
      setIllustrationProgress(null);
      setStreamingGeneration({ kind: "chapter", number: 1, narration: "", phase: "writing" });
      try {
        const { story: next } = await bootstrapStory(world.id);
        if (!active) return;
        const latest = next.chapters.at(-1);
        if (!latest) throw new Error("Chapter 1 could not be generated.");
        const initialIllustration: StoryIllustrationProgress = { completed: 0, total: latest.beats.length };
        setStreamingGeneration((current) => current?.kind === "chapter"
          ? { ...current, number: latest.number, narration: "", phase: "illustrating", illustration: initialIllustration }
          : current);
        const batch = await prepareChapterImageBatch({
          worldId: world.id,
          beats: latest.beats,
          loadCached: loadSceneImage,
          generate: ensureSceneImage,
          onProgress: (completed, total) => {
            if (!active || illustrationTask.current !== taskId) return;
            setStreamingGeneration((current) => current?.kind === "chapter"
              ? { ...current, phase: "illustrating", narration: "", illustration: { completed, total } }
              : current);
          },
        });
        const warmedEntries = await preloadChapterImageAssets(batch.entries);
        if (!active || illustrationTask.current !== taskId) return;
        setStoredImages((current) => savePreparedImages(current, warmedEntries));
        setStory(next);
        setSelectedChapterId(latest.id);
        setViewNarration(latest.narration);
        setViewBeats(latest.beats);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Chapter 1 could not be generated.");
      } finally {
        if (active) {
          setStreamingGeneration((current) => current?.kind === "chapter" ? null : current);
          setBusy(false);
        }
      }
    });
    return () => {
      active = false;
      if (illustrationTask.current === taskId) illustrationTask.current += 1;
    };
  }, [bootstrapAttempt, world.id]);

  const chapter = story?.chapters.find((candidate) => candidate.id === selectedChapterId) ?? story?.chapters.at(-1);
  const chapterIndex = chapter && story ? story.chapters.findIndex((candidate) => candidate.id === chapter.id) : -1;
  const isLatestChapter = Boolean(story && chapterIndex === story.chapters.length - 1);
  const timeMachineRunning = timeMachineJob?.status === "queued" || timeMachineJob?.status === "running" || timeMachineJob?.status === "illustrating";
  const timeMachineTargetNumber = story?.chapters.find((candidate) => candidate.id === timeMachineJob?.targetChapterId)?.number
    ?? timeMachineJob?.targetChapterNumber;
  const timeMachineStatusPending = timeMachineJob === undefined;
  const chapterLocked = timeMachineStatusPending || Boolean(timeMachineRunning && chapter && chapter.number >= (timeMachineTargetNumber ?? Number.MAX_SAFE_INTEGER));
  const readerBusy = busy || timeMachineStatusPending || timeMachineRunning;
  const chapterArtifactKey = chapter ? `${chapter.id}-r${chapter.revision ?? 1}` : "chapter";
  const moment = activeCharacter ? "perspective_scene" as const : "chapter_scene" as const;
  const readerLabel = useMemo(() => activeCharacter ? story?.characters.find((character) => character.id === activeCharacter)?.name ?? "Character" : "Narrator", [activeCharacter, story]);
  const storyFlow = useMemo(() => buildStoryFlow(viewNarration, viewBeats), [viewNarration, viewBeats]);
  const openingCharacterName = streamingGeneration?.kind === "perspective" ? streamingGeneration.characterName : undefined;
  const showingPerspectiveDraft = streamingGeneration?.kind === "perspective" && streamingGeneration.narration.trim().length > 0;

  // A handoff is canonical story metadata. Do not make it appear inside a
  // character lens (including the short interval while that lens is opening).
  const isCanonicalReading = !activeCharacter && !perspectiveLoading && !openingCharacterName;
  /**
   * Every visible frame and background job shares this cache-first resolver.
   * It deduplicates StrictMode/rerender callers, never POSTs after observing a
   * pending record, and returns only a terminal image state.
   */
  const loadImage = useCallback((request: SceneImageRequest, signal?: AbortSignal) => ensureSceneImage(request, { signal }), []);
  const retryImage = useCallback(async (request: SceneImageRequest, signal?: AbortSignal) => {
    const queued = await generateSceneImage(request, true);
    return queued?.status === "pending" ? waitForSceneImage(request, { signal }) : queued;
  }, []);
  const loadCachedSceneImage = useCallback(async (request: SceneImageRequest) => {
    const cached = await loadSceneImage(request);
    return cached?.status === "pending" ? waitForSceneImage(request) : cached;
  }, []);

  /** Archive navigation performs cache reads only. It must never bill the image
   * provider merely because a reader revisits a completed chapter. */
  const loadStoredChapterImages = useCallback(async (target: StoryChapter) => {
    const entries = await Promise.all(target.beats.map(async (beat) => {
      const request: SceneImageRequest = { worldId: world.id, sceneId: beat.id, moment: "chapter_scene" };
      try { return [storedImageKey(request), await loadCachedSceneImage(request)] as const; }
      catch { return [storedImageKey(request), null] as const; }
    }));
    setStoredImages((current) => entries.reduce((next, [key, image]) => saveStoredImage(next, key, image), current));
  }, [loadCachedSceneImage, world.id]);

  const showNarratorChapter = (target: StoryChapter, imagesPrepared = false) => {
    setSelectedChapterId(target.id);
    setAudioPlan(null);
    setPerspectiveLoading(null);
    setActiveCharacter(null);
    setViewNarration(target.narration);
    setViewBeats(target.beats);
    setError(undefined);
    if (!imagesPrepared) void loadStoredChapterImages(target);
  };

  const updateFromStory = (next: WorldStory, imagesPrepared = false) => {
    const latest = next.chapters.at(-1);
    setStory(next);
    if (latest) showNarratorChapter(latest, imagesPrepared);
  };

  const timeMachineJobChanged = useCallback((job: TimeMachineJob | null) => {
    setTimeMachineJob(job);
    const active = job?.status === "queued" || job?.status === "running" || job?.status === "illustrating";
    if (!active || !story) return;
    const targetNumber = story.chapters.find((candidate) => candidate.id === job.targetChapterId)?.number ?? job.targetChapterNumber;
    const selected = story.chapters.find((candidate) => candidate.id === selectedChapterId) ?? story.chapters.at(-1);
    if (!selected || selected.number < targetNumber) return;
    const safeChapter = story.chapters.find((candidate) => candidate.number === targetNumber - 1);
    if (!safeChapter) return;
    setSelectedChapterId(safeChapter.id);
    setActiveCharacter(null);
    setViewNarration(safeChapter.narration);
    setViewBeats(safeChapter.beats);
    setAudioPlan(null);
  }, [selectedChapterId, story]);

  const timeMachineCompleted = useCallback(async (job: TimeMachineJob) => {
    try {
      const { story: next } = await bootstrapStory(world.id);
      const target = next.chapters.find((candidate) => candidate.id === job.targetChapterId)
        ?? next.chapters.find((candidate) => candidate.number === job.targetChapterNumber)
        ?? next.chapters.at(-1);
      illustrationTask.current += 1;
      setStoredImages({});
      setStory(next);
      setActiveCharacter(null);
      setAudioPlan(null);
      if (target) {
        setSelectedChapterId(target.id);
        setViewNarration(target.narration);
        setViewBeats(target.beats);
        void loadStoredChapterImages(target);
      }
      setTimeMachineJob(job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The rewritten timeline could not be restored.");
    }
  }, [loadStoredChapterImages, world.id]);

  const chooseCharacter = async (characterId: string) => {
    if (!story || readerBusy || !isLatestChapter) return;
    const character = story.characters.find((candidate) => candidate.id === characterId);
    if (!character) return;
    // Keep the current/canonical view visible until the character-specific
    // narration arrives, but make the requested lens explicit immediately.
    // Existing illustrations can continue saving, but should not obscure the
    // next character transition or overwrite its progress indicator.
    illustrationTask.current += 1;
    setIllustrationProgress(null);
    setPerspectiveLoading({ characterId, characterName: character.name });
    setStreamingGeneration({ kind: "perspective", characterName: character.name, narration: "", phase: "writing" });
    setBusy(true); setError(undefined); setAudioPlan(null);
    try {
      // Cached perspectives can return almost instantly. Hold the transition
      // briefly so every switch communicates what is happening before content
      // changes, without delaying an actual generation request.
      const [result] = await Promise.all([streamCharacterPerspective(world.id, characterId, {
        onPhase: (phase) => setStreamingGeneration((current) => current?.kind === "perspective" ? { ...current, phase } : current),
        onNarration: (text) => setStreamingGeneration((current) => current?.kind === "perspective" ? { ...current, narration: `${current.narration}${text}` } : current),
      }), wait(MIN_PERSPECTIVE_LOADING_MS)]);
      if (!result.perspective) throw new Error("The story engine returned no character perspective.");
      setStory(result.story);
      setActiveCharacter(characterId);
      setViewNarration(result.perspective.narration);
      setViewBeats(result.perspective.beats);
      const currentChapter = result.story.chapters.at(-1);
      const taskId = ++illustrationTask.current;
      setIllustrationProgress({ number: currentChapter?.number ?? 0, completed: 0, total: result.perspective.beats.length });
      void prepareChapterImages({
        worldId: world.id,
        beats: result.perspective.beats,
        moment: "perspective_scene",
        protagonistId: characterId,
        generate: ensureSceneImage,
        onImage: (beat, image) => {
          if (illustrationTask.current !== taskId) return;
          const request: SceneImageRequest = { worldId: world.id, sceneId: beat.id, moment: "perspective_scene", protagonistId: characterId };
          setStoredImages((current) => saveStoredImage(current, storedImageKey(request), image));
        },
        onProgress: (completed, total) => { if (illustrationTask.current === taskId) setIllustrationProgress({ number: currentChapter?.number ?? 0, completed, total }); },
      }).finally(() => { if (illustrationTask.current === taskId) setIllustrationProgress(null); });
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Perspective could not be generated.";
      setError(`${character.name}'s perspective could not be opened. ${detail}`);
    } finally {
      setStreamingGeneration((current) => current?.kind === "perspective" ? null : current);
      setPerspectiveLoading((current) => current?.characterId === characterId ? null : current);
      setBusy(false);
    }
  };

  const streamHandlers = (kind: StreamingGeneration["kind"]) => ({
    onPhase: (phase: StoryGenerationPhase) => setStreamingGeneration((current) => current?.kind === kind ? { ...current, phase } : current),
    onNarration: (text: string) => setStreamingGeneration((current) => current?.kind === kind ? { ...current, narration: `${current.narration}${text}` } : current),
  });

  /**
   * A chapter is a single cinematic unit: make every saved scene terminal
   * before changing the reader. Cache hits complete in the same small batch;
   * only absent or pending records pass through the generation resolver.
   */
  const prepareVisualBatch = async (target: StoryChapter, kind: "chapter" | "revision", taskId: number): Promise<boolean> => {
    const total = target.beats.length;
    setStreamingGeneration((current) => current?.kind === kind
      ? { ...current, phase: "illustrating", narration: "", illustration: { completed: 0, total } }
      : current);
    const batch = await prepareChapterImageBatch({
      worldId: world.id,
      beats: target.beats,
      loadCached: loadSceneImage,
      generate: ensureSceneImage,
      onProgress: (completed, progressTotal) => {
        if (illustrationTask.current !== taskId) return;
        setStreamingGeneration((current) => current?.kind === kind
          ? { ...current, phase: "illustrating", narration: "", illustration: { completed, total: progressTotal } }
          : current);
      },
    });
    const warmedEntries = await preloadChapterImageAssets(batch.entries);
    if (illustrationTask.current !== taskId) return false;
    setStoredImages((current) => savePreparedImages(current, warmedEntries));
    setStreamingGeneration((current) => current?.kind === kind
      ? {
        ...current,
        phase: "illustrating",
        narration: "",
        illustration: {
          completed: total,
          total,
          cached: total - batch.resolvedCount,
          allCached: batch.allCached,
        },
      }
      : current);
    return true;
  };

  const advance = async () => {
    if (!story || readerBusy || illustrationProgress || !isLatestChapter) return;
    setBusy(true); setError(undefined);
    const requestedNumber = (story.chapters.at(-1)?.number ?? 0) + 1;
    setStreamingGeneration({ kind: "chapter", number: requestedNumber, narration: "", phase: "writing" });
    try {
      const result = await streamNextChapter(world.id, streamHandlers("chapter"));
      const next = result.story.chapters.at(-1);
      if (!next) throw new Error("The story engine returned no new chapter.");
      const taskId = ++illustrationTask.current;
      if (!await prepareVisualBatch(next, "chapter", taskId)) return;
      updateFromStory(result.story, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The story could not continue.");
    } finally {
      setStreamingGeneration((current) => current?.kind === "chapter" ? null : current);
      setBusy(false);
    }
  };

  /**
   * The Director observes only the selected canonical chapter, makes no write,
   * and the server binds its returned proposal to this chapter/revision.
   */
  const proposeDirectorChange = async (prompt: string): Promise<ChapterDirectorProposal> => {
    if (!story || !chapter || !isLatestChapter || activeCharacter) {
      throw new Error("Return to the current canonical chapter before asking the AI Story Director for a preview.");
    }
    const result = await proposeChapterDirection(world.id, chapter.id, prompt);
    return result.proposal;
  };

  /** Apply an already reviewed proposal. The Director API revalidates its base
   * revision, then this reader uses the normal atomic visual-preparation path
   * so stale illustrations and POVs cannot flash into the replacement. */
  const applyDirectorChange = async (proposal: ChapterDirectorProposal): Promise<void> => {
    if (!story || !chapter || !isLatestChapter || activeCharacter) {
      throw new Error("Return to the current canonical chapter before applying a Director preview.");
    }
    const revision = chapter.revision ?? 1;
    if (proposal.chapterId !== chapter.id || proposal.baseRevision !== revision) {
      throw new Error("This Director preview belongs to an earlier version of the chapter. Preview it again.");
    }
    illustrationTask.current += 1;
    setIllustrationProgress(null);
    setBusy(true); setError(undefined); setAudioPlan(null);
    setStreamingGeneration({ kind: "revision", number: chapter.number, narration: "", phase: "validating" });
    try {
      const result = await applyChapterDirection(world.id, chapter.id, proposal);
      if (!result.chapter || result.chapter.id !== chapter.id) {
        throw new Error("The AI Story Director did not return the revised current chapter.");
      }
      // The Director assigns a new revision and beat namespace. Clear old
      // in-memory art before the cinematic reader reveals the new chapter.
      setStoredImages({});
      const taskId = ++illustrationTask.current;
      if (!await prepareVisualBatch(result.chapter, "revision", taskId)) return;
      setStory(result.story);
      showNarratorChapter(result.chapter, true);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "The Director proposal could not be applied.";
      setError(detail);
      throw reason instanceof Error ? reason : new Error(detail);
    } finally {
      setStreamingGeneration((current) => current?.kind === "revision" ? null : current);
      setBusy(false);
    }
  };

  const addDirection = async (direction: string) => {
    if (!story || readerBusy || !isLatestChapter) return;
    setBusy(true); setError(undefined);
    try {
      const result = await addUpcomingDirection(world.id, direction);
      setStory(result.story);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The upcoming direction could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * A destructive timeline change has to invalidate the reader's transient
   * point of view and any in-flight illustration callbacks. The server owns
   * the atomic persistence rollback; the reader then opens the chapter it
   * explicitly reports as still surviving.
   */
  const applyRollback = (next: WorldStory, survivingChapter: StoryChapter) => {
    illustrationTask.current += 1;
    setIllustrationProgress(null);
    setStoredImages({});
    setStory(next);
    showNarratorChapter(survivingChapter);
  };

  const removeLatestChapter = async () => {
    if (!story || !chapter || !isLatestChapter || chapterIndex <= 0 || readerBusy || illustrationProgress) return;
    setBusy(true); setError(undefined); setAudioPlan(null);
    try {
      const result = await deleteLatestChapter(world.id, chapter.id);
      applyRollback(result.story, result.chapter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This chapter could not be deleted. The timeline was left unchanged.");
    } finally {
      setBusy(false);
      setRollbackVersion((version) => version + 1);
    }
  };

  const removeFutureChapters = async () => {
    if (!story || !chapter || chapterIndex < 0 || chapterIndex >= story.chapters.length - 1 || readerBusy || illustrationProgress) return;
    setBusy(true); setError(undefined); setAudioPlan(null);
    try {
      const result = await deleteFutureChapters(world.id, chapter.id);
      applyRollback(result.story, result.chapter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The future chapters could not be deleted. The timeline was left unchanged.");
    } finally {
      setBusy(false);
      setRollbackVersion((version) => version + 1);
    }
  };

  const retryBootstrap = () => {
    setError(undefined);
    setBootstrapAttempt((attempt) => attempt + 1);
  };

  return <main className="generated-reader">
    <header className="reader-header"><button className="brand" type="button" onClick={close}><span className="mark">SV</span> WORLD ATLAS</button><span className="timeline-pill violet">{world.genre}</span></header>
    {error && !story ? <div className="story-boot"><h1>The chapter is waiting.</h1><p>{error}</p><button type="button" className="enter-button" onClick={retryBootstrap}>Try again</button></div>
      : streamingGeneration?.kind === "chapter" || streamingGeneration?.kind === "revision" ? <StoryGenerationStage kind={streamingGeneration.kind} number={streamingGeneration.number} narration={streamingGeneration.narration} phase={streamingGeneration.phase} illustration={streamingGeneration.illustration} />
        : busy && !story ? <div className="story-boot"><p className="eyebrow">STORY ENGINE</p><h1>Opening Chapter 1…</h1><p>Restoring the saved world, chapter, and visual sequence for {world.title}.</p></div>
          : story && chapter ? <div className="generated-grid"><section className="generated-story">
            <StoryTimeMachine
              worldId={world.id}
              chapters={story.chapters}
              disabled={busy || Boolean(illustrationProgress)}
              onJobChange={timeMachineJobChanged}
              onCompleted={timeMachineCompleted}
            />
            {chapterLocked ? <div className="timeline-locked" role="status">
              <p>{timeMachineStatusPending ? "STORY TIME MACHINE · CHECKING TIMELINE" : `STORY TIME MACHINE · CHAPTER ${timeMachineTargetNumber} ONWARDS`}</p>
              <h2>{timeMachineStatusPending ? "Restoring the saved timeline status…" : "This part of the timeline is being rewritten."}</h2>
              <small>{timeMachineStatusPending ? "Your chapter will open after the current world status is confirmed." : "You can read the earlier chapters while the new future is generated and illustrated."}</small>
            </div> : <>
            {story.chapters.length > 1 && <nav className="chapter-archive" aria-label="Chapter history">
              <button type="button" onClick={() => showNarratorChapter(story.chapters[chapterIndex - 1])} disabled={chapterIndex <= 0}>← Previous</button>
              <span>CHAPTER {chapter.number} OF {story.chapters.length}</span>
              <button type="button" onClick={() => showNarratorChapter(story.chapters[chapterIndex + 1])} disabled={chapterIndex >= story.chapters.length - 1 || Boolean(timeMachineRunning && story.chapters[chapterIndex + 1]?.number >= (timeMachineTargetNumber ?? Number.MAX_SAFE_INTEGER))}>Next →</button>
            </nav>}
            {/* A rollback changes the selected timeline. Remount the action
              surface once the request settles so a completed confirmation
              cannot remain open for a new chapter or obscure a server error. */}
            <ChapterTimelineActions
              key={`${chapter.id}-${story.chapters.length}-${rollbackVersion}`}
              selectedChapterNumber={chapter.number}
              isLatest={isLatestChapter}
              hasPreviousChapter={chapterIndex > 0}
              hasFutureChapters={chapterIndex >= 0 && chapterIndex < story.chapters.length - 1}
              busy={readerBusy || Boolean(illustrationProgress)}
              onDeleteCurrent={() => void removeLatestChapter()}
              onDeleteFuture={() => void removeFutureChapters()}
            />
            <p className="eyebrow">CHAPTER {chapter.number}</p>
            <h1>{chapter.title}</h1>
            <div className={`perspective-banner ${activeCharacter || openingCharacterName ? "perspective-banner--character" : ""}`}>
              <span>NOW VIEWING</span>
              <b>{activeCharacter ? `${readerLabel}'s perspective` : openingCharacterName ? `Opening ${openingCharacterName}'s perspective…` : "StoryVerse narrator · canonical world view"}</b>
              <p>{activeCharacter ? `This chapter is filtered through ${readerLabel}'s memories, goals, and observations.` : openingCharacterName ? `The saved canonical chapter remains unchanged while this lens is written from ${openingCharacterName}'s memories, goals, and observations.` : "This is the omniscient, shared version of events—not any single character’s point of view."}</p>
              {activeCharacter && <button type="button" className="canonical-return" onClick={() => showNarratorChapter(chapter)}>Return to canonical view →</button>}
            </div>
            {perspectiveLoading && <PerspectiveLoadingNotice characterName={perspectiveLoading.characterName} />}
            {showingPerspectiveDraft && streamingGeneration ? <StoryGenerationStage kind="perspective" characterName={streamingGeneration.characterName} narration={streamingGeneration.narration} phase={streamingGeneration.phase} illustration={streamingGeneration.illustration} /> : <>
              <ChapterBgm key={`bgm-${chapterArtifactKey}-${activeCharacter ?? "canonical"}`} worldId={world.id} chapterId={chapter.id} protagonistId={activeCharacter ?? undefined} chapterText={`${chapter.title}\n${viewNarration}`} onPlan={setAudioPlan} />
              <ChapterNarration key={`narration-${chapterArtifactKey}-${activeCharacter ?? "canonical"}`} worldId={world.id} chapterId={chapter.id} protagonistId={activeCharacter ?? undefined} plan={audioPlan} />
              {illustrationProgress?.number === chapter.number && <div className="illustration-progress" role="status" aria-live="polite"><span>ILLUSTRATING IN BACKGROUND</span><b>{illustrationProgress.completed} of {illustrationProgress.total} chapter scenes saved</b><i><em style={{ width: `${(illustrationProgress.completed / Math.max(1, illustrationProgress.total)) * 100}%` }} /></i></div>}
              <div className="chapter-flow">{storyFlow.map((item, paragraphIndex) => <Fragment key={`${paragraphIndex}-${item.paragraph.slice(0, 32)}`}>
                <p className="scene-prose">{item.paragraph}</p>
                {item.beats.map((beat) => {
                  const imageRequest: SceneImageRequest = { worldId: world.id, sceneId: beat.id, moment, protagonistId: activeCharacter ?? undefined };
                  const imageKey = storedImageKey(imageRequest);
                  return <div className="story-beat" key={imageKey}>
                    <SceneImage
                      image={storedImages[imageKey]}
                      worldId={world.id}
                      sceneId={beat.id}
                      moment={moment}
                      protagonistId={activeCharacter ?? undefined}
                      title={beat.caption}
                      description={beat.description}
                      loadImage={isLatestChapter && !illustrationProgress ? loadImage : undefined}
                      preparing={Boolean(illustrationProgress)}
                      retryImage={retryImage}
                    />
                  </div>;
                })}
              </Fragment>)}</div>
              {isCanonicalReading && chapter.transition && <ChapterTransitionHandoff chapterNumber={chapter.number} transition={chapter.transition} />}
              {isLatestChapter && !activeCharacter && <AIStoryDirector
                key={`${chapter.id}-r${chapter.revision ?? 1}`}
                currentChapter={chapter}
                busy={readerBusy || Boolean(illustrationProgress)}
                onPropose={proposeDirectorChange}
                onApply={applyDirectorChange}
              />}
              {isCanonicalReading && <StoryTrailer
                key={`${world.id}-${chapterArtifactKey}-${story.chapters.length}`}
                worldId={world.id}
                chapterId={chapter.id}
                chapterRevision={chapter.revision ?? 1}
                chapterCount={chapterIndex + 1}
                disabled={readerBusy || Boolean(illustrationProgress)}
              />}
            </>}
            {isLatestChapter ? <StoryAuthorControls upcomingDirections={story.upcomingDirections ?? []} busy={readerBusy || Boolean(illustrationProgress)} onAddDirection={(direction) => void addDirection(direction)} onGenerateNext={() => void advance()} /> : <div className="archive-note"><span>ARCHIVED CHAPTER</span><p>This chapter and its illustrations are preserved. Return to the latest chapter to continue the world’s timeline.</p><button type="button" onClick={() => showNarratorChapter(story.chapters.at(-1)!)}>Return to latest chapter →</button></div>}
            </>}
            {error && <p className="story-error" role="status">{error}</p>}
          </section><WorldCast
            characters={story.characters}
            activeCharacterId={activeCharacter}
            loadingCharacterId={perspectiveLoading?.characterId}
            disabled={readerBusy || !isLatestChapter}
            onSelect={(characterId) => void chooseCharacter(characterId)}
          /></div>
            : <div className="story-boot"><p className="eyebrow">CHAPTER 1 IS NOT READY</p><h1>This world is waiting for its first scene.</h1><p>The story engine did not receive a usable chapter yet. Retry once the model connection is available; your world data is preserved.</p><button type="button" className="enter-button" onClick={retryBootstrap} disabled={busy}>{busy ? "Writing Chapter 1…" : "Generate Chapter 1 →"}</button>{error && <p className="story-error" role="status">{error}</p>}</div>}
  </main>;
}

function PerspectiveLoadingNotice({ characterName }: { characterName: string }) {
  return <section className="perspective-loading" role="status" aria-live="polite" aria-atomic="true">
    <div className="perspective-loading__glyph" aria-hidden="true"><i /><i /><i /></div>
    <div><span>CHARACTER LENS · LOADING</span><b>Opening {characterName}&rsquo;s perspective…</b><p>The canonical chapter stays intact while we gather their memories, goals, and observations.</p></div>
    <div className="perspective-loading__meter" aria-hidden="true"><i /></div>
  </section>;
}

/**
 * A low-weight closing beat between the finished chapter and author controls.
 * It never repeats chapter prose or creates a new scene; it simply makes the
 * resolved present and the next narrative thread legible to the reader.
 */
function ChapterTransitionHandoff({ chapterNumber, transition }: { chapterNumber: number; transition: NonNullable<StoryChapter["transition"]> }) {
  const carryForward = transition.carryForward.filter((thread) => thread.trim().length > 0);

  return <footer className="chapter-handoff" aria-label={`Chapter ${chapterNumber} closing handoff`}>
    <div className="chapter-handoff__line" aria-hidden="true"><i /><span /></div>
    <div className="chapter-handoff__resolved">
      <p>CHAPTER {String(chapterNumber).padStart(2, "0")} · CLOSING BEAT</p>
      <h2>{transition.resolvedBeat}</h2>
    </div>
    {transition.closingImage.trim() && <p className="chapter-handoff__frame"><span>CLOSING SHOT</span>{transition.closingImage}</p>}
    <div className="chapter-handoff__hook">
      <span>THE THREAD AHEAD</span>
      <p>{transition.nextChapterHook}</p>
    </div>
    {carryForward.length > 0 && <div className="chapter-handoff__carry-forward">
      <span>CARRY FORWARD</span>
      <ul>{carryForward.map((thread, index) => <li key={`${index}-${thread}`}>{thread}</li>)}</ul>
    </div>}
  </footer>;
}
