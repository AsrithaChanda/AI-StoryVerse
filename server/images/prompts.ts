import { createHash } from "node:crypto";
import type { World } from "../worlds.js";
import type { ImageMoment, ImageRequest } from "./types.js";

// Includes reliability-affecting generation settings in the cache namespace so
// timeout-era records never prevent a later, better configured render.
export const IMAGE_PROMPT_VERSION = "storyverse-cinematic-v2";

const canonicalCharacters = {
  mira: "Mira Sen — a young palace courier with a brave, impulsive presence, practical dark-blue courier clothing, and a distinctive amber scarf.",
  ravi: "Ravi — a retired royal guard, older and observant with a weathered face, a dark guard coat, and a worn brass watch-falcon emblem; protective without being severe.",
  kael: "Prince Kael — the young heir to Astra, controlled, idealistic, and secretive, wearing a refined pale ceremonial coat with a subtle ember-shaped royal insignia.",
} as const;

const momentDetails: Record<ImageMoment, { scene: string; mood: string; camera: string; characters: string[] }> = {
  world_cover: {
    scene: "an evocative first view of this original story universe at the hour its central danger becomes visible",
    mood: "cinematic, inviting, full of mystery and possibility", camera: "sweeping wide establishing composition", characters: [],
  },
  opening: {
    scene: "the Eastern Bridge in Astra: warning bells crossing a floating city, amber lamps in mist, Mira Sen confronting Prince Kael as an Ember fragment glows between them",
    mood: "suspenseful, rain-bright, and intimate", camera: "medium-wide storybook frame at eye level", characters: ["mira", "kael"],
  },
  trust_kael: {
    scene: "Mira protects Kael at the Eastern Bridge; Kael remains free while city alert bells remain elevated and the glowing Ember fragment is concealed",
    mood: "secretive, tense, conspiratorial, amber-gold treatment", camera: "close cinematic two-shot with city lights falling away behind them", characters: ["mira", "kael"],
  },
  expose_kael: {
    scene: "Mira reveals Kael's involvement to Ravi at the Eastern Bridge; Kael is detained and the city alert has become critical",
    mood: "public, urgent, confrontational, violet storm treatment", camera: "dynamic medium-wide frame with guards and bridge architecture", characters: ["mira", "ravi", "kael"],
  },
  ravi_pov: {
    // This intentionally contains only the facts Ravi may know. Kael's private
    // motive is never interpolated into this prompt.
    scene: "Ravi's point of view on the Eastern Bridge: warning bells, a suspicious Ember fragment, Mira's difficult choice, and his duty to protect Astra; an unresolved investigation with no private motive revealed",
    mood: "watchful, grounded, morally tense", camera: "over-the-shoulder investigative framing from Ravi's point of view", characters: ["ravi", "mira"],
  },
  chapter_scene: {
    scene: "an authored chapter beat in this original world", mood: "cinematic, emotionally precise, anime-inspired painted treatment", camera: "dynamic narrative frame", characters: [],
  },
  perspective_scene: {
    scene: "an authored chapter beat shown from the current character’s close point of view", mood: "subjective, cinematic, emotionally precise, anime-inspired painted treatment", camera: "close observational story frame", characters: [],
  },
};

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function imageCacheKey(request: Omit<ImageRequest, "retry">): string {
  const stable = JSON.stringify({
    version: IMAGE_PROMPT_VERSION,
    worldId: request.worldId, branchId: request.branchId ?? null,
    sceneId: request.sceneId, moment: request.moment,
    protagonistId: request.protagonistId ?? null,
  });
  return createHash("sha256").update(stable).digest("hex").slice(0, 40);
}

export function buildImagePrompt(world: World, request: Omit<ImageRequest, "retry">, visualBeat?: string | null): { prompt: string; characterIds: string[] } {
  const details = momentDetails[request.moment];
  const isLastEmber = world.id === "the-last-ember";
  const chosenCharacters = isLastEmber
    ? details.characters
    : world.characters.slice(0, 3).map((character) => character.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "character");
  const characterDescriptions = isLastEmber
    ? details.characters.map((id) => canonicalCharacters[id as keyof typeof canonicalCharacters]).join(" ")
    : world.characters.slice(0, 3).map((character) => `${character.name} — ${character.role}, ${character.trait}.`).join(" ");
  const worldMoment = request.moment === "world_cover"
    ? `Premise: ${clean(world.premise)}. Creative direction: ${clean(world.creatorPrompt)}. Opening moment: ${clean(world.openingScene)}.`
    : visualBeat ? `Canonical visual beat: ${clean(visualBeat)}.` : `Opening canon: ${clean(world.openingScene)}.`;
  const branch = request.branchId
    ? `Continuity: branch ${clean(request.branchId)}. Preserve the branch-specific consequence exactly.`
    : "Continuity: the original timeline.";
  const protagonist = request.protagonistId === "ravi"
    ? "Current protagonist: Ravi. Show only what Ravi can observe or reasonably know."
    : request.protagonistId ? `Current protagonist: ${clean(request.protagonistId)}.` : "Current protagonist: Mira Sen.";
  const epicCover = request.moment === "world_cover" && /historical|epic|mytholog/i.test(world.genre)
    ? "Cover composition: two original rival warriors in period-appropriate Indian-inspired traditional battle dress facing each other in a dramatic ancient landscape; do not resemble any existing film character or actor."
    : "";
  const prompt = [
    `Create one cinematic, painterly story image for “${clean(world.title)}”, a ${clean(world.genre)} world.`,
    `Story moment: ${details.scene}.`, worldMoment, branch,
    `Mood and lighting: ${details.mood}. Camera: ${details.camera}.`,
    `Character continuity: ${characterDescriptions || "Use the world’s three central characters with clearly distinguishable silhouettes."}`,
    protagonist,
    epicCover,
    "Important objects and environment must remain coherent with the scene. Rich atmospheric detail, filmic depth, inclusive human characters.",
    "No written text, captions, speech bubbles, logos, signatures, or watermarks.",
  ].join("\n");
  return { prompt, characterIds: chosenCharacters };
}

/** A polished, zero-network placeholder that preserves image geometry and theme. */
export function fallbackImageUrl(moment: ImageMoment): string {
  const palette = moment === "expose_kael" ? ["#221b48", "#8d60e8", "#e9d8ff"] : moment === "trust_kael" ? ["#14192d", "#d28b35", "#f7d89a"] : ["#10192f", "#4674a6", "#f3d7a1"];
  const title = moment.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750" role="img" aria-label="${title} illustrated fallback"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset=".55" stop-color="${palette[1]}"/><stop offset="1" stop-color="#070a13"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="28"/></filter></defs><rect width="1200" height="750" fill="url(#g)"/><circle cx="850" cy="175" r="130" fill="${palette[2]}" opacity=".32" filter="url(#b)"/><path d="M0 620 C220 470 420 680 650 520 S970 500 1200 420V750H0Z" fill="#050713" opacity=".73"/><path d="M485 650 L575 240 L650 650 M535 435 H625" stroke="${palette[2]}" stroke-width="11" opacity=".68"/><circle cx="578" cy="315" r="16" fill="${palette[2]}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
