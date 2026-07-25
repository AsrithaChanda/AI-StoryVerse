import { describe, expect, it } from "vitest";
import { extractOutputText, responseDiagnostics } from "./openai-response.js";

describe("Responses API output extraction", () => {
  it("uses the convenience output_text when supplied", () => {
    expect(extractOutputText({ output_text: '{"chapter":1}' })).toBe('{"chapter":1}');
  });

  it("uses the canonical nested message content shape", () => {
    const payload = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"chapter":1}' }] }] };
    expect(extractOutputText(payload)).toBe('{"chapter":1}');
    expect(responseDiagnostics(payload)).toMatchObject({ responseStatus: "completed", outputItems: 1, outputTypes: "message", contentTypes: "output_text" });
  });

  it("does not treat non-text output as story text", () => {
    expect(extractOutputText({ status: "incomplete", output: [{ type: "reasoning", content: [] }], incomplete_details: { reason: "max_output_tokens" } })).toBeNull();
  });
});
