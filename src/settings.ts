export type BackendMode = "openai" | "local";

export interface CodexBridgeSettings {
  backendMode: BackendMode;
  openAIApiKey: string;
  openAIBaseUrl: string;
  openAIModel: string;
  localCommand: string;
  localArgs: string;
  showDiffBeforeApply: boolean;
  maxNoteChars: number;
  extraInstructions: string;
}

export const DEFAULT_SETTINGS: CodexBridgeSettings = {
  backendMode: "local",
  openAIApiKey: "",
  openAIBaseUrl: "https://api.openai.com/v1",
  openAIModel: "gpt-5.2",
  localCommand: "codex",
  localArgs:
    'exec --cd "{{vaultPath}}" --sandbox danger-full-access --ask-for-approval never -',
  showDiffBeforeApply: true,
  maxNoteChars: 24000,
  extraInstructions: ""
};

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
