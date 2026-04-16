import { NextRequest } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadProject, readSkill, setPhase, clearPreviewPort } from '@/lib/project-manager'
import { startPreview } from '@/lib/preview-manager'
import path from 'path'
import fs from 'fs'

type Skill =
  | 'generate-specs'
  | 'scaffold-frontend'
  | 'build-layout'
  | 'build-page'
  | 'build-backend'

export async function POST(req: NextRequest) {
  const {
    projectId,
    skill,
    pageName,
  }: { projectId: string; skill: Skill; pageName?: string } = await req.json()

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
       * 80 turns — large enough for complex pages, small enough to stay focused.
       */
      async function runSession(skillName: string, extraPrompt = '') {
        const skillPrompt = readSkill(projectDir, skillName)
        const fullPrompt = extraPrompt ? `${skillPrompt}\n\n${extraPrompt}` : skillPrompt

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
        // ── generate-specs ─────────────────────────────────────────────────────
        if (skill === 'generate-specs') {
          setPhase(projectId, 'writing-specs')
          send('phase', { label: 'Writing specs...' })
          await runSession('generate-specs')
          // Return discovered pages so the client can build its approval queue
          const pages = discoverPages(projectDir)
          send('done', { skill, pages })

        // ── scaffold-frontend ──────────────────────────────────────────────────
        } else if (skill === 'scaffold-frontend') {
          // Invalidate any port stored from a previous build so page reloads
          // never accidentally load a stale or cross-project dev server.
          clearPreviewPort(projectId)
          setPhase(projectId, 'building')
          send('phase', { label: 'Scaffolding project...' })
          await runSession('scaffold-frontend')

          // Start the dev server and reveal the scaffolded app immediately —
          // the user can review the base design tokens/layout before pages are built.
          const clientDir = path.join(projectDir, 'client')
          if (fs.existsSync(path.join(clientDir, 'package.json'))) {
            const port = await startPreview(projectId, projectDir)
            setPhase(projectId, 'preview')
            send('preview-ready', { port })
          } else {
            setPhase(projectId, 'preview')
          }
          send('done', { skill })

        // ── build-layout ───────────────────────────────────────────────────────
        } else if (skill === 'build-layout') {
          setPhase(projectId, 'building')
          send('phase', { label: 'Building Navbar & Footer...' })
          await runSession('build-layout')
          setPhase(projectId, 'preview')
          send('preview-refresh', {})
          send('done', { skill })

        // ── build-page ─────────────────────────────────────────────────────────
        } else if (skill === 'build-page') {
          const name = pageName ?? 'home'
          setPhase(projectId, 'building')
          send('phase', { label: `Building ${name} page...` })
          await runSession(
            'build-page',
            `## Page to build\n\`${name}\` — read \`client/specs/pages/${name}.md\` for the full spec.`,
          )
          setPhase(projectId, 'preview')
          send('preview-refresh', {})
          send('done', { skill })

        // ── build-backend ──────────────────────────────────────────────────────
        } else if (skill === 'build-backend') {
          setPhase(projectId, 'building-backend')
          send('phase', { label: 'Building backend...' })
          await runSession('build-backend')
          setPhase(projectId, 'complete')
          send('done', { skill })
        }

      } catch (err) {
        send('error', { message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Reads the page spec files written by generate-specs to know which pages
 * need to be built. Falls back to ['home'] if no spec pages directory exists.
 */
function discoverPages(projectDir: string): string[] {
  const pagesDir = path.join(projectDir, 'client', 'specs', 'pages')
  if (!fs.existsSync(pagesDir)) return ['home']
  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md'))
  return files.length > 0 ? files.map((f) => f.replace('.md', '')) : ['home']
}
