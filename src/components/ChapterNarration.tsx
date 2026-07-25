import { useEffect, useRef, useState } from "react";
import { getNarration, type AudioPlan } from "../audio/chapter-audio";

const speedOptions = [0.75, 1, 1.25, 1.5, 2] as const;

export default function ChapterNarration({ worldId, chapterId, protagonistId, plan }: { worldId: string; chapterId: string; protagonistId?: string; plan: AudioPlan | null }) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [player, setPlayer] = useState<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    player?.pause();
    window.dispatchEvent(new Event("storyverse:narration-end"));
  }, [player]);

  const changeSpeed = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    if (playerRef.current) playerRef.current.playbackRate = nextSpeed;
  };

  const prepare = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const { narration } = await getNarration(worldId, chapterId, protagonistId, plan.contentHash);
      if (narration.contentHash !== plan.contentHash || narration.narrationSource.label !== plan.narrationSource.label) throw new Error("Narration source mismatch");
      if (!narration.audioUrl) {
        setError("Narration is unavailable; the chapter remains readable.");
        return;
      }
      const next = new Audio(narration.audioUrl);
      playerRef.current?.pause();
      next.preload = "auto";
      next.playbackRate = speed;
      next.onended = () => {
        window.dispatchEvent(new Event("storyverse:narration-end"));
        setPlaying(false);
      };
      playerRef.current = next;
      setPlayer(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Narration could not be prepared. Check the server log, then try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!player) return prepare();
    if (playing) {
      player.pause();
      window.dispatchEvent(new Event("storyverse:narration-end"));
      setPlaying(false);
      return;
    }
    try {
      window.dispatchEvent(new Event("storyverse:narration-start"));
      await player.play();
      setPlaying(true);
    } catch {
      window.dispatchEvent(new Event("storyverse:narration-end"));
      setError("Your browser blocked playback. Press Play narration once more.");
    }
  };

  const restart = async () => {
    const activePlayer = playerRef.current;
    if (!activePlayer) return;
    activePlayer.currentTime = 0;
    try {
      window.dispatchEvent(new Event("storyverse:narration-start"));
      await activePlayer.play();
      setPlaying(true);
    } catch {
      window.dispatchEvent(new Event("storyverse:narration-end"));
      setError("Your browser blocked playback. Press Restart narration once more.");
    }
  };

  const label = busy ? "Preparing voice…" : !player ? "Prepare narration" : playing ? "Pause narration" : "Play narration";

  return <section className="chapter-narration" aria-label="Chapter narration">
    <div>
      <span>AI NARRATOR · {plan?.narrationSource.label ?? "Preparing source…"}</span>
      <b>{plan ? `${plan.narrator.ageTone} ${plan.narrator.genderPresentation} narrator` : "Preparing narrator…"}</b>
      <small>{plan?.narrator.delivery ?? "Matching the chapter’s emotional context."}</small>
      {plan && <i>Will read: “{plan.narrationExcerpt}…”</i>}
    </div>
    <div className="narration-controls">
      <label className="narration-speed">
        <span>Speed</span>
        <select aria-label="Narration speed" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))} disabled={busy}>
          {speedOptions.map((option) => <option key={option} value={option}>{option}×</option>)}
        </select>
      </label>
      {player && <button type="button" onClick={() => void restart()} disabled={busy}>Restart</button>}
      <button type="button" onClick={() => void toggle()} disabled={busy || !plan}>{label}</button>
    </div>
    {player && !playing && !busy && <p role="status">Narration ready for {plan?.narrationSource.label} at {speed}× — press Play narration.</p>}
    {error && <p role="status">{error}</p>}
  </section>;
}
