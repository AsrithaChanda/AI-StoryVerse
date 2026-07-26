export type OpenAIResponsePayload = {
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  }>;
  status?: unknown;
  incomplete_details?: { reason?: unknown } | null;
};

export type ResponseDiagnostics = {
  responseStatus: string;
  outputItems: number;
  outputTypes: string;
  contentTypes: string;
  incompleteReason?: string;
};

/**
 * The Responses API normally exposes a convenience `output_text` field, but
 * some compatible models return only the canonical output/message/content
 * structure. Read both forms without ever logging model text.
 */
export function extractOutputText(payload: OpenAIResponsePayload): string | null {
  // A provider can include a partial text field alongside an incomplete
  // response. Never let a truncated structured chapter look usable merely
  // because that partial field happens to be present.
  if (payload.status === "incomplete" || payload.status === "failed" || payload.incomplete_details) return null;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  return null;
}

export function responseDiagnostics(payload: OpenAIResponsePayload): ResponseDiagnostics {
  const outputs = Array.isArray(payload.output) ? payload.output : [];
  const outputTypes = outputs.map((item) => typeof item.type === "string" ? item.type : "unknown");
  const contentTypes = outputs.flatMap((item) => (item.content ?? []).map((content) => typeof content.type === "string" ? content.type : "unknown"));
  const incompleteReason = payload.incomplete_details && typeof payload.incomplete_details.reason === "string"
    ? payload.incomplete_details.reason
    : undefined;
  return {
    responseStatus: typeof payload.status === "string" ? payload.status : "unknown",
    outputItems: outputs.length,
    outputTypes: outputTypes.join(",") || "none",
    contentTypes: contentTypes.join(",") || "none",
    incompleteReason,
  };
}
