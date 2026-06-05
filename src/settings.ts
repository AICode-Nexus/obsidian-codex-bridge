export type BackendMode = "openai" | "local";

export interface CodexBridgeSettings {
  backendMode: BackendMode;
  openAIApiKey: string;
  openAIBaseUrl: string;
  openAIModel: string;
  localCommand: string;
  localArgs: string;
  localTimeoutMs: number;
  showDiffBeforeApply: boolean;
  maxNoteChars: number;
  extraInstructions: string;
}

export const LEGACY_LOCAL_ARGS =
  'exec --cd "{{vaultPath}}" --sandbox danger-full-access --ask-for-approval never -';

export const DEFAULT_SETTINGS: CodexBridgeSettings = {
  backendMode: "local",
  openAIApiKey: "",
  openAIBaseUrl: "https://api.openai.com/v1",
  openAIModel: "gpt-5.2",
  localCommand: "codex",
  localArgs:
    'exec --cd "{{vaultPath}}" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message "{{outputFile}}" -',
  localTimeoutMs: 120000,
  showDiffBeforeApply: true,
  maxNoteChars: 24000,
  extraInstructions: ""
};

export function normalizeSettings(data: Partial<CodexBridgeSettings> | null | undefined): CodexBridgeSettings {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(data ?? {})
  };

  if (settings.localArgs === LEGACY_LOCAL_ARGS) {
    settings.localArgs = DEFAULT_SETTINGS.localArgs;
  }

  return settings;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
