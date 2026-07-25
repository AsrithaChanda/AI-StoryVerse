import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { StoryBeat, StoryChapter, WorldStory } from "../api/story";
import { bootstrapStory, characterPerspective, commandStory, nextChapter } from "../api/story";
import type { World } from "../api/worlds";
import { generateSceneImage, loadSceneImage } from "../images/api";
import { prepareChapterImages } from "../images/chapter-preparation";
import type { StoryImage } from "../images/contracts";
import ChapterBgm from "./ChapterBgm";
import ChapterNarration from "./ChapterNarration";
import type { AudioPlan } from "../audio/chapter-audio";
import SceneImage from "./SceneImage";
import { buildStoryFlow } from "../story-layout";

type ChapterGeneration = { number: number; phase: "writing" | "illustrating"; completed: number; total: number };
type IllustrationProgress = Pick<ChapterGeneration, "number" | "completed" | "total">;
type PerspectiveLoading = { characterId: string; characterName: string };
const MIN_PERSPECTIVE_LOADING_MS = 450;
const wait = (milliseconds: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

export default function GeneratedWorldReader({ world, close }: { world: World; close(): void }) {
  const [story, setStory] = useState<WorldStory | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [viewNarration, setViewNarration] = useState("");
  const [viewBeats, setViewBeats] = useState<StoryBeat[]>([]);
  const [storedImages, setStoredImages] = useState<Record<string, StoryImage | null>>({});
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [chapterGeneration, setChapterGeneration] = useState<ChapterGeneration | null>(null);
  const [illustrationProgress, setIllustrationProgress] = useState<IllustrationProgress | null>(null);
  const [audioPlan, setAudioPlan] = useState<AudioPlan | null>(null);
  const [perspectiveLoading, setPerspectiveLoading] = useState<PerspectiveLoading | null>(null);
  const illustrationTask = useRef(0);

  useEffect(() => {
    let active = true;
    void bootstrapStory(world.id).then(({ story: next }) => {
      if (!active) return;
      const latest = next.chapters.at(-1);
      setStory(next);
      setStoredImages({});
      setSelectedChapterId(latest?.id ?? null);
      setViewNarration(latest?.narration ?? "");
      setViewBeats(latest?.beats ?? []);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Chapter 1 could not be generated.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [world.id]);

  const chapter = story?.chapters.find((candidate) => candidate.id === selectedChapterId) ?? story?.chapters.at(-1);
  const chapterIndex = chapter && story ? story.chapters.findIndex((candidate) => candidate.id === chapter.id) : -1;
  const isLatestChapter = Boolean(story && chapterIndex === story.chapters.length - 1);
  const moment = activeCharacter ? "perspective_scene" as const : "chapter_scene" as const;
  const readerLabel = useMemo(() => activeCharacter ? story?.characters.find((character) => character.id === activeCharacter)?.name ?? "Character" : "Narrator", [activeCharacter, story]);
  const storyFlow = useMemo(() => buildStoryFlow(viewNarration, viewBeats), [viewNarration, viewBeats]);
  const loadImage = async (request: Parameters<typeof loadSceneImage>[0]) => (await loadSceneImage(request)) ?? generateSceneImage(request);

  /** Archive navigation performs cache reads only. It must never bill the image
   * provider merely because a reader revisits a completed chapter. */
  const loadStoredChapterImages = async (target: StoryChapter) => {
    const entries = await Promise.all(target.beats.map(async (beat) => {
      try { return [beat.id, await loadSceneImage({ worldId: world.id, sceneId: beat.id, moment: "chapter_scene" })] as const; }
      catch { return [beat.id, null] as const; }
    }));
    setStoredImages((current) => ({ ...current, ...Object.fromEntries(entries) }));
  };

  const showNarratorChapter = (target: StoryChapter) => {
    setSelectedChapterId(target.id);
    setAudioPlan(null);
    setPerspectiveLoading(null);
    setActiveCharacter(null);
    setViewNarration(target.narration);
    setViewBeats(target.beats);
    setError(undefined);
    void loadStoredChapterImages(target);
  };

  const updateFromStory = (next: WorldStory) => {
    const latest = next.chapters.at(-1);
    setStory(next);
    if (latest) showNarratorChapter(latest);
  };

  const chooseCharacter = async (characterId: string) => {
    if (!story || busy || !isLatestChapter) return;
    const character = story.characters.find((candidate) => candidate.id === characterId);
    if (!character) return;
    // Keep the current/canonical view visible until the character-specific
    // narration arrives, but make the requested lens explicit immediately.
    // Existing illustrations can continue saving, but should not obscure the
    // next character transition or overwrite its progress indicator.
    illustrationTask.current += 1;
    setIllustrationProgress(null);
    setPerspectiveLoading({ characterId, characterName: character.name });
    setBusy(true); setError(undefined); setAudioPlan(null);
    try {
      // Cached perspectives can return almost instantly. Hold the transition
      // briefly so every switch communicates what is happening before content
      // changes, without delaying an actual generation request.
      const [result] = await Promise.all([characterPerspective(world.id, characterId), wait(MIN_PERSPECTIVE_LOADING_MS)]);
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
        generate: generateSceneImage,
        onImage: (beat, image) => setStoredImages((current) => ({ ...current, [beat.id]: image })),
        onProgress: (completed, total) => { if (illustrationTask.current === taskId) setIllustrationProgress({ number: currentChapter?.number ?? 0, completed, total }); },
      }).finally(() => { if (illustrationTask.current === taskId) setIllustrationProgress(null); });
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Perspective could not be generated.";
      setError(`${character.name}'s perspective could not be opened. ${detail}`);
    } finally {
      setPerspectiveLoading((current) => current?.characterId === characterId ? null : current);
      setBusy(false);
    }
  };

  const advance = async (authorCommand?: string) => {
    if (!story || busy || illustrationProgress || !isLatestChapter) return;
    setBusy(true); setError(undefined);
    const requestedNumber = (story.chapters.at(-1)?.number ?? 0) + 1;
    setChapterGeneration({ number: requestedNumber, phase: "writing", completed: 0, total: 0 });
    try {
      const result = authorCommand ? await commandStory(world.id, authorCommand) : await nextChapter(world.id);
      const next = result.story.chapters.at(-1);
      if (!next) throw new Error("The story engine returned no new chapter.");
      updateFromStory(result.story);
      setCommand("");
      const taskId = ++illustrationTask.current;
      setIllustrationProgress({ number: next.number, completed: 0, total: next.beats.length });
      void prepareChapterImages({
        worldId: world.id,
        beats: next.beats,
        generate: generateSceneImage,
        onImage: (beat, image) => setStoredImages((current) => ({ ...current, [beat.id]: image })),
        onProgress: (completed, total) => { if (illustrationTask.current === taskId) setIllustrationProgress({ number: next.number, completed, total }); },
      }).finally(() => { if (illustrationTask.current === taskId) setIllustrationProgress(null); });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The story could not continue.");
    } finally {
      setChapterGeneration(null);
      setBusy(false);
    }
  };

  const retryBootstrap = () => {
    setBusy(true); setError(undefined);
    void bootstrapStory(world.id).then(({ story: next }) => updateFromStory(next))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Chapter 1 could not be generated."))
      .finally(() => setBusy(false));
  };

  return <main className="generated-reader">
    <header className="reader-header"><button className="brand" type="button" onClick={close}><span className="mark">SV</span> WORLD ATLAS</button><span className="timeline-pill violet">{world.genre}</span></header>
    {busy && !story ? <div className="story-boot"><p className="eyebrow">STORY ENGINE</p><h1>Writing Chapter 1…</h1><p>Building a persistent cast, opening chapter, and image beats for {world.title}.</p></div>
      : error && !story ? <div className="story-boot"><h1>The chapter is waiting.</h1><p>{error}</p><button type="button" className="enter-button" onClick={retryBootstrap}>Try again</button></div>
        : chapterGeneration ? <ChapterGenerationView generation={chapterGeneration} />
          : story && chapter ? <div className="generated-grid"><section className="generated-story">
            {story.chapters.length > 1 && <nav className="chapter-archive" aria-label="Chapter history">
              <button type="button" onClick={() => showNarratorChapter(story.chapters[chapterIndex - 1])} disabled={chapterIndex <= 0}>← Previous</button>
              <span>CHAPTER {chapter.number} OF {story.chapters.length}</span>
              <button type="button" onClick={() => showNarratorChapter(story.chapters[chapterIndex + 1])} disabled={chapterIndex >= story.chapters.length - 1}>Next →</button>
            </nav>}
            <p className="eyebrow">CHAPTER {chapter.number}</p><h1>{chapter.title}</h1><div className={`perspective-banner ${activeCharacter ? "perspective-banner--character" : ""}`}><span>NOW VIEWING</span><b>{activeCharacter ? `${readerLabel}'s perspective` : "StoryVerse narrator · canonical world view"}</b><p>{activeCharacter ? `This chapter is filtered through ${readerLabel}'s memories, goals, and observations.` : "This is the omniscient, shared version of events—not any single character’s point of view."}</p>{activeCharacter && <button type="button" className="canonical-return" onClick={() => showNarratorChapter(chapter)}>Return to canonical view →</button>}</div>{perspectiveLoading && <PerspectiveLoadingNotice characterName={perspectiveLoading.characterName} />}<ChapterBgm key={`bgm-${chapter.id}-${activeCharacter ?? "canonical"}`} worldId={world.id} chapterId={chapter.id} protagonistId={activeCharacter ?? undefined} chapterText={`${chapter.title}\n${viewNarration}`} perspective={activeCharacter ? `${readerLabel}'s POV` : "Canonical world view"} onPlan={setAudioPlan} /><ChapterNarration key={`narration-${chapter.id}-${activeCharacter ?? "canonical"}`} worldId={world.id} chapterId={chapter.id} protagonistId={activeCharacter ?? undefined} plan={audioPlan} />
            {illustrationProgress?.number === chapter.number && <div className="illustration-progress" role="status" aria-live="polite"><span>ILLUSTRATING IN BACKGROUND</span><b>{illustrationProgress.completed} of {illustrationProgress.total} chapter scenes saved</b><i><em style={{ width: `${(illustrationProgress.completed / Math.max(1, illustrationProgress.total)) * 100}%` }} /></i></div>}
            <div className="chapter-flow">{storyFlow.map((item, paragraphIndex) => <Fragment key={`${paragraphIndex}-${item.paragraph.slice(0, 32)}`}><p className="scene-prose">{item.paragraph}</p>{item.beats.map((beat) => <div className="story-beat" key={beat.id}><SceneImage image={storedImages[beat.id]} worldId={world.id} sceneId={beat.id} moment={moment} protagonistId={activeCharacter ?? undefined} title={beat.caption} description={beat.description} loadImage={isLatestChapter && !illustrationProgress ? loadImage : undefined} retryImage={(request) => generateSceneImage(request, true)} /></div>)}</Fragment>)}</div>
            {isLatestChapter ? <><div className="author-command"><label htmlFor="story-command">Change the story</label><textarea id="story-command" value={command} maxLength={1000} onChange={(event) => setCommand(event.target.value)} placeholder="For example: introduce a storm that separates the allies, but keep the mentor alive." /><button type="button" disabled={busy || Boolean(illustrationProgress) || command.trim().length < 3} onClick={() => void advance(command.trim())}>Apply command →</button></div><button className="next-chapter" type="button" disabled={busy || Boolean(illustrationProgress)} onClick={() => void advance()}>{illustrationProgress ? "Illustrating chapter…" : "Generate next chapter →"}</button></> : <div className="archive-note"><span>ARCHIVED CHAPTER</span><p>This chapter and its illustrations are preserved. Return to the latest chapter to continue the world’s timeline.</p><button type="button" onClick={() => showNarratorChapter(story.chapters.at(-1)!)}>Return to latest chapter →</button></div>}
            {error && <p className="story-error" role="status">{error}</p>}
          </section><aside className="story-cast"><p className="panel-label">PERSISTENT CAST</p>{story.characters.map((character) => {
            const isLoading = character.id === perspectiveLoading?.characterId;
            const className = [character.id === activeCharacter ? "active" : "", isLoading ? "loading" : ""].filter(Boolean).join(" ");
            return <button type="button" className={className} key={character.id} disabled={busy || !isLatestChapter} aria-busy={isLoading || undefined} aria-pressed={character.id === activeCharacter} aria-label={isLoading ? `Opening ${character.name}'s perspective` : `View ${character.name}'s perspective`} onClick={() => void chooseCharacter(character.id)}><b>{character.name}</b><span>{isLoading ? "OPENING PERSPECTIVE…" : character.role}</span><small>{character.personality}</small></button>;
          })}<p className="cast-note">{isLatestChapter ? "Choose a character to see the current chapter through only their memories, goals, and observations." : "Character perspectives are available on the current chapter; this archived chapter keeps its original narration and illustrations."}</p></aside></div>
            : <div className="story-boot"><p className="eyebrow">CHAPTER 1 IS NOT READY</p><h1>This world is waiting for its first scene.</h1><p>The story engine did not receive a usable chapter yet. Retry once the model connection is available; your world data is preserved.</p><button type="button" className="enter-button" onClick={retryBootstrap} disabled={busy}>{busy ? "Writing Chapter 1…" : "Generate Chapter 1 →"}</button>{error && <p className="story-error" role="status">{error}</p>}</div>}
  </main>;
}

function ChapterGenerationView({ generation }: { generation: ChapterGeneration }) {
  const width = generation.phase === "writing" ? "12%" : `${Math.max(8, (generation.completed / Math.max(1, generation.total)) * 100)}%`;
  return <div className="chapter-generation" role="status" aria-live="polite"><p className="eyebrow">STORY ENGINE · CHAPTER {generation.number}</p><h1>{generation.phase === "writing" ? `Generating Chapter ${generation.number}…` : `Illustrating Chapter ${generation.number}…`}</h1><p>{generation.phase === "writing" ? "Writing the next turn while preserving the world, cast, and continuity." : `Preparing the complete visual sequence — scene ${generation.completed} of ${generation.total} ready.`}</p><div className="chapter-generation__meter" aria-hidden="true"><span style={{ width }} /></div><small>The chapter appears as soon as its story is ready; illustrations continue safely in the background.</small></div>;
}

function PerspectiveLoadingNotice({ characterName }: { characterName: string }) {
  return <section className="perspective-loading" role="status" aria-live="polite" aria-atomic="true">
    <div className="perspective-loading__glyph" aria-hidden="true"><i /><i /><i /></div>
    <div><span>CHARACTER LENS · LOADING</span><b>Opening {characterName}&rsquo;s perspective…</b><p>The current chapter stays readable while we gather their memories, goals, and observations.</p></div>
    <div className="perspective-loading__meter" aria-hidden="true"><i /></div>
  </section>;
}
