export type StoryCharacter = { id: string; name: string; role: string; visualDescription: string; personality: string; goal: string; memories: string[] };
export type StoryBeat = { id: string; description: string; caption: string };
export type StoryAudioDirection = { primaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; secondaryEmotion: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; intensity: number; bgmCue: "reflection" | "suspense" | "danger" | "conflict" | "grief" | "triumph"; narrationDelivery: string };
export type StoryChapter = { id: string; number: number; title: string; narration: string; beats: StoryBeat[]; audioDirection?: StoryAudioDirection; command?: string };
export type Perspective = { characterId: string; chapterId: string; narration: string; beats: StoryBeat[] };
export type WorldStory = { worldId: string; characters: StoryCharacter[]; chapters: StoryChapter[]; perspectives: Perspective[]; worldState: string; source: "openai" | "fallback"; createdAt: string; updatedAt: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The story engine could not complete that request.");
  return payload;
}

export const bootstrapStory = (worldId: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/bootstrap`, { method: "POST", body: "{}" });
export const nextChapter = (worldId: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/next`, { method: "POST", body: "{}" });
export const commandStory = (worldId: string, command: string) => request<{ story: WorldStory }>(`/api/worlds/${encodeURIComponent(worldId)}/story/command`, { method: "POST", body: JSON.stringify({ command }) });
export const characterPerspective = (worldId: string, characterId: string) => request<{ story: WorldStory; perspective: Perspective }>(`/api/worlds/${encodeURIComponent(worldId)}/story/perspective`, { method: "POST", body: JSON.stringify({ characterId }) });
