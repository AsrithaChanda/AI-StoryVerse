import { useEffect, useState } from "react";
import { createWorld, listWorlds, type CreateWorldInput, type World } from "./api/worlds";
import StoryExperience, { type StoryActions } from "./components/StoryExperience";
import { LastEmberController } from "./controller";
import type { Decision } from "./domain";
import { generateSceneImage, generateWorldCover, loadSceneImage, loadWorldCover } from "./images/api";

export default function App() {
  const [controller] = useState(() => new LastEmberController());
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [worlds, setWorlds] = useState<World[]>([]);
  const [worldsLoading, setWorldsLoading] = useState(true);
  const [worldError, setWorldError] = useState<string | undefined>();
  const [selectedWorld, setSelectedWorld] = useState<World | null>(null);

  const loadWorlds = async (): Promise<void> => {
    setWorldsLoading(true);
    try { setWorlds(await listWorlds()); setWorldError(undefined); }
    catch { setWorldError("The world archive is offline. Start the API with npm run dev."); }
    finally { setWorldsLoading(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorlds(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const execute = async (label: string, operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(label);
    try {
      await operation();
      setNotice(label.includes("scene") ? "A remembered scene was recovered from the offline archive." : undefined);
    } catch {
      setNotice("The chronicle paused, but your existing timeline is safe. Try again.");
    } finally {
      refresh((value) => value + 1);
      setBusy(false);
    }
  };

  const actions: StoryActions = {
    busy,
    notice,
    enterUniverse: () => execute("Entering Astra…", () => controller.enterUniverse()),
    commitDecision: (decision: Decision) => execute("The world is remembering this choice…", () => controller.commitDecision(decision)),
    inspectCharacter: (characterId) => controller.inspectCharacter(characterId),
    switchProtagonist: () => execute("Ravi is gathering his memories…", () => controller.switchProtagonist("ravi")),
    createAlternateBranch: () => execute("A second future is forming…", () => controller.createAlternateBranch()),
    switchBranch: (branchId) => execute("Switching continuity…", () => controller.switchBranch(branchId)),
    resetDemo: () => execute("Restoring the opening moment…", () => controller.resetDemo()),
  };

  const handleCreateWorld = async (input: CreateWorldInput): Promise<void> => {
    const world = await createWorld(input);
    setWorlds((current) => [world, ...current]);
    setSelectedWorld(world);
  };
  const handleSelectWorld = (world: World): void => {
    if (world.id === "the-last-ember") void actions.enterUniverse();
    else setSelectedWorld(world);
  };

  const loadOrGenerateSceneImage = async (request: Parameters<typeof loadSceneImage>[0]) => {
    const cached = await loadSceneImage(request);
    return cached ?? generateSceneImage(request);
  };
  const retrySceneImage = (request: Parameters<typeof loadSceneImage>[0]) => generateSceneImage(request, true);
  const loadOrGenerateWorldCover = async (request: Parameters<typeof loadWorldCover>[0]) => {
    const cached = await loadWorldCover(request);
    return cached ?? generateWorldCover(request);
  };
  const retryWorldCover = (request: Parameters<typeof loadWorldCover>[0]) => generateWorldCover(request, true);

  return <StoryExperience state={controller.state} actions={actions} worlds={worlds} worldsLoading={worldsLoading} worldError={worldError} createWorld={handleCreateWorld} selectWorld={handleSelectWorld} selectedWorld={selectedWorld} closeWorld={() => setSelectedWorld(null)} loadSceneImage={loadOrGenerateSceneImage} retrySceneImage={retrySceneImage} loadWorldCover={loadOrGenerateWorldCover} retryWorldCover={retryWorldCover} />;
}
