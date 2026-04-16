import { NextRequest } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadProject, readSkill } from '@/lib/project-manager'

export async function POST(req: NextRequest) {
  const { projectId, userRequest }: { projectId: string; userRequest: string } = await req.json()

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
        const skillPrompt = readSkill(projectDir, 'apply-change')
        const fullPrompt = `${skillPrompt}\n\n---\n\nUser request: "${userRequest}"`

        send('start', { userRequest })
        send('phase', { label: 'Applying changes...' })

        for await (const message of query({
          prompt: fullPrompt,
          options: {
            cwd: projectDir,
            model: 'opus',
            maxTurns: 150,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
          },
        })) {
          if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'text' && block.text.trim()) {
                send('text', { text: block.text })
              }
              if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'FileWrite')) {
                const filePath = (block.input as Record<string, string>).file_path ?? ''
                const relative = filePath.startsWith(projectDir)
                  ? filePath.slice(projectDir.length + 1)
                  : filePath
                send('file', { path: relative })
              }
              if (block.type === 'tool_use' && block.name === 'Bash') {
                const cmd = ((block.input as Record<string, string>).command ?? '').slice(0, 120)
                send('shell', { command: cmd })
              }
            }
          }
        }

        send('preview-refresh', {})
        send('done', {})
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
