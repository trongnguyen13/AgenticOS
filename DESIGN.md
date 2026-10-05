# AgenticOS design

Designed for managing multiple local projects on one workstation. The core job is resuming work with the right instructions, reusable skills, and memory, without opening several disconnected folders.

## Web research

- [Agentic OS](https://github.com/aporb/agentic-os): separates the console into daily work, skill discovery, and a knowledge/wiki surface. Borrow the separation of concerns and inspectable Markdown skills.
- [OpenClaw Dashboard](https://github.com/oealgo/openclaw-dashboard): groups projects, files, and agent sessions into an everyday workspace. Borrow project-first navigation and contextual document inspection.
- [OpenClaw dashboard architecture](https://docs.openclaw.ai/web/dashboard-architecture): session dashboards can sit alongside the conversation. This informs a future runtime view; this version does not implement its widget system.

These are pattern references, not cloned designs or runtime dependencies.

## Direction

Slate white canvas (#F6F8FC), white surfaces (#FFFFFF), ink (#202C42), muted slate (#7B8699), action blue (#315CE7), and teal (#549B90). Project colors help distinguish workspaces. Typography uses the native Windows Segoe UI Variable/Segoe UI family, with clear sentence-case headings and compact secondary text. It loads no external fonts, scripts, or image resources.

Left-aligned workspace rail → main content → document dialog. One memorable element, the workspace map, shows the relationship between connected projects and their skills and memory. Elsewhere, structure follows the content: project cards, memory rows, skill cards, and task columns. Counts and Git status come from actual local scanning, with unavailable states when a source fails.

```text
Project rail | Overview and workspace map
             | Project cards
             | Recent memory          Pinned skills
             |                        Runtime connection state
```

Keep automation status honest. Never invent agent runs, token costs, project health scores, or completed tasks. Source memory remains visibly read-only; new notes have an explicit workspace destination.

## Runtime integration

Tasks can now invoke Claude Code print mode from the selected project directory, with a project skill, live output, history, and cancellation. Saving and executing remain separate actions. Runs offer read-only tools or existing project permissions; interactive permission denials are reported rather than auto-approved. Task completion remains a user decision. Future work includes an interactive approval bridge, Codex execution, scheduled jobs, and deliberate rules for editing source memory and installing skills.
