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
import { callOpenAI } from "./openaiClient";
import { runLocalAgent } from "./localAgent";
import { DEFAULT_SETTINGS, type BackendMode, type CodexBridgeSettings } from "./settings";
import { buildDiffPreview, extractUpdatedNoteFromSuggestion } from "./suggestions";
import { readVaultInstructions } from "./vaultRules";

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

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_BRIDGE, (leaf) => {
      this.view = new CodexBridgeView(leaf, this);
      return this.view;
    });

    this.addRibbonIcon("sparkles", "Codex Bridge", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-codex-bridge",
      name: "Open Codex Bridge",
      callback: () => void this.activateView()
    });

    this.addCommand({
      id: "ask-about-current-note",
      name: "Ask about current note",
      editorCallback: () => void this.askAboutCurrentNote()
    });

    this.addCommand({
      id: "suggest-edits-current-note",
      name: "Suggest edits for current note",
      editorCallback: () => void this.suggestEditsForCurrentNote()
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

    this.addSettingTab(new CodexBridgeSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CODEX_BRIDGE);
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    };
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
      "Suggest concrete improvements for this note. If a full rewrite is useful, include it in a fenced block labelled `markdown updated-note`."
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
              vaultPath: this.getVaultPath(),
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
    await this.app.vault.modify(suggestion.note, suggestion.updatedNote ?? suggestion.original);
    new Notice("Suggested edit applied.");
  }

  private getCurrentMarkdownFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file ?? null;
  }

  private getVaultPath(): string {
    const adapter = this.app.vault.adapter;
    if ("basePath" in adapter && typeof adapter.basePath === "string") {
      return adapter.basePath;
    }
    return "/";
  }
}

class CodexBridgeView extends ItemView {
  private plugin: CodexBridgePlugin;

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
    this.renderShell(status);
  }

  setResult(response: string, diff: string): void {
    const container = this.contentContainer();
    container.empty();
    container.createEl("h2", { text: "Codex Bridge" });
    container.createEl("pre", { text: response, cls: "codex-bridge-output" });
    if (diff) {
      container.createEl("h3", { text: "Diff preview" });
      container.createEl("pre", { text: diff, cls: "codex-bridge-diff" });
      new Setting(container)
        .setName("Apply suggested edit")
        .setDesc("Replace the current note with the fenced `markdown updated-note` block.")
        .addButton((button) =>
          button
            .setButtonText("Apply")
            .setCta()
            .onClick(() => void this.plugin.applyLatestSuggestion())
        );
    }
  }

  private renderShell(status = "Ready."): void {
    const container = this.contentContainer();
    container.empty();
    container.createEl("h2", { text: "Codex Bridge" });
    container.createEl("p", { text: status });
    new Setting(container)
      .setName("Ask about current note")
      .addButton((button) =>
        button.setButtonText("Ask").onClick(() => void this.plugin.askAboutCurrentNote())
      );
    new Setting(container)
      .setName("Suggest edits")
      .addButton((button) =>
        button.setButtonText("Suggest").onClick(() => void this.plugin.suggestEditsForCurrentNote())
      );
  }

  private contentContainer(): HTMLElement {
    return this.containerEl.children[1] as HTMLElement;
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

    new Setting(containerEl).setName("Extra instructions").addTextArea((text) => {
      text.inputEl.rows = 5;
      text.setValue(this.plugin.settings.extraInstructions).onChange(async (value) => {
        this.plugin.settings.extraInstructions = value;
        await this.plugin.saveSettings();
      });
    });
  }
}
