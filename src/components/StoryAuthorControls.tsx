import { useState, type FormEvent } from "react";
import "../styles/story-author-controls.css";

export type StoryAuthorControlsProps = {
  upcomingDirections: string[];
  busy: boolean;
  onReviseCurrent(prompt: string): void;
  onAddDirection(direction: string): void;
  onGenerateNext(): void;
};

const minimumPromptLength = 3;

export default function StoryAuthorControls({
  upcomingDirections,
  busy,
  onReviseCurrent,
  onAddDirection,
  onGenerateNext,
}: StoryAuthorControlsProps) {
  const [revision, setRevision] = useState("");
  const [direction, setDirection] = useState("");
  const revisionIsReady = revision.trim().length >= minimumPromptLength;
  const directionIsReady = direction.trim().length >= minimumPromptLength;

  const submitRevision = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !revisionIsReady) return;
    onReviseCurrent(revision.trim());
    setRevision("");
  };

  const submitDirection = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !directionIsReady) return;
    onAddDirection(direction.trim());
    setDirection("");
  };

  return <section className="story-author-controls" aria-label="Author controls">
    <header className="story-author-controls__header">
      <div><p className="story-author-controls__eyebrow"><span aria-hidden="true" /> AUTHOR CONTROLS</p><h2>Guide the story<br /><em>without losing its thread.</em></h2></div>
      {busy && <p className="story-author-controls__busy" role="status" aria-live="polite"><span aria-hidden="true" /> Story work in progress…</p>}
    </header>

    <div className="story-author-controls__grid">
      <form className="story-author-controls__panel" onSubmit={submitRevision}>
        <div className="story-author-controls__panel-heading"><span>01</span><div><h3>Revise this chapter</h3><p>Describe a change to the chapter you are currently reading—including a new character when the scene needs one.</p></div></div>
        <label htmlFor="story-author-revision">Revision prompt</label>
        <textarea id="story-author-revision" value={revision} maxLength={1000} minLength={minimumPromptLength} onChange={(event) => setRevision(event.target.value)} placeholder="Describe the change you want to make" disabled={busy} />
        <div className="story-author-controls__form-footer"><small>{revision.trim().length}/1000</small><button type="submit" disabled={busy || !revisionIsReady}>Revise chapter <span aria-hidden="true">→</span></button></div>
      </form>

      <form className="story-author-controls__panel story-author-controls__panel--queue" onSubmit={submitDirection}>
        <div className="story-author-controls__panel-heading"><span>02</span><div><h3>Upcoming chapters</h3><p>Queue any number of new characters or directions for the next generated chapter.</p></div></div>
        <label htmlFor="story-author-direction">Add a character or direction</label>
        <div className="story-author-controls__queue-input"><input id="story-author-direction" value={direction} maxLength={1000} minLength={minimumPromptLength} onChange={(event) => setDirection(event.target.value)} placeholder="Introduce a character or future direction" disabled={busy} /><button type="submit" disabled={busy || !directionIsReady}>Add</button></div>
        <div className="story-author-controls__queued" aria-live="polite">
          {upcomingDirections.length > 0
            ? <ul aria-label={`${upcomingDirections.length} queued direction${upcomingDirections.length === 1 ? "" : "s"}`}>{upcomingDirections.map((item, index) => <li key={`${item}-${index}`}><span>{item}</span><small>Used on next chapter</small></li>)}</ul>
            : <p>No upcoming directions queued yet.</p>}
        </div>
        <p className="story-author-controls__queue-note"><span aria-hidden="true">✦</span> Every generated character joins this world’s persistent cast and can later receive a point of view. These saved notes are used when the next chapter is generated.</p>
      </form>
    </div>

    <footer className="story-author-controls__generate"><div><span>NEXT CHAPTER</span><p>Generate the next chapter using the saved world, character context, and any queued characters or directions.</p></div><button type="button" onClick={onGenerateNext} disabled={busy}>Generate next chapter <span aria-hidden="true">→</span></button></footer>
  </section>;
}
