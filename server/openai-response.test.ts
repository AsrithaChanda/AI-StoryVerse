import { describe, expect, it } from "vitest";
import { extractOutputText, responseDiagnostics } from "./openai-response.js";
import { collectResponseOutputText } from "./story-stream.js";

function responseEventStream(events: Array<{ event: string; payload: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const sse = events.map(({ event, payload }) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
}

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

  it("does not expose partial output text from an incomplete response", () => {
    expect(extractOutputText({
      status: "incomplete",
      output_text: '{"chapter":"partial"}',
      incomplete_details: { reason: "max_output_tokens" },
    })).toBeNull();
  });

  it("accepts a canonical completed Responses stream after in-progress events", async () => {
    const result = await collectResponseOutputText(responseEventStream([
      { event: "response.created", payload: { type: "response.created", response: { status: "in_progress", incomplete_details: null } } },
      { event: "response.in_progress", payload: { type: "response.in_progress", response: { status: "in_progress", incomplete_details: null } } },
      { event: "response.output_text.delta", payload: { type: "response.output_text.delta", delta: '{"chapter":1}' } },
      { event: "response.output_text.done", payload: { type: "response.output_text.done", text: '{"chapter":1}' } },
      { event: "response.completed", payload: { type: "response.completed", response: { status: "completed", incomplete_details: null } } },
    ]));

    expect(result).toEqual({ ok: true, outputText: '{"chapter":1}' });
  });

  it("rejects a completed stream event whose nested Response status is incomplete", async () => {
    const result = await collectResponseOutputText(responseEventStream([
      { event: "response.output_text.delta", payload: { type: "response.output_text.delta", delta: '{"chapter":"partial"}' } },
      {
        event: "response.completed",
        payload: {
          type: "response.completed",
          response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
        },
      },
    ]));

    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });
});
