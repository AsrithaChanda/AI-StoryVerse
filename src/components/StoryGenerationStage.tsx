import { useId } from "react";
import "../styles/story-generation-stage.css";

export type StoryGenerationPhase = "writing" | "validating" | "illustrating";

/** Optional illustration status for hosts that keep the stage visible while art resolves. */
export type StoryIllustrationProgress = {
  completed: number;
  total: number;
  /** Number of scenes restored from storage rather than rendered anew. */
  cached?: number;
  /** All requested scenes were already available in durable storage. */
  allCached?: boolean;
};

export type StoryGenerationStageProps = {
  kind: "chapter" | "perspective" | "revision";
  number?: number;
  characterName?: string;
  narration: string;
  phase: StoryGenerationPhase;
  /** Lets a host show the chapter-to-illustration handoff without changing the base flow. */
  illustration?: StoryIllustrationProgress;
  /** Perspective generation is embedded inside a reader; chapters can remain immersive. */
  inline?: boolean;
};

function subjectFor({ kind, number, characterName }: Pick<StoryGenerationStageProps, "kind" | "number" | "characterName">): string {
  if (kind === "chapter") return number ? `Chapter ${number}` : "the next chapter";
  if (kind === "revision") return number ? `Chapter ${number}` : "this chapter";
  const name = characterName?.trim();
  return name ? `${name}'s perspective` : "this character's perspective";
}

export default function StoryGenerationStage({ kind, number, characterName, narration, phase, illustration, inline: inlineProp }: StoryGenerationStageProps) {
  const titleId = useId();
  const statusId = useId();
  const subject = subjectFor({ kind, number, characterName });
  const hasDraft = narration.trim().length > 0;
  const isValidating = phase === "validating";
  const isIllustrating = phase === "illustrating";
  const isWriting = phase === "writing";
  const inline = inlineProp ?? kind === "perspective";
  const Title = inline ? "h2" : "h1";
  // Canonical chapters and revisions are intentionally an atomic reading
  // experience: keep prose out of the transition until its whole visual
  // sequence is available. A character lens is an in-reader transition, so
  // it can still offer a short live preview while that lens is being written.
  const holdCanonicalDraft = !inline && (kind === "chapter" || kind === "revision");
  const showDraftPreview = hasDraft && !isIllustrating && !holdCanonicalDraft;
  const illustrationTotal = Math.max(0, Math.floor(illustration?.total ?? 0));
  const illustrationsReady = Math.min(illustrationTotal, Math.max(0, Math.floor(illustration?.completed ?? 0)));
  const cachedIllustrations = Math.min(illustrationTotal, Math.max(0, Math.floor(illustration?.cached ?? 0)));
  const allScenesCached = Boolean(illustration?.allCached || (illustrationTotal > 0 && cachedIllustrations >= illustrationTotal));
  const progressValue = Math.round(
    isWriting ? (hasDraft ? 38 : 23)
      : isValidating ? 66
        : illustrationTotal ? 72 + (illustrationsReady / illustrationTotal) * 28
          : 78,
  );
  const action = kind === "revision" ? "Revising" : "Writing";
  const title = isIllustrating
    ? "Preparing the complete visual sequence"
    : isValidating ? `Securing ${kind === "revision" ? "the revision for " : ""}${subject}` : `${action} ${subject}`;
  const liveStatus = isIllustrating
    ? allScenesCached
      ? illustrationTotal ? `Restoring ${illustrationTotal} saved scenes from this world’s image archive. They are ready immediately.` : "Restoring saved scenes from this world’s image archive."
      : illustrationTotal
        ? `Illustrating ${illustrationsReady} of ${illustrationTotal} scenes${cachedIllustrations ? `, with ${cachedIllustrations} restored from storage` : ""}. The draft is secured while the full visual sequence finishes. A small new batch usually finishes in under a minute, though provider queues can take longer.`
        : "Preparing the chapter’s scene illustrations. The draft is secured while the full visual sequence finishes."
    : isValidating
      ? "The draft is being checked against the saved world, characters, and recent events."
      : kind === "revision"
        ? "Rewriting this chapter while preserving the saved world, cast, and later continuity."
        : "Writing is in progress. The story engine is carrying forward the saved world and character context.";
  const timingNote = isIllustrating
    ? allScenesCached
      ? "Restoring saved scenes from durable storage; no new image generation is needed."
      : "This chapter’s text is already secure. New scene art usually arrives in under a minute for a small batch, though provider queues can take longer."
    : "The story draft is secured first. Its complete visual sequence is prepared next, before the chapter opens.";
  const progressLabel = isIllustrating
    ? illustrationTotal ? `${illustrationsReady} of ${illustrationTotal} scenes ready` : "Scene art in progress"
    : isValidating ? "Continuity review" : hasDraft ? "Draft taking shape" : "World context loaded";
  const writingStepClass = isWriting ? "is-active" : "is-complete";
  const validationStepClass = isWriting ? "" : isValidating ? "is-active" : "is-complete";
  const illustrationStepClass = isIllustrating ? "is-active" : "";

  return <section className={`story-generation-stage story-generation-stage--${phase} ${inline ? "story-generation-stage--inline" : ""}`.trim()} aria-labelledby={titleId} aria-describedby={statusId} aria-busy="true">
    <div className="story-generation-stage__atmosphere" aria-hidden="true"><i /><i /><i /></div>
    <div className="story-generation-stage__copy">
      <p className="story-generation-stage__eyebrow"><span aria-hidden="true" /> {isIllustrating ? "SCENE ASSEMBLY" : "LIVE STORY GENERATION"}</p>
      <Title className="story-generation-stage__title" id={titleId}>{title}<em>…</em></Title>
      <p className="story-generation-stage__status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
        <span className="story-generation-stage__pulse" aria-hidden="true" />
        {liveStatus}
      </p>
      <div className="story-generation-stage__meter">
        <div><span>ASSEMBLY PROGRESS</span><b>{progressLabel}</b></div>
        <div className="story-generation-stage__track" role="progressbar" aria-label="Story generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
          <i style={{ width: `${progressValue}%` }} />
        </div>
      </div>
    </div>

    <div className="story-generation-stage__draft" aria-label={isIllustrating || holdCanonicalDraft ? "Chapter is being prepared as one complete visual sequence" : hasDraft ? "Current draft preview" : "Draft preview waiting for text"}>
      <div className="story-generation-stage__draft-header"><span>{isIllustrating || holdCanonicalDraft ? "CHAPTER DELIVERY" : "DRAFT PREVIEW"}</span><b>{isIllustrating ? allScenesCached ? "RESTORING SAVED SCENES" : "ART ARRIVING" : isValidating ? "CHECKING CONTINUITY" : "WRITING LIVE"}</b></div>
      {showDraftPreview
        ? <p className="story-generation-stage__narration">{narration.trim()}</p>
        : isIllustrating
          ? <div className="story-generation-stage__secured" role="status"><span aria-hidden="true">✦</span><div><b>Chapter draft secured</b><p>The complete chapter will open when its visual sequence is ready.</p></div></div>
          : holdCanonicalDraft
            ? <div className="story-generation-stage__secured" role="status"><span aria-hidden="true">✦</span><div><b>Building the complete chapter</b><p>Story text and scene art will open together as one uninterrupted reading sequence.</p></div></div>
          : <div className="story-generation-stage__skeleton" aria-hidden="true"><i /><i /><i /><i /></div>}
      <p className="story-generation-stage__delivery-note"><span aria-hidden="true">✦</span>{timingNote}</p>
    </div>

    <ol className="story-generation-stage__steps" aria-label="Generation stages">
      <li className="is-complete"><span>01</span><div><b>Load continuity</b><small>Saved world context and character history are in place.</small></div></li>
      <li className={writingStepClass}><span>02</span><div><b>{kind === "revision" ? "Rewrite the chapter" : "Write the draft"}</b><small>{isWriting ? `Developing ${subject}.` : "Draft captured."}</small></div></li>
      <li className={validationStepClass}><span>03</span><div><b>{kind === "revision" ? "Secure the revision" : "Secure the draft"}</b><small>{isIllustrating ? "Continuity confirmed." : "Continuity and perspective are checked before the chapter is shown."}</small></div></li>
      <li className={illustrationStepClass}><span>04</span><div><b>Render illustrations</b><small>{isIllustrating ? illustrationTotal ? `${illustrationsReady} of ${illustrationTotal} scenes ready.` : "Scene art is arriving in stages." : "Scene art follows after the draft is secured."}</small></div></li>
    </ol>

    <p className="story-generation-stage__promise"><span aria-hidden="true">✦</span> {isIllustrating ? "The chapter will open as one complete reading sequence when the final scene is ready." : kind === "revision" ? "The updated draft is secured before its visual sequence is prepared." : "The chapter draft is secured before its visual sequence is prepared."}</p>
  </section>;
}
