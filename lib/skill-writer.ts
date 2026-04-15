/**
 * Creates the .claude/commands/ skill files and .claude/examples/
 * in the project directory. These files are the programmatic instructions
 * that tell Claude Code how to write specs and generate code.
 *
 * Build pipeline (each step is its own Claude Code session):
 *   generate-specs  → writes all spec files + CLAUDE.md
 *   scaffold-frontend → creates Next.js app, tokens, .env, .gitignore
 *   build-layout    → Navbar, Footer, root layout only
 *   build-page      → one page per session (page name injected at call time)
 *   build-backend   → full backend + wires frontend
 *   apply-change    → targeted edits for user requests
 *
 * Context handoff: each session writes documentation/{phase}.md so the
 * next session reads that summary instead of scanning source files.
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

There is NO fixed list. Reason from the overview:

**Frontend (if any):**
- Always: \`client/specs/overview.md\` — stack, folder structure, conventions
- If there's a design system: \`client/specs/design/tokens.md\` and \`client/specs/design/components.md\`
- For each major page or page group: \`client/specs/pages/{name}.md\`
- If frontend fetches from an API: \`client/specs/data-fetching.md\`
- If global UI state: \`client/specs/state.md\`
- If assets/copy: \`client/specs/content/assets.md\`
- If realtime/websockets in the UI: \`client/specs/realtime.md\`

**Backend (if any):**
- Always: \`server/specs/overview.md\` — stack, folder structure, conventions
- If persistent data: \`server/specs/database.md\`
- If business logic: \`server/specs/services.md\`
- If REST API: \`server/specs/api-routes.md\`
- If background jobs/queues/email: \`server/specs/jobs.md\`
- If websockets server-side: \`server/specs/websocket.md\`
- If env vars / deployment: \`server/specs/environments.md\`

**Shared (if both frontend and backend exist):**
- \`server-client-communication.md\` — REST shapes, auth tokens, error codes, WS events

## Step 3 — Write each spec file

Look at the example spec files in \`.claude/examples/\` — these show the exact level of
detail and writing style to use. They are FORMAT references only. Do not copy their content.

Write specs specific to THIS project:
- Use the actual app name, not placeholders
- Define real colour values, real route names, real schema fields
- Describe actual UI components needed
- Be thorough — the spec is the blueprint for the entire codebase

## Step 4 — Write CLAUDE.md last

CLAUDE.md must:
1. State the role: "You are building {app name}"
2. List every spec file created in the ORDER they should be read before writing code
3. Define hard rules specific to this project (e.g. "NEVER hardcode colours, always use tokens")
4. Define the tech stack
5. Define the folder structure

Use \`.claude/examples/CLAUDE.md\` as a format reference.
`

// ─── Skill: Scaffold Frontend ─────────────────────────────────────────────────

const SCAFFOLD_FRONTEND_SKILL = `# scaffold-frontend

You are setting up the initial Next.js project scaffold. Your ONLY job this session is to
create the project, install dependencies, apply global tokens, and create env/gitignore files.
Do NOT build any components or pages.

## Step 1 — Read context
Read \`overview.md\`, then \`CLAUDE.md\`, then \`client/specs/overview.md\`.
Summarise the stack and key conventions in one sentence before continuing.

## Step 2 — Scaffold
Check if \`client/package.json\` exists. If not, run:
\`\`\`
npx create-next-app@latest client --typescript --tailwind --app --no-git --no-eslint --yes
\`\`\`
Wait for it to finish completely before proceeding.

## Step 3 — Apply design tokens
Read \`client/specs/design/tokens.md\`.
- Define all colour, typography, and spacing values as CSS custom properties in \`client/src/app/globals.css\`
- Remove all default Next.js boilerplate styles (keep only the :root token block and base resets)
- Apply the project font via next/font in \`client/src/app/layout.tsx\`

## Step 4 — Create environment and gitignore files
- Write \`client/.env.example\` with placeholder values for every env var the project will need
  (derive these from the specs — API URLs, keys, feature flags, etc.)
- Write \`client/.env\` with the same keys set to empty strings (never commit real secrets)
- Write \`client/.gitignore\`:
  node_modules/
  .next/
  out/
  .env
  .env.local
  .DS_Store

## Step 5 — Verify
Run: \`cd client && npm run build\`
Fix all TypeScript and build errors. The build MUST pass before continuing.

## Step 6 — Write handoff documentation
Write \`documentation/scaffold.md\` with the following sections:

### Packages installed
List every dependency and devDependency (name + version from package.json).

### CSS token variables
List every CSS custom property defined in globals.css (e.g. --color-primary: #FF6B2C).

### Folder structure
Show the directory tree created under client/ (exclude node_modules and .next).

### Conventions
Note any important conventions established (font loading approach, any path aliases, etc.).

Then STOP. Write nothing else.
`

// ─── Skill: Build Layout ──────────────────────────────────────────────────────

const BUILD_LAYOUT_SKILL = `# build-layout

You are building the shared layout components for this project: Navbar, Footer, and the root
layout wrapper. Do NOT build any page content or page-specific sections this session.

## Step 1 — Read context (do not scan source files)
Read these files in order — this is all the context you need:
1. \`documentation/scaffold.md\` — packages available, token variable names, folder structure
2. \`client/specs/design/tokens.md\` — colour/spacing values
3. \`client/specs/design/components.md\` — component primitives to use
4. \`CLAUDE.md\` — project rules and stack

## Step 2 — Build layout components
Build ONLY these three files:
- \`client/src/components/layout/Navbar.tsx\`
- \`client/src/components/layout/Footer.tsx\`
- \`client/src/app/layout.tsx\` (imports Navbar + Footer, wraps {children})

Rules:
- Use CSS custom properties from globals.css — never hardcode colours or spacing
- Use fonts from the root layout, not re-imported per-component
- Keep Navbar and Footer purely presentational — no data fetching

## Step 3 — Verify
Run: \`cd client && npm run build\`
Fix all errors. Build MUST pass before continuing.

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
- Section components go in \`client/src/components/sections/\`
- The page file goes in \`client/src/app/{route}/page.tsx\`
- Reuse layout components from \`documentation/layout.md\` — do not recreate them
- Use CSS custom properties from globals.css — never hardcode colours
- All copy must come from the spec — no placeholder text

## Step 3 — Verify
Run: \`cd client && npm run build\`
Fix all errors. Build MUST pass before continuing.

## Step 4 — Update handoff documentation
Append to \`documentation/pages.md\` (create if it does not exist):

### {PageName} page
- Route: /{route}
- Page file: client/src/app/{route}/page.tsx
- Section components: list each file path and a one-line description

Then STOP. Write nothing else.

---
`

// ─── Skill: Build Backend ─────────────────────────────────────────────────────

const BUILD_BACKEND_SKILL = `# build-backend

You are generating the complete backend codebase and wiring it to the frontend.

## Step 1 — Read context
Read \`CLAUDE.md\`, then all \`server/specs/\` files, then \`server-client-communication.md\`.
Also read \`documentation/scaffold.md\` and \`documentation/pages.md\` to understand what the
frontend expects.

## Step 2 — Scaffold
Check if \`server/package.json\` exists. If not, scaffold based on the stack in
\`server/specs/overview.md\`. Place all source code under \`server/src/\`.

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
- Add API client setup per \`client/specs/data-fetching.md\`
- Replace any hardcoded/mock data with real API calls
- Add \`NEXT_PUBLIC_API_URL\` to \`client/.env\` and \`client/.env.example\`

## Step 5 — Verify both builds
Run \`cd client && npm run build\`, then verify the server compiles (\`cd server && npm run build\` or \`tsc --noEmit\`).
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

**Structural/layout change**:
- Update the relevant page spec
- Update the code

## Step 3 — Verify
Run: \`cd client && npm run build\`
Fix any errors introduced by your change.

## Rules
- Make the MINIMAL change needed. Do not refactor unrelated code.
- Do not change anything the user did not ask about.
- Update \`documentation/pages.md\` if you add or remove a component.
`
