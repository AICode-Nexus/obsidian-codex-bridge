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
- Use OpenAI API mode for lightweight current-note suggestions.

## Default Local Command

The default local backend is intentionally powerful:

```bash
codex exec --cd "{{vaultPath}}" --sandbox danger-full-access --ask-for-approval never -
```

The plugin sends the task, current note path, root `AGENTS.md` content, and current note body to stdin.

This is suitable for private, trusted vaults. Use a more restrictive command if you want human approval or read-only behavior.

If Obsidian is launched from the macOS GUI, it may not inherit your shell `PATH`. Codex Bridge automatically checks common `codex` install paths such as nvm, Homebrew, and `/usr/local/bin`. You can also set the plugin's Local command to an absolute path, for example:

```text
/Users/admin/.nvm/versions/node/v24.15.0/bin/codex
```

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

## License

MIT
