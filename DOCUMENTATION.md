# WebBuilder Portal — Documentation

This is a web-based tool that lets you describe a web app in plain English, and it builds the actual code for you automatically using Claude AI (Anthropic). You chat with an AI, pick a folder, and it writes a complete frontend (and optionally backend) application — then shows you a live preview right in the browser.

---

## What This App Does (Big Picture)

1. You open the portal and create a new project
2. You chat with an AI and describe what you want to build
3. You pick a folder on your computer where the app will be created
4. The portal runs a series of AI agents that write code, install dependencies, and start a dev server
5. You see a live preview of your app inside the portal
6. You can keep chatting to make changes to the app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| Database | SQLite (via better-sqlite3) |
| Process management | execa (spawns dev servers) |

---

## Project Structure

```
portal/
├── app/                        # All pages and API routes (Next.js App Router)
│   ├── page.tsx                # Home page — lists your projects
│   ├── layout.tsx              # Root HTML wrapper (fonts, metadata)
│   ├── globals.css             # Global CSS styles
│   ├── project/[id]/page.tsx   # The main workspace for a specific project
│   └── api/                    # Backend API endpoints
│       ├── chat/route.ts       # Handles the requirement-gathering chat
│       ├── generate/route.ts   # Runs the code generation pipeline
│       ├── edit/route.ts       # Handles live edit requests in preview mode
│       └── projects/
│           ├── route.ts        # List all projects / create a new project
│           └── [id]/
│               ├── route.ts    # Get a single project by ID
│               └── setup/route.ts  # Sets up the project folder on disk
│
├── components/                 # Reusable UI pieces
│   ├── chat-panel.tsx          # Left sidebar — chat, forms, and edit input
│   ├── preview-panel.tsx       # Right side — live iframe preview of your app
│   ├── generation-screen.tsx   # Full-screen overlay during code generation
│   └── message-bubble.tsx      # Displays a single chat message
│
├── lib/                        # Core logic and utilities
│   ├── db.ts                   # SQLite database — stores project records
│   ├── project-manager.ts      # Creates, loads, and updates projects
│   ├── skill-writer.ts         # Writes AI instruction files (skills) to disk
│   └── preview-manager.ts      # Starts and stops the generated app's dev server
│
├── types/index.ts              # TypeScript types shared across the app
├── package.json                # Dependencies
├── next.config.ts              # Next.js configuration
└── tsconfig.json               # TypeScript configuration
```

---

## How a Project Moves Through Phases

A project has a `phase` — think of it as a status that changes as the build progresses. The portal uses this to decide what to show you on screen.

```
gathering  →  ready  →  writing-specs  →  building  →  building-backend  →  preview  →  complete
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

### Step 1 — Home Page (`app/page.tsx`)

When you open the portal, you see a list of your existing projects or a button to start a new one. Clicking "New Project" calls `POST /api/projects` which creates a database record and sends you to `/project/{id}`.

### Step 2 — Gathering Chat (`app/api/chat/route.ts`)

You land on the project workspace. The left panel shows a chat interface. You describe your app idea — what pages you need, what it should do, who will use it.

The AI (`claude-sonnet-4-6`) reads your messages and asks follow-up questions. When it has enough information, it silently generates an `overview.md` file (a human-readable summary of everything you described) and signals the frontend that it's ready to proceed.

**What streams back to the browser:**
- `delta` — streaming text chunks (so you see the response being typed)
- `done` — message complete, with a `ready: true/false` flag
- `overview-ready` — the full overview.md content

### Step 3 — Project Setup (`app/api/projects/[id]/setup/route.ts`)

You enter a folder path and a project name. When you click Proceed:

1. A new folder is created at `{your-path}/project-{name}/`
2. Subfolders are created: `client/`, `server/`, `documentation/`
3. `overview.md` is written to disk (the requirements summary from chat)
4. Six AI skill files are written into `.claude/commands/` — these are detailed instruction prompts for the code-writing AI agents (more on this below)
5. Sample reference files are written into `.claude/examples/`
6. The project phase is updated to `writing-specs`

### Step 4 — Spec Generation (`app/api/generate/route.ts` with skill `generate-specs`)

The portal triggers a Claude Code agent that reads `overview.md` and writes structured specification files into a `specs/` folder. Each spec file is a blueprint for one part of your app (a page, a component, or a backend route).

### Step 5 — Frontend Build (`app/api/generate/route.ts` with skill `build-frontend`)

This runs three sub-phases sequentially:

**Phase A — `scaffold-frontend`**
- Creates a Next.js app inside the `client/` folder
- Installs npm dependencies
- Writes design tokens, environment files, and base config
- Starts the dev server on a free port (starting from 3100)
- Sends a `preview-ready` event with the port number

**Phase B — `build-layout`**
- Builds the Navbar, Footer, and root layout
- Sends a `preview-refresh` event so the iframe reloads

**Phase C — `build-page` (once per page)**
- Reads each page's spec file
- Builds the full page and all its sections
- Sends a `preview-refresh` event after each page so you can watch it appear

### Step 6 — Live Preview (`components/preview-panel.tsx`)

Once the dev server is running, the right panel shows an embedded iframe pointed at `http://localhost:{port}`. You can switch between Desktop, Tablet (768px), and Mobile (390px) viewports.

Every time an AI agent finishes writing a page, the preview automatically refreshes so you see the change instantly.

### Step 7 — Live Editing (`app/api/edit/route.ts`)

Once you're in preview mode, you can type requests into the chat panel like "change the hero section color to blue" or "add a pricing page". The portal sends this to the `apply-change` skill, which runs a Claude Code agent that edits the relevant spec and code files, then signals the preview to reload.

---

## The Six AI Skills

Skills are instruction files written to `.claude/commands/` inside your project folder. Each skill is a detailed prompt that tells a Claude Code agent exactly what to do during one step of the build.

| Skill File | What It Does |
|---|---|
| `generate-specs` | Reads overview.md, decides what spec files are needed, writes them all |
| `scaffold-frontend` | Creates Next.js app, installs packages, sets up base config and design tokens |
| `build-layout` | Builds Navbar, Footer, and the root layout.tsx |
| `build-page` | Builds one full page (run separately for each page in the app) |
| `build-backend` | Scaffolds backend APIs and wires them to the frontend |
| `apply-change` | Makes a targeted edit to the app based on a user's request |

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
| `created_at` | Unix timestamp |
| `updated_at` | Unix timestamp |

---

## How the Preview Dev Server Works (`lib/preview-manager.ts`)

When the frontend scaffold is complete, the portal runs `npm run dev` inside the `client/` folder using a child process. It:

1. Finds an open port starting from 3100
2. Spawns the dev server subprocess
3. Waits up to 30 seconds for the port to open
4. Saves the port number to the database
5. The iframe in the preview panel points to that port

When you navigate away or the project session ends, the dev server subprocess is killed.

---

## How Streaming Works

All long-running operations (chat, code generation, editing) use Server-Sent Events (SSE). Instead of waiting for everything to finish and getting one big response, the browser receives a stream of small event messages in real time.

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
| `warning` | Something non-fatal happened |
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

| Component | Job |
|---|---|
| `app/page.tsx` | Shows project list, creates new projects |
| `app/project/[id]/page.tsx` | Main workspace — manages all state, coordinates left/right panels |
| `components/chat-panel.tsx` | Handles chat input, setup form, and edit requests |
| `components/preview-panel.tsx` | Embeds the live iframe, handles viewport switching and refresh |
| `components/generation-screen.tsx` | Full-screen overlay with live event log during generation |
| `components/message-bubble.tsx` | Renders a single chat message (user or assistant) |

| Library File | Job |
|---|---|
| `lib/db.ts` | All reads and writes to SQLite |
| `lib/project-manager.ts` | High-level project operations (create, load, update phase) |
| `lib/skill-writer.ts` | Generates the 6 AI skill prompt files and writes them to disk |
| `lib/preview-manager.ts` | Spawns and kills the generated app's dev server process |
