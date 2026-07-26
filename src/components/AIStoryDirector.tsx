import { useRef, useState, type FormEvent } from "react";
import type { ChapterDirectorProposal } from "../api/story-director";
import type { StoryChapter } from "../api/story";
import "../styles/ai-story-director.css";

/**
 * The only chapter information the Director needs to render its scope. Keeping
 * this intentionally small prevents the panel from becoming another story
 * navigator or a gateway to future-chapter controls.
 */
export type StoryDirectorChapter = Pick<StoryChapter, "id" | "number" | "title" | "revision">;

export type AIStoryDirectorProps = {
  /** The canonical chapter currently displayed in the reader. */
  currentChapter: StoryDirectorChapter;
  /** A story operation outside this panel is running. */
  busy: boolean;
  /** Produces a reviewable, scoped edit plan. It must not mutate the chapter. */
  onPropose(prompt: string): Promise<ChapterDirectorProposal>;
  /** Commits exactly the proposal the reader has reviewed. */
  onApply(proposal: ChapterDirectorProposal): Promise<void>;
};

type DirectorAction = "proposing" | "applying" | null;
type ScopedMessage = { chapterId: string; revision: number; text: string };

const minimumPromptLength = 3;
const maximumPromptLength = 600;
const directionChips = [
  { label: "Slow the pacing", prompt: "Slow the pacing and give the current emotional beat more room to land." },
  { label: "Sympathetic character", prompt: "Make a central character more sympathetic through a concrete choice or revealing detail." },
  { label: "Foreshadow", prompt: "Foreshadow a later betrayal through details that feel natural to this chapter." },
] as const;

function chapterRevision(chapter: StoryDirectorChapter): number {
  return chapter.revision ?? 1;
}

function chapterLabel(chapter: StoryDirectorChapter): string {
  return `Chapter ${String(chapter.number).padStart(2, "0")}`;
}

function categoryLabel(category: ChapterDirectorProposal["changes"][number]["category"]): string {
  return category.replace("_", " ");
}

function scopesToChapter(proposal: ChapterDirectorProposal, chapter: StoryDirectorChapter): boolean {
  return proposal.chapterId === chapter.id && proposal.baseRevision === chapterRevision(chapter);
}

export default function AIStoryDirector({ currentChapter, busy, onPropose, onApply }: AIStoryDirectorProps) {
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<ChapterDirectorProposal | null>(null);
  const [action, setAction] = useState<DirectorAction>(null);
  const [error, setError] = useState<ScopedMessage | null>(null);
  const [success, setSuccess] = useState<ScopedMessage | null>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const revision = chapterRevision(currentChapter);
  const proposalIsCurrent = proposal !== null && scopesToChapter(proposal, currentChapter);
  const visibleProposal = proposalIsCurrent ? proposal : null;
  const visibleError = error?.chapterId === currentChapter.id && error.revision === revision ? error.text : null;
  const visibleSuccess = success?.chapterId === currentChapter.id && success.revision === revision ? success.text : null;
  const isWorking = busy || action !== null;
  const promptIsReady = prompt.trim().length >= minimumPromptLength;
  const hasProposedChanges = Boolean(visibleProposal && visibleProposal.changes.length > 0);

  const setPromptFromChip = (chipPrompt: string) => {
    if (isWorking) return;
    setPrompt(chipPrompt);
    setError(null);
    setSuccess(null);
    promptInput.current?.focus();
  };

  const previewChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isWorking || !promptIsReady) return;

    const target = { chapterId: currentChapter.id, revision };
    setAction("proposing");
    setError(null);
    setSuccess(null);
    try {
      const nextProposal = await onPropose(prompt.trim());
      if (!scopesToChapter(nextProposal, currentChapter)) {
        throw new Error("The Director returned a plan for a different chapter. Please preview the change again.");
      }
      setProposal(nextProposal);
    } catch (reason) {
      setError({
        ...target,
        text: reason instanceof Error ? reason.message : "The Director could not prepare a chapter change.",
      });
    } finally {
      setAction(null);
    }
  };

  const applyChange = async () => {
    if (!visibleProposal || !hasProposedChanges || isWorking) return;

    const target = { chapterId: currentChapter.id, revision };
    setAction("applying");
    setError(null);
    setSuccess(null);
    try {
      await onApply(visibleProposal);
      setProposal(null);
      setSuccess({
        ...target,
        text: `${chapterLabel(currentChapter)} has been updated. Loading the revised chapter now…`,
      });
    } catch (reason) {
      setError({
        ...target,
        text: reason instanceof Error ? reason.message : "The proposed chapter change could not be applied.",
      });
    } finally {
      setAction(null);
    }
  };

  const discardProposal = () => {
    if (isWorking) return;
    setProposal(null);
    setError(null);
    setSuccess(null);
    promptInput.current?.focus();
  };

  return <section className="ai-story-director" aria-labelledby="ai-story-director-heading" aria-busy={isWorking}>
    <header className="ai-story-director__header">
      <div>
        <p className="ai-story-director__eyebrow"><span aria-hidden="true" /> AI STORY DIRECTOR</p>
        <h2 id="ai-story-director-heading">Shape this chapter<br /><em>before it changes.</em></h2>
      </div>
      <div className="ai-story-director__scope" aria-label={`Scoped to ${chapterLabel(currentChapter)}, revision ${revision}`}>
        <span>CHAPTER SCOPE</span>
        <b>{chapterLabel(currentChapter)}</b>
        <small>REV {revision}</small>
      </div>
    </header>

    <p className="ai-story-director__chapter-title"><span>CANONICAL VIEW</span> {currentChapter.title}</p>
    <p className="ai-story-director__scope-note">The Director prepares a reviewable edit only for this displayed chapter. Nothing is changed until you apply its preview.</p>

    <form className="ai-story-director__form" onSubmit={previewChange}>
      <label htmlFor="ai-story-director-prompt">What should change in this chapter?</label>
      <textarea
        ref={promptInput}
        id="ai-story-director-prompt"
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value);
          setError(null);
          setSuccess(null);
        }}
        maxLength={maximumPromptLength}
        minLength={minimumPromptLength}
        placeholder="e.g. Let the confrontation breathe before the reveal."
        disabled={isWorking}
        aria-describedby="ai-story-director-prompt-note"
        aria-invalid={Boolean(visibleError)}
      />
      <div className="ai-story-director__form-footer">
        <small id="ai-story-director-prompt-note">{prompt.trim().length}/{maximumPromptLength} · Preview first—no story change yet.</small>
        <button type="submit" disabled={isWorking || !promptIsReady}>
          {action === "proposing" ? "Previewing…" : "Preview change"} <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>

    <div className="ai-story-director__chips" aria-label="Suggested chapter directions">
      <span>TRY A DIRECTION</span>
      <div>{directionChips.map((chip) => <button key={chip.label} type="button" onClick={() => setPromptFromChip(chip.prompt)} disabled={isWorking}>{chip.label}</button>)}</div>
    </div>

    {(action !== null || visibleError || visibleSuccess) && <div className={`ai-story-director__status${visibleError ? " ai-story-director__status--error" : ""}${visibleSuccess ? " ai-story-director__status--success" : ""}`} role={visibleError ? "alert" : "status"} aria-live="polite">
      <span aria-hidden="true" />
      <p>{visibleError ?? visibleSuccess ?? (action === "proposing" ? "The Director is mapping a contained chapter change…" : "Applying the reviewed change to this chapter…")}</p>
    </div>}

    {visibleProposal && <article className="ai-story-director__proposal" aria-labelledby="ai-story-director-proposal-heading">
      <header>
        <div>
          <p>DIRECTOR’S PREVIEW</p>
          <h3 id="ai-story-director-proposal-heading">{visibleProposal.directorIntent}</h3>
        </div>
        <span>REVIEW REQUIRED</span>
      </header>
      <p className="ai-story-director__directive">“{visibleProposal.directive}”</p>
      {visibleProposal.changes.length > 0
        ? <ol className="ai-story-director__changes">
          {visibleProposal.changes.map((change, index) => <li key={`${change.category}-${change.summary}-${index}`}>
            <span className="ai-story-director__change-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p className="ai-story-director__category">{categoryLabel(change.category)}</p>
              <h4>{change.summary}</h4>
              <p className="ai-story-director__rationale">{change.rationale}</p>
              <p className="ai-story-director__scenes"><span>AFFECTED SCENES · {change.affectedBeatIds.length}</span>{change.affectedBeatIds.length > 0 ? change.affectedBeatIds.join(" · ") : "Chapter narration"}</p>
            </div>
          </li>)}
        </ol>
        : <p className="ai-story-director__empty-plan">The Director found no concrete scene changes to make. Refine the direction, then preview again.</p>}
      <details className="ai-story-director__chapter-preview">
        <summary>
          <span>READ PROPOSED CHAPTER</span>
          <b>{visibleProposal.proposedChapter.title}</b>
          <i aria-hidden="true">⌄</i>
        </summary>
        <div>
          <p className="ai-story-director__preview-label">PROPOSED CANONICAL TEXT</p>
          {visibleProposal.proposedChapter.narration.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`} className="ai-story-director__preview-prose">{paragraph}</p>)}
        </div>
      </details>
      <footer>
        <p><span aria-hidden="true">✦</span> This plan affects {chapterLabel(currentChapter)} only. No future chapter direction is being queued.</p>
        <div>
          <button type="button" className="ai-story-director__discard" onClick={discardProposal} disabled={isWorking}>Discard</button>
          <button type="button" className="ai-story-director__apply" onClick={() => void applyChange()} disabled={isWorking || !hasProposedChanges}>
            {action === "applying" ? "Applying…" : `Apply to ${chapterLabel(currentChapter)}`} <span aria-hidden="true">→</span>
          </button>
        </div>
      </footer>
    </article>}
  </section>;
}
