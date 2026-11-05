import type { AgentEvent } from "@earendil-works/pi-agent-core";

/** Reads the tool payload a `tool_execution_end` event carries. */
export function toolDetails(event: Extract<AgentEvent, { type: "tool_execution_end" }>): Record<string, unknown> {
  const result = event.result as { details?: unknown; structuredContent?: unknown } | undefined;
  const value = result?.details ?? result?.structuredContent;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Reads the structured payload a `tool_execution_end` event carries. */
export function toolStructured(event: Extract<AgentEvent, { type: "tool_execution_end" }>): unknown {
  const result = event.result as { structuredContent?: unknown } | undefined;
  return result?.structuredContent;
}

/** Reads the text an assistant message carries. */
export function eventText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part: unknown): part is { type: "text"; text: string } =>
      Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"))
    .map((part: { text: string }) => part.text)
    .join("\n")
    .trim();
}
