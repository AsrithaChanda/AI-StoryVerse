import { useEffect, useMemo, useRef, useState } from "react";
import { getAudioPlan, type AudioPlan } from "../audio/chapter-audio";
import { AdaptiveSoundscape, soundscapeForChapter } from "../audio/soundscape";

type Props = { worldId: string; chapterId: string; protagonistId?: string; chapterText: string; onPlan(plan: AudioPlan | null): void };

export default function ChapterBgm({ worldId, chapterId, protagonistId, chapterText, onPlan }: Props) {
  const engine = useRef<AdaptiveSoundscape | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(18);
  const [track, setTrack] = useState<AudioPlan["bgm"] | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const profile = useMemo(() => soundscapeForChapter(`${worldId}|${chapterId}|${protagonistId ?? "canonical"}|${chapterText}`), [worldId, chapterId, protagonistId, chapterText]);

  useEffect(() => {
    if (playing) engine.current?.setProfile(profile);
  }, [playing, profile]);
  useEffect(() => () => engine.current?.dispose(), []);
  useEffect(() => { let active = true; player.current?.pause(); player.current = null; void getAudioPlan(worldId, chapterId, protagonistId).then(({ plan }) => { if (active) { setTrack(plan.bgm); onPlan(plan); } }).catch(() => { if (active) onPlan(null); }); return () => { active = false; player.current?.pause(); player.current = null; }; }, [worldId, chapterId, protagonistId, onPlan]);
  useEffect(() => {
    const lowerForNarration = () => {
      const music = player.current;
      if (music) { music.volume = Math.max(0.025, volume / 100 * 0.24); void music.play().then(() => setPlaying(true)).catch(() => undefined); return; }
      if (track) { const next = new Audio(track.url); next.loop = true; next.volume = Math.max(0.025, volume / 100 * 0.24); player.current = next; void next.play().then(() => setPlaying(true)).catch(() => undefined); return; }
      engine.current ??= new AdaptiveSoundscape(); engine.current.setVolume(Math.max(0.025, volume / 100 * 0.24)); void engine.current.start(profile).then(() => setPlaying(true));
    };
    const restoreAfterNarration = () => { if (player.current) player.current.volume = volume / 100; else engine.current?.setVolume(volume / 100); };
    window.addEventListener("storyverse:narration-start", lowerForNarration); window.addEventListener("storyverse:narration-end", restoreAfterNarration);
    return () => { window.removeEventListener("storyverse:narration-start", lowerForNarration); window.removeEventListener("storyverse:narration-end", restoreAfterNarration); };
  }, [track, profile, volume]);

  const toggle = async () => {
    if (playing) { engine.current?.stop(); player.current?.pause(); setPlaying(false); return; }
    if (track) { const music = new Audio(track.url); music.loop = true; music.volume = volume / 100; player.current = music; try { await music.play(); setPlaying(true); return; } catch { /* fall through to local bed */ } }
    engine.current ??= new AdaptiveSoundscape();
    engine.current.setVolume(volume / 100);
    await engine.current.start(profile);
    setPlaying(true);
  };
  const updateVolume = (next: number) => { setVolume(next); engine.current?.setVolume(next / 100); if (player.current) player.current.volume = next / 100; };

  return <section className={`chapter-bgm chapter-bgm--${profile.mood}`} aria-label="Chapter background music">
    <button type="button" onClick={() => void toggle()} aria-pressed={playing}>{playing ? "Pause music" : "Play music"}</button>
    <input className="chapter-bgm__volume" type="range" min="0" max="35" value={volume} onChange={(event) => updateVolume(Number(event.target.value))} aria-label="Background music volume" />
  </section>;
}
