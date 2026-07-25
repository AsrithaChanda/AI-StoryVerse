export type SoundscapeMood = "suspense" | "storm" | "conflict" | "grief" | "triumph" | "reflection";

export type SoundscapeProfile = {
  mood: SoundscapeMood;
  label: string;
  rootHz: number;
  pulseMs: number;
  waveform: OscillatorType;
  motif: readonly number[];
  shimmer: boolean;
};

const profiles: Record<SoundscapeMood, SoundscapeProfile> = {
  suspense: { mood: "suspense", label: "Suspense beneath the scene", rootHz: 146.83, pulseMs: 1300, waveform: "sine", motif: [1, 1.189, 1.498, 1.122], shimmer: true },
  storm: { mood: "storm", label: "Storm over the horizon", rootHz: 110, pulseMs: 780, waveform: "sawtooth", motif: [1, 1.335, 1.122, 1.498], shimmer: true },
  conflict: { mood: "conflict", label: "War drums and resolve", rootHz: 130.81, pulseMs: 620, waveform: "triangle", motif: [1, 1.498, 1.335, 1.681], shimmer: false },
  grief: { mood: "grief", label: "A quiet elegy", rootHz: 174.61, pulseMs: 1750, waveform: "sine", motif: [1, 1.122, 1.335, 1.189], shimmer: true },
  triumph: { mood: "triumph", label: "Embers of victory", rootHz: 196, pulseMs: 980, waveform: "triangle", motif: [1, 1.26, 1.498, 2], shimmer: true },
  reflection: { mood: "reflection", label: "Moonlit reflection", rootHz: 164.81, pulseMs: 1550, waveform: "sine", motif: [1, 1.189, 1.335, 1.498], shimmer: true },
};

export function soundscapeForChapter(text: string): SoundscapeProfile {
  const value = text.toLowerCase();
  const base = /thunder|storm|lightning|tempest|rain/.test(value) ? profiles.storm
    : /battle|war|attack|siege|fight|blade|army/.test(value) ? profiles.conflict
      : /kill|death|dies|dead|grief|mourn|funeral|loss/.test(value) ? profiles.grief
        : /triumph|victory|hope|dawn|celebrat|reunite/.test(value) ? profiles.triumph
          : /secret|hidden|mystery|suspicion|unknown|shadow|door|omen/.test(value) ? profiles.suspense : profiles.reflection;
  const seed = hash(text);
  const rootShift = [-3, -2, 0, 2, 3][seed % 5];
  const rootHz = base.rootHz * 2 ** (rootShift / 12);
  const rotate = seed % base.motif.length;
  return { ...base, rootHz, pulseMs: base.pulseMs + ((seed >>> 4) % 5 - 2) * 45, motif: [...base.motif.slice(rotate), ...base.motif.slice(0, rotate)], shimmer: seed % 2 === 0 ? base.shimmer : !base.shimmer };
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

/** Lightweight, local instrumental bed. No audio leaves the device. */
export class AdaptiveSoundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;
  private profile: SoundscapeProfile = profiles.reflection;
  private volume = 0.18;

  public async start(profile: SoundscapeProfile): Promise<void> {
    this.profile = profile;
    this.context ??= new AudioContext();
    this.master ??= this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
    await this.context.resume();
    this.schedule();
  }

  public setProfile(profile: SoundscapeProfile): void {
    this.profile = profile;
    this.step = 0;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(0.35, volume));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.08);
  }

  public stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.step = 0;
    if (this.master && this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
  }

  public dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private schedule(): void {
    if (!this.context || !this.master || this.timer !== null) return;
    const play = () => {
      if (!this.context || !this.master) return;
      const now = this.context.currentTime;
      const note = this.profile.motif[this.step % this.profile.motif.length];
      this.tone(this.profile.rootHz * note, 1.1, 0.035, now, this.profile.waveform);
      this.tone(this.profile.rootHz * this.profile.motif[(this.step + 2) % this.profile.motif.length], 0.85, 0.018, now + 0.03, "sine");
      if (this.profile.mood === "storm" || this.profile.mood === "conflict") this.tone(this.profile.rootHz / 2, 0.22, 0.075, now, "triangle");
      if (this.profile.shimmer) this.tone(this.profile.rootHz * 2, 0.36, 0.009, now + 0.19, "sine");
      this.step += 1;
      this.timer = window.setTimeout(() => { this.timer = null; play(); }, this.profile.pulseMs);
    };
    play();
  }

  private tone(frequency: number, duration: number, gain: number, start: number, type: OscillatorType): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.07);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }
}
