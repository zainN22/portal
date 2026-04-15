import { NextRequest } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadProject, readSkill, setPhase } from '@/lib/project-manager'
import { startPreview } from '@/lib/preview-manager'
import path from 'path'
import fs from 'fs'

export async function POST(req: NextRequest) {
  const { projectId, skill }: { projectId: string; skill: 'generate-specs' | 'build-frontend' | 'build-backend' } =
    await req.json()

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

      try {
        const skillPrompt = readSkill(projectDir, skill)

        if (skill === 'generate-specs') setPhase(projectId, 'writing-specs')
        if (skill === 'build-frontend') setPhase(projectId, 'building')
        if (skill === 'build-backend') setPhase(projectId, 'building-backend')

        send('start', { skill })

        for await (const message of query({
          prompt: skillPrompt,
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

        // After build-frontend: start the Vite preview server
        if (skill === 'build-frontend') {
          const clientDir = path.join(projectDir, 'client-x')
          if (fs.existsSync(path.join(clientDir, 'package.json'))) {
            send('text', { text: 'Starting preview server...' })
            const port = await startPreview(projectId, projectDir)
            setPhase(projectId, 'preview')
            send('preview-ready', { port })
          }
        }

        if (skill === 'build-backend') setPhase(projectId, 'complete')

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
