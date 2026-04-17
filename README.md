# Claude Code UI

A clean, local web UI for browsing your Claude Code sessions. Think of it as a ChatGPT-style history viewer for the JSONL logs Claude Code stores in `~/.claude/projects/`.

![Claude Code UI](https://img.shields.io/badge/runtime-Bun-black) ![License MIT](https://img.shields.io/badge/license-MIT-blue)

## Why

Claude Code writes every session as a JSONL file under `~/.claude/projects/<project-slug>/<session-id>.jsonl`. It's all there — prompts, tool calls, thinking blocks, results — but there's no built-in way to browse, search, or revisit a specific session. This is that tool.

Everything runs **100% locally**. Your sessions never leave your machine.

## Features

- Sidebar with all projects and sessions, grouped by date (Today / Yesterday / Previous 7 days / ...)
- Search across session titles, previews, session IDs, branch, and cwd
- Rich session header: session ID (click to copy), topic, duration, message breakdown, token usage, tools used, model, git branch, cwd, version
- Full thread rendering with collapsible `thinking`, `tool_use`, and `tool_result` blocks
- Inline markdown (bold, inline code, code blocks, links)
- **Rename** any session (stored in `~/.claude-code-ui/titles.json`, never modifies the JSONL)
- **Safe delete** (moves the JSONL to `.trash/` in the project folder, recoverable by hand)
- **Light & dark themes** — toggle in the sidebar, remembered via localStorage
- No build step, no database, no cloud — just Bun + three static files

## Screenshot

Drop a screenshot into `docs/` and reference it here once you have one.

## Install

Requires [Bun](https://bun.sh) (1.0+).

```bash
git clone https://github.com/<your-username>/claude-code-ui.git
cd claude-code-ui
bun run start
```

Then open http://localhost:4477.

To run on a different port:

```bash
PORT=5000 bun run start
```

## How it works

- Reads JSONL session files from `~/.claude/projects/` (read-only)
- Parses them on the fly — no persistent cache, no index
- Serves a single static HTML + JS + CSS frontend from Bun

That's it. Three endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/projects` | List Claude Code project folders |
| `GET /api/sessions?project=<slug>` | List sessions in a project with summary + stats |
| `GET /api/session/<slug>/<session-id>` | Full parsed session entries |
| `DELETE /api/session/<slug>/<session-id>` | Move session to `.trash/` (recoverable) |
| `PUT /api/title/<session-id>` | Set or clear a custom session title |

## Project structure

```
claude-code-ui/
├── server.ts           # Bun HTTP server
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── package.json
└── README.md
```

## Privacy

The tool reads your local Claude Code logs only. Nothing is uploaded anywhere. Run it on localhost, view it in your browser, close the tab when done.

## Contributing

PRs welcome. Ideas that would be nice:

- Markdown table rendering
- Token cost estimates per session
- Export session to Markdown
- Cross-project search
- Dark/light toggle

## License

MIT — see [LICENSE](LICENSE).
