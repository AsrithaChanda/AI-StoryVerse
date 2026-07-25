export type CharacterId = "mira" | "ravi" | "kael";
export type Decision = "TRUST_KAEL" | "EXPOSE_KAEL";
export type BranchId = "timeline_a" | "timeline_b";

export type CityAlert = "Elevated" | "Critical";
export type KaelStatus = "Suspected" | "Detained";

export type Memory = {
  id: string;
  text: string;
  sequence: number;
  remembered?: boolean;
};

export type Belief = {
  id: string;
  text: string;
  sequence: number;
};

export type CharacterRuntime = {
  id: CharacterId;
  emotion: string;
  location: string;
  memories: readonly Memory[];
  knownFacts: readonly string[];
  beliefs: readonly Belief[];
  relationships: Readonly<Record<CharacterId, number>>;
};

export type CharacterDefinition = {
  id: CharacterId;
  name: string;
  role: string;
  personality: readonly string[];
  goal: string;
  startingEmotion: string;
};

export type CharacterView = CharacterDefinition & {
  emotion: string;
  location: string;
  memories: readonly Memory[];
  knownFacts: readonly string[];
  beliefs: readonly Belief[];
  relationships: Readonly<Record<CharacterId, number>>;
};

/** Canonical truth is deliberately separate from any character's beliefs. */
export type WorldTruth = {
  emberStability: number;
  cityAlert: CityAlert;
  kaelStatus: KaelStatus;
  location: string;
  fragmentLocation: "with_kael";
  /** Not exposed by `getCharacterView`; only Kael initially knows this reason. */
  kaelFragmentPurpose: string;
};

export type WorldView = Pick<
  WorldTruth,
  "emberStability" | "cityAlert" | "kaelStatus" | "location"
>;

export type StoryEvent = {
  id: string;
  branchId: BranchId;
  sequence: number;
  type: "CHARACTER_DECISION" | "PROTAGONIST_SWITCH";
  actorId: CharacterId;
  payload: Readonly<Record<string, string | number | boolean>>;
  causedBy?: string;
  createdAt: string;
};

export type Scene = {
  id: string;
  branchId: BranchId;
  protagonistId: CharacterId;
  title: string;
  narration: string;
  dialogue: readonly { characterId: CharacterId; text: string }[];
  closingHook: string;
  source: "fallback" | "generated";
  sourceEventIds: readonly string[];
};

export type Universe = {
  id: "the-last-ember";
  title: "The Last Ember";
  premise: string;
  rules: readonly string[];
};

export type BranchState = {
  id: BranchId;
  name: "Timeline A" | "Timeline B";
  accent: "amber" | "violet";
  parentBranchId?: BranchId;
  forkEventId?: string;
  selectedDecision: Decision | null;
  decisionActionId?: string;
  world: WorldTruth;
  characters: Readonly<Record<CharacterId, CharacterRuntime>>;
  events: readonly StoryEvent[];
  protagonistId: CharacterId;
  scene: Scene;
};

export type StoryState = {
  universe: Universe;
  entered: boolean;
  activeBranchId: BranchId;
  selectedCharacterId: CharacterId | null;
  branches: Readonly<Partial<Record<BranchId, BranchState>>>;
};

export type TimelineView = {
  id: BranchId;
  name: "Timeline A" | "Timeline B";
  accent: "amber" | "violet";
  selectedDecision: Decision | null;
  world: WorldView;
  eventCount: number;
  isActive: boolean;
};

/** A safe, presentation-oriented projection. Private canonical truth is omitted. */
export type StoryViewState = {
  universe: Universe;
  entered: boolean;
  activeBranchId: BranchId;
  activeBranch: Pick<BranchState, "id" | "name" | "accent" | "selectedDecision" | "protagonistId">;
  selectedCharacterId: CharacterId | null;
  world: WorldView;
  characters: readonly CharacterView[];
  events: readonly StoryEvent[];
  scene: Scene;
  timelines: readonly TimelineView[];
  canMakeDecision: boolean;
  canCreateAlternateBranch: boolean;
};
