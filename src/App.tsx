import { useEffect, useState } from "react";
import { createWorld, listWorlds, type CreateWorldInput, type World } from "./api/worlds";
import StoryExperience from "./components/StoryExperience";
import { generateWorldCover, loadWorldCover } from "./images/api";

export default function App() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [worldsLoading, setWorldsLoading] = useState(true);
  const [worldError, setWorldError] = useState<string | undefined>();
  const [selectedWorld, setSelectedWorld] = useState<World | null>(null);

  useEffect(() => {
    let active = true;
    void listWorlds()
      .then((savedWorlds) => {
        if (!active) return;
        setWorlds(savedWorlds);
        setWorldError(undefined);
      })
      .catch(() => {
        if (active) setWorldError("The world archive is unavailable. Start the API with npm run dev, then refresh.");
      })
      .finally(() => {
        if (active) setWorldsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleCreateWorld = async (input: CreateWorldInput): Promise<void> => {
    const world = await createWorld(input);
    setWorlds((current) => [world, ...current]);
    setSelectedWorld(world);
  };

  const loadOrGenerateWorldCover = async (request: Parameters<typeof loadWorldCover>[0]) => {
    return (await loadWorldCover(request)) ?? generateWorldCover(request);
  };

  return <StoryExperience
    worlds={worlds}
    worldsLoading={worldsLoading}
    worldError={worldError}
    createWorld={handleCreateWorld}
    selectWorld={setSelectedWorld}
    selectedWorld={selectedWorld}
    closeWorld={() => setSelectedWorld(null)}
    loadWorldCover={loadOrGenerateWorldCover}
    retryWorldCover={(request) => generateWorldCover(request, true)}
  />;
}
