import { useState } from "react";
import type { CharacterId, Decision, StoryViewState } from "../domain";
import type { CreateWorldInput, World } from "../api/worlds";
import SceneImage, { type SceneImageProps } from "./SceneImage";
import WorldImage, { type WorldImageProps } from "./WorldImage";
import GeneratedWorldReader from "./GeneratedWorldReader";
import "../styles/storyverse.css";

export type StoryActions = {
  enterUniverse(): Promise<void>;
  commitDecision(decision: Decision): Promise<void>;
  inspectCharacter(characterId: CharacterId): void;
  switchProtagonist(characterId: "ravi"): Promise<void>;
  createAlternateBranch(): Promise<void>;
  switchBranch(branchId: string): Promise<void>;
  resetDemo(): Promise<void>;
  busy: boolean;
  notice?: string;
};

type Props = {
  state: StoryViewState;
  actions: StoryActions;
  worlds?: readonly World[];
  worldsLoading?: boolean;
  worldError?: string;
  createWorld?(input: CreateWorldInput): Promise<void>;
  selectWorld?(world: World): void;
  selectedWorld?: World | null;
  closeWorld?(): void;
  loadSceneImage?: SceneImageProps["loadImage"];
  retrySceneImage?: SceneImageProps["retryImage"];
  loadWorldCover?: WorldImageProps["loadImage"];
  retryWorldCover?: WorldImageProps["retryImage"];
};

const characterGlyph: Record<CharacterId, string> = { mira: "M", ravi: "R", kael: "K" };

function labelDecision(decision: Decision | null): string {
  return decision === "TRUST_KAEL" ? "Trust Kael" : decision === "EXPOSE_KAEL" ? "Expose Kael" : "Unchosen";
}

function momentFor(state: StoryViewState): Exclude<SceneImageProps["moment"], "world_cover"> {
  if (state.activeBranch.protagonistId === "ravi") return "ravi_pov";
  if (state.activeBranch.selectedDecision === "TRUST_KAEL") return "trust_kael";
  if (state.activeBranch.selectedDecision === "EXPOSE_KAEL") return "expose_kael";
  return "opening";
}

export default function StoryExperience({ state, actions, worlds = [], worldsLoading, worldError, createWorld, selectWorld, selectedWorld, closeWorld, loadSceneImage, retrySceneImage, loadWorldCover }: Props) {
  const [drawer, setDrawer] = useState<CharacterId | null>(null);
  const [timeMachine, setTimeMachine] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const selected = state.characters.find((character) => character.id === drawer);

  const openCharacter = (id: CharacterId) => {
    actions.inspectCharacter(id);
    setDrawer(id);
  };

  if (selectedWorld) return <GeneratedWorldReader world={selectedWorld} close={() => closeWorld?.()} />;

  if (!state.entered) {
    return <main className="landing-shell">
      <div className="star-field" aria-hidden="true" />
      <nav className="masthead"><span className="mark">SV</span><span>STORYVERSE</span><span className="nav-rule" /> <small>A living universe</small><button className="nav-create" type="button" onClick={() => setCreatorOpen(true)}>Create a world</button></nav>
      <section className="landing-hero">
        <p className="eyebrow">UNIVERSE 01 · ASTRA</p>
        <h1>The Last<br /><em>Ember</em></h1>
        <p className="premise">A floating city is dying. At its eastern bridge, a courier must decide whether a prince’s secret is worth the risk of saving Astra.</p>
        <button className="enter-button" type="button" onClick={() => void actions.enterUniverse()} disabled={actions.busy}>Enter the story <span>→</span></button>
        <p className="living-label">✦ A living universe — every decision is remembered</p>
      </section>
      <section className="cast-strip" aria-label="The Last Ember cast">
        {state.characters.map((character) => <button type="button" className="cast-card" key={character.id} onClick={() => openCharacter(character.id)}>
          <span className={`portrait ${character.id}`}>{characterGlyph[character.id]}</span><span><b>{character.name}</b><small>{character.role}</small></span>
        </button>)}
      </section>
      <section className="world-library" aria-label="Explore story worlds">
        <div><p className="eyebrow">WORLD ATLAS</p><h2>Explore existing worlds</h2></div>
        <button className="atlas-create" type="button" onClick={() => setCreatorOpen(true)}>+ Create a world</button>
        {worldsLoading && <p className="library-note">Opening the archive…</p>}
        {worldError && <p className="library-note error">{worldError}</p>}
        <div className="world-cards">{worlds.map((world) => <button type="button" className="world-card" key={world.id} onClick={() => selectWorld?.(world)}><WorldImage worldId={world.id} title={world.title} genre={world.genre} compact loadImage={loadWorldCover} /><span>{world.genre}</span><b>{world.title}</b><small>{world.premise}</small><i>{world.id === "the-last-ember" ? "Enter →" : "Explore →"}</i></button>)}</div>
      </section>
      {selected && <MemoryDrawer character={selected} close={() => setDrawer(null)} actions={actions} />}
      {creatorOpen && createWorld && <WorldCreator close={() => setCreatorOpen(false)} submit={async (input) => { await createWorld(input); setCreatorOpen(false); }} />}
    </main>;
  }

  return <main className="experience-shell">
    <header className="reader-header">
      <button className="brand" type="button" aria-label="Reset to story landing" onClick={() => void actions.resetDemo()}><span className="mark">SV</span> STORYVERSE</button>
      <div className="chapter">CHAPTER ONE <i /> THE EASTERN BRIDGE</div>
      <div className="header-controls"><span className={`timeline-pill ${state.activeBranch.accent}`}>{state.activeBranch.name}</span><button type="button" className="reset-link" onClick={() => void actions.resetDemo()}>Reset demo</button></div>
    </header>
    <div className="glow-timeline" aria-label={`${state.activeBranch.name}, ${labelDecision(state.activeBranch.selectedDecision)}`}><span className="node opening" /><span className="line" /><span className="node decision" /><span className="line muted" /><span className="node future" /></div>
    <div className="reader-grid">
      <section className="story-column" aria-live="polite">
        <p className="eyebrow">{state.activeBranch.protagonistId === "ravi" ? "RAVI'S POINT OF VIEW" : "MIRA'S POINT OF VIEW"}</p>
        <h1>{state.scene.title}</h1>
        <SceneImage worldId="the-last-ember" branchId={state.activeBranchId} protagonistId={state.activeBranch.protagonistId} moment={momentFor(state)} title={state.scene.title} loadImage={loadSceneImage} retryImage={retrySceneImage} />
        <p className="scene-prose">{state.scene.narration}</p>
        {state.scene.dialogue.map((line, index) => <blockquote key={`${line.characterId}-${index}`}><span>{line.characterId === "ravi" ? "RAVI" : line.characterId === "mira" ? "MIRA" : "KAEL"}</span>{line.text}</blockquote>)}
        <p className="hook">{state.scene.closingHook}</p>
        {state.scene.source === "fallback" && <p className="fallback-note">✦ Offline scene archive active — the story remains fully playable.</p>}
        {state.canMakeDecision ? <DecisionCards actions={actions} /> : <div className="world-changed"><span>✦</span><div><b>The world changed</b><p>{state.world.cityAlert} alert · Kael {state.world.kaelStatus.toLowerCase()} · consequences remembered</p></div></div>}
      </section>
      <aside className="world-panel" aria-label="Current world state">
        <p className="panel-label">WORLD STATE</p>
        <StateRow label="Ember stability" value={`${state.world.emberStability}%`} />
        <StateRow label="City alert" value={state.world.cityAlert} danger={state.world.cityAlert === "Critical"} />
        <StateRow label="Kael’s status" value={state.world.kaelStatus} />
        <StateRow label="Location" value={state.world.location} />
        <div className="panel-divider" />
        <p className="panel-label">CAST MEMORY</p>
        <div className="cast-buttons">{state.characters.map((character) => <button type="button" key={character.id} onClick={() => openCharacter(character.id)}><span className={`mini-portrait ${character.id}`}>{characterGlyph[character.id]}</span><span><b>{character.name}</b><small>{character.emotion}</small></span><i>›</i></button>)}</div>
        {state.activeBranch.selectedDecision && <button className="time-button" type="button" onClick={() => setTimeMachine(true)}>⌁ Open Time Machine</button>}
      </aside>
    </div>
    {actions.notice && <p className="action-notice" role="status">{actions.notice}</p>}
    {selected && <MemoryDrawer character={selected} close={() => setDrawer(null)} actions={actions} />}
    {timeMachine && <TimeMachine state={state} actions={actions} close={() => setTimeMachine(false)} loadImage={loadSceneImage} />}
  </main>;
}

function WorldCreator({ close, submit }: { close(): void; submit(input: CreateWorldInput): Promise<void> }) {
  const [input, setInput] = useState<CreateWorldInput>({ title: "", genre: "", premise: "", creatorPrompt: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const update = (key: keyof CreateWorldInput, value: string) => setInput((current) => ({ ...current, [key]: value }));
  const onSubmit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(undefined); try { await submit(input); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create this world."); } finally { setSaving(false); } };
  return <div className="drawer-backdrop" role="presentation" onMouseDown={close}><section className="world-creator" role="dialog" aria-modal="true" aria-label="Create a world" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close" type="button" onClick={close} aria-label="Close world creator">×</button><p className="eyebrow">WORLD FORGE</p><h2>Create a living world</h2><p>Describe the premise. StoryVerse creates its opening moment and three central characters, then saves it to the universe archive.</p>
    <form onSubmit={(event) => void onSubmit(event)}><label>World title<input required minLength={3} maxLength={100} value={input.title} onChange={(event) => update("title", event.target.value)} placeholder="The Glass Horizon" /></label><label>Genre<input required minLength={3} maxLength={100} value={input.genre} onChange={(event) => update("genre", event.target.value)} placeholder="Solarpunk mystery" /></label><label>Core premise<textarea required minLength={3} maxLength={1000} value={input.premise} onChange={(event) => update("premise", event.target.value)} placeholder="A city travels across an endless sky…" /></label><label>Creative direction<textarea required minLength={3} maxLength={1000} value={input.creatorPrompt} onChange={(event) => update("creatorPrompt", event.target.value)} placeholder="Hopeful but unsettling; choices should carry emotional weight." /></label>{error && <p className="form-error">{error}</p>}<button className="alternate-button" disabled={saving} type="submit">{saving ? "Forging your world…" : "Create world →"}</button></form>
  </section></div>;
}

function StateRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="state-row"><span>{label}</span><b className={danger ? "danger" : ""}>{value}</b></div>; }

function DecisionCards({ actions }: { actions: StoryActions }) {
  return <div className="choice-wrap"><p className="choice-label">MIRA MUST CHOOSE</p><div className="choices">
    <button className="choice trust" type="button" disabled={actions.busy} onClick={() => void actions.commitDecision("TRUST_KAEL")}><span>01 · CONCEAL THE FRAGMENT</span><b>Trust Kael</b><small>Help him disappear before the guard arrives.</small></button>
    <button className="choice expose" type="button" disabled={actions.busy} onClick={() => void actions.commitDecision("EXPOSE_KAEL")}><span>02 · CALL THE GUARD</span><b>Expose Kael</b><small>Give Ravi the truth and let the city decide.</small></button>
  </div></div>;
}

function MemoryDrawer({ character, close, actions }: { character: StoryViewState["characters"][number]; close(): void; actions: StoryActions }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={close}><section className="memory-drawer" role="dialog" aria-modal="true" aria-label={`${character.name} memory`} onMouseDown={(event) => event.stopPropagation()}>
    <button className="close" type="button" onClick={close} aria-label="Close character memory">×</button><span className={`drawer-portrait ${character.id}`}>{characterGlyph[character.id]}</span>
    <p className="eyebrow">CHARACTER MEMORY</p><h2>{character.name}</h2><p className="role">{character.role} · {character.emotion}</p><p className="personality">{character.personality.join(" · ")}</p>
    <div className="memory-section"><b>Current goal</b><p>{character.goal}</p></div>
    <div className="memory-section"><b>Known facts</b>{character.knownFacts.map((fact) => <p key={fact}>• {fact}</p>)}</div>
    <div className="memory-section"><b>Beliefs</b>{character.beliefs.map((belief) => <p key={belief.id}>• {belief.text}</p>)}</div>
    <div className="memory-section"><b>Memories</b>{character.memories.map((memory) => <p className={memory.remembered ? "remembered" : ""} key={memory.id}>{memory.remembered && <em>Remembered</em>}{memory.text}</p>)}</div>
    {character.id === "ravi" && <button className="ravi-button" type="button" disabled={actions.busy} onClick={() => { void actions.switchProtagonist("ravi"); close(); }}>Continue as Ravi →</button>}
  </section></div>;
}

function TimeMachine({ state, actions, close, loadImage }: { state: StoryViewState; actions: StoryActions; close(): void; loadImage?: SceneImageProps["loadImage"] }) {
  const alternate = state.activeBranch.selectedDecision === "TRUST_KAEL" ? "EXPOSE_KAEL" : "TRUST_KAEL";
  return <div className="drawer-backdrop" role="presentation" onMouseDown={close}><section className="time-machine" role="dialog" aria-modal="true" aria-label="Story Time Machine" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close" type="button" onClick={close} aria-label="Close Time Machine">×</button><p className="eyebrow">STORY TIME MACHINE</p><h2>Change one decision.<br /><em>Keep every future.</em></h2>
    <div className="branch-map"><span>Opening</span><i /><span>Bridge confrontation</span><div className="fork"><div><b className="amber-dot" />Trust Kael<br /><small>Timeline A</small></div><div><b className="violet-dot" />Expose Kael<br /><small>Timeline B</small></div></div></div>
    <div className="timeline-switches">{state.timelines.map((timeline) => { const moment = timeline.selectedDecision === "EXPOSE_KAEL" ? "expose_kael" : timeline.selectedDecision === "TRUST_KAEL" ? "trust_kael" : "opening"; return <button type="button" key={timeline.id} className={timeline.isActive ? "active" : ""} onClick={() => void actions.switchBranch(timeline.id)}><SceneImage className="timeline-image" worldId="the-last-ember" branchId={timeline.id} moment={moment} title={`${timeline.name} ${labelDecision(timeline.selectedDecision)}`} loadImage={loadImage} /><b>{timeline.name}</b><span>{labelDecision(timeline.selectedDecision)}</span><small>{timeline.world.cityAlert} · Kael {timeline.world.kaelStatus}</small></button>; })}</div>
    {state.canCreateAlternateBranch ? <button className="alternate-button" type="button" disabled={actions.busy} onClick={() => void actions.createAlternateBranch()}>Create alternate future: {labelDecision(alternate)} →</button> : <p className="branch-ready">Both futures are preserved. Switch timelines to compare their consequences.</p>}
  </section></div>;
}
