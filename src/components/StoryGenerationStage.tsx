import { useId } from "react";
import "../styles/story-generation-stage.css";

export type StoryGenerationStageProps = {
  kind: "chapter" | "perspective";
  number?: number;
  characterName?: string;
  narration: string;
  phase: "writing" | "validating";
};

function subjectFor({ kind, number, characterName }: Pick<StoryGenerationStageProps, "kind" | "number" | "characterName">): string {
  if (kind === "chapter") return number ? `Chapter ${number}` : "the next chapter";
  const name = characterName?.trim();
  return name ? `${name}'s perspective` : "this character's perspective";
}

export default function StoryGenerationStage({ kind, number, characterName, narration, phase }: StoryGenerationStageProps) {
  const titleId = useId();
  const statusId = useId();
  const subject = subjectFor({ kind, number, characterName });
  const hasDraft = narration.trim().length > 0;
  const isValidating = phase === "validating";
  const title = isValidating ? `Securing ${subject}` : `Writing ${subject}`;
  const liveStatus = isValidating
    ? "The draft is being checked against the saved world, characters, and recent events."
    : "Writing is in progress. The story engine is carrying forward the saved world and character context.";

  return <section className={`story-generation-stage story-generation-stage--${phase}`} aria-labelledby={titleId} aria-describedby={statusId}>
    <div className="story-generation-stage__atmosphere" aria-hidden="true"><i /><i /><i /></div>
    <div className="story-generation-stage__copy">
      <p className="story-generation-stage__eyebrow"><span aria-hidden="true" /> LIVE STORY GENERATION</p>
      <h1 id={titleId}>{title}<em>…</em></h1>
      <p className="story-generation-stage__status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
        <span className="story-generation-stage__pulse" aria-hidden="true" />
        {liveStatus}
      </p>
    </div>

    <div className="story-generation-stage__draft" aria-label={hasDraft ? "Current draft preview" : "Draft preview waiting for text"}>
      <div className="story-generation-stage__draft-header"><span>DRAFT PREVIEW</span><b>{isValidating ? "CHECKING CONTINUITY" : "WRITING LIVE"}</b></div>
      {hasDraft
        ? <p className="story-generation-stage__narration">{narration.trim()}</p>
        : <div className="story-generation-stage__skeleton" aria-hidden="true"><i /><i /><i /><i /></div>}
    </div>

    <ol className="story-generation-stage__steps" aria-label="Generation stages">
      <li className="is-complete"><span>01</span><div><b>Load continuity</b><small>Saved world context and character history are in place.</small></div></li>
      <li className={isValidating ? "is-complete" : "is-active"}><span>02</span><div><b>Write the draft</b><small>{isValidating ? "Draft captured." : `Developing ${subject}.`}</small></div></li>
      <li className={isValidating ? "is-active" : ""}><span>03</span><div><b>Secure the draft</b><small>Continuity and perspective are checked before the chapter is shown.</small></div></li>
      <li><span>04</span><div><b>Render illustrations</b><small>Scene art appears in stages after the draft is secured.</small></div></li>
    </ol>

    <p className="story-generation-stage__promise"><span aria-hidden="true">✦</span> The written chapter appears first. Its cinematic illustrations continue safely in the background.</p>
  </section>;
}
