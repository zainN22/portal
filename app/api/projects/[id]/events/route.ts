import { NextRequest } from 'next/server'
import { getBuild, getEvents } from '@/lib/build-runner'
import { loadProject } from '@/lib/project-manager'

/**
 * GET /api/projects/:id/events?fromIndex=0
 *
 * SSE endpoint that streams build events from the background runner.
 * Supports reconnection: pass fromIndex to catch up on missed events.
 *
 * Flow:
 * 1. Immediately sends all buffered events from fromIndex (catch-up)
 * 2. Polls every 500ms for new events
 * 3. Closes when build completes (status = done/error) and all events are sent
 * 4. If no active build, returns the current project phase as a status event
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params
    const fromIndex = parseInt(req.nextUrl.searchParams.get('fromIndex') ?? '0', 10)

    const project = loadProject(id)
    if (!project) {
        return new Response('Project not found', { status: 404 })
    }

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
        async start(controller) {
            function send(event: string, data: unknown) {
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
                } catch {
                    // Controller may be closed if client disconnected — ignore
                }
            }

            // Check if there is an active build for this project
            const build = getBuild(id)

            if (!build) {
                // No active build — send the current project phase and close
                console.log(`[API/events] No active build for ${id}, sending status. Phase: ${project.phase}`)
                send('status', { phase: project.phase, message: 'No active build' })
                controller.close()
                return
            }

            console.log(`[API/events] Streaming events for ${id}, skill="${build.skill}", status="${build.status}", fromIndex=${fromIndex}`)

            let cursor = fromIndex
            const POLL_MS = 500
            const MAX_IDLE_MS = 300_000 // 5 minutes max connection time

            const startTime = Date.now()

            // Poll loop — sends new events as they appear
            while (true) {
                // Check if client disconnected (AbortSignal from Next.js)
                if (req.signal.aborted) {
                    console.log(`[API/events] Client disconnected for ${id}`)
                    break
                }

                // Safety timeout
                if (Date.now() - startTime > MAX_IDLE_MS) {
                    console.log(`[API/events] Max connection time reached for ${id}`)
                    send('timeout', { message: 'Connection timeout, please reconnect' })
                    break
                }

                // Get new events since our cursor
                const result = getEvents(id, cursor)
                if (!result) {
                    // Build was cleared from memory
                    send('status', { phase: 'unknown', message: 'Build data no longer available' })
                    break
                }

                // Send any new events
                if (result.events.length > 0) {
                    for (const event of result.events) {
                        send(event.kind, event.data)
                    }
                    cursor = result.total
                }

                // Check if build is finished AND we've sent all events
                const currentBuild = getBuild(id)
                if (currentBuild && currentBuild.status !== 'running' && cursor >= currentBuild.events.length) {
                    console.log(`[API/events] Build finished for ${id}, status="${currentBuild.status}", total events=${cursor}`)
                    send('build-complete', { status: currentBuild.status, error: currentBuild.error })
                    break
                }

                // Wait before polling again
                await new Promise((resolve) => setTimeout(resolve, POLL_MS))
            }

            try {
                controller.close()
            } catch {
                // Already closed
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
