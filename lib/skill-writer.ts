/**
 * Creates the .claude/commands/ skill files and .claude/examples/
 * in the project directory. These files are the programmatic instructions
 * that tell Claude Code how to write specs and generate code.
 *
 * Build pipeline (each step is its own Claude Code session):
 *   generate-specs     → writes all spec files + CLAUDE.md + dependencies.md
 *   scaffold-frontend  → copies/creates Next.js app, installs all deps at once, applies tokens
 *   build-layout       → Navbar, Footer, root layout only
 *   build-page         → one page per session (page name injected at call time)
 *   build-backend      → full backend + wires frontend
 *   apply-change       → targeted edits for user requests
 *
 * Context handoff: each session writes documentation/{phase}.md so the
 * next session reads that summary instead of scanning source files.
 *
 * Speed notes:
 *  - Verification uses `npx tsc --noEmit` (type-check only, ~5-10 s) instead of
 *    `npm run build` (full Next.js production bundle, 30-90 s).  The dev server
 *    handles compilation continuously; the type check is sufficient.
 *  - All `npm install` commands use a shared cache at ~/.webbuilder/npm-cache so
 *    packages downloaded once are reused across projects.
 *  - The generate-specs session writes specs/client/dependencies.md so the
 *    scaffold session can install ALL third-party packages in a single pass
 *    rather than discovering them piecemeal mid-session.
 */

import fs from 'fs'
import path from 'path'

const SAMPLE_DIR = path.join(process.cwd(), '..', 'sample')

export function writeSkillFiles(projectDir: string): void {
  const commandsDir = path.join(projectDir, '.claude', 'commands')
  const examplesDir = path.join(projectDir, '.claude', 'examples')

  fs.mkdirSync(commandsDir, { recursive: true })
  fs.mkdirSync(examplesDir, { recursive: true })

  copySamples(examplesDir)

  fs.writeFileSync(path.join(commandsDir, 'generate-specs.md'), GENERATE_SPECS_SKILL)
  fs.writeFileSync(path.join(commandsDir, 'scaffold-frontend.md'), SCAFFOLD_FRONTEND_SKILL)
  fs.writeFileSync(path.join(commandsDir, 'build-layout.md'), BUILD_LAYOUT_SKILL)
  fs.writeFileSync(path.join(commandsDir, 'build-page.md'), BUILD_PAGE_SKILL)
  fs.writeFileSync(path.join(commandsDir, 'build-backend.md'), BUILD_BACKEND_SKILL)
  fs.writeFileSync(path.join(commandsDir, 'apply-change.md'), APPLY_CHANGE_SKILL)
}

function copySamples(examplesDir: string): void {
  const sampleFiles = [
    ['specs/design/tokens.md', 'tokens.md'],
    ['specs/design/components.md', 'components.md'],
    ['specs/pages/marketing.md', 'marketing.md'],
    ['specs/content/assets.md', 'assets.md'],
    ['CLAUDE.md', 'CLAUDE.md'],
  ]

  for (const [src, dest] of sampleFiles) {
    const srcPath = path.join(SAMPLE_DIR, src)
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(examplesDir, dest))
    }
  }
}

// ─── Skill: Generate Specs ────────────────────────────────────────────────────

const GENERATE_SPECS_SKILL = `# generate-specs

You are generating the complete spec structure for a web project.

## Step 1 — Read the project overview
Run: \`cat overview.md\`
If it is empty or missing, stop and say "overview.md is missing — cannot proceed."
Summarise the project in one sentence before continuing.

## Step 2 — Decide which spec files this project needs

There is NO fixed list. Reason from the overview and write ONLY what this project
actually requires. Do not write placeholder or "we might need this" files.

**Frontend (if any):**
- Always: \`specs/client/overview.md\` — stack, folder structure, conventions
- If there's a design system: \`specs/client/design/tokens.md\` and \`specs/client/design/components.md\`
- For each major page or page group: \`specs/client/pages/{name}.md\`
- If frontend fetches from an API: \`specs/client/data-fetching.md\`
- If global UI state: \`specs/client/state.md\`
- If assets/copy: \`specs/client/content/assets.md\`
- If realtime/websockets in the UI: \`specs/client/realtime.md\`

**Backend (if any):**
- Always: \`specs/server/overview.md\` — stack, folder structure, conventions
- If persistent data: \`specs/server/database.md\`
- If business logic: \`specs/server/services.md\`
- If REST API: \`specs/server/api-routes.md\`
- If background jobs/queues/email: \`specs/server/jobs.md\`
- If websockets server-side: \`specs/server/websocket.md\`
- If env vars / deployment: \`specs/server/environments.md\`

**Shared (if both frontend and backend exist):**
- \`specs/server-client-communication.md\` — REST shapes, auth tokens, error codes, WS events

## Step 3 — Write each spec file

Look at the example spec files in \`.claude/examples/\` — these show the exact level of
detail and writing style to use. They are FORMAT references only. Do not copy their content.

Write specs specific to THIS project:
- Use the actual app name, not placeholders
- Define real colour values, real route names, real schema fields
- Describe actual UI components needed
- Be thorough — the spec is the blueprint for the entire codebase

## Step 4 — Write specs/client/dependencies.md

This file tells the scaffold session exactly which packages to install in one pass.
List ONLY packages that are NOT already included by create-next-app
(next, react, react-dom, tailwindcss, @types/node, @types/react, typescript are pre-installed).

Format:
\`\`\`markdown
# Client Dependencies

## Runtime
- package-name — one-line reason (e.g. framer-motion — page transition animations)

## Dev
- package-name — one-line reason
\`\`\`

If no additional packages are needed, write the file with just the heading and
"No additional packages required."

If the project has a backend, also write \`specs/server/dependencies.md\` in the same format.

## Step 5 — Write CLAUDE.md last

CLAUDE.md must:
1. State the role: "You are building {app name}"
2. List every spec file created (under \`specs/\`) in the ORDER they should be read before writing code
3. Define hard rules specific to this project (e.g. "NEVER hardcode colours, always use tokens")
4. Define the tech stack
5. Define the folder structure

Use \`.claude/examples/CLAUDE.md\` as a format reference.
`

// ─── Skill: Scaffold Frontend ─────────────────────────────────────────────────

const SCAFFOLD_FRONTEND_SKILL = `# scaffold-frontend

You are setting up the initial frontend project scaffold. Your ONLY job this session is to
create the project structure, install ALL dependencies, apply global tokens, and write config
files. Do NOT build any components or pages yet.

## Step 1 — Read context and detect the tech stack
Read \`overview.md\`, then \`CLAUDE.md\`, then \`specs/client/overview.md\`.
The Tech Stack section of overview.md is authoritative. Extract:
- The frontend framework (e.g. Next.js, Vite + React, Vite + Vue, SvelteKit, etc.)
- Whether TypeScript is required
- Whether Tailwind CSS is used
Summarise the detected stack in one sentence before continuing.

## Step 2 — Scaffold the project (skip if already done)
Check if \`client/package.json\` already exists. If it does, skip to Step 3.

Otherwise run the appropriate scaffold command based on the detected stack:

**Next.js (TypeScript + Tailwind — the default):**
\`\`\`
npx --yes create-next-app@latest client --typescript --tailwind --app --src-dir --no-git --no-eslint --yes
\`\`\`

**Vite + React + TypeScript:**
\`\`\`
npx --yes create-vite@latest client --template react-ts
cd client && npm install --cache ~/.webbuilder/npm-cache
\`\`\`

**Vite + Vue + TypeScript:**
\`\`\`
npx --yes create-vite@latest client --template vue-ts
cd client && npm install --cache ~/.webbuilder/npm-cache
\`\`\`

**SvelteKit:**
\`\`\`
npx --yes sv create client --template minimal --types ts --no-add-ons
cd client && npm install --cache ~/.webbuilder/npm-cache
\`\`\`

**Other framework:** Read the spec carefully and run the standard scaffold command for that
framework. Always prefer an official CLI tool (create-*, degit, etc.) over manual setup.

Wait for the scaffold command to finish completely before proceeding.

## Step 3 — Install Tailwind CSS (if needed and not already included)
If the stack uses Tailwind and the scaffold did not include it, install and configure it now
following the official guide for the detected framework.

## Step 4 — Install all project-specific dependencies in one pass
Read \`specs/client/dependencies.md\`.
Extract every package listed under Runtime and Dev sections.
If there are Runtime packages:
\`\`\`
cd client && npm install <packages> --cache ~/.webbuilder/npm-cache
\`\`\`
If there are Dev packages:
\`\`\`
cd client && npm install -D <packages> --cache ~/.webbuilder/npm-cache
\`\`\`
If the file says "No additional packages required", skip this step.
**Never run npm install again in any later session — all packages are installed here.**

## Step 5 — Apply design tokens
Read \`specs/client/design/tokens.md\`.
Write all colour, typography, and spacing values as CSS custom properties in the global
stylesheet (globals.css for Next.js, index.css or App.css for Vite, etc.).
Remove default framework boilerplate styles; keep only the :root token block and base resets.
Apply the project font where the framework expects it (layout.tsx, App.tsx, etc.).

## Step 6 — Create environment and gitignore files
- Write \`client/.env.example\` with placeholder values for every env var the project will need
- Write \`client/.env\` with the same keys set to empty strings
- Write \`client/.gitignore\` appropriate for the framework (node_modules/, build output, .env)

## Step 7 — Verify (type-check only)
Run: \`cd client && npx tsc --noEmit\`
Fix all TypeScript errors before continuing.
(The dev server handles compilation continuously — no need to run a full production build here.)

## Step 8 — Write handoff documentation
Write \`documentation/scaffold.md\` with:

### Stack
Framework, version, key packages.

### Packages installed
Every dependency and devDependency (name + version from package.json).

### CSS token variables
Every CSS custom property defined in the global stylesheet.

### Folder structure
Directory tree under client/ (exclude node_modules and build output).

### Conventions
Font loading approach, path aliases, important config decisions.

Then STOP. Write nothing else.
`

// ─── Skill: Build Layout ──────────────────────────────────────────────────────

const BUILD_LAYOUT_SKILL = `# build-layout

You are building the shared layout components for this project: Navbar, Footer, and the root
layout wrapper. Do NOT build any page content or page-specific sections this session.

## Step 1 — Read context (do not scan source files)
Read these files in order — this is all the context you need:
1. \`documentation/scaffold.md\` — packages available, token variable names, folder structure
2. \`specs/client/design/tokens.md\` — colour/spacing values
3. \`specs/client/design/components.md\` — component primitives to use
4. \`CLAUDE.md\` — project rules and stack

## Step 2 — Build layout components
Read \`documentation/scaffold.md\` to confirm the framework and folder conventions.
Build ONLY the shared shell — Navbar, Footer, and the root layout wrapper.
Place them where the framework expects shared layout code (e.g. for Next.js:
\`client/src/components/layout/\` + \`client/src/app/layout.tsx\`; for Vite+React:
\`client/src/components/layout/\` + \`client/src/App.tsx\`).

Rules:
- Use CSS custom properties defined in the global stylesheet — never hardcode colours or spacing
- Keep Navbar and Footer purely presentational — no data fetching
- Do NOT run npm install — all packages were installed during scaffold

## Step 3 — Verify (type-check only)
Run: \`cd client && npx tsc --noEmit\`
Fix all TypeScript errors before continuing.

## Step 4 — Write handoff documentation
Write \`documentation/layout.md\` with:

### Components built
For each component: file path, a one-line description, and its props interface.

### Styles used
List CSS custom properties used and any Tailwind utility classes that form the visual identity.

### Navigation links
List every nav link defined (label + href).

Then STOP. Write nothing else.
`

// ─── Skill: Build Page ────────────────────────────────────────────────────────

const BUILD_PAGE_SKILL = `# build-page

You are building a single page and its section components.
The page name and spec file are specified at the end of this prompt.

## Step 1 — Read context (do not scan source files)
Read these files in order:
1. \`documentation/scaffold.md\` — packages, tokens, folder structure
2. \`documentation/layout.md\` — existing layout components and their props
3. \`documentation/pages.md\` (if it exists) — pages already built, components already created
4. The page spec file named at the end of this prompt

Do NOT read any other source files. The documentation above contains all the context you need.

## Step 2 — Build the page
Read \`documentation/scaffold.md\` to confirm the framework routing conventions.
- Section components go in \`client/src/components/sections/\`
- Place the page file where the framework expects it (e.g. for Next.js:
  \`client/src/app/{route}/page.tsx\`; for Vite: \`client/src/pages/{Route}.tsx\` wired via the router)
- Reuse layout components from \`documentation/layout.md\` — do not recreate them
- Use CSS custom properties from the global stylesheet — never hardcode colours
- All copy must come from the spec — no placeholder text
- Do NOT run npm install — all packages were installed during scaffold

## Step 3 — Verify (type-check only)
Run: \`cd client && npx tsc --noEmit\`
Fix all TypeScript errors before continuing.

## Step 4 — Update handoff documentation
Append to \`documentation/pages.md\` (create if it does not exist):

### {PageName} page
- Route: /{route}
- Page file: client/src/app/{route}/page.tsx
- Section components: list each file path and a one-line description

Then STOP. Write nothing else.

---

**Note:** Page spec files are located under \`specs/client/pages/\`, not inside \`client/\`.
`

// ─── Skill: Build Backend ─────────────────────────────────────────────────────

const BUILD_BACKEND_SKILL = `# build-backend

You are generating the complete backend codebase and wiring it to the frontend.

## Step 1 — Read context
Read \`CLAUDE.md\`, then all \`specs/server/\` files, then \`specs/server-client-communication.md\`.
Also read \`documentation/scaffold.md\` and \`documentation/pages.md\` to understand what the
frontend expects.

## Step 2 — Scaffold
Check if \`server/package.json\` exists. If not, scaffold based on the stack in
\`specs/server/overview.md\`. Place all source code under \`server/src/\`.

Install server dependencies:
\`\`\`
cd server && npm install <packages from specs/server/dependencies.md> --cache ~/.webbuilder/npm-cache
\`\`\`

Create:
- \`server/.env.example\` with all required env var keys
- \`server/.env\` with keys set to empty strings
- \`server/.gitignore\` (node_modules/, dist/, .env)

## Step 3 — Generate backend code
Implement everything in the server specs:
- Database schema and migrations under \`server/src/db/\`
- Service layer under \`server/src/services/\`
- API routes under \`server/src/routes/\` with correct middleware and auth guards
- Background jobs if specified
- Entry point at \`server/src/index.ts\` (or main file per the spec)

## Step 4 — Wire frontend to backend
Update the frontend to call real API endpoints:
- Add API client setup per \`specs/client/data-fetching.md\`
- Replace any hardcoded/mock data with real API calls
- Add \`NEXT_PUBLIC_API_URL\` to \`client/.env\` and \`client/.env.example\`

## Step 5 — Verify both builds
Run \`cd client && npx tsc --noEmit\`, then verify the server compiles
(\`cd server && npx tsc --noEmit\` or \`npm run build\` per the spec).
Fix all errors before stopping.

## Step 6 — Write handoff documentation
Write \`documentation/backend.md\` with:
- API routes list (method, path, description)
- Database tables/collections
- Environment variables required
`

// ─── Skill: Apply Change ──────────────────────────────────────────────────────

const APPLY_CHANGE_SKILL = `# apply-change

A user has requested a change to the running application. The request follows this prompt.

## Step 1 — Read context
Read \`documentation/scaffold.md\`, \`documentation/layout.md\`, and \`documentation/pages.md\`
to understand what exists. Only open source files you actually need to edit.

## Step 2 — Identify the change type and act

**Design change** (colour, spacing, typography):
- Update the relevant spec file (tokens.md, components.md)
- Update globals.css or the component
- Keep spec and code in sync

**Content change** (copy, images, labels):
- Update the relevant content/assets spec
- Update the component

**New feature or section**:
- Update or add to the relevant spec file
- Write the code
- If a new npm package is needed, install it:
  \`cd client && npm install <package> --cache ~/.webbuilder/npm-cache\`

**Structural/layout change**:
- Update the relevant page spec
- Update the code

## Step 3 — Verify
Run: \`cd client && npx tsc --noEmit\`
Fix any TypeScript errors introduced by your change.

## Rules
- Make the MINIMAL change needed. Do not refactor unrelated code.
- Do not change anything the user did not ask about.
- Update \`documentation/pages.md\` if you add or remove a component.
`
