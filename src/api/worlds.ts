export type World = {
  id: string;
  title: string;
  premise: string;
  genre: string;
  creatorPrompt: string;
  openingScene: string;
  characters: Array<{ name: string; role: string; trait: string }>;
  source: "openai" | "fallback";
  createdAt: string;
};

export type CreateWorldInput = Pick<World, "title" | "premise" | "genre" | "creatorPrompt">;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The archive could not complete that request.");
  return payload;
}

export async function listWorlds(): Promise<World[]> { return (await request<{ worlds: World[] }>("/api/worlds")).worlds; }
export async function createWorld(input: CreateWorldInput): Promise<World> {
  return (await request<{ world: World }>("/api/worlds", { method: "POST", body: JSON.stringify(input) })).world;
}
