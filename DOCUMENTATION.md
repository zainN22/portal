# WebBuilder Portal — Documentation

This is a web-based tool that lets you describe a web app in plain English, and it builds the actual code for you automatically using Claude AI (Anthropic). You chat with an AI, pick a folder, and it writes a complete frontend (and optionally backend) application — then shows you a live preview right in the browser.

---

## What This App Does (Big Picture)

1. You open the portal and create a new project
2. You chat with an AI and describe what you want to build
3. You pick a folder on your computer where the app will be created
4. The portal runs a series of AI agents that write code, install dependencies, and start a dev server
5. You see a live preview of your app inside the portal
6. You can keep chatting to make changes to the app, approving steps one at a time

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| AI (chat) | Anthropic Claude Haiku 4.5 |
| AI (build) | Claude Sonnet 4.6 / Opus 4.6 (per skill) |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| Database | SQLite (via better-sqlite3) |
| Process management | execa (spawns dev servers) |

---

## Project Structure

```
portal/
├── app/                              # All pages and API routes (Next.js App Router)
│   ├── page.tsx                      # Home page — lists your projects
│   ├── layout.tsx                    # Root HTML wrapper (fonts, metadata)
│   ├── globals.css                   # Global CSS styles
│   ├── project/[id]/
│   │   ├── page.tsx                  # Server component wrapper — forces remount on nav
│   │   └── project-workspace.tsx    # Main workspace (client component) — all state & logic
│   └── api/                          # Backend API endpoints
│       ├── chat/route.ts             # Requirement-gathering chat (SSE)
│       ├── generate/route.ts         # Starts a background build skill (fire-and-forget)
│       ├── edit/route.ts             # Triggers an edit in preview mode
│       └── projects/
│           ├── route.ts              # List all projects / create a new one
│           └── [id]/
│               ├── route.ts          # Get or update a single project
│               ├── setup/route.ts    # Creates the project folder structure on disk
│               ├── messages/route.ts # Persist and load chat messages
│               ├── preview/route.ts  # Start or resume the generated app's dev server
│               └── events/route.ts   # SSE stream of live build events
│
├── components/                       # Reusable UI pieces
│   ├── chat-panel.tsx                # Left sidebar — chat, setup form, and edit input
│   ├── preview-panel.tsx             # Right side — live iframe preview of your app
│   ├── generation-screen.tsx         # Full-screen overlay during code generation
│   ├── generation-progress.tsx       # Compact event log component (reference)
│   └── message-bubble.tsx            # Displays a single chat message
│
├── lib/                              # Core logic and utilities
│   ├── db.ts                         # SQLite database — stores project records + messages
│   ├── project-manager.ts            # Creates, loads, and updates projects
│   ├── build-runner.ts               # Background build orchestration and event buffering
│   ├── skill-writer.ts               # Writes AI instruction files (skills) to disk
│   └── preview-manager.ts            # Starts and stops the generated app's dev server
│
├── sample/specs/                     # Example spec files copied into new projects
├── types/index.ts                    # TypeScript types shared across the app
├── package.json                      # Dependencies
├── next.config.ts                    # Next.js configuration
└── tsconfig.json                     # TypeScript configuration
```

---

## How a Project Moves Through Phases

A project has a `phase` — think of it as a status that changes as the build progresses. The portal uses this to decide what to show you on screen.

```
  ┌───────────┐    ┌─────────┐    ┌───────────────┐    ┌──────────┐
  │ gathering │───▶│  ready  │───▶│ writing-specs │───▶│ building │
  └───────────┘    └─────────┘    └───────────────┘    └──────────┘
   Chat with AI    Enter folder    AI writes specs       AI builds
                   + name                                frontend
                                                             │
                                                             ▼
  ┌──────────┐    ┌──────────────────┐    ┌─────────────────────────┐
  │ complete │◀───│ building-backend │◀───│         preview         │
  └──────────┘    └──────────────────┘    │  live iframe + editing  │
                    AI builds backend     └────────────┬────────────┘
                                                       │
                                                       └──▶ (edit loop)
```

| Phase | What's Happening |
|---|---|
| `gathering` | You're chatting with the AI describing what you want |
| `ready` | AI has enough info — you fill in a folder path and project name |
| `writing-specs` | AI writes detailed spec files (blueprints for the app) |
| `building` | AI builds the frontend (Next.js app + all pages) |
| `building-backend` | AI builds the backend (APIs, database, etc.) |
| `preview` | Your app is running — you can view and edit it live |
| `complete` | Everything is done |

---

## Step-by-Step Flow

```
  User          Browser           Portal API         Build Runner     Claude Agent    Generated App
   │               │                   │                   │                │               │
   │  New Project  │                   │                   │                │               │
   │──────────────▶│  POST /projects   │                   │                │               │
   │               │──────────────────▶│                   │                │               │
   │               │◀──────────────────│                   │                │               │
   │               │   { id, phase }   │                   │                │               │
   │               │                   │                   │                │               │
   │  Describe app │                   │                   │                │               │
   │──────────────▶│  POST /api/chat   │                   │                │               │
   │               │──────────────────▶│                   │                │               │
   │               │◀╌╌ delta ╌╌╌╌╌╌╌╌│                   │                │               │
   │               │◀╌╌ done/ready ╌╌╌│                   │                │               │
   │               │                   │                   │                │               │
   │  Enter folder │                   │                   │                │               │
   │──────────────▶│  POST /setup      │                   │                │               │
   │               │──────────────────▶│                   │                │               │
   │               │◀──────────────────│                   │                │               │
   │               │   writing-specs   │                   │                │               │
   │               │                   │                   │                │               │
   │  Click Build  │                   │                   │                │               │
   │──────────────▶│  POST /generate   │   startBuild()    │                │               │
   │               │──────────────────▶│──────────────────▶│                │               │
   │               │◀── 200 OK ────────│                   │  query(skill)  │               │
   │               │  GET /events SSE  │                   │───────────────▶│               │
   │               │──────────────────▶│                   │                │               │
   │               │◀╌╌ text/file ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│◀╌╌ events ╌╌╌╌│               │
   │               │◀╌╌ preview-ready ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│                │  npm run dev  │
   │               │                   │                   │───────────────────────────────▶│
   │               │                   │                   │                │               │
   │  Chat edit    │                   │                   │                │               │
   │──────────────▶│  POST /api/edit   │   startBuild()    │                │               │
   │               │──────────────────▶│──────────────────▶│  query(edit)   │               │
   │               │◀╌╌ preview-refresh ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│───────────────▶│               │
```

### Step 1 — Home Page (`app/page.tsx`)

When you open the portal, you see up to 5 of your most recent projects or a button to start a new one. Clicking "Start a new project" calls `POST /api/projects`, which creates a database record and redirects you to `/project/{id}`.

### Step 2 — Gathering Chat (`app/api/chat/route.ts`)

You land on the project workspace. The left panel shows a chat interface. You describe your app idea — what pages you need, what it should do, who will use it.

The AI (Claude Haiku 4.5) reads your messages and asks follow-up questions. When it has gathered enough information, it emits two signals:
- `[READY_TO_PROCEED]` — a marker embedded in the response indicating it's done gathering
- A full spec document after a `---SPEC---` delimiter — written to `overview.md`

**What streams back to the browser:**
- `delta` — streaming text chunks (so you see the response being typed)
- `done` — message complete, with a `ready: true/false` flag
- `overview-ready` — the full overview.md content

### Step 3 — Project Setup (`app/api/projects/[id]/setup/route.ts`)

You enter a folder path and a project name. When you click Proceed:

1. A new folder is created at `{your-path}/project-{name}/`
2. Subfolders are created: `client/`, `server/`, `specs/`, `documentation/`
3. `overview.md` is written to disk (the requirements summary from chat)
4. A temporary `CLAUDE.md` is written to the project root to pin it and prevent the agent from scanning parent directories
5. Six AI skill files are written into `.claude/commands/` — detailed instruction prompts for each code-writing agent
6. Sample reference spec files are written into `.claude/examples/`
7. The project phase is updated to `writing-specs`

### Step 4 — Spec Generation (skill: `generate-specs`, model: Sonnet 4.6)

The portal triggers a background Claude Code agent that reads `overview.md` and writes structured specification files into `specs/`. Each spec file is a blueprint for one part of the app (a page, component, or backend route). After all specs are written, it writes `CLAUDE.md` (project root context) and `documentation/dependencies.md`. The generated page specs are then used to populate the build queue.

### Step 5 — Frontend Build

This runs three sub-phases sequentially, each driven by the build queue:

```
  ┌───────────────────────────────────────────────────────────────────┐
  │                        BUILD PIPELINE                             │
  │                                                                   │
  │  ┌───────────────────┐                                            │
  │  │  generate-specs   │  reads overview.md                         │
  │  │  Sonnet 4.6       │  writes specs/ + CLAUDE.md + deps.md       │
  │  │  60 turns         │  discovers page list for build queue       │
  │  └────────┬──────────┘                                            │
  │           │                                                       │
  │           ▼                                                       │
  │  ┌───────────────────┐                                            │
  │  │ scaffold-frontend │  create-next-app, npm install all deps,    │
  │  │  Sonnet 4.6       │  design tokens, type-check                 │
  │  │  40 turns         │  → starts dev server on port 3100+         │
  │  └────────┬──────────┘                                            │
  │           │                                                       │
  │           ▼                                                       │
  │  ┌───────────────────┐                                            │
  │  │   build-layout    │  Navbar, Footer, root layout.tsx           │
  │  │  Sonnet 4.6       │  writes documentation/layout.md            │
  │  │  35 turns         │                                            │
  │  └────────┬──────────┘                                            │
  │           │                                                       │
  │           ▼                                                       │
  │  ┌───────────────────┐                                            │
  │  │    build-page     │◀─┐  one page per session                   │
  │  │    Opus 4.6       │  │  reads documentation/* for context      │
  │  │    50 turns       │──┘  user approves between each page        │
  │  └────────┬──────────┘                                            │
  │           │                                                       │
  │           ▼                                                       │
  │  ┌───────────────────┐                                            │
  │  │  build-backend    │  server, DB schema, API routes,            │
  │  │  Opus 4.6         │  wires frontend to backend                 │
  │  │  80 turns         │  (optional — user triggered)               │
  │  └───────────────────┘                                            │
  └───────────────────────────────────────────────────────────────────┘
```

**Phase A — `scaffold-frontend` (Sonnet 4.6, 40 turns)**
- Creates a Next.js app inside the `client/` folder using `create-next-app`
- Reads `documentation/dependencies.md` and installs all packages in a single `npm install` pass
- Applies design tokens, environment files, and base config
- Type-checks before finishing
- The dev server is started after scaffolding; a `preview-ready` event with the port is emitted

**Phase B — `build-layout` (Sonnet 4.6, 35 turns)**
- Builds the Navbar, Footer, and root layout only — no pages
- Writes `documentation/layout.md` for subsequent sessions to reference
- Emits a `preview-refresh` event so the iframe reloads

**Phase C — `build-page` (Opus 4.6, 50 turns, once per page)**
- Reads the page's spec file plus `documentation/layout.md` and `documentation/pages.md`
- Builds the full page and all its sections
- Updates `documentation/pages.md`
- Emits a `preview-refresh` event after each page so you can watch the app grow
- Requires user approval between each page (via the build queue)

### Step 6 — Live Preview (`components/preview-panel.tsx`)

Once the dev server is running, the right panel shows an embedded iframe pointed at `http://localhost:{port}`. You can switch between Desktop, Tablet (768px), and Mobile (390px) viewports. Every time an agent finishes writing a page, the preview automatically refreshes.

### Step 7 — Backend Build (skill: `build-backend`, Opus 4.6, 80 turns)

After all frontend pages are built, you can trigger backend generation. This scaffolds the server directory, implements database schema, service layer, and API routes, then wires the frontend to call them.

### Step 8 — Live Editing (`app/api/edit/route.ts`)

Once you're in preview mode, you can type requests into the chat panel like "change the hero section color to blue" or "add a pricing page". The portal sends this to the `apply-change` skill (Haiku 4.5, 20 turns), which edits the relevant spec and source files, then signals the preview to reload.

---

## The Six AI Skills

Skills are instruction files written to `.claude/commands/` inside your project folder. Each skill is a detailed prompt that tells a Claude Code agent exactly what to do during one step of the build.

| Skill File | Model | Max Turns | What It Does |
|---|---|---|---|
| `generate-specs` | Sonnet 4.6 | 60 | Reads overview.md, decides what spec files are needed, writes them all; writes CLAUDE.md and dependencies.md |
| `scaffold-frontend` | Sonnet 4.6 | 40 | Creates Next.js app, installs all packages in one pass, applies design tokens and base config |
| `build-layout` | Sonnet 4.6 | 35 | Builds Navbar, Footer, and root layout.tsx; writes documentation/layout.md |
| `build-page` | Opus 4.6 | 50 | Builds one full page per session, reading documentation/* instead of scanning source |
| `build-backend` | Opus 4.6 | 80 | Scaffolds server, implements schema/services/routes, wires frontend to backend |
| `apply-change` | Haiku 4.5 | 20 | Makes targeted edits from user chat requests; updates both specs and code |

A key design constraint applied to all sessions: no hardcoded CSS values, no mid-session `npm install` (all packages installed once during scaffold), and always read `documentation/` for context rather than scanning source files.

---

## Database

SQLite is used to store project metadata. The database file lives at `~/.webbuilder/projects.db`.

The `projects` table has these columns:

| Column | What It Stores |
|---|---|
| `id` | Unique project ID (UUID) |
| `name` | The project name you chose |
| `phase` | Current phase (e.g. `gathering`, `preview`) |
| `dir` | Full path to the project folder on disk |
| `preview_port` | Port number the dev server is running on |
| `messages` | JSON array of chat messages (persisted for session recovery) |
| `build_queue` | JSON array of pending build steps (persists across refreshes) |
| `discovered_pages` | JSON array of page names found in the spec files |
| `created_at` | Unix timestamp |
| `updated_at` | Unix timestamp |

---

## How the Build Runner Works (`lib/build-runner.ts`)

The build runner is the core orchestration engine. It manages background Claude Code sessions and buffers events for the frontend.

- **Fire-and-forget:** `POST /api/generate` returns immediately. The build runs async via `startBuild()`.
- **In-memory event buffer:** All events (text, file writes, shell commands, phase transitions) are stored in a per-project array. The frontend SSE endpoint reads from this buffer and can reconnect mid-build using `?fromIndex=N`.
- **Session execution:** Each skill runs as a separate `query()` call to `@anthropic-ai/claude-agent-sdk`, with the project directory explicitly set as `cwd` and injected into the prompt.
- **Handoff via documentation:** Each session writes summary files (e.g., `documentation/layout.md`, `documentation/pages.md`) for subsequent sessions to read instead of scanning source code.
- **Turn limit warnings:** If a session hits the max turn limit, it emits a `warning` event — work completed so far is still saved and the build continues.

---

## How the Preview Dev Server Works (`lib/preview-manager.ts`)

When the frontend scaffold is complete, the portal runs `npm run dev` inside the `client/` folder using a child process. It:

1. Stops any other projects' running dev servers (only one at a time)
2. Reuses the existing server if its port is already alive
3. Finds a free port starting from 3100
4. Spawns the dev server subprocess with `--port X --hostname 0.0.0.0`
5. Waits up to 60 seconds for the port to open
6. Saves the port to the database

---

## How Streaming Works

All long-running operations (chat, code generation, editing) use Server-Sent Events (SSE). The browser receives a stream of small event messages in real time rather than waiting for a single big response.

The build events endpoint (`/api/projects/[id]/events`) supports reconnection: pass `?fromIndex=N` to skip events already received. Events are buffered in memory for the duration of the build.

```
  Browser                    Portal Server                    File System
  ┌──────────────┐           ┌──────────────────────────┐    ┌─────────────┐
  │              │           │  POST /api/generate       │    │             │
  │              │──────────▶│  returns 200 immediately  │    │             │
  │              │           │            │              │    │             │
  │              │           │   startBuild() async      │    │             │
  │              │           │            │              │    │             │
  │ GET /events  │           │  ┌─────────▼───────────┐  │    │             │
  │ (SSE stream) │──────────▶│  │    Build Runner      │◀────▶│ project/    │
  │              │           │  │                      │  │    │             │
  │              │           │  │  query(skill prompt) │  │    │             │
  │◀╌╌ text ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│  │  Claude Agent SDK    │  │    │             │
  │◀╌╌ file ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│  │                      │  │    │             │
  │◀╌╌ shell ╌╌╌╌╌╌╌╌╌╌╌╌╌╌│  │  event buffer []      │  │    │             │
  │              │           │  └──────────────────────┘  │    │             │
  │  (reconnect) │           │                            │    │             │
  │              │──────────▶│  GET /events?fromIndex=42  │    │             │
  │◀╌╌ missed events ╌╌╌╌╌╌╌│  replays from buffer       │    │             │
  └──────────────┘           └──────────────────────────┘    └─────────────┘
```

Event types used across the app:

| Event | Meaning |
|---|---|
| `delta` | A chunk of streamed text (for chat) |
| `text` | Claude's narration during generation |
| `file` | A file was written by the AI |
| `shell` | A shell command was run |
| `phase` | A named phase started (e.g. "Building Navbar...") |
| `preview-ready` | Dev server started — includes the port number |
| `preview-refresh` | Tell the iframe to reload |
| `done` | This skill or chat turn is complete |
| `warning` | Something non-fatal happened (e.g. turn limit reached) |
| `error` | A fatal error occurred |

---

## Environment Setup

You need one environment variable set:

```
ANTHROPIC_API_KEY=your-api-key-here
```

This is used by both the chat API and the Claude Code agent SDK.

---

## Component Responsibilities (Quick Reference)

```
  ┌──────────────────────────────────────────────────────────────┐
  │           project-workspace.tsx  (client component)          │
  │   phase state · build queue · event stream · preview port    │
  │                                                              │
  │  ┌──────────────────────┐    ┌────────────────────────────┐  │
  │  │    chat-panel.tsx    │    │    preview-panel.tsx        │  │
  │  │                      │    │                            │  │
  │  │  gathering → chat    │    │  iframe → localhost:port   │  │
  │  │  ready     → form    │    │  desktop / tablet / mobile │  │
  │  │  preview   → edits   │    │  reloads on refresh tick   │  │
  │  │                      │    └────────────────────────────┘  │
  │  │  ┌────────────────┐  │                                    │
  │  │  │ message-bubble │  │    ┌────────────────────────────┐  │
  │  │  └────────────────┘  │    │  generation-screen.tsx     │  │
  │  └──────────────────────┘    │  full-screen build overlay  │  │
  │                              │  live event log + progress  │  │
  │                              └────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────┘
               │                              │
               ▼                              ▼
  ┌────────────────────────┐    ┌──────────────────────────────┐
  │  /api/chat             │    │  /api/projects/:id/events    │
  │  /api/projects/:id/    │    │  /api/generate               │
  │    setup · messages    │    │  /api/edit                   │
  │  /api/projects (CRUD)  │    │  /api/projects/:id/preview   │
  └────────────────────────┘    └──────────────────────────────┘
               │                              │
               └──────────────┬───────────────┘
                               ▼
                  ┌────────────────────────┐
                  │       lib/             │
                  │  db.ts                 │
                  │  project-manager.ts    │
                  │  build-runner.ts       │
                  │  skill-writer.ts       │
                  │  preview-manager.ts    │
                  └────────────────────────┘
```

| Component | Job |
|---|---|
| `app/page.tsx` | Shows project list (max 5), creates new projects |
| `app/project/[id]/page.tsx` | Server component wrapper — forces React remount on navigation via `key={id}` |
| `app/project/[id]/project-workspace.tsx` | Main workspace (client) — manages all state, coordinates left/right panels, drives build pipeline |
| `components/chat-panel.tsx` | Handles chat input (gathering), setup form (ready), and edit requests (preview) |
| `components/preview-panel.tsx` | Embeds the live iframe, handles viewport switching and refresh |
| `components/generation-screen.tsx` | Full-screen overlay with live event log and progress bar during generation |
| `components/message-bubble.tsx` | Renders a single chat message (user or assistant) |

| Library File | Job |
|---|---|
| `lib/db.ts` | All reads and writes to SQLite — projects, messages, build queue |
| `lib/project-manager.ts` | High-level project operations (create, load, setup directory, update phase) |
| `lib/build-runner.ts` | Runs background Claude Code sessions, buffers events, orchestrates the full build pipeline |
| `lib/skill-writer.ts` | Generates the 6 AI skill prompt files and writes them to disk |
| `lib/preview-manager.ts` | Spawns and kills the generated app's dev server process |
