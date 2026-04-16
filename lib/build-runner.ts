/**
 * Background build runner — decouples Claude Code sessions from HTTP connections.
 *
 * Builds run as fire-and-forget async tasks. Events are buffered in memory so
 * the frontend can reconnect (e.g. after page refresh) and catch up on missed events.
 *
 * One active build per project at a time.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { readSkill, setPhase, clearPreviewPort } from './project-manager'
import { startPreview } from './preview-manager'
import path from 'path'
import fs from 'fs'

// ── Types ────────────────────────────────────────────────────────────────────

export type BuildEventKind =
    | 'text'
    | 'file'
    | 'shell'
    | 'phase'
    | 'done'
    | 'warning'
    | 'error'
    | 'preview-ready'
    | 'preview-refresh'

export interface BuildEvent {
    kind: BuildEventKind
    data: Record<string, unknown>
    timestamp: number
}

export type BuildStatus = 'running' | 'done' | 'error'

export type Skill =
    | 'generate-specs'
    | 'scaffold-frontend'
    | 'build-layout'
    | 'build-page'
    | 'build-backend'

export interface ActiveBuild {
    projectId: string
    skill: Skill
    pageName?: string
    status: BuildStatus
    events: BuildEvent[]
    error?: string
}

// ── In-memory store ──────────────────────────────────────────────────────────

const builds = new Map<string, ActiveBuild>()

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start a build for a project. Returns immediately — the build runs in the background.
 * If a build is already running for this project, returns false.
 */
export function startBuild(
    projectId: string,
    projectDir: string,
    skill: Skill,
    pageName?: string,
): boolean {
    const existing = builds.get(projectId)
    if (existing && existing.status === 'running') {
        console.log(`[build-runner] Build already running for ${projectId}, skill="${existing.skill}"`)
        return false
    }

    const build: ActiveBuild = {
        projectId,
        skill,
        pageName,
        status: 'running',
        events: [],
    }

    builds.set(projectId, build)

    console.log(`[build-runner] ▶ Starting background build: skill="${skill}", project="${projectId}"${pageName ? `, page="${pageName}"` : ''}`)

    // Fire-and-forget — intentionally NOT awaited
    runBuildAsync(build, projectDir).catch((err) => {
        console.error(`[build-runner] ❌ Unhandled error in background build:`, err)
        build.status = 'error'
        build.error = String(err)
        pushEvent(build, 'error', { message: String(err) })
    })

    return true
}

/** Get the current build for a project, or null if none exists. */
export function getBuild(projectId: string): ActiveBuild | null {
    return builds.get(projectId) ?? null
}

/** Get events starting from a given index. Returns { events, total }. */
export function getEvents(projectId: string, fromIndex: number): { events: BuildEvent[]; total: number } | null {
    const build = builds.get(projectId)
    if (!build) return null
    return {
        events: build.events.slice(fromIndex),
        total: build.events.length,
    }
}

/** Check if a build is currently running for a project. */
export function isBuildRunning(projectId: string): boolean {
    const build = builds.get(projectId)
    return build?.status === 'running'
}

/** Clear a completed/errored build from memory. */
export function clearBuild(projectId: string): void {
    builds.delete(projectId)
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function pushEvent(build: ActiveBuild, kind: BuildEventKind, data: Record<string, unknown>) {
    build.events.push({ kind, data, timestamp: Date.now() })
}

/**
 * Runs a single Claude Code session for one skill.
 * This function runs independently of any HTTP connection.
 */
async function runSession(
    build: ActiveBuild,
    projectDir: string,
    skillName: string,
    extraPrompt = '',
) {
    console.log(`[build-runner] 🔄 runSession start: "${skillName}"`)
    const skillPrompt = readSkill(projectDir, skillName)
    const fullPrompt = extraPrompt ? `${skillPrompt}\n\n${extraPrompt}` : skillPrompt
    let messageCount = 0

    try {
        for await (const message of query({
            prompt: fullPrompt,
            options: {
                cwd: projectDir,
                maxTurns: 80,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            },
        })) {
            messageCount++
            if (messageCount % 5 === 1) {
                console.log(`[build-runner] 📨 "${skillName}" message #${messageCount}, type: ${message.type}`)
            }
            if (message.type === 'assistant') {
                for (const block of message.message.content) {
                    if (block.type === 'text' && block.text.trim()) {
                        pushEvent(build, 'text', { text: block.text })
                    }
                    if (block.type === 'tool_use') {
                        if (block.name === 'Write' || block.name === 'FileWrite') {
                            const filePath = (block.input as Record<string, string>).file_path ?? ''
                            const relative = filePath.startsWith(projectDir)
                                ? filePath.slice(projectDir.length + 1)
                                : filePath
                            console.log(`[build-runner] 📝 File written: ${relative}`)
                            pushEvent(build, 'file', { path: relative })
                        }
                        if (block.name === 'Bash') {
                            const cmd = (block.input as Record<string, string>).command ?? ''
                            console.log(`[build-runner] 💻 Shell: ${cmd.slice(0, 80)}`)
                            pushEvent(build, 'shell', { command: cmd.slice(0, 120) })
                        }
                    }
                }
            }
        }
        console.log(`[build-runner] ✅ runSession complete: "${skillName}", total messages: ${messageCount}`)
    } catch (err) {
        const msg = String(err)
        if (msg.includes('maximum number of turns')) {
            console.warn(`[build-runner] ⚠️ Max turns reached for "${skillName}" after ${messageCount} messages`)
            pushEvent(build, 'warning', { message: `Session turn limit reached for "${skillName}". Work saved so far.` })
        } else {
            console.error(`[build-runner] ❌ Error in "${skillName}":`, err)
            throw err
        }
    }
}

/**
 * The background async runner. Executes the skill and updates build status.
 * This function is fire-and-forget — it is NOT tied to any HTTP request.
 */
async function runBuildAsync(build: ActiveBuild, projectDir: string): Promise<void> {
    const { projectId, skill, pageName } = build

    try {
        // ── generate-specs ─────────────────────────────────────────────────────
        if (skill === 'generate-specs') {
            console.log(`[build-runner] Starting pipeline: generate-specs`)
            setPhase(projectId, 'writing-specs')
            pushEvent(build, 'phase', { label: 'Writing specs...' })
            await runSession(build, projectDir, 'generate-specs')
            const pages = discoverPages(projectDir)
            console.log(`[build-runner] Specs done. Discovered pages:`, pages)
            pushEvent(build, 'done', { skill, pages })

            // ── scaffold-frontend ──────────────────────────────────────────────────
        } else if (skill === 'scaffold-frontend') {
            console.log(`[build-runner] Starting pipeline: scaffold-frontend`)
            clearPreviewPort(projectId)
            setPhase(projectId, 'building')
            pushEvent(build, 'phase', { label: 'Scaffolding project...' })
            await runSession(build, projectDir, 'scaffold-frontend')

            const clientDir = path.join(projectDir, 'client')
            if (fs.existsSync(path.join(clientDir, 'package.json'))) {
                console.log(`[build-runner] Starting preview server...`)
                const port = await startPreview(projectId, projectDir)
                console.log(`[build-runner] Preview server running on port ${port}`)
                setPhase(projectId, 'preview')
                pushEvent(build, 'preview-ready', { port })
            } else {
                console.warn(`[build-runner] No client/package.json found after scaffold`)
                setPhase(projectId, 'preview')
            }
            pushEvent(build, 'done', { skill })

            // ── build-layout ───────────────────────────────────────────────────────
        } else if (skill === 'build-layout') {
            console.log(`[build-runner] Starting pipeline: build-layout`)
            setPhase(projectId, 'building')
            pushEvent(build, 'phase', { label: 'Building Navbar & Footer...' })
            await runSession(build, projectDir, 'build-layout')
            setPhase(projectId, 'preview')
            pushEvent(build, 'preview-refresh', {})
            pushEvent(build, 'done', { skill })
            console.log(`[build-runner] build-layout complete`)

            // ── build-page ─────────────────────────────────────────────────────────
        } else if (skill === 'build-page') {
            const name = pageName ?? 'home'
            console.log(`[build-runner] Starting pipeline: build-page "${name}"`)
            setPhase(projectId, 'building')
            pushEvent(build, 'phase', { label: `Building ${name} page...` })
            await runSession(
                build,
                projectDir,
                'build-page',
                `## Page to build\n\`${name}\` — read \`specs/client/pages/${name}.md\` for the full spec.`,
            )
            setPhase(projectId, 'preview')
            pushEvent(build, 'preview-refresh', {})
            pushEvent(build, 'done', { skill })
            console.log(`[build-runner] build-page "${name}" complete`)

            // ── build-backend ──────────────────────────────────────────────────────
        } else if (skill === 'build-backend') {
            console.log(`[build-runner] Starting pipeline: build-backend`)
            setPhase(projectId, 'building-backend')
            pushEvent(build, 'phase', { label: 'Building backend...' })
            await runSession(build, projectDir, 'build-backend')
            setPhase(projectId, 'complete')
            pushEvent(build, 'done', { skill })
            console.log(`[build-runner] build-backend complete`)
        }

        build.status = 'done'
        console.log(`[build-runner] ✅ Build "${skill}" finished successfully for project ${projectId}`)
    } catch (err) {
        build.status = 'error'
        build.error = String(err)
        console.error(`[build-runner] ❌ Build "${skill}" FAILED for project ${projectId}:`, err)
        pushEvent(build, 'error', { message: String(err) })
    }
}

/**
 * Reads the page spec files written by generate-specs to know which pages
 * need to be built. Falls back to ['home'] if no spec pages directory exists.
 */
function discoverPages(projectDir: string): string[] {
    const pagesDir = path.join(projectDir, 'specs', 'client', 'pages')
    if (!fs.existsSync(pagesDir)) return ['home']
    const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md'))
    return files.length > 0 ? files.map((f) => f.replace('.md', '')) : ['home']
}
