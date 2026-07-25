import { useEffect, useState } from "react";
import { createWorld, listWorlds, type CreateWorldInput, type World } from "./api/worlds";
import StoryExperience from "./components/StoryExperience";
import { generateWorldCover, loadWorldCover } from "./images/api";
import { worldIdFromSearch, worldRoute } from "./world-route";

export default function App() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [worldsLoading, setWorldsLoading] = useState(true);
  const [worldError, setWorldError] = useState<string | undefined>();
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(() => worldIdFromSearch(window.location.search));

  useEffect(() => {
    const restoreFromBrowserHistory = () => setSelectedWorldId(worldIdFromSearch(window.location.search));
    window.addEventListener("popstate", restoreFromBrowserHistory);
    return () => window.removeEventListener("popstate", restoreFromBrowserHistory);
  }, []);

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
    openWorld(world);
  };

  const openWorld = (world: World) => {
    setSelectedWorldId(world.id);
    window.history.pushState({ worldId: world.id }, "", worldRoute(window.location, world.id));
  };

  const closeWorld = () => {
    setSelectedWorldId(null);
    window.history.pushState({}, "", worldRoute(window.location, null));
  };

  const loadOrGenerateWorldCover = async (request: Parameters<typeof loadWorldCover>[0]) => {
    return (await loadWorldCover(request)) ?? generateWorldCover(request);
  };

  const selectedWorld = worlds.find((world) => world.id === selectedWorldId) ?? null;

  if (selectedWorldId && worldsLoading) return <main className="world-restoring" role="status" aria-live="polite"><p className="eyebrow">WORLD ATLAS</p><h1>Restoring your world…</h1><p>Loading its saved story, cast, and chapter archive.</p></main>;

  return <StoryExperience
    worlds={worlds}
    worldsLoading={worldsLoading}
    worldError={worldError}
    createWorld={handleCreateWorld}
    selectWorld={openWorld}
    selectedWorld={selectedWorld}
    closeWorld={closeWorld}
    loadWorldCover={loadOrGenerateWorldCover}
    retryWorldCover={(request) => generateWorldCover(request, true)}
  />;
}
