import { createHash } from "node:crypto";
import type { StoryCharacter, WorldStory } from "../story.js";
import type { World } from "../worlds.js";
import type { ImageMoment, ImageRequest } from "./types.js";

// This version reads the persistent story cast rather than a fixed subset of
// world-blueprint characters, so prior limited-cast artwork is never reused.
export const IMAGE_PROMPT_VERSION = "storyverse-cinematic-v4";

const momentDetails: Record<ImageMoment, { scene: string; mood: string; camera: string }> = {
  world_cover: {
    scene: "an evocative first view of this original story universe at the moment its central possibility becomes visible",
    mood: "cinematic, inviting, and full of narrative possibility",
    camera: "sweeping wide establishing composition",
  },
  chapter_scene: {
    scene: "a concrete, authored beat from the current chapter",
    mood: "cinematic, emotionally precise, anime-inspired painted treatment",
    camera: "dynamic narrative frame",
  },
  perspective_scene: {
    scene: "a concrete authored beat experienced through the selected character’s point of view",
    mood: "subjective, cinematic, and emotionally precise",
    camera: "close observational story frame",
  },
};

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function characterId(name: string, index: number): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `character-${index + 1}`;
}

type VisualCharacter = Pick<StoryCharacter, "id" | "name" | "role" | "visualDescription">;

/**
 * The world blueprint is useful before Chapter 1 exists, but the story cast
 * is canonical once it has been generated. Crucially, this intentionally does
 * not take a first-N slice: every persisted character remains part of the
 * world’s visual continuity contract.
 */
function visualCast(world: World, story?: WorldStory | null): VisualCharacter[] {
  if (story?.characters.length) return story.characters.map(({ id, name, role, visualDescription }) => ({ id, name, role, visualDescription }));
  return world.characters.map((character, index) => ({
    id: characterId(character.name, index),
    name: character.name,
    role: character.role,
    visualDescription: `${character.trait} presence`,
  }));
}

export function imageCacheKey(request: Omit<ImageRequest, "retry">): string {
  const stable = JSON.stringify({
    version: IMAGE_PROMPT_VERSION,
    worldId: request.worldId,
    branchId: request.branchId ?? null,
    sceneId: request.sceneId,
    moment: request.moment,
    protagonistId: request.protagonistId ?? null,
  });
  return createHash("sha256").update(stable).digest("hex").slice(0, 40);
}

/** Builds image context solely from persisted world/story data and chapter beats.
 * No cast or plot is baked into the visual-generation path. */
export function buildImagePrompt(
  world: World,
  request: Omit<ImageRequest, "retry">,
  visualBeat?: string | null,
  story?: WorldStory | null,
): { prompt: string; characterIds: string[] } {
  const details = momentDetails[request.moment];
  const characters = visualCast(world, story);
  const characterIds = characters.map((character) => character.id);
  const characterDescriptions = characters
    .map((character) => `${clean(character.name)} — ${clean(character.role)}; ${clean(character.visualDescription)}.`)
    .join(" ");
  const sceneContext = request.moment === "world_cover"
    ? `Premise: ${clean(world.premise)}. Creative direction: ${clean(world.creatorPrompt)}. Opening moment: ${clean(world.openingScene)}.`
    : visualBeat
      ? `Saved visual beat: ${clean(visualBeat)}.`
      : `Saved opening moment: ${clean(world.openingScene)}.`;
  const continuity = request.branchId
    ? `Continuity identifier: ${clean(request.branchId)}. Keep the depicted consequences coherent with this saved branch.`
    : "Continuity: the world’s saved canonical history.";
  const viewpoint = request.moment === "perspective_scene"
    ? "Viewpoint rule: show only what the selected character can observe, remember, or reasonably infer; do not expose another character’s private knowledge."
    : "Viewpoint rule: use the shared, canonical view of events.";
  const epicCover = request.moment === "world_cover" && /historical|epic|mytholog/i.test(world.genre)
    ? "Cover composition: original rival figures in culturally respectful period-appropriate dress within an ancient landscape. Do not resemble protected film characters, actors, or branded costumes."
    : "";
  const prompt = [
    `Create one cinematic, painterly story image for “${clean(world.title)}”, an original ${clean(world.genre)} world.`,
    `Story surface: ${details.scene}.`,
    sceneContext,
    continuity,
    `Mood and lighting: ${details.mood}. Camera: ${details.camera}.`,
    `Character continuity: ${characterDescriptions || "Use the world’s saved central characters with clearly distinguishable silhouettes."} Show only people relevant to the saved visual beat, but preserve every listed character’s identity when they appear.`,
    viewpoint,
    epicCover,
    "Keep people, objects, locations, and visual motifs coherent with the saved context. Rich atmospheric detail, filmic depth, inclusive human characters.",
    "No written text, captions, speech bubbles, logos, signatures, watermarks, or references to existing fictional franchises.",
  ].filter(Boolean).join("\n");
  return { prompt, characterIds };
}

/** A polished, zero-network placeholder that preserves image geometry and theme. */
export function fallbackImageUrl(moment: ImageMoment): string {
  const palette = moment === "perspective_scene"
    ? ["#221b48", "#8d60e8", "#e9d8ff"]
    : moment === "world_cover"
      ? ["#14192d", "#d28b35", "#f7d89a"]
      : ["#10192f", "#4674a6", "#f3d7a1"];
  const title = moment.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750" role="img" aria-label="${title} illustrated fallback"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset=".55" stop-color="${palette[1]}"/><stop offset="1" stop-color="#070a13"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="28"/></filter></defs><rect width="1200" height="750" fill="url(#g)"/><circle cx="850" cy="175" r="130" fill="${palette[2]}" opacity=".32" filter="url(#b)"/><path d="M0 620 C220 470 420 680 650 520 S970 500 1200 420V750H0Z" fill="#050713" opacity=".73"/><path d="M485 650 L575 240 L650 650 M535 435 H625" stroke="${palette[2]}" stroke-width="11" opacity=".68"/><circle cx="578" cy="315" r="16" fill="${palette[2]}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
