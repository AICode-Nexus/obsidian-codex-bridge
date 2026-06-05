import type { CodexBridgeSettings } from "./settings";
import { normalizeBaseUrl } from "./settings";

export interface OpenAIRequestInput {
  settings: CodexBridgeSettings;
  task: string;
  notePath: string;
  noteContent: string;
  vaultInstructions?: string;
}

export interface BuiltOpenAIRequest {
  url: string;
  init: RequestInit;
}

export function buildOpenAIRequest(input: OpenAIRequestInput): BuiltOpenAIRequest {
  const url = `${normalizeBaseUrl(input.settings.openAIBaseUrl)}/responses`;
  const body = {
    model: input.settings.openAIModel,
    instructions: [
      "You are an Obsidian vault assistant.",
      "Help with the current Markdown note while respecting the user's vault rules.",
      "When suggesting a full rewrite, include exactly one fenced block marked `markdown updated-note`.",
      input.settings.extraInstructions,
      input.vaultInstructions
    ]
      .filter(Boolean)
      .join("\n\n"),
    input: [
      `Task: ${input.task}`,
      `Note path: ${input.notePath}`,
      input.vaultInstructions ? `Vault instructions:\n${input.vaultInstructions}` : "",
      "Current note:",
      "```markdown",
      input.noteContent,
      "```"
    ]
      .filter(Boolean)
      .join("\n")
  };

  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.settings.openAIApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  };
}

export async function callOpenAI(input: OpenAIRequestInput): Promise<string> {
  if (!input.settings.openAIApiKey.trim()) {
    throw new Error("OpenAI API key is not configured.");
  }

  const request = buildOpenAIRequest(input);
  const response = await fetch(request.url, request.init);
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(extractOpenAIError(payload) ?? `OpenAI request failed with ${response.status}.`);
  }

  const text = extractResponseText(payload);
  if (!text) {
    throw new Error("OpenAI response did not include text output.");
  }
  return text;
}

function extractOpenAIError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : null;
}

export function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }

  return parts.join("\n").trim();
}
