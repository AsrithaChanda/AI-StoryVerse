/** Cross-team integration contract. Do not edit outside the designated owner. */
export type Decision = "TRUST_KAEL" | "EXPOSE_KAEL";
export type CharacterId = "mira" | "ravi" | "kael";

export type StoryController = {
  state: import("./domain/types").StoryViewState;
  enterUniverse(): Promise<void>;
  commitDecision(decision: Decision): Promise<void>;
  inspectCharacter(characterId: CharacterId): void;
  switchProtagonist(characterId: "ravi"): Promise<void>;
  createAlternateBranch(): Promise<void>;
  switchBranch(branchId: string): Promise<void>;
  resetDemo(): Promise<void>;
};

export type SceneGenerator = {
  generate(input: import("./ai/types").SceneGenerationInput): Promise<import("./ai/types").GeneratedScene>;
};
