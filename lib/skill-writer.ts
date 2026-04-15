/**
 * Creates the .claude/commands/ skill files and .claude/examples/
 * in the project directory. These files are the programmatic instructions
 * that tell Claude Code how to write specs and generate code.
 */

import fs from 'fs'
import path from 'path'

const SAMPLE_DIR = path.join(process.cwd(), '..', 'sample')

export function writeSkillFiles(projectDir: string): void {
  const commandsDir = path.join(projectDir, '.claude', 'commands')
  const examplesDir = path.join(projectDir, '.claude', 'examples')

  fs.mkdirSync(commandsDir, { recursive: true })
  fs.mkdirSync(examplesDir, { recursive: true })

  // Copy sample spec files as format examples
  copySamples(examplesDir)

  // Write each skill file
  fs.writeFileSync(path.join(commandsDir, 'generate-specs.md'), GENERATE_SPECS_SKILL)
  fs.writeFileSync(path.join(commandsDir, 'build-frontend.md'), BUILD_FRONTEND_SKILL)
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

## Step 1 — Confirm you can read the project context
Run: \`cat overview.md\`
If the file is empty or missing, stop and say "overview.md is missing or empty — cannot proceed."
Otherwise, confirm you read it by summarising the project in one sentence before continuing.

## Step 2 — Read the project context fully
Re-read \`overview.md\` carefully. Understand the project deeply before doing anything else.

## Step 3 — Decide what spec files this project needs

There is NO fixed list. Reason through it based on what you read:

**For the frontend (if any):**
- Always: \`client-x/specs/overview.md\` — frontend stack, folder structure, conventions
- If there's a design system / brand: \`client-x/specs/design/tokens.md\` and \`client-x/specs/design/components.md\`
- For each major page or page group: \`client-x/specs/pages/{name}.md\`
- If frontend fetches from an API: \`client-x/specs/data-fetching.md\`
- If there's global UI state: \`client-x/specs/state.md\`
- If there are assets, images, copy: \`client-x/specs/content/assets.md\`
- If there's realtime/websockets in the UI: \`client-x/specs/realtime.md\`

**For the backend (if any):**
- Always: \`server-x/specs/overview.md\` — server stack, folder structure, conventions
- If there's persistent data: \`server-x/specs/database.md\`
- If there's business logic: \`server-x/specs/services.md\`
- If there's a REST API: \`server-x/specs/api-routes.md\`
- If there are background jobs, queues, email: \`server-x/specs/jobs.md\`
- If there are websockets server-side: \`server-x/specs/websocket.md\`
- If there are env vars / deployments: \`server-x/specs/environments.md\`

**Shared (if both frontend and backend exist):**
- \`server-client-communication.md\` — REST shapes, auth tokens, error codes, WS events

## Step 4 — Write each spec file

Look at the example spec files in \`.claude/examples/\` — these show the exact level of
detail and writing style to use. They are FORMAT references only. Do not copy their content.

Write specs that are specific to THIS project:
- Use the actual app name, not placeholders
- Define real color values, real route names, real schema fields
- Describe actual UI components needed, not generic ones
- Be thorough — the spec is the blueprint for the entire codebase

## Step 5 — Write CLAUDE.md last

CLAUDE.md must:
1. State the role: "You are building {app name}"
2. List every spec file you created in the ORDER Claude Code should read them before writing code
3. Define hard rules specific to this project (e.g., "NEVER hardcode colors, always use tokens")
4. Define the tech stack
5. Define the folder structure for the generated code

Use \`.claude/examples/CLAUDE.md\` as a format reference.
`

// ─── Skill: Build Frontend ────────────────────────────────────────────────────

const BUILD_FRONTEND_SKILL = `# build-frontend

You are generating the complete frontend codebase for this project.

## Step 1 — Read all specs
Open \`CLAUDE.md\`. Read it fully. It lists every spec file in the order you must read them.
Read every single spec file before writing a single line of code.

## Step 2 — Scaffold if needed
Check if \`client-x/package.json\` exists. If not, scaffold with:
\`\`\`
npx create-next-app@latest client-x --typescript --tailwind --app --no-git --no-eslint --yes
\`\`\`

## Step 3 — Generate all code
Implement everything the specs describe. Rules:
- No stubbed components, no placeholder content, no TODO comments
- Real components with correct styles matching the design tokens spec exactly
- Real page layouts matching the page specs exactly
- All copy from the assets/content spec
- Follow the folder structure defined in CLAUDE.md

## Step 4 — Verify the build
Run: \`cd client-x && npm run build\`
Fix all TypeScript and build errors. The build MUST succeed before you stop.
`

// ─── Skill: Build Backend ─────────────────────────────────────────────────────

const BUILD_BACKEND_SKILL = `# build-backend

You are generating the complete backend codebase and wiring it to the frontend.

## Step 1 — Read all specs
Read \`CLAUDE.md\`, then all server-x specs, then \`server-client-communication.md\`.

## Step 2 — Scaffold if needed
Check if \`server-x/package.json\` exists. If not, scaffold based on the stack in
\`server-x/specs/overview.md\`.

## Step 3 — Generate backend code
Implement everything in the server specs:
- Database schema and migrations
- Service layer (business logic)
- API routes with correct middleware and auth guards
- Background jobs if specified
- Environment variable setup (.env.example)

## Step 4 — Wire frontend to backend
Update the frontend to call real API endpoints:
- Add API client setup per \`client-x/specs/data-fetching.md\`
- Replace any hardcoded/mock data with real API calls
- Add \`NEXT_PUBLIC_API_URL\` env var pointing to the backend

## Step 5 — Verify both build
Run both \`npm run build\` commands. Fix all errors before stopping.
`

// ─── Skill: Apply Change ──────────────────────────────────────────────────────

const APPLY_CHANGE_SKILL = `# apply-change

A user has requested a change to the running application. The request follows this message.

## How to approach it

1. **Identify** what files are affected (spec files and/or code files)

2. **If it is a design decision** (color, spacing, typography, layout pattern):
   - Update the relevant spec file (tokens.md, components.md, etc.)
   - Update the code to match
   - Keep spec and code in sync

3. **If it is a content change** (copy, images, labels):
   - Update the relevant content/assets spec
   - Update the code

4. **If it is a new feature or new section**:
   - Update or add to the relevant spec file to document it
   - Then write the code

5. **If it is a structural/layout change**:
   - Update the relevant page spec
   - Update the code

## Rules
- Make the MINIMAL change needed. Do not refactor unrelated code.
- Do not change things the user did not ask about.
- After making changes, verify the file compiles (run \`npm run build\` in client-x if touching frontend).
`
