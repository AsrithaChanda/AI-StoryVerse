import { useCallback, useEffect, useId, useRef, useState } from "react";
import "../styles/chapter-timeline-actions.css";

export type ChapterTimelineActionsProps = {
  selectedChapterNumber: number;
  isLatest: boolean;
  hasPreviousChapter: boolean;
  hasFutureChapters: boolean;
  busy: boolean;
  onDeleteCurrent(): void;
  onDeleteFuture(): void;
};

type DeletionScope = "current" | "future";

function confirmationCopy(scope: DeletionScope, chapterNumber: number) {
  if (scope === "current") {
    return {
      title: `Delete Chapter ${chapterNumber}?`,
      description: `Chapter ${chapterNumber}, including its saved perspectives, narration, and illustrations, will be permanently removed. Chapter ${chapterNumber - 1} will become the latest chapter.`,
      confirm: "Delete this chapter",
    };
  }

  return {
    title: `Delete chapters after Chapter ${chapterNumber}?`,
    description: `Every chapter after Chapter ${chapterNumber}, including its saved perspectives, narration, and illustrations, will be permanently removed. Chapter ${chapterNumber} will remain unchanged.`,
    confirm: "Delete future chapters",
  };
}

/**
 * A reader-side deletion affordance. It intentionally never offers current
 * Chapter 1 deletion, and delegates every mutation to the supplied callbacks.
 */
export default function ChapterTimelineActions({
  selectedChapterNumber,
  isLatest,
  hasPreviousChapter,
  hasFutureChapters,
  busy,
  onDeleteCurrent,
  onDeleteFuture,
}: ChapterTimelineActionsProps) {
  const [confirmation, setConfirmation] = useState<DeletionScope | null>(null);
  const currentTrigger = useRef<HTMLButtonElement>(null);
  const futureTrigger = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const canDeleteCurrent = isLatest && hasPreviousChapter && selectedChapterNumber > 1;
  const canDeleteFuture = hasFutureChapters;

  const confirmationStillAvailable = confirmation === "current" ? canDeleteCurrent : confirmation === "future" ? canDeleteFuture : false;
  const visibleConfirmation = confirmation && confirmationStillAvailable ? confirmation : null;

  const closeConfirmation = useCallback(() => {
    if (busy) return;
    const trigger = confirmation === "current" ? currentTrigger.current : futureTrigger.current;
    setConfirmation(null);
    window.setTimeout(() => trigger?.focus(), 0);
  }, [busy, confirmation]);

  useEffect(() => {
    if (!visibleConfirmation) return;
    cancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeConfirmation(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleConfirmation, closeConfirmation]);

  useEffect(() => {
    if (!confirmation || confirmationStillAvailable) return;
    const cleanup = window.setTimeout(() => setConfirmation(null), 0);
    return () => window.clearTimeout(cleanup);
  }, [confirmation, confirmationStillAvailable]);

  if (!canDeleteCurrent && !canDeleteFuture) return null;
  const copy = visibleConfirmation ? confirmationCopy(visibleConfirmation, selectedChapterNumber) : null;

  return <section className="chapter-timeline-actions" aria-label="Chapter deletion actions">
    <div className="chapter-timeline-actions__copy"><p>CHAPTER MAINTENANCE</p><small>Delete only the part of the timeline you no longer want to keep.</small></div>
    <div className="chapter-timeline-actions__buttons">
      {canDeleteCurrent && <button ref={currentTrigger} type="button" className="chapter-timeline-actions__button" disabled={busy} onClick={() => setConfirmation("current")}>Delete this chapter</button>}
      {canDeleteFuture && <button ref={futureTrigger} type="button" className="chapter-timeline-actions__button" disabled={busy} onClick={() => setConfirmation("future")}>Delete future chapters</button>}
    </div>

    {visibleConfirmation && copy && <div className="chapter-timeline-actions__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmation(); }}>
      <section className="chapter-timeline-actions__dialog" role="alertdialog" aria-modal="true" aria-labelledby={dialogTitleId} aria-describedby={dialogDescriptionId}>
        <p className="chapter-timeline-actions__warning"><span aria-hidden="true">!</span> PERMANENT CHANGE</p>
        <h2 id={dialogTitleId}>{copy.title}</h2>
        <p id={dialogDescriptionId}>{copy.description}</p>
        <p className="chapter-timeline-actions__irreversible">This action cannot be undone.</p>
        {busy && <p className="chapter-timeline-actions__progress" role="status" aria-live="polite"><span aria-hidden="true" /> Deleting saved chapter material…</p>}
        <div className="chapter-timeline-actions__dialog-buttons"><button ref={cancelButton} type="button" disabled={busy} onClick={closeConfirmation}>Keep timeline</button><button type="button" className="chapter-timeline-actions__confirm" disabled={busy} onClick={() => visibleConfirmation === "current" ? onDeleteCurrent() : onDeleteFuture()}>{busy ? "Deleting…" : copy.confirm}</button></div>
      </section>
    </div>}
  </section>;
}
