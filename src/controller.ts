import { buildSceneInput, createSceneGenerator } from "./ai";
import type { GeneratedScene } from "./ai";
import {
  commitDecision,
  createAlternateBranch,
  createInitialState,
  enterStory,
  getCharacterView,
  getStoryViewState,
  replaceScene,
  resetStory,
  switchBranch,
  switchProtagonist,
} from "./domain";
import type { CharacterId, Decision, Scene, StoryState, StoryViewState } from "./domain";
import { clearPersisted, loadPersisted, savePersisted } from "./persistence";

function consequences(decision: Decision | null): string[] {
  if (decision === "TRUST_KAEL") return ["Kael remains free", "City alert remains Elevated", "Kael trusts Mira more; Ravi trusts her less"];
  if (decision === "EXPOSE_KAEL") return ["Kael is detained", "City alert is Critical", "Ravi trusts Mira more; Kael trusts her less"];
  return ["The bridge confrontation is unresolved"];
}

function toDomainScene(generated: GeneratedScene, state: StoryState): Scene {
  const view = getStoryViewState(state);
  return {
    id: `${view.activeBranchId}:generated:${view.events.length}`,
    branchId: view.activeBranchId,
    protagonistId: view.activeBranch.protagonistId,
    title: generated.title,
    narration: generated.narration,
    dialogue: generated.dialogue,
    closingHook: generated.closingHook,
    source: generated.source === "provider" ? "generated" : "fallback",
    sourceEventIds: view.events.map((event) => event.id),
  };
}

/** Browser-side orchestrator. Its reducer remains the sole authority for world state. */
export class LastEmberController {
  private story: StoryState;
  private generating = false;

  public constructor(initial?: StoryState) {
    this.story = initial ?? loadPersisted<StoryState>() ?? createInitialState();
  }

  public get state(): StoryViewState { return getStoryViewState(this.story); }
  public get isGenerating(): boolean { return this.generating; }

  private persist(): void { savePersisted(this.story); }

  private async refreshScene(mode: "decision" | "protagonist"): Promise<void> {
    const view = this.state;
    const protagonist = getCharacterView(this.story, view.activeBranch.protagonistId);
    const input = buildSceneInput({
      branchId: view.activeBranchId,
      branchName: view.activeBranch.name,
      protagonistId: protagonist.id,
      protagonistName: protagonist.name,
      protagonist: {
        personality: protagonist.personality,
        knownFacts: protagonist.knownFacts,
        memories: protagonist.memories.map((memory) => memory.text),
        beliefs: protagonist.beliefs.map((belief) => belief.text),
      },
      worldState: view.world,
      recentEvents: view.events.map((event) => `${event.type}: ${String(event.payload.action ?? event.payload.protagonist ?? "committed")}`),
      requiredConsequences: consequences(view.activeBranch.selectedDecision),
      decision: view.activeBranch.selectedDecision ?? undefined,
      mode,
    });
    const generated = await createSceneGenerator().generate(input);
    this.story = replaceScene(this.story, toDomainScene(generated, this.story));
    this.persist();
  }

  public async enterUniverse(): Promise<void> {
    this.story = enterStory(this.story);
    this.persist();
  }

  public async commitDecision(decision: Decision): Promise<void> {
    if (this.generating || !this.state.canMakeDecision) return;
    this.generating = true;
    try {
      this.story = commitDecision(this.story, decision, `bridge:${this.state.activeBranchId}:${decision}`);
      this.persist();
      await this.refreshScene("decision");
    } finally { this.generating = false; }
  }

  public inspectCharacter(_characterId: CharacterId): void {
    void _characterId;
    // Drawer selection belongs to the presentation layer; no canonical state changes.
  }

  public async switchProtagonist(characterId: "ravi"): Promise<void> {
    if (this.generating) return;
    this.generating = true;
    try {
      this.story = switchProtagonist(this.story, characterId);
      this.persist();
      await this.refreshScene("protagonist");
    } finally { this.generating = false; }
  }

  public async createAlternateBranch(): Promise<void> {
    if (this.generating || !this.state.canCreateAlternateBranch) return;
    this.generating = true;
    try {
      this.story = createAlternateBranch(this.story);
      this.persist();
      await this.refreshScene("decision");
    } finally { this.generating = false; }
  }

  public async switchBranch(branchId: string): Promise<void> {
    this.story = switchBranch(this.story, branchId);
    this.persist();
  }

  public async resetDemo(): Promise<void> {
    this.story = resetStory();
    clearPersisted();
  }
}
