import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CreateWorldInput, World } from "../api/worlds";
import WorldImage, { type WorldImageProps } from "./WorldImage";
import GeneratedWorldReader from "./GeneratedWorldReader";
import "../styles/storyverse.css";

type Props = {
  worlds?: readonly World[];
  worldsLoading?: boolean;
  worldError?: string;
  createWorld?(input: CreateWorldInput): Promise<void>;
  selectWorld?(world: World): void;
  selectedWorld?: World | null;
  closeWorld?(): void;
  loadWorldCover?: WorldImageProps["loadImage"];
  retryWorldCover?: WorldImageProps["retryImage"];
};

const capabilityCards = [
  {
    index: "01",
    title: "Create a living universe",
    detail: "Start with a title, genre, premise, and creative direction. StoryVerse creates and saves the opening chapter, cast, and visual world language.",
    accent: "amber",
  },
  {
    index: "02",
    title: "Follow every point of view",
    detail: "Open the same chapter through a character’s memory, goals, and observations. Their perspective stays distinct from the canonical world view.",
    accent: "violet",
  },
  {
    index: "03",
    title: "Direct what happens next",
    detail: "Use an author command to introduce a change, then generate the next chapter while carrying the saved world and cast forward.",
    accent: "blue",
  },
] as const;

const productionFeatures = [
  ["Cinematic sequence", "A chapter is presented as a paced sequence of story beats with saved scene artwork."],
  ["Voice and score", "Narration reads the displayed perspective while chapter-specific background music supports the emotional beat."],
  ["Persistent archive", "Created worlds, chapters, perspectives, commands, and generated assets remain available when you return."],
] as const;

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved world";
  return `Created ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

export default function StoryExperience({
  worlds = [],
  worldsLoading = false,
  worldError,
  createWorld,
  selectWorld,
  selectedWorld,
  closeWorld,
  loadWorldCover,
  retryWorldCover,
}: Props) {
  const [creatorOpen, setCreatorOpen] = useState(false);
  const creatorTrigger = useRef<HTMLButtonElement | null>(null);
  const createdWorlds = worlds;

  const openCreator = (trigger: HTMLButtonElement) => {
    if (!createWorld) return;
    creatorTrigger.current = trigger;
    setCreatorOpen(true);
  };

  const closeCreator = () => {
    setCreatorOpen(false);
    window.setTimeout(() => creatorTrigger.current?.focus(), 0);
  };

  const exploreWorlds = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.getElementById("world-atlas")?.scrollIntoView({ behavior, block: "start" });
  };

  if (selectedWorld) return <GeneratedWorldReader world={selectedWorld} close={() => closeWorld?.()} />;

  return <main className="product-home">
    <div className="product-home__grain" aria-hidden="true" />
    <header className="product-home__header">
      <button className="product-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="StoryVerse home">
        <span className="mark">SV</span>
        <span>STORYVERSE</span>
      </button>
      <nav className="product-home__nav" aria-label="Primary navigation">
        <button type="button" onClick={() => document.getElementById("capabilities")?.scrollIntoView({ behavior: "smooth", block: "start" })}>How it works</button>
        <button type="button" onClick={exploreWorlds}>World atlas</button>
      </nav>
      <button className="product-home__create product-home__create--nav" type="button" disabled={!createWorld} onClick={(event) => openCreator(event.currentTarget)}>Create a world <span aria-hidden="true">↗</span></button>
    </header>

    <section className="product-hero" aria-labelledby="product-home-title">
      <div className="product-hero__copy">
        <p className="product-kicker"><span /> AI-NATIVE STORY STUDIO</p>
        <h1 id="product-home-title">Build worlds<br />that <em>remember.</em></h1>
        <p className="product-hero__lede">StoryVerse turns a creative brief into a cinematic, persistent story universe—then lets readers experience each chapter through the people living inside it.</p>
        <div className="product-hero__actions">
          <button className="product-home__create" type="button" disabled={!createWorld} onClick={(event) => openCreator(event.currentTarget)}>Create your world <span aria-hidden="true">→</span></button>
          <button className="product-home__explore" type="button" onClick={exploreWorlds}>Explore worlds <span aria-hidden="true">↓</span></button>
        </div>
        <p className="product-hero__note">No templates. Your premise, your direction, your continuity.</p>
      </div>
      <div className="story-system" aria-label="StoryVerse turns a world brief into an evolving, multi-perspective story">
        <div className="story-system__halo" aria-hidden="true" />
        <p className="story-system__label">THE STORY SYSTEM</p>
        <ol className="story-system__flow">
          <li><span>01</span><div><b>World brief</b><small>Title, genre, premise, direction</small></div></li>
          <li><span>02</span><div><b>Persistent cast</b><small>Memory, beliefs, relationships</small></div></li>
          <li><span>03</span><div><b>Cinematic chapters</b><small>Scenes, perspectives, narration</small></div></li>
        </ol>
        <div className="story-system__signal" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <p className="story-system__footer">A single world state holds every chapter together.</p>
      </div>
    </section>

    <section className="capabilities-section" id="capabilities" aria-labelledby="capabilities-title">
      <div className="section-heading">
        <p className="product-kicker"><span /> BUILT FOR EVOLVING FICTION</p>
        <h2 id="capabilities-title">A world is more than<br /><em>its first chapter.</em></h2>
        <p>StoryVerse is designed for long-running stories where commands, character knowledge, and visual moments carry forward instead of starting over.</p>
      </div>
      <div className="capability-grid">
        {capabilityCards.map((card) => <article className={`capability-card capability-card--${card.accent}`} key={card.index}>
          <span className="capability-card__index">{card.index}</span>
          <h3>{card.title}</h3>
          <p>{card.detail}</p>
          <i aria-hidden="true" />
        </article>)}
      </div>
    </section>

    <section className="production-section" aria-labelledby="production-title">
      <div className="production-section__intro">
        <p className="product-kicker"><span /> THE READER EXPERIENCE</p>
        <h2 id="production-title">Made to be read,<br />seen, and <em>heard.</em></h2>
      </div>
      <div className="production-section__features">
        {productionFeatures.map(([title, detail], index) => <article key={title}>
          <span>0{index + 1}</span><div><h3>{title}</h3><p>{detail}</p></div>
        </article>)}
      </div>
    </section>

    <section className="world-atlas" id="world-atlas" aria-labelledby="world-atlas-title">
      <div className="world-atlas__heading">
        <div>
          <p className="product-kicker"><span /> YOUR WORLD ATLAS</p>
          <h2 id="world-atlas-title">Return to a world<br /><em>already in motion.</em></h2>
        </div>
        <button className="product-home__explore world-atlas__create" type="button" disabled={!createWorld} onClick={(event) => openCreator(event.currentTarget)}>+ Create a world</button>
      </div>

      {worldsLoading && <p className="atlas-status" role="status">Loading your saved worlds…</p>}
      {worldError && <p className="atlas-status atlas-status--error" role="status">{worldError}</p>}
      {!worldsLoading && !worldError && createdWorlds.length === 0 && <div className="world-atlas__empty">
        <span aria-hidden="true">✦</span>
        <div><p className="product-kicker">YOUR FIRST WORLD</p><h3>Your atlas is waiting.</h3><p>Create a world from a title, genre, premise, and creative direction. Its first chapter becomes the beginning of a persistent archive.</p></div>
        <button className="product-home__create" type="button" disabled={!createWorld} onClick={(event) => openCreator(event.currentTarget)}>Create a world <span aria-hidden="true">→</span></button>
      </div>}
      {createdWorlds.length > 0 && <div className="world-atlas__grid">
        {createdWorlds.map((world) => <article className="world-atlas-card" key={world.id}>
          <WorldImage worldId={world.id} title={world.title} genre={world.genre} description={world.premise} loadImage={loadWorldCover} retryImage={retryWorldCover} />
          <div className="world-atlas-card__body">
            <p className="world-atlas-card__genre">{world.genre}</p>
            <h3>{world.title}</h3>
            <p>{world.premise}</p>
            <footer><small>{formatCreatedAt(world.createdAt)}</small><button type="button" onClick={() => selectWorld?.(world)}>Open world <span aria-hidden="true">→</span></button></footer>
          </div>
        </article>)}
      </div>}
    </section>

    <footer className="product-home__footer"><span className="mark">SV</span><p>StoryVerse · persistent, cinematic storytelling.</p><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to top ↑</button></footer>

    {creatorOpen && createWorld && <WorldCreator close={closeCreator} submit={async (input) => { await createWorld(input); closeCreator(); }} />}
  </main>;
}

function WorldCreator({ close, submit }: { close(): void; submit(input: CreateWorldInput): Promise<void> }) {
  const [input, setInput] = useState<CreateWorldInput>({ title: "", genre: "", premise: "", creatorPrompt: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const titleInput = useRef<HTMLInputElement>(null);
  const update = (key: keyof CreateWorldInput, value: string) => setInput((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    titleInput.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) close(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, saving]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try { await submit(input); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "StoryVerse could not create this world. Please try again."); }
    finally { setSaving(false); }
  };

  return <div className="drawer-backdrop world-creator-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section className="world-creator" role="dialog" aria-modal="true" aria-labelledby="world-creator-title" aria-describedby="world-creator-description">
      <button className="close" type="button" onClick={close} disabled={saving} aria-label="Close world creator">×</button>
      <p className="product-kicker"><span /> WORLD FORGE</p>
      <h2 id="world-creator-title">Create a world<br /><em>with a future.</em></h2>
      <p id="world-creator-description">Set the creative foundation. StoryVerse will generate and save a Chapter 1, persistent cast, cinematic beats, and the world context for what comes next.</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>World title<input ref={titleInput} required minLength={3} maxLength={100} value={input.title} onChange={(event) => update("title", event.target.value)} placeholder="Your world title" /></label>
        <label>Genre<input required minLength={3} maxLength={100} value={input.genre} onChange={(event) => update("genre", event.target.value)} placeholder="Genre and tone" /></label>
        <label>Core premise<textarea required minLength={3} maxLength={1000} value={input.premise} onChange={(event) => update("premise", event.target.value)} placeholder="What is happening in this world?" /></label>
        <label>Creative direction<textarea required minLength={3} maxLength={1000} value={input.creatorPrompt} onChange={(event) => update("creatorPrompt", event.target.value)} placeholder="Themes, visual language, emotional tone, and constraints" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="product-home__create world-creator__submit" disabled={saving} type="submit">{saving ? "Creating your world…" : <>Create world <span aria-hidden="true">→</span></>}</button>
      </form>
    </section>
  </div>;
}
