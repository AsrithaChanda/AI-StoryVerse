import type { SceneGenerationInput, SceneProvider } from "./types";

/** Deterministic provider used by tests and local demos; it never calls a model. */
export class MockSceneProvider implements SceneProvider {
  readonly inputs: SceneGenerationInput[] = [];
  private cursor = 0;

  constructor(private readonly responses: Array<unknown | Error | (() => Promise<unknown>)>) {}

  async generate(input: SceneGenerationInput): Promise<unknown> {
    this.inputs.push(input);
    const response = this.responses[Math.min(this.cursor, this.responses.length - 1)];
    this.cursor += 1;
    if (response instanceof Error) throw response;
    if (typeof response === "function") return response();
    return response;
  }
}
