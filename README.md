# AgenticOS

A local dashboard for projects, Claude Code sessions, skills, memory, channels, and tasks. Each teammate runs their own workspace on their computer. No shared server or database is required.

## Quick start

Requirements: **Node.js 22 or newer**, **Git**, and a current **Claude Code** installation for running tasks and discovering sessions. Browsing projects and memories works without Claude. Install and sign in to Claude using the [official setup guide](https://code.claude.com/docs/en/setup).

Clone this private repository with a GitHub account that has access:

```powershell
git clone https://github.com/trongnguyen13/AgenticOS.git
cd AgenticOS
npm.cmd run setup
npm.cmd start
```

On macOS/Linux, use `npm` instead of `npm.cmd`. There are no npm dependencies to install. Open **http://127.0.0.1:4310/**, click **Add project**, and enter a name and the full path to an existing project folder. Repeat for each project.

Setup creates an ignored `config.json` for your computer, detects an installed native Claude executable, and defaults memory to your own `~/.claude/projects`. It does not overwrite an existing configuration. Starting without running setup also creates these defaults.

## What you can do

- Browse projects and Git status from one dashboard.
- Index skills from project `.claude/skills`, `.agents/skills`, `.codex/skills`, and `skills` folders. Global skill libraries are excluded.
- Search memory notes and explore explicit note links in an interactive graph.
- Save tasks, choose a project skill and model, and run Claude with live output and saved history.
- See open Claude sessions, including idle versus working sessions, with five-second updates.
- Inspect custom channels from `.claude/channels` or `channels` and view their documentation.
- Switch between light and dark themes; your browser remembers the choice.

## Local configuration

`config.example.json` illustrates the minimal structure. `config.json` is personal and is never committed. Optional fields:

| Field | Purpose |
| --- | --- |
| `port` | Local HTTP port, default 4310 |
| `claudeExecutable` | Full path to the native Claude executable |
| `memoryRoot` | Your Claude projects directory |
| `projects` | Optional preconfigured projects; UI-added projects live in `data/workspace.json` |
| `channelHealth` | Local channel health probes, keyed by `projectId:channelFolder` |

If Claude is not detected, set `claudeExecutable` in `config.json`, or set `CLAUDE_EXECUTABLE` before starting. Restart after changing configuration. `CLAUDE_CONFIG_DIR` is used for first-run memory defaults. You can also override `PORT`, `AGENTIC_OS_DATA_DIR`, or `AGENTIC_OS_CONFIG` for isolated instances.

Each configured project has `id`, `name`, `path`, `memoryFolder`, `description`, `color` (`blue`, `purple`, or `teal`), and `initials`. The Add project dialog fills these in automatically.

### Memory

Claude memories are indexed read-only. Automatic mapping uses the project path; for nested repository folders without their own memory directory, it checks parents up to the Git repository root. The Add project dialog also accepts an explicit memory-folder name.

Graph links come from `[[note-name]]` and local Markdown links, including aliases and headings. Names resolve within their project. Unresolved references are reported rather than guessed. Refresh the index after editing source notes. New notes created in AgenticOS are saved locally in `data/workspace.json`.

### Running tasks

Creating a task saves it without starting Claude. Choose **Run Claude**, select a project, optional project skill, model, instructions, and tool access:

- **Read only** allows reading and searching, with editing and shell commands disabled.
- **Project permissions** uses existing Claude permissions; allowed tools may change files. Interactive approval requests are denied and shown in the output.

Models include Claude default, Sonnet, Opus, Haiku, or a custom ID. Explicit selections use `claude -p --model`. Access follows your own account/provider. Prompts and context read by Claude are processed by that provider and consume its usage allowance.

One AgenticOS task may run per project at a time. Closing the output dialog does not stop the run; use **Stop run**. Cancellation does not undo edits. Runs interrupted by a server restart are marked Interrupted. Review results before manually marking tasks Done.

### Sessions and channels

Session discovery uses `claude agents --json`. Windows also verifies local registrations against process birth times, including protected sessions omitted by the CLI. Other operating systems use CLI discovery. Separate worktree paths are not automatically assigned to a project. Discovery errors appear in project details.

Channels are indexed without executing their code. To enable listener health for a channel, add a numeric local port:

```json
{
  "channelHealth": {
    "my-project:my-channel": { "port": 8788 }
  }
}
```

AgenticOS checks `http://127.0.0.1:8788/health`. The response must contain `ok: true` and a `channel` matching the manifest name. Listening only confirms the local listener, not the webhook tunnel or Claude connection. Unconfigured channels show Installed.

## Privacy and sharing

The app binds only to `127.0.0.1`. Your configuration, project paths, tasks, notes, run prompts/output, screenshots, logs, and credentials remain local and are excluded from Git. Never commit `config.json`, `data/`, `.env` files, or Claude credential files. Source projects and their memory files are not copied into this repository.

The GitHub repository shares the application code. Team members need repository access, their own local project checkouts, and their own Claude authentication. It does not sync team tasks or memories.

## Development and updates

```powershell
npm.cmd run check
npm.cmd test
```

Tests use generated project fixtures and temporary data, without requiring personal projects or Claude authentication. GitHub Actions runs checks on Windows and Linux.

To update, stop the app with Ctrl+C, run `git pull`, then `npm.cmd start`. Ignored local configuration and data remain intact. See [DESIGN.md](DESIGN.md) for the UI direction.
