import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StoryChapter } from "../api/story";
import { getTimeMachineJob, startTimeMachine, type TimeMachineJob } from "../api/time-machine";
import "../styles/time-machine.css";

const activeStatus = (job: TimeMachineJob | null) =>
  job?.status === "queued" || job?.status === "running" || job?.status === "illustrating";

export default function StoryTimeMachine({
  worldId,
  chapters,
  disabled,
  onJobChange,
  onCompleted,
}: {
  worldId: string;
  chapters: StoryChapter[];
  disabled: boolean;
  onJobChange(job: TimeMachineJob | null): void;
  onCompleted(job: TimeMachineJob): void;
}) {
  const [job, setJob] = useState<TimeMachineJob | null>(null);
  const [targetChapterId, setTargetChapterId] = useState(chapters.at(-1)?.id ?? "");
  const [changePrompt, setChangePrompt] = useState("");
  const [futurePrompt, setFuturePrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [pollGeneration, setPollGeneration] = useState(0);
  const completedId = useRef<string | undefined>(undefined);
  const observedActive = useRef(false);
  const onJobChangeRef = useRef(onJobChange);
  const onCompletedRef = useRef(onCompleted);

  useEffect(() => { onJobChangeRef.current = onJobChange; }, [onJobChange]);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const result = await getTimeMachineJob(worldId);
        if (!alive) return;
        setJob(result.job);
        onJobChangeRef.current(result.job);
        if (activeStatus(result.job)) observedActive.current = true;
        if (result.job?.status === "completed" && observedActive.current && completedId.current !== result.job.id) {
          completedId.current = result.job.id;
          onCompletedRef.current(result.job);
        }
        if (activeStatus(result.job)) timer = window.setTimeout(refresh, 1800);
      } catch (reason) {
        if (alive) {
          setError(reason instanceof Error ? reason.message : "Time Machine status is unavailable.");
          onJobChangeRef.current(null);
        }
      }
    };
    void refresh();
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, [pollGeneration, worldId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!targetChapterId || changePrompt.trim().length < 3 || submitting || activeStatus(job)) return;
    setSubmitting(true); setError(undefined);
    try {
      const result = await startTimeMachine(worldId, {
        targetChapterId,
        changePrompt: changePrompt.trim(),
        futurePrompt: futurePrompt.trim() || undefined,
      });
      setJob(result.job);
      observedActive.current = true;
      onJobChange(result.job);
      setPollGeneration((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The timeline rewrite could not be started.");
    } finally {
      setSubmitting(false);
    }
  };

  const active = activeStatus(job);
  const jobTargetIndex = job ? chapters.findIndex((chapter) => chapter.id === job.targetChapterId) : -1;
  const displayedTargetNumber = jobTargetIndex >= 0 ? chapters[jobTargetIndex]!.number : job?.targetChapterNumber;
  const displayedTotal = jobTargetIndex >= 0
    ? chapters.filter((chapter) => chapter.number >= chapters[jobTargetIndex]!.number).length
    : job?.totalChapters ?? 0;
  const displayedCompleted = Math.min(job?.completedChapters ?? 0, displayedTotal);
  return <section className={`time-machine ${active ? "time-machine--active" : ""}`}>
    <header>
      <div><p><span /> WORLD FEATURE · STORY TIME MACHINE</p><h2>Change one choice. <em>Rewrite the future.</em></h2></div>
      <b>{active ? "TIMELINE LOCKED" : "WORLD TIMELINE"}</b>
    </header>
    {active && job ? <div className="time-machine__running" role="status" aria-live="polite">
      <div className="time-machine__clock" aria-hidden="true"><i /><span /></div>
      <div><p>TIME MACHINE TRIGGERED · CHAPTER {displayedTargetNumber}</p>
        <h3>{job.status === "illustrating" ? "Drawing the new future…" : "Regenerating every future event…"}</h3>
        <small>Chapter {displayedTargetNumber} and every chapter after it are hidden until the new timeline is complete.</small>
      </div>
      <div className="time-machine__meter"><i><em style={{ width: `${job.progress}%` }} /></i><span>{job.progress}% · {displayedCompleted} of {displayedTotal} chapters rewritten</span></div>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <label>Jump to chapter<select value={targetChapterId} onChange={(event) => setTargetChapterId(event.target.value)} disabled={disabled || submitting}>
        {chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>Chapter {chapter.number}: {chapter.title}</option>)}
      </select></label>
      <label>What decision should change?<textarea rows={3} maxLength={2000} value={changePrompt} onChange={(event) => setChangePrompt(event.target.value)} placeholder="Example: Meera chooses to trust Arjun instead of leaving the city." disabled={disabled || submitting} /></label>
      <label>How should the future chapters develop? <small>Optional</small><textarea rows={3} maxLength={2000} value={futurePrompt} onChange={(event) => setFuturePrompt(event.target.value)} placeholder="Example: Keep the friendship strong, but make the mystery more dangerous." disabled={disabled || submitting} /></label>
      <button type="submit" disabled={disabled || submitting || changePrompt.trim().length < 3}>{submitting ? "Starting…" : "Trigger Time Machine →"}</button>
      <p>The original timeline stays visible until the complete replacement has been written and checked.</p>
    </form>}
    {job?.status === "failed" && <div className="time-machine__error">The rewrite stopped safely. Your existing story was kept unchanged. You can try again.</div>}
    {error && <div className="time-machine__error">{error}</div>}
  </section>;
}
