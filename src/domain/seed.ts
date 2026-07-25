import type {
  BranchState,
  CharacterDefinition,
  CharacterId,
  CharacterRuntime,
  Scene,
  Universe,
  WorldTruth,
} from "./types";

export const universe: Universe = {
  id: "the-last-ember",
  title: "The Last Ember",
  premise:
    "In the floating city of Astra, a palace courier must decide whether a prince's secret can save a dying world.",
  rules: [
    "The Ember Core keeps Astra aloft.",
    "Committed events are immutable within their timeline.",
    "Characters act only on what they know, remember, or believe.",
  ],
};

export const characterDefinitions: Readonly<Record<CharacterId, CharacterDefinition>> = {
  mira: {
    id: "mira",
    name: "Mira Sen",
    role: "Palace courier",
    personality: ["Brave", "Impulsive", "Compassionate"],
    goal: "Prevent Astra from falling.",
    startingEmotion: "Anxious, but determined",
  },
  ravi: {
    id: "ravi",
    name: "Ravi",
    role: "Retired royal guard and Mira's mentor",
    personality: ["Observant", "Protective", "Distrustful of authority"],
    goal: "Keep Mira alive.",
    startingEmotion: "Protective and suspicious",
  },
  kael: {
    id: "kael",
    name: "Prince Kael",
    role: "Heir to Astra",
    personality: ["Controlled", "Idealistic", "Secretive"],
    goal: "Prevent mass panic.",
    startingEmotion: "Guilty and afraid",
  },
};

export const initialWorld: WorldTruth = {
  emberStability: 42,
  cityAlert: "Elevated",
  kaelStatus: "Suspected",
  location: "Eastern Bridge",
  fragmentLocation: "with_kael",
  kaelFragmentPurpose: "Kael removed the fragment to prevent a larger reaction in the failing Ember Core.",
};

export const openingScene: Scene = {
  id: "scene:opening",
  branchId: "timeline_a",
  protagonistId: "mira",
  title: "The Eastern Bridge",
  narration:
    "Warning bells comb the midnight sky as Mira Sen finds Prince Kael alone on the Eastern Bridge. A coal-red glimmer stains his glove—the same light she saw near the vault. Below, Astra's lantern districts sway above the storm. Kael does not deny the missing Ember fragment. He only asks Mira to trust him before the guard arrives.",
  dialogue: [
    { characterId: "kael", text: "If they take it from me now, the city will panic before dawn." },
    { characterId: "mira", text: "Then tell me why I should believe you." },
  ],
  closingHook: "Boots ring on the far span. Mira has one decision before Ravi reaches them.",
  source: "fallback",
  sourceEventIds: [],
};

export function initialCharacters(): Readonly<Record<CharacterId, CharacterRuntime>> {
  return {
    mira: {
      id: "mira",
      emotion: "Anxious, but determined",
      location: "Eastern Bridge",
      memories: [{ id: "mira:opening", text: "I saw Prince Kael near the vault before the bells began.", sequence: 0 }],
      knownFacts: ["I saw Prince Kael near the vault."],
      beliefs: [{ id: "mira:kael", text: "Kael is hiding something, but he may not be Astra's enemy.", sequence: 0 }],
      relationships: { mira: 100, ravi: 75, kael: 40 },
    },
    ravi: {
      id: "ravi",
      emotion: "Protective and suspicious",
      location: "Guard approach to Eastern Bridge",
      memories: [{ id: "ravi:opening", text: "The royal family concealed an earlier Ember failure.", sequence: 0 }],
      knownFacts: ["The royal family concealed an earlier Ember failure."],
      beliefs: [{ id: "ravi:kael", text: "Prince Kael is hiding something dangerous.", sequence: 0 }],
      relationships: { mira: 70, ravi: 100, kael: 15 },
    },
    kael: {
      id: "kael",
      emotion: "Guilty and afraid",
      location: "Eastern Bridge",
      memories: [{ id: "kael:opening", text: "I removed the Ember fragment before its reaction could spread.", sequence: 0 }],
      knownFacts: ["I removed the fragment to stop a larger reaction in the Ember Core."],
      beliefs: [{ id: "kael:panic", text: "Panic could fracture Astra faster than the failing Core.", sequence: 0 }],
      relationships: { mira: 40, ravi: 15, kael: 100 },
    },
  };
}

export function initialBranch(): BranchState {
  return {
    id: "timeline_a",
    name: "Timeline A",
    accent: "amber",
    selectedDecision: null,
    world: initialWorld,
    characters: initialCharacters(),
    events: [],
    protagonistId: "mira",
    scene: openingScene,
  };
}
