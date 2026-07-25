import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { StoryCharacter } from "./story.js";
import type { WorldStore } from "./worlds.js";

export type NarratorProfile = { genderPresentation: "feminine" | "masculine" | "neutral"; ageTone: "young adult" | "mature" | "elder"; voice: "coral" | "onyx" | "sage"; delivery: string };
export type ChapterAudioPlan = { worldId: string; chapterId: string; protagonistId?: string; mood: string; bgm: { id: string; title: string; url: string }; narrator: NarratorProfile; narrationSource: { kind: "canonical" | "character"; label: string }; narrationText: string; narrationExcerpt: string; contentHash: string };
type Bgm = ChapterAudioPlan["bgm"];

const library: Record<string, Bgm> = {
  reflection: { id: "airy", title: "Open air", url: "/bgm/airy.mp3" },
  suspense: { id: "sector", title: "Unknown sector", url: "/bgm/sector.mp3" },
  danger: { id: "pulse", title: "Rising pulse", url: "/bgm/pulse.mp3" },
  conflict: { id: "urgent", title: "Urgent", url: "/bgm/urgent.mp3" },
  grief: { id: "transmission", title: "Aftermath", url: "/bgm/transmission.mp3" },
  triumph: { id: "victory", title: "Victory", url: "/bgm/victory.mp3" },
};

function moodOf(text: string): string {
  const value = text.toLowerCase();
  if (/death|dies|dead|grief|mourn|funeral|loss/.test(value)) return "grief";
  if (/triumph|victory|hope|dawn|celebrat|reunite/.test(value)) return "triumph";
  if (/battle|war|attack|siege|fight|blade|army|chase/.test(value)) return "conflict";
  if (/thunder|storm|lightning|tempest|danger|blood|fire|threat/.test(value)) return "danger";
  if (/secret|hidden|mystery|suspicion|unknown|shadow|door|omen/.test(value)) return "suspense";
  return "reflection";
}

function characterPresentation(character: StoryCharacter): NarratorProfile["genderPresentation"] {
  const cues = `${character.name} ${character.role} ${character.visualDescription}`.toLowerCase();
  if (/\b(woman|girl|female|heroine|queen|princess|sister|mother|daughter|she|her)\b/.test(cues)) return "feminine";
  if (/\b(man|boy|male|hero|king|prince|brother|father|son|he|him)\b/.test(cues)) return "masculine";
  return "neutral";
}

function characterAgeTone(character: StoryCharacter): NarratorProfile["ageTone"] {
  const cues = `${character.role} ${character.visualDescription}`.toLowerCase();
  if (/teen|sixteen|seventeen|eighteen|young /.test(cues)) return "young adult";
  if (/elder|elderly|retired|sixt|sevent|ancient/.test(cues)) return "elder";
  return "mature";
}

function narratorFor(genre: string, mood: string, character?: StoryCharacter): NarratorProfile {
  if (character) {
    const genderPresentation = characterPresentation(character);
    const ageTone = characterAgeTone(character);
    const voice = genderPresentation === "feminine" ? "coral" : genderPresentation === "masculine" ? "onyx" : "sage";
    const delivery = mood === "conflict" || mood === "danger" ? "close, immediate, and urgent" : mood === "grief" ? "intimate and restrained" : "observant and emotionally present";
    return { genderPresentation, ageTone, voice, delivery };
  }
  const value = genre.toLowerCase();
  if (/historical|epic|myth|war/.test(value)) return { genderPresentation: "masculine", ageTone: "elder", voice: "onyx", delivery: mood === "conflict" ? "commanding and urgent" : "measured and mythic" };
  if (/romance|fairy|fantasy|mystery/.test(value)) return { genderPresentation: "feminine", ageTone: "mature", voice: "coral", delivery: mood === "grief" ? "warm and intimate" : "cinematic and precise" };
  return { genderPresentation: "neutral", ageTone: "mature", voice: "sage", delivery: mood === "danger" ? "quietly tense" : "calm and observant" };
}

/** The chapter-audio agent makes the two coupled decisions: local music cue
 * and narration persona. It never asks a model to compose music. */
export class ChapterAudioDirector {
  public constructor(private readonly store: WorldStore, private readonly assetDirectory = resolve(process.cwd(), "data", "story-narrations")) {}
  public plan(worldId: string, chapterId: string, protagonistId?: string): ChapterAudioPlan | null {
    const world = this.store.get(worldId); const story = this.store.getWorldStory(worldId); const chapter = story?.chapters.find((entry) => entry.id === chapterId);
    if (!world || !story || !chapter) return null;
    const pov = protagonistId ? story.perspectives.find((entry) => entry.characterId === protagonistId && entry.chapterId === chapterId) : undefined;
    if (protagonistId && !pov) return null;
    const narrationText = pov?.narration ?? chapter.narration;
    const fallbackMood = moodOf(`${chapter.title}\n${narrationText}`);
    const direction = chapter.audioDirection;
    const mood = direction?.bgmCue ?? fallbackMood;
    const selectedCharacter = protagonistId ? story.characters.find((entry) => entry.id === protagonistId) : undefined;
    if (protagonistId && !selectedCharacter) return null;
    const baseNarrator = narratorFor(world.genre, mood, selectedCharacter);
    const narrator = direction ? {
      ...baseNarrator,
      delivery: selectedCharacter ? `${direction.narrationDelivery}; ${baseNarrator.delivery}` : direction.narrationDelivery,
    } : baseNarrator;
    const narrationSource = selectedCharacter ? { kind: "character" as const, label: `${selectedCharacter.name}'s perspective` } : { kind: "canonical" as const, label: "Canonical narrator perspective" };
    const contentHash = createHash("sha256").update(narrationText).digest("hex").slice(0, 16);
    return { worldId, chapterId, protagonistId, mood, bgm: library[mood], narrator, narrationSource, narrationText, narrationExcerpt: narrationText.replace(/\s+/g, " ").trim().slice(0, 180), contentHash };
  }
  public async narrate(plan: ChapterAudioPlan): Promise<{ status: "ready" | "fallback"; audioUrl?: string; narrator: NarratorProfile; bgm: Bgm; narrationSource: ChapterAudioPlan["narrationSource"]; contentHash: string; errorCode?: string }> {
    // Do not reuse legacy generative-audio files: this renderer reads the saved
    // text directly, and its version/model are part of the cache identity.
    const narrationModel = process.env.OPENAI_NARRATION_MODEL || "gpt-4o-mini-tts";
    const key = createHash("sha256").update(JSON.stringify({ renderer: "openai-tts-v1", narrationModel, worldId: plan.worldId, chapterId: plan.chapterId, protagonistId: plan.protagonistId ?? null, contentHash: plan.contentHash, narrator: plan.narrator })).digest("hex").slice(0, 40);
    const filename = `${key}.wav`; const output = resolve(this.assetDirectory, filename);
    if (existsSync(output)) return { status: "ready", audioUrl: `/api/narrations/assets/${filename}`, narrator: plan.narrator, bgm: plan.bgm, narrationSource: plan.narrationSource, contentHash: plan.contentHash };
    if (!process.env.OPENAI_API_KEY) return { status: "fallback", narrator: plan.narrator, bgm: plan.bgm, narrationSource: plan.narrationSource, contentHash: plan.contentHash, errorCode: "provider_disabled" };
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal: AbortSignal.timeout(Number(process.env.STORYVERSE_NARRATION_TIMEOUT_MS || 120_000)),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: narrationModel,
          voice: plan.narrator.voice,
          input: plan.narrationText,
          instructions: `Read the supplied text verbatim, once, without summarising, paraphrasing, adding words, music, or sound effects. Use a ${plan.narrator.ageTone}, ${plan.narrator.genderPresentation}-presenting narration persona with a ${plan.narrator.delivery} delivery.`,
          response_format: "wav",
        }),
      });
      if (!response.ok) return { status: "fallback", narrator: plan.narrator, bgm: plan.bgm, narrationSource: plan.narrationSource, contentHash: plan.contentHash, errorCode: "provider_error" };
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 44 || bytes.length > 40 * 1024 * 1024) return { status: "fallback", narrator: plan.narrator, bgm: plan.bgm, narrationSource: plan.narrationSource, contentHash: plan.contentHash, errorCode: "invalid_response" };
      await mkdir(this.assetDirectory, { recursive: true }); await writeFile(output, bytes, { flag: "w" });
      return { status: "ready", audioUrl: `/api/narrations/assets/${filename}`, narrator: plan.narrator, bgm: plan.bgm, narrationSource: plan.narrationSource, contentHash: plan.contentHash };
    } catch { return { status: "fallback", narrator: plan.narrator, bgm: plan.bgm, narrationSource: plan.narrationSource, contentHash: plan.contentHash, errorCode: "provider_error" }; }
  }
  public assetPath(filename: string): string | null { return /^[a-f0-9]{40}\.wav$/i.test(filename) ? resolve(this.assetDirectory, filename) : null; }
}
