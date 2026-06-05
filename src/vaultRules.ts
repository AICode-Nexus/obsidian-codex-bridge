import type { App } from "obsidian";

export async function readVaultInstructions(app: App): Promise<string> {
  const file = app.vault.getFileByPath("AGENTS.md");
  if (!file) {
    return "";
  }
  return app.vault.cachedRead(file);
}
