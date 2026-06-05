# Codex Bridge for Obsidian

Codex Bridge is an Obsidian desktop plugin that connects the current note to either:

- a local high-permission command such as `codex exec`, or
- the OpenAI Responses API.

It is designed for local-first knowledge bases where the vault is the source of truth and the user wants agent help without leaving Obsidian.

## Features

- Ask about the current Markdown note from a side panel.
- Generate edit suggestions for the current note.
- Apply a suggested full-note rewrite from a fenced `markdown updated-note` block.
- Read root `AGENTS.md` instructions and pass them to the assistant.
- Run a configurable local command in the vault root.
- Diagnose the local backend from inside Obsidian.
- Use OpenAI API mode for lightweight current-note suggestions.

## Default Local Command

The default local backend is intentionally powerful:

```bash
codex exec --cd "{{vaultPath}}" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message "{{outputFile}}" -
```

The plugin sends the task, current note path, root `AGENTS.md` content, and current note body to stdin. It reads the final response from `--output-last-message` so Codex startup logs and warnings do not pollute the Obsidian side panel.

This is suitable for private, trusted vaults. Use a more restrictive command if you want human approval or read-only behavior.

If Obsidian is launched from the macOS GUI, it may not inherit your shell `PATH`. Codex Bridge automatically checks common `codex` install paths such as nvm, Homebrew, and `/usr/local/bin`, then prepends Node/Codex directories to the spawned process `PATH` so `#!/usr/bin/env node` scripts can start. You can also set the plugin's Local command to an absolute path, for example:

```text
/Users/admin/.nvm/versions/node/v24.15.0/bin/codex
```

Use **Codex Bridge: Diagnose local backend** if the local backend fails. It checks the executable, supported `codex exec` flags, non-git vault handling, and the spawned process `PATH`.

Older plugin settings that used `--ask-for-approval never` are automatically migrated on plugin load because current `codex exec` versions reject that flag. If you upgraded from an early build, reload the plugin and run **Diagnose local backend** to confirm the stored Local arguments match the current default.

Local tasks time out after 120 seconds by default. Increase **Local timeout ms** in settings for long-running vault maintenance jobs.

## OpenAI API Mode

OpenAI mode calls:

```text
POST /v1/responses
```

Configure these settings in Obsidian:

- OpenAI API key
- OpenAI base URL
- OpenAI model
- Extra instructions

## Development

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

For local Obsidian testing, copy or symlink this repository to:

```text
<vault>/.obsidian/plugins/codex-bridge
```

You can also clone it directly:

```bash
mkdir -p "<vault>/.obsidian/plugins"
git clone https://github.com/AICode-Nexus/obsidian-codex-bridge.git "<vault>/.obsidian/plugins/codex-bridge"
cd "<vault>/.obsidian/plugins/codex-bridge"
corepack pnpm install
corepack pnpm build
```

Then reload Obsidian, enable community plugins, and turn on Codex Bridge.

## Safety Notes

- The plugin is desktop-only because local command execution depends on Node APIs.
- Local mode can modify files if the command you configure does so.
- OpenAI mode sends note content and root `AGENTS.md` content to the configured API endpoint.
- Full-note edits are only applied when the model returns a fenced `markdown updated-note` block.

## ACP

Agent Client Protocol is not a core backend yet. It is useful for future persistent sessions, streaming updates, permission prompts, and richer tool-call UI. The current plugin keeps `codex exec` as the powerful local backend and OpenAI Responses API as the lightweight stateless backend. ACP should be added later as an optional third backend after the note-assistant workflow is stable.

## License

MIT
