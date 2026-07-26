/** A parsed SSE message from the upstream Responses API. */
export type ProviderSseEvent = { event?: string; data: string };

export type ResponseTextStreamResult =
  | { ok: true; outputText: string }
  | { ok: false; reason: "provider_error" | "invalid_response" };

/**
 * Parses the SSE framing returned by a streamed Responses request. It does not
 * trust an event's contents: callers still parse the JSON data separately.
 */
export async function* readProviderSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ProviderSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const nextEvent = (): ProviderSseEvent | null => {
    const boundary = buffer.search(/\r?\n\r?\n/);
    if (boundary < 0) return null;
    const block = buffer.slice(0, boundary);
    const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
    buffer = buffer.slice(boundary + delimiter.length);
    const data: string[] = [];
    let event: string | undefined;
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") event = value;
      if (field === "data") data.push(value);
    }
    return data.length > 0 ? { event, data: data.join("\n") } : null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const parsed = nextEvent();
        if (!parsed) break;
        yield parsed;
      }
    }
    buffer += decoder.decode();
    while (true) {
      const parsed = nextEvent();
      if (!parsed) break;
      yield parsed;
    }
    // A well-formed provider stream ends with a blank line. Accept a final
    // complete event defensively so a proxy cannot turn a valid response into
    // a false provider error merely by stripping that trailing delimiter.
    if (buffer.trim()) {
      const data: string[] = [];
      let event: string | undefined;
      for (const line of buffer.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const separator = line.indexOf(":");
        const field = separator < 0 ? line : line.slice(0, separator);
        const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
      if (data.length > 0) yield { event, data: data.join("\n") };
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Incrementally extracts only a JSON object's `narration` string. The model
 * stream carries JSON because it uses a strict schema, so this decoder avoids
 * leaking titles, beats, or other JSON fragments to the browser.
 */
export class NarrationJsonDeltaDecoder {
  private raw = "";
  private emitted = "";

  public push(rawDelta: string): string {
    this.raw += rawDelta;
    const start = narrationValueStart(this.raw);
    if (start === null) return "";
    const decoded = decodeJsonStringPrefix(this.raw.slice(start));
    if (!decoded.startsWith(this.emitted)) return "";
    const next = decoded.slice(this.emitted.length);
    this.emitted = decoded;
    return next;
  }
}

/** Find a real JSON `narration` property, never that word inside prose. */
function narrationValueStart(raw: string): number | null {
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '"') continue;
    let end = index + 1;
    let escaped = false;
    for (; end < raw.length; end += 1) {
      if (!escaped && raw[end] === '"') break;
      escaped = !escaped && raw[end] === "\\";
      if (raw[end] !== "\\") escaped = false;
    }
    if (end >= raw.length) return null;
    const property = raw.slice(index + 1, end);
    index = end;
    if (property !== "narration") continue;
    let cursor = end + 1;
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
    if (raw[cursor] !== ":") continue;
    cursor += 1;
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
    return raw[cursor] === '"' ? cursor + 1 : null;
  }
  return null;
}

/** Consume only typed Responses text-delta events and buffer the full JSON. */
export async function collectResponseOutputText(
  body: ReadableStream<Uint8Array>,
  onTextDelta?: (delta: string) => void,
): Promise<ResponseTextStreamResult> {
  let outputText = "";
  let sawTextDelta = false;
  for await (const message of readProviderSse(body)) {
    if (message.data === "[DONE]") break;
    let payload: { type?: unknown; delta?: unknown; status?: unknown; response?: { status?: unknown } };
    try {
      payload = JSON.parse(message.data) as { type?: unknown; delta?: unknown; status?: unknown; response?: { status?: unknown } };
    } catch {
      return { ok: false, reason: "invalid_response" };
    }
    const type = typeof payload.type === "string" ? payload.type : message.event;
    if (type === "response.output_text.delta") {
      if (typeof payload.delta !== "string") return { ok: false, reason: "invalid_response" };
      sawTextDelta = true;
      outputText += payload.delta;
      onTextDelta?.(payload.delta);
      continue;
    }
    if (type === "error" || type === "response.failed" || type === "response.incomplete") return { ok: false, reason: "provider_error" };
    if (type === "response.completed") {
      const status = payload.response?.status ?? payload.status;
      if (status !== undefined && status !== "completed") return { ok: false, reason: "provider_error" };
    }
  }
  return sawTextDelta ? { ok: true, outputText } : { ok: false, reason: "invalid_response" };
}

function decodeJsonStringPrefix(raw: string): string {
  let decoded = "";
  for (let index = 0; index < raw.length; index += 1) {
    const current = raw[index];
    if (current === '"') return decoded;
    if (current !== "\\") {
      decoded += current;
      continue;
    }
    const escaped = raw[index + 1];
    if (!escaped) return decoded;
    const simpleEscapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    if (escaped in simpleEscapes) {
      decoded += simpleEscapes[escaped];
      index += 1;
      continue;
    }
    if (escaped !== "u") return decoded;
    const hexadecimal = raw.slice(index + 2, index + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) return decoded;
    const codeUnit = Number.parseInt(hexadecimal, 16);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextEscape = raw.slice(index + 6, index + 12);
      if (!/^\\u[0-9a-fA-F]{4}$/.test(nextEscape)) {
        if (raw.length < index + 12) return decoded;
        decoded += String.fromCharCode(codeUnit);
        index += 5;
        continue;
      }
      const lowerUnit = Number.parseInt(nextEscape.slice(2), 16);
      if (lowerUnit >= 0xdc00 && lowerUnit <= 0xdfff) {
        decoded += String.fromCodePoint(0x10000 + ((codeUnit - 0xd800) << 10) + (lowerUnit - 0xdc00));
        index += 11;
        continue;
      }
    }
    decoded += String.fromCharCode(codeUnit);
    index += 5;
  }
  return decoded;
}
