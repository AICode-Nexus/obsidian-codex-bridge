import {
  App,
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import { canApplySuggestedEdit } from "./applyGuard";
import { resolveCurrentMarkdownFile } from "./currentNote";
import { callOpenAI } from "./openaiClient";
import { diagnoseLocalAgent, runLocalAgent } from "./localAgent";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type BackendMode,
  type CodexBridgeSettings
} from "./settings";
import { buildDiffPreview, extractUpdatedNoteFromSuggestion } from "./suggestions";
import { readVaultInstructions } from "./vaultRules";
import { resolveVaultPath } from "./vaultPath";

const VIEW_TYPE_CODEX_BRIDGE = "codex-bridge-view";

interface SuggestionState {
  note: TFile;
  original: string;
  response: string;
  updatedNote: string | null;
}

export default class CodexBridgePlugin extends Plugin {
  settings: CodexBridgeSettings = DEFAULT_SETTINGS;
  private view: CodexBridgeView | null = null;
  private latestSuggestion: SuggestionState | null = null;
  private lastMarkdownFile: TFile | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_BRIDGE, (leaf) => {
      this.view = new CodexBridgeView(leaf, this);
      return this.view;
    });

    this.addRibbonIcon("sparkles", "Codex Bridge", () => {
      void this.activateView();
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension === "md") {
          this.lastMarkdownFile = file;
        }
      })
    );

    this.addCommand({
      id: "open-codex-bridge",
      name: "Open Codex Bridge",
      callback: () => void this.activateView()
    });

    this.addCommand({
      id: "ask-about-current-note",
      name: "Ask about current note",
      callback: () => void this.askAboutCurrentNote()
    });

    this.addCommand({
      id: "suggest-edits-current-note",
      name: "Suggest edits for current note",
      callback: () => void this.suggestEditsForCurrentNote()
    });

    this.addCommand({
      id: "apply-latest-suggested-edit",
      name: "Apply latest suggested edit",
      checkCallback: (checking) => {
        const canApply = Boolean(this.latestSuggestion?.updatedNote);
        if (!checking && canApply) {
          void this.applyLatestSuggestion();
        }
        return canApply;
      }
    });

    this.addCommand({
      id: "run-local-agent-task",
      name: "Run local agent task in vault",
      callback: () => {
        new TaskModal(this.app, "Run local agent task", (task) => {
          void this.runTask(task, "local");
        }).open();
      }
    });

    this.addCommand({
      id: "diagnose-local-backend",
      name: "Diagnose local backend",
      callback: () => void this.diagnoseLocalBackend()
    });

    this.addSettingTab(new CodexBridgeSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CODEX_BRIDGE);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CODEX_BRIDGE)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CODEX_BRIDGE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async askAboutCurrentNote(): Promise<void> {
    new TaskModal(this.app, "Ask Codex Bridge", (task) => {
      void this.runTask(task);
    }).open();
  }

  async suggestEditsForCurrentNote(): Promise<void> {
    await this.runTask(
      [
        "Suggest concrete improvements for this note.",
        "Then output a complete rewritten note in exactly one fenced block labelled markdown updated-note.",
        "Use four backticks for the outer fence so inner Markdown code fences remain safe.",
        "The final block must look like:",
        "````markdown updated-note",
        "# Full rewritten note",
        "````"
      ].join("\n")
    );
  }

  async runTask(task: string, forcedBackend?: BackendMode): Promise<void> {
    const note = this.getCurrentMarkdownFile();
    if (!note) {
      new Notice("Open a Markdown note first.");
      return;
    }

    await this.activateView();
    this.view?.setStatus("Running...");

    try {
      const vaultPath = this.getVaultPath();
      const noteContent = await this.app.vault.cachedRead(note);
      const truncatedContent = noteContent.slice(0, this.settings.maxNoteChars);
      const vaultInstructions = await readVaultInstructions(this.app);
      const response =
        (forcedBackend ?? this.settings.backendMode) === "openai"
          ? await callOpenAI({
              settings: this.settings,
              task,
              notePath: note.path,
              noteContent: truncatedContent,
              vaultInstructions
            })
          : await runLocalAgent({
              settings: this.settings,
              vaultPath,
              notePath: note.path,
              noteContent: truncatedContent,
              task,
              vaultInstructions
            });

      const updatedNote = extractUpdatedNoteFromSuggestion(response);
      this.latestSuggestion = {
        note,
        original: noteContent,
        response,
        updatedNote
      };
      this.view?.setResult(response, updatedNote ? buildDiffPreview(noteContent, updatedNote) : "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.view?.setStatus(`Error: ${message}`);
      new Notice(message);
    }
  }

  async diagnoseLocalBackend(): Promise<void> {
    await this.activateView();
    this.view?.setStatus("Running diagnostics...");

    try {
      const result = await diagnoseLocalAgent({
        settings: this.settings,
        vaultPath: this.getVaultPath()
      });
      this.view?.setResult(result.report, "");
      new Notice(result.ok ? "Local backend diagnostics passed." : "Local backend diagnostics found issues.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.view?.setStatus(`Diagnostics error: ${message}`);
      new Notice(message);
    }
  }

  async applyLatestSuggestion(): Promise<void> {
    if (!this.latestSuggestion?.updatedNote) {
      new Notice("No full-note suggestion is available.");
      return;
    }

    const suggestion = this.latestSuggestion;
    if (this.settings.showDiffBeforeApply) {
      new ConfirmApplyModal(this.app, suggestion, () => void this.writeSuggestion(suggestion)).open();
      return;
    }

    await this.writeSuggestion(suggestion);
  }

  private async writeSuggestion(suggestion: SuggestionState): Promise<void> {
    const current = await this.app.vault.read(suggestion.note);
    const guard = canApplySuggestedEdit({
      original: suggestion.original,
      current
    });
    if (!guard.ok) {
      new Notice(guard.reason);
      this.view?.setStatus(`Apply blocked: ${guard.reason}`);
      return;
    }
    await this.app.vault.modify(suggestion.note, suggestion.updatedNote ?? suggestion.original);
    new Notice("Suggested edit applied.");
  }

  private getCurrentMarkdownFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = view?.file ?? this.app.workspace.getActiveFile();
    return resolveCurrentMarkdownFile(activeFile, this.lastMarkdownFile);
  }

  private getVaultPath(): string {
    const path = resolveVaultPath(this.app.vault.adapter);
    if (!path) {
      throw new Error("This vault does not expose a local filesystem path.");
    }
    return path;
  }
}

class CodexBridgeView extends ItemView {
  private plugin: CodexBridgePlugin;
  private statusText = "Ready";

  constructor(leaf: WorkspaceLeaf, plugin: CodexBridgePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CODEX_BRIDGE;
  }

  getDisplayText(): string {
    return "Codex Bridge";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
  }

  setStatus(status: string): void {
    this.statusText = status;
    this.renderShell(status);
  }

  setResult(response: string, diff: string): void {
    this.statusText = diff ? "Suggestion ready" : "Response ready";
    const container = this.contentContainer();
    container.empty();
    this.renderHeader(container);
    this.renderActions(container);
    const result = container.createDiv({ cls: "codex-bridge-panel codex-bridge-result" });
    result.createDiv({ text: diff ? "Assistant response" : "Result", cls: "codex-bridge-section-label" });
    result.createEl("div", { text: response, cls: "codex-bridge-output" });
    if (diff) {
      const diffPanel = container.createDiv({ cls: "codex-bridge-panel" });
      const diffHeader = diffPanel.createDiv({ cls: "codex-bridge-panel-header" });
      diffHeader.createDiv({ text: "Diff preview", cls: "codex-bridge-section-label" });
      const applyButton = diffHeader.createEl("button", {
        text: "Apply",
        cls: "mod-cta codex-bridge-apply"
      });
      applyButton.addEventListener("click", () => void this.plugin.applyLatestSuggestion());
      diffPanel.createEl("pre", { text: diff, cls: "codex-bridge-diff" });
    }
  }

  private renderShell(status = "Ready."): void {
    this.statusText = status.replace(/\.$/, "");
    const container = this.contentContainer();
    container.empty();
    this.renderHeader(container);
    this.renderActions(container);
    const empty = container.createDiv({ cls: "codex-bridge-empty" });
    empty.createDiv({ text: "Open a note, ask a question, or run diagnostics.", cls: "codex-bridge-empty-title" });
    empty.createDiv({
      text: "Results appear here without changing your note unless you explicitly apply a suggested rewrite.",
      cls: "codex-bridge-empty-copy"
    });
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "codex-bridge-header" });
    const titleBlock = header.createDiv();
    titleBlock.createEl("h2", { text: "Codex Bridge", cls: "codex-bridge-title" });
    titleBlock.createDiv({ text: "Obsidian note agent", cls: "codex-bridge-subtitle" });
    header.createDiv({ text: this.statusText, cls: "codex-bridge-status" });
  }

  private renderActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "codex-bridge-actions" });
    const ask = actions.createEl("button", { text: "Ask", cls: "mod-cta codex-bridge-action" });
    ask.setAttribute("aria-label", "Ask about current note");
    ask.addEventListener("click", () => void this.plugin.askAboutCurrentNote());

    const suggest = actions.createEl("button", { text: "Suggest", cls: "codex-bridge-action" });
    suggest.setAttribute("aria-label", "Suggest edits for current note");
    suggest.addEventListener("click", () => void this.plugin.suggestEditsForCurrentNote());

    const diagnose = actions.createEl("button", { text: "Diagnose", cls: "codex-bridge-action" });
    diagnose.setAttribute("aria-label", "Diagnose local backend");
    diagnose.addEventListener("click", () => void this.plugin.diagnoseLocalBackend());
  }

  private contentContainer(): HTMLElement {
    return this.contentEl;
  }
}

class TaskModal extends Modal {
  private readonly title: string;
  private readonly onSubmit: (task: string) => void;
  private task = "";

  constructor(app: App, title: string, onSubmit: (task: string) => void) {
    super(app);
    this.title = title;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.title });
    new Setting(contentEl).setName("Task").addTextArea((text) => {
      text.setPlaceholder("What should the agent do with the current note?");
      text.inputEl.rows = 8;
      text.onChange((value) => {
        this.task = value;
      });
    });
    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Run")
        .setCta()
        .onClick(() => {
          if (this.task.trim()) {
            this.close();
            this.onSubmit(this.task.trim());
          }
        })
    );
  }
}

class ConfirmApplyModal extends Modal {
  private readonly suggestion: SuggestionState;
  private readonly onConfirm: () => void;

  constructor(app: App, suggestion: SuggestionState, onConfirm: () => void) {
    super(app);
    this.suggestion = suggestion;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Apply suggested edit?" });
    this.contentEl.createEl("pre", {
      text: buildDiffPreview(this.suggestion.original, this.suggestion.updatedNote ?? ""),
      cls: "codex-bridge-diff"
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("Apply")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }
}

class CodexBridgeSettingTab extends PluginSettingTab {
  private readonly plugin: CodexBridgePlugin;

  constructor(app: App, plugin: CodexBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Codex Bridge" });

    new Setting(containerEl)
      .setName("Backend")
      .setDesc("Local mode runs a command in the vault. OpenAI mode calls the Responses API.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "Local command")
          .addOption("openai", "OpenAI API")
          .setValue(this.plugin.settings.backendMode)
          .onChange(async (value) => {
            this.plugin.settings.backendMode = value as BackendMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored in Obsidian plugin data on this device.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.openAIApiKey).onChange(async (value) => {
          this.plugin.settings.openAIApiKey = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("OpenAI model").addText((text) =>
      text.setValue(this.plugin.settings.openAIModel).onChange(async (value) => {
        this.plugin.settings.openAIModel = value.trim() || DEFAULT_SETTINGS.openAIModel;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("OpenAI base URL").addText((text) =>
      text.setValue(this.plugin.settings.openAIBaseUrl).onChange(async (value) => {
        this.plugin.settings.openAIBaseUrl = value.trim() || DEFAULT_SETTINGS.openAIBaseUrl;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("Local command").addText((text) =>
      text.setValue(this.plugin.settings.localCommand).onChange(async (value) => {
        this.plugin.settings.localCommand = value.trim() || DEFAULT_SETTINGS.localCommand;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl)
      .setName("Local arguments")
      .setDesc("Use {{vaultPath}} and {{notePath}} placeholders. The prompt is sent on stdin.")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.setValue(this.plugin.settings.localArgs).onChange(async (value) => {
          this.plugin.settings.localArgs = value.trim() || DEFAULT_SETTINGS.localArgs;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Show diff before applying")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showDiffBeforeApply).onChange(async (value) => {
          this.plugin.settings.showDiffBeforeApply = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Max note characters").addText((text) =>
      text.setValue(String(this.plugin.settings.maxNoteChars)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.maxNoteChars = Number.isFinite(parsed)
          ? parsed
          : DEFAULT_SETTINGS.maxNoteChars;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("Local timeout ms").addText((text) =>
      text.setValue(String(this.plugin.settings.localTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.localTimeoutMs = Number.isFinite(parsed)
          ? parsed
          : DEFAULT_SETTINGS.localTimeoutMs;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("Extra instructions").addTextArea((text) => {
      text.inputEl.rows = 5;
      text.setValue(this.plugin.settings.extraInstructions).onChange(async (value) => {
        this.plugin.settings.extraInstructions = value;
        await this.plugin.saveSettings();
      });
    });
  }
}
