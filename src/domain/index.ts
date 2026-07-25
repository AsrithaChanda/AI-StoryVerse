import { characterDefinitions, initialBranch, openingScene, universe } from "./seed";
import type {
  Belief,
  BranchId,
  BranchState,
  CharacterId,
  CharacterRuntime,
  CharacterView,
  Decision,
  Memory,
  Scene,
  StoryEvent,
  StoryState,
  StoryViewState,
  WorldView,
} from "./types";

export * from "./types";

const decisionEffects: Record<Decision, {
  cityAlert: "Elevated" | "Critical";
  kaelStatus: "Suspected" | "Detained";
  kaelTrustDelta: number;
  raviTrustDelta: number;
  miraMemory: string;
  raviMemory?: string;
  raviBelief?: string;
  scene: (branchId: BranchId, eventId: string) => Scene;
}> = {
  TRUST_KAEL: {
    cityAlert: "Elevated",
    kaelStatus: "Suspected",
    kaelTrustDelta: 25,
    raviTrustDelta: -10,
    miraMemory: "I protected Kael at the bridge.",
    raviBelief: "Mira may be hiding something.",
    scene: (branchId, eventId) => ({
      id: `${branchId}:after-trust`, branchId, protagonistId: "mira", title: "A Debt in Emberlight",
      narration: "Mira steps between Kael and the approaching guard, letting the bridge's amber lamps hide the fragment's glow. Ravi reads the pause in her voice and says nothing, but the silence lands between mentor and courier like a drawn blade. Kael slips into the festival shadows with a promise that he will explain before the Core fails again.",
      dialogue: [{ characterId: "ravi", text: "You are asking me to trust a prince who has given us no reason to." }],
      closingHook: "Somewhere below the palace, the Ember Core answers with a low, wounded pulse.", source: "fallback", sourceEventIds: [eventId],
    }),
  },
  EXPOSE_KAEL: {
    cityAlert: "Critical",
    kaelStatus: "Detained",
    kaelTrustDelta: -30,
    raviTrustDelta: 15,
    miraMemory: "I exposed Kael to Ravi.",
    raviMemory: "Mira trusted me with the truth.",
    scene: (branchId, eventId) => ({
      id: `${branchId}:after-expose`, branchId, protagonistId: "mira", title: "The Prince in Chains",
      narration: "Mira calls Ravi's name before Kael can vanish into the festival. The retired guard reaches the bridge with the city watch at his back; in a breath, the prince's secret is ironed into public fact. As Kael is led away, alarm beacons turn violet across Astra. The fragment is secured, but the crowd below has begun to understand how close the city is to falling.",
      dialogue: [{ characterId: "kael", text: "You have made fear the loudest voice in Astra." }],
      closingHook: "Ravi closes his hand around Mira's shoulder as the first panic bells begin.", source: "fallback", sourceEventIds: [eventId],
    }),
  },
};

const raviScenes: Record<Decision, (branchId: BranchId, eventId: string) => Scene> = {
  TRUST_KAEL: (branchId, eventId) => ({
    id: `${branchId}:ravi-trust`, branchId, protagonistId: "ravi", title: "The Silence Between Bells",
    narration: "Ravi watches Mira's silhouette disappear into the bridge fog and hears the old palace lesson beneath her careful words: someone is protecting a secret. He does not know what Kael carries, only that Mira has chosen to carry the risk with him. The guard captain waits for an order. Ravi gives none—yet.",
    dialogue: [{ characterId: "ravi", text: "Keep the watch close. No one leaves the eastern quarter unseen." }],
    closingHook: "Trust is not innocence, Ravi reminds himself. It is a debt that must be accounted for.", source: "fallback", sourceEventIds: [eventId],
  }),
  EXPOSE_KAEL: (branchId, eventId) => ({
    id: `${branchId}:ravi-expose`, branchId, protagonistId: "ravi", title: "A Guard's Promise",
    narration: "Ravi takes the prince's measure through the panic gathering at the bridge. Mira gave him enough to act, but not enough to explain why Kael looks relieved beneath his fear. Ravi orders a quiet route to the palace cells. He knows the city once buried an Ember failure; he will not let it bury Mira with it.",
    dialogue: [{ characterId: "ravi", text: "No spectacle. We find out what this prince knows before Astra tears itself apart." }],
    closingHook: "The alarm lights paint every familiar face a dangerous shade of violet.", source: "fallback", sourceEventIds: [eventId],
  }),
};

export function createInitialState(): StoryState {
  return { universe, entered: false, activeBranchId: "timeline_a", selectedCharacterId: null, branches: { timeline_a: initialBranch() } };
}

/** Entering is intentionally a small deterministic state change for the landing-to-reader transition. */
export function enterStory(state: StoryState): StoryState {
  return state.entered ? state : { ...state, entered: true };
}

function clampTrust(value: number): number { return Math.max(-100, Math.min(100, value)); }

function updateCharacter(
  character: CharacterRuntime,
  patch: Partial<Omit<CharacterRuntime, "id" | "relationships">> & { relationships?: Partial<Record<CharacterId, number>> },
): CharacterRuntime {
  return { ...character, ...patch, relationships: patch.relationships ? { ...character.relationships, ...patch.relationships } : character.relationships };
}

function activeBranch(state: StoryState): BranchState { return state.branches[state.activeBranchId]!; }

function makeDecisionEvent(branch: BranchState, decision: Decision, actionId: string): StoryEvent {
  return {
    id: `${branch.id}:bridge:${decision.toLowerCase()}`,
    branchId: branch.id,
    sequence: branch.events.length + 1,
    type: "CHARACTER_DECISION",
    actorId: "mira",
    payload: { action: decision, location: "eastern_bridge", actionId },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Pure canonical decision reducer. A branch accepts one bridge decision; repeated
 * submissions (whether the same action id or a new click) return the existing state.
 */
export function commitDecision(state: StoryState, decision: Decision, actionId = `bridge:${decision}`): StoryState {
  const branch = activeBranch(state);
  if (branch.selectedDecision || branch.events.some((event) => event.payload.actionId === actionId)) return state;
  const effect = decisionEffects[decision];
  const event = makeDecisionEvent(branch, decision, actionId);
  const nextSequence = event.sequence;
  const miraMemory: Memory = { id: `${branch.id}:mira:${decision}`, text: effect.miraMemory, sequence: nextSequence, remembered: true };
  const raviBelief: Belief | undefined = effect.raviBelief ? { id: `${branch.id}:ravi:belief:${decision}`, text: effect.raviBelief, sequence: nextSequence } : undefined;
  const raviMemory: Memory | undefined = effect.raviMemory ? { id: `${branch.id}:ravi:${decision}`, text: effect.raviMemory, sequence: nextSequence, remembered: true } : undefined;
  const characters = {
    ...branch.characters,
    mira: updateCharacter(branch.characters.mira, { memories: [...branch.characters.mira.memories, miraMemory] }),
    ravi: updateCharacter(branch.characters.ravi, {
      memories: raviMemory ? [...branch.characters.ravi.memories, raviMemory] : branch.characters.ravi.memories,
      beliefs: raviBelief ? [...branch.characters.ravi.beliefs, raviBelief] : branch.characters.ravi.beliefs,
      relationships: { mira: clampTrust(branch.characters.ravi.relationships.mira + effect.raviTrustDelta) },
    }),
    kael: updateCharacter(branch.characters.kael, {
      relationships: { mira: clampTrust(branch.characters.kael.relationships.mira + effect.kaelTrustDelta) },
    }),
  };
  const nextBranch: BranchState = {
    ...branch,
    selectedDecision: decision,
    decisionActionId: actionId,
    world: { ...branch.world, cityAlert: effect.cityAlert, kaelStatus: effect.kaelStatus },
    characters,
    events: [...branch.events, event],
    scene: effect.scene(branch.id, event.id),
  };
  return { ...state, entered: true, branches: { ...state.branches, [branch.id]: nextBranch } };
}

/** Restores the immutable pre-decision seed into Timeline B, then commits the opposite event. */
export function createAlternateBranch(state: StoryState): StoryState {
  if (state.branches.timeline_b) return state;
  const source = activeBranch(state);
  if (!source.selectedDecision) return state;
  const alternate: Decision = source.selectedDecision === "TRUST_KAEL" ? "EXPOSE_KAEL" : "TRUST_KAEL";
  const restored = initialBranch();
  const forked: BranchState = {
    ...restored,
    id: "timeline_b",
    name: "Timeline B",
    accent: "violet",
    parentBranchId: source.id,
    forkEventId: source.events.find((event) => event.type === "CHARACTER_DECISION")?.id,
    scene: { ...openingScene, id: "timeline_b:opening", branchId: "timeline_b" },
  };
  const forkedState: StoryState = { ...state, activeBranchId: "timeline_b", branches: { ...state.branches, timeline_b: forked } };
  return commitDecision(forkedState, alternate, "alternate-bridge-decision");
}

export function switchBranch(state: StoryState, branchId: string): StoryState {
  if (branchId !== "timeline_a" && branchId !== "timeline_b") return state;
  if (!state.branches[branchId]) return state;
  return { ...state, activeBranchId: branchId };
}

export function switchProtagonist(state: StoryState, characterId: "ravi"): StoryState {
  const branch = activeBranch(state);
  if (characterId !== "ravi" || !branch.selectedDecision) return state;
  const decisionEvent = branch.events.find((event) => event.type === "CHARACTER_DECISION");
  if (!decisionEvent) return state;
  const alreadyRavi = branch.protagonistId === "ravi";
  const events = alreadyRavi
    ? branch.events
    : [...branch.events, {
        id: `${branch.id}:protagonist:ravi`, branchId: branch.id, sequence: branch.events.length + 1,
        type: "PROTAGONIST_SWITCH" as const, actorId: "ravi" as const,
        payload: { protagonist: "ravi" }, causedBy: decisionEvent.id, createdAt: "2026-01-01T00:00:01.000Z",
      }];
  const nextBranch: BranchState = { ...branch, protagonistId: "ravi", events, scene: raviScenes[branch.selectedDecision](branch.id, decisionEvent.id) };
  return { ...state, selectedCharacterId: "ravi", branches: { ...state.branches, [branch.id]: nextBranch } };
}

/**
 * Replaces only the presentation scene on the active timeline. Canonical world,
 * character, and event projections stay owned by the deterministic reducers.
 */
export function replaceScene(state: StoryState, scene: Scene): StoryState {
  const branch = activeBranch(state);
  if (scene.branchId !== branch.id) return state;
  const nextBranch: BranchState = { ...branch, scene: { ...scene, dialogue: [...scene.dialogue], sourceEventIds: [...scene.sourceEventIds] } };
  return { ...state, branches: { ...state.branches, [branch.id]: nextBranch } };
}

export function resetStory(): StoryState { return createInitialState(); }

export function getCharacterView(state: StoryState, characterId: CharacterId, branchId: BranchId = state.activeBranchId): CharacterView {
  const branch = state.branches[branchId];
  if (!branch) throw new Error(`Unknown branch: ${branchId}`);
  const runtime = branch.characters[characterId];
  const definition = characterDefinitions[characterId];
  return { ...definition, ...runtime, memories: [...runtime.memories], knownFacts: [...runtime.knownFacts], beliefs: [...runtime.beliefs], relationships: { ...runtime.relationships } };
}

function worldView(branch: BranchState): WorldView {
  const { emberStability, cityAlert, kaelStatus, location } = branch.world;
  return { emberStability, cityAlert, kaelStatus, location };
}

export function getStoryViewState(state: StoryState): StoryViewState {
  const branch = activeBranch(state);
  return {
    universe: state.universe,
    entered: state.entered,
    activeBranchId: state.activeBranchId,
    activeBranch: { id: branch.id, name: branch.name, accent: branch.accent, selectedDecision: branch.selectedDecision, protagonistId: branch.protagonistId },
    selectedCharacterId: state.selectedCharacterId,
    world: worldView(branch),
    characters: (["mira", "ravi", "kael"] as CharacterId[]).map((id) => getCharacterView(state, id)),
    events: [...branch.events],
    scene: branch.scene,
    timelines: (["timeline_a", "timeline_b"] as BranchId[]).flatMap((id) => {
      const candidate = state.branches[id];
      return candidate ? [{ id, name: candidate.name, accent: candidate.accent, selectedDecision: candidate.selectedDecision, world: worldView(candidate), eventCount: candidate.events.length, isActive: id === state.activeBranchId }] : [];
    }),
    canMakeDecision: branch.selectedDecision === null,
    canCreateAlternateBranch: Boolean(branch.selectedDecision && !state.branches.timeline_b),
  };
}
