import { useEffect, useId, useMemo, useRef, useState } from "react";
import "../styles/world-cast.css";

/** The minimum character profile the cast UI needs to render a useful entry. */
export type WorldCastCharacter = {
  id: string;
  name: string;
  role: string;
  personality: string;
};

/**
 * Drop-in cast sidebar contract for a chapter reader. It intentionally accepts
 * any sized character array, rather than assuming a fixed initial cast.
 */
export type WorldCastProps = {
  characters: readonly WorldCastCharacter[];
  activeCharacterId: string | null;
  loadingCharacterId?: string;
  disabled: boolean;
  onSelect(characterId: string): void;
};

function searchableCharacter(character: WorldCastCharacter, query: string): boolean {
  const haystack = `${character.name} ${character.role} ${character.personality}`.toLocaleLowerCase();
  return haystack.includes(query.trim().toLocaleLowerCase());
}

type CastEntryProps = {
  character: WorldCastCharacter;
  activeCharacterId: string | null;
  loadingCharacterId?: string;
  disabled: boolean;
  onSelect(characterId: string): void;
  onSelected?(): void;
};

function CastEntry({ character, activeCharacterId, loadingCharacterId, disabled, onSelect, onSelected }: CastEntryProps) {
  const isActive = character.id === activeCharacterId;
  const isLoading = character.id === loadingCharacterId;
  const className = ["world-cast__entry", isActive ? "is-active" : "", isLoading ? "is-loading" : ""].filter(Boolean).join(" ");

  return <button
    className={className}
    type="button"
    disabled={disabled}
    aria-current={isActive ? "true" : undefined}
    aria-busy={isLoading || undefined}
    aria-label={isLoading ? `Opening ${character.name}'s perspective` : `View ${character.name}'s perspective`}
    onClick={() => { onSelect(character.id); onSelected?.(); }}
  >
    <span className="world-cast__entry-mark" aria-hidden="true">{character.name.trim().charAt(0).toUpperCase() || "?"}</span>
    <span className="world-cast__entry-copy"><b>{character.name}</b><small>{character.role}</small><i>{character.personality}</i></span>
    {isLoading && <em className="world-cast__entry-status">Opening…</em>}
    {isActive && !isLoading && <em className="world-cast__entry-status">Viewing</em>}
  </button>;
}

export default function WorldCast({ characters, activeCharacterId, loadingCharacterId, disabled, onSelect }: WorldCastProps) {
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [inlineQuery, setInlineQuery] = useState("");
  const [query, setQuery] = useState("");
  const directoryTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const directoryTitleId = useId();
  const inlineSearchId = useId();
  const inlineMatches = useMemo(() => characters.filter((character) => searchableCharacter(character, inlineQuery)), [characters, inlineQuery]);
  const directoryMatches = useMemo(() => characters.filter((character) => searchableCharacter(character, query)), [characters, query]);

  const closeDirectory = () => {
    setDirectoryOpen(false);
    window.setTimeout(() => directoryTrigger.current?.focus(), 0);
  };

  useEffect(() => {
    if (!directoryOpen) return;
    searchInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeDirectory(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [directoryOpen]);

  return <aside className="world-cast" aria-labelledby={titleId}>
    <header className="world-cast__header"><div><p className="world-cast__eyebrow">PERSISTENT CAST</p><h2 id={titleId}>Who sees this<br />world differently?</h2></div><span className="world-cast__count" aria-label={`${characters.length} characters`}>{characters.length}</span></header>

    {characters.length === 0
      ? <div className="world-cast__empty"><span aria-hidden="true">✦</span><div><b>The cast is still forming.</b><p>Characters introduced by the story will appear here with their own perspective.</p></div></div>
      : <>
        <div className="world-cast__list-heading"><label className="world-cast__inline-search" htmlFor={inlineSearchId}><span>ALL CHARACTERS</span><input id={inlineSearchId} type="search" value={inlineQuery} onChange={(event) => setInlineQuery(event.target.value)} placeholder="Search cast" disabled={disabled} /></label><p>Showing {inlineMatches.length} of {characters.length}</p></div>
        <div className="world-cast__all-list" role="list" aria-label="All characters" aria-live="polite">
          {inlineMatches.length > 0
            ? inlineMatches.map((character) => <div role="listitem" key={character.id}><CastEntry character={character} activeCharacterId={activeCharacterId} loadingCharacterId={loadingCharacterId} disabled={disabled} onSelect={onSelect} /></div>)
            : <p className="world-cast__no-results">No characters match “{inlineQuery.trim()}”. Try another name, role, or trait.</p>}
        </div>
        <button ref={directoryTrigger} className="world-cast__directory-trigger" type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={directoryOpen} onClick={() => { setQuery(inlineQuery); setDirectoryOpen(true); }}>
          <span><b>Open focused directory</b><small>Browse all {characters.length} characters in a larger view</small></span><i aria-hidden="true">↗</i>
        </button>
      </>}

    {directoryOpen && <div className="world-cast__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDirectory(); }}>
      <section className="world-cast__directory" role="dialog" aria-modal="true" aria-labelledby={directoryTitleId}>
        <header><div><p className="world-cast__eyebrow">CAST DIRECTORY</p><h2 id={directoryTitleId}>{characters.length} characters</h2></div><button type="button" className="world-cast__close" aria-label="Close cast directory" onClick={closeDirectory}>×</button></header>
        <label className="world-cast__search" htmlFor="world-cast-search"><span>Search name, role, or personality</span><input ref={searchInput} id="world-cast-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the cast" /></label>
        <div className="world-cast__directory-list" aria-live="polite">
          {directoryMatches.length > 0
            ? directoryMatches.map((character) => <CastEntry key={character.id} character={character} activeCharacterId={activeCharacterId} loadingCharacterId={loadingCharacterId} disabled={disabled} onSelect={onSelect} onSelected={closeDirectory} />)
            : <p className="world-cast__no-results">No characters match “{query.trim()}”. Try another name, role, or trait.</p>}
        </div>
      </section>
    </div>}
  </aside>;
}
