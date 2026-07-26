export type TimeMachineJobStatus = "queued" | "running" | "illustrating" | "completed" | "failed";

export type TimeMachineJob = {
  id: string;
  worldId: string;
  targetChapterId: string;
  targetChapterNumber: number;
  changePrompt: string;
  futurePrompt?: string;
  baseStoryVersion: number;
  baseStoryUpdatedAt: string;
  totalChapters: number;
  completedChapters: number;
  status: TimeMachineJobStatus;
  progress: number;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};

async function request(path: string, init?: RequestInit): Promise<{ job: TimeMachineJob | null }> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const payload = await response.json() as { job: TimeMachineJob | null; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The Story Time Machine could not complete that request.");
  return payload;
}

export const getTimeMachineJob = (worldId: string) =>
  request(`/api/worlds/${encodeURIComponent(worldId)}/time-machine`);

export const startTimeMachine = (
  worldId: string,
  input: { targetChapterId: string; changePrompt: string; futurePrompt?: string },
) => request(`/api/worlds/${encodeURIComponent(worldId)}/time-machine`, {
  method: "POST",
  body: JSON.stringify(input),
});
