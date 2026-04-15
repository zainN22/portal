import { NextRequest } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadProject, readSkill, setPhase } from '@/lib/project-manager'
import { startPreview } from '@/lib/preview-manager'
import path from 'path'
import fs from 'fs'

type Skill = 'generate-specs' | 'build-frontend' | 'build-backend'

export async function POST(req: NextRequest) {
  const { projectId, skill }: { projectId: string; skill: Skill } = await req.json()

  const project = loadProject(projectId)
  if (!project) return new Response('Project not found', { status: 404 })
  if (!project.dir) return new Response('Project directory not set up yet', { status: 400 })

  const projectDir = project.dir
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      /**
       * Runs a single Claude Code session for one skill.
       * Each session is capped at 40 turns — enough for a focused task,
       * small enough to never approach the hard limit.
       */
      async function runSession(skillName: string, extraPrompt = '') {
        const skillPrompt = readSkill(projectDir, skillName)
        const fullPrompt = extraPrompt ? `${skillPrompt}\n\n${extraPrompt}` : skillPrompt

        try {
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              cwd: projectDir,
              maxTurns: 40,
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
            },
          })) {
            if (message.type === 'assistant') {
              for (const block of message.message.content) {
                if (block.type === 'text' && block.text.trim()) {
                  send('text', { text: block.text })
                }
                if (block.type === 'tool_use') {
                  if (block.name === 'Write' || block.name === 'FileWrite') {
                    const filePath = (block.input as Record<string, string>).file_path ?? ''
                    const relative = filePath.startsWith(projectDir)
                      ? filePath.slice(projectDir.length + 1)
                      : filePath
                    send('file', { path: relative })
                  }
                  if (block.name === 'Bash') {
                    const cmd = (block.input as Record<string, string>).command ?? ''
                    send('shell', { command: cmd.slice(0, 120) })
                  }
                }
              }
            }
          }
        } catch (err) {
          const msg = String(err)
          // Max-turns means work up to this point is saved — treat as a warning, not a failure
          if (msg.includes('maximum number of turns')) {
            send('warning', { message: `Session turn limit reached for "${skillName}". Work saved so far.` })
          } else {
            throw err
          }
        }
      }

      try {
        if (skill === 'generate-specs') {
          setPhase(projectId, 'writing-specs')
          send('phase', { phase: 'generate-specs', label: 'Writing specs...' })
          await runSession('generate-specs')

        } else if (skill === 'build-frontend') {

          // ── Phase 1: Scaffold ──────────────────────────────────────────────
          setPhase(projectId, 'building')
          send('phase', { phase: 'scaffold', label: 'Scaffolding project...' })
          await runSession('scaffold-frontend')

          // Start preview as soon as the app exists (even before any UI is built)
          const clientDir = path.join(projectDir, 'client')
          if (fs.existsSync(path.join(clientDir, 'package.json'))) {
            const port = await startPreview(projectId, projectDir)
            setPhase(projectId, 'preview')
            send('preview-ready', { port })
          }

          // ── Phase 2: Layout ────────────────────────────────────────────────
          send('phase', { phase: 'layout', label: 'Building Navbar & Footer...' })
          await runSession('build-layout')
          send('preview-refresh', {})

          // ── Phase 3: Pages (one session per page) ─────────────────────────
          const pages = discoverPages(projectDir)
          for (const page of pages) {
            send('phase', { phase: `page-${page}`, label: `Building ${page} page...` })
            await runSession(
              'build-page',
              `## Page to build\n\`${page}\` — read \`client/specs/pages/${page}.md\` for the full spec.`,
            )
            send('preview-refresh', {})
          }

          setPhase(projectId, 'preview')

        } else if (skill === 'build-backend') {
          setPhase(projectId, 'building-backend')
          send('phase', { phase: 'build-backend', label: 'Building backend...' })
          await runSession('build-backend')
          setPhase(projectId, 'complete')
        }

        send('done', { skill })
      } catch (err) {
        send('error', { message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}

/**
 * Reads the page spec files written by generate-specs to know which pages
 * need to be built. Falls back to ['home'] if no spec pages directory exists.
 */
function discoverPages(projectDir: string): string[] {
  const pagesDir = path.join(projectDir, 'client', 'specs', 'pages')
  if (!fs.existsSync(pagesDir)) return ['home']
  const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.md'))
  return files.length > 0 ? files.map(f => f.replace('.md', '')) : ['home']
}
