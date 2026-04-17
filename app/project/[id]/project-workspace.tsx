'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChatPanel } from '@/components/chat-panel'
import { PreviewPanel } from '@/components/preview-panel'
import { GenerationScreen } from '@/components/generation-screen'
import type { Project, ProjectPhase, GenerationEvent } from '@/types'

// Phases where the full-screen generation loader should show
const GENERATING_PHASES: ProjectPhase[] = ['writing-specs', 'building', 'building-backend']

/** Human-readable label for an item in the build queue. */
function queueItemLabel(item: string): string {
  if (item === 'build-layout') return 'Build layout'
  if (item === 'build-backend') return 'Build backend'
  if (item.startsWith('page-')) {
    const name = item.replace(/^page-/, '')
    return `Build ${name[0].toUpperCase() + name.slice(1)} page`
  }
  return 'Continue'
}

export function ProjectWorkspace({ id }: { id: string }) {
  const router = useRouter()

  const [project, setProject] = useState<Project | null>(null)
  const [previewPort, setPreviewPort] = useState<number | null>(null)
  const [phase, setPhase] = useState<ProjectPhase>('gathering')
  const [genEvents, setGenEvents] = useState<GenerationEvent[]>([])
  const [projectName, setProjectName] = useState('Your app')

  // ── Build queue (layout → each page → backend) ──────────────────────────────
  const [buildQueue, setBuildQueue] = useState<string[]>([])
  const buildQueueRef = useRef<string[]>([])
  const suppressPreviewRef = useRef(false)

  // GenerationScreen progress
  const [isBuilding, setIsBuilding] = useState(false)
  const [phaseLabel, setPhaseLabel] = useState('')
  const [stepInfo, setStepInfo] = useState<{ current: number; total: number } | null>(null)

  // Incrementing this causes the preview iframe to reload
  const [previewRefreshTick, setPreviewRefreshTick] = useState(0)

  // True while we are (re)starting the dev server for an existing project
  const [previewLoading, setPreviewLoading] = useState(false)

  // Resizable divider
  const [panelWidth, setPanelWidth] = useState(420)
  const [dragging, setDragging] = useState(false)

  // ── SSE event stream reader ─────────────────────────────────────────────────
  // Connects to /api/projects/:id/events and processes SSE events.
  // Returns the payload from the 'done' event, or {} if stream ends without one.
  const connectToEvents = useCallback(
    async (fromIndex = 0): Promise<Record<string, unknown>> => {
      console.log(`[connectToEvents] Connecting to events stream, fromIndex=${fromIndex}`)

      const res = await fetch(`/api/projects/${id}/events?fromIndex=${fromIndex}`)
      console.log(`[connectToEvents] Response status: ${res.status}, body: ${!!res.body}`)

      if (!res.body) return {}

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let eventName = ''
      let doneData: Record<string, unknown> = {}
      let eventCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log(`[connectToEvents] Stream ended. Total events: ${eventCount}`)
          break
        }

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim()
            continue
          }
          if (!line.startsWith('data: ')) continue

          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          eventCount++
          if (eventCount <= 5 || eventCount % 10 === 0) {
            console.log(`[connectToEvents] Event #${eventCount} [${eventName}]:`, JSON.stringify(payload).substring(0, 150))
          }

          // Map events to UI state
          if (payload.text) setGenEvents((p) => [...p, { kind: 'text', data: payload.text as string }])
          if (payload.path) setGenEvents((p) => [...p, { kind: 'file', data: payload.path as string }])
          if (payload.command) setGenEvents((p) => [...p, { kind: 'shell', data: payload.command as string }])

          if (eventName === 'phase' && payload.label) {
            const label = payload.label as string
            setPhaseLabel(label)
            setGenEvents((p) => [...p, { kind: 'phase', data: label }])
          }

          if (eventName === 'warning' && payload.message) {
            setGenEvents((p) => [...p, { kind: 'warning', data: payload.message as string }])
          }

          if (eventName === 'error' && payload.message) {
            console.error(`[connectToEvents] ❌ Error: ${payload.message}`)
            setGenEvents((p) => [...p, { kind: 'error', data: payload.message as string }])
          }

          if (eventName === 'preview-ready' && payload.port) {
            const p = payload.port as number
            console.log(`[connectToEvents] 🖥 Preview ready on port ${p}`)
            setPreviewPort(p)
            setProject((prev) => (prev ? { ...prev, previewPort: p } : prev)) // Sync project object
            if (!suppressPreviewRef.current) {
              setIsBuilding(false)
              setPhase('preview')
              setProject((prev) => (prev ? { ...prev, phase: 'preview', previewPort: p } : prev))
            }
          }

          if (eventName === 'preview-refresh') {
            setPreviewRefreshTick((t) => t + 1)
          }

          if (eventName === 'done') {
            doneData = payload
            console.log(`[connectToEvents] ✅ Done: skill="${payload.skill}"`)
            setGenEvents((p) => [...p, { kind: 'done', data: `${payload.skill} complete` }])

            const s = payload.skill as string
            if (s === 'build-layout' || s === 'build-page') {
              if (!suppressPreviewRef.current) {
                setIsBuilding(false)
                setPhase('preview')
                setProject((prev) => (prev ? { ...prev, phase: 'preview' } : prev))
              }
            }
            if (s === 'build-backend') {
              setIsBuilding(false)
              setPhase('complete')
              setProject((prev) => (prev ? { ...prev, phase: 'complete' } : prev))
            }
          }

          // build-complete is sent by the events endpoint when the build finishes
          if (eventName === 'build-complete') {
            console.log(`[connectToEvents] Build complete, status: ${payload.status}`)
          }

          // status event: no active build — just update phase
          if (eventName === 'status') {
            console.log(`[connectToEvents] Status: phase="${payload.phase}", message="${payload.message}"`)
          }

          eventName = ''
        }
      }

      if (!suppressPreviewRef.current) {
        setIsBuilding(false)
      }
      return doneData
    },
    [id],
  )

  // ── Core skill runner ────────────────────────────────────────────────────────
  // 1. POST /api/generate (fire-and-forget — starts background build)
  // 2. Connect to /api/projects/:id/events (SSE — survives refresh)
  const runSkill = useCallback(
    async (skill: string, pageName?: string): Promise<Record<string, unknown>> => {
      console.log(`[runSkill] ▶ Starting skill: "${skill}"`, pageName ? `page: "${pageName}"` : '')
      const phaseMap: Record<string, ProjectPhase> = {
        'generate-specs': 'writing-specs',
        'scaffold-frontend': 'building',
        'build-layout': 'building',
        'build-page': 'building',
        'build-backend': 'building-backend',
      }
      setPhase(phaseMap[skill] ?? 'building')
      setProject((prev) => (prev ? { ...prev, phase: phaseMap[skill] ?? 'building' } : prev))
      setIsBuilding(true)

      // Step 1: Fire-and-forget — start the build in the background
      console.log(`[runSkill] POST /api/generate (fire-and-forget)`)
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, skill, pageName }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        console.error(`[runSkill] Failed to start build:`, err)
        setIsBuilding(false)
        return {}
      }

      console.log(`[runSkill] Build started, connecting to events stream...`)

      // Step 2: Connect to events SSE to receive updates
      // Small delay to let the build runner push its first event
      await new Promise((r) => setTimeout(r, 300))
      const doneData = await connectToEvents(0)

      console.log(`[runSkill] ◼ Finished "${skill}".`)
      return doneData
    },
    [id, connectToEvents],
  )

  // ── Load project on mount ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    console.log('[ProjectWorkspace] Mounting — fetching project', id)

    fetch(`/api/projects/${id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then(async (p: Project) => {
        if (cancelled) return
        console.log('[ProjectWorkspace] Project loaded:', {
          id: p.id, name: p.name, phase: p.phase, dir: p.dir, previewPort: p.previewPort,
        })

        setProject(p)
        setPhase(p.phase)
        setPreviewPort(p.previewPort) // 👈 FIX 1: Initialize port state on mount
        setProjectName(p.name !== 'New Project' ? p.name : 'Your app')

        // ── RECONNECT: If project is in a building phase, reconnect to events stream.
        // The build is running in the background — we just need to re-attach.
        if (GENERATING_PHASES.includes(p.phase)) {
          console.log('[ProjectWorkspace] 🔄 Building phase detected on load — reconnecting to events stream')
          setIsBuilding(true)
          setPhaseLabel('Reconnecting to build...')
          setGenEvents([{ kind: 'phase', data: 'Reconnecting to build...' }])

          let hasPortFromStream = false
          try {
            // Connect to the events endpoint — it will send all buffered events first
            await connectToEvents(0)
            // If connectToEvents received a 'preview-ready' event, it already called setPreviewPort
            if (previewPort) hasPortFromStream = true
          } catch (err) {
            console.error('[ProjectWorkspace] Events stream error:', err)
          }

          // After events stream ends, reload project to get latest state
          if (cancelled) return
          try {
            const refreshRes = await fetch(`/api/projects/${id}`, { signal: controller.signal })
            if (refreshRes.ok) {
              const updated: Project = await refreshRes.json()
              console.log('[ProjectWorkspace] Post-build project state:', updated.phase, 'port:', updated.previewPort)
              setProject(updated)
              setPhase(updated.phase)
              setIsBuilding(false)

              // Only trigger a preview restart if we don't have a port yet
              if ((updated.phase === 'preview' || updated.phase === 'complete') && !hasPortFromStream && !updated.previewPort) {
                setPreviewLoading(true)
                try {
                  const previewRes = await fetch(`/api/projects/${id}/preview`, {
                    method: 'POST', signal: controller.signal,
                  })
                  if (previewRes.ok && !cancelled) {
                    const { port } = await previewRes.json()
                    console.log('[ProjectWorkspace] Preview on port', port)
                    setPreviewPort(port)
                  }
                } catch (err) {
                  console.error('[ProjectWorkspace] Preview restart error:', err)
                } finally {
                  if (!cancelled) setPreviewLoading(false)
                }
              } else if (updated.previewPort) {
                setPreviewPort(updated.previewPort)
              }
            }
          } catch {
            // ignore
          }
          return
        }

        // For projects with a live preview, restart the dev server
        if (p.phase === 'preview' || p.phase === 'complete') {
          console.log('[ProjectWorkspace] Phase is', p.phase, '— restarting preview server')
          setPreviewLoading(true)
          try {
            const res = await fetch(`/api/projects/${id}/preview`, {
              method: 'POST', signal: controller.signal,
            })
            if (cancelled) return
            if (res.ok) {
              const { port } = await res.json()
              console.log('[ProjectWorkspace] Preview server started on port', port)
              if (!cancelled) setPreviewPort(port)
            }
          } catch (err) {
            console.error('[ProjectWorkspace] Preview restart error:', err)
          } finally {
            if (!cancelled) setPreviewLoading(false)
          }
        }
      })
      .catch((err) => {
        console.error('[ProjectWorkspace] Failed to load project:', err)
        if (!cancelled) router.push('/')
      })

    return () => {
      console.log('[ProjectWorkspace] Unmounting — aborting fetches for', id)
      cancelled = true
      controller.abort()
    }
  }, [id, router, connectToEvents])

  const handlePreviewRefresh = useCallback(() => {
    setPreviewRefreshTick((t) => t + 1)
  }, [])

  const handlePhaseChange = useCallback((p: ProjectPhase) => {
    console.log('[ProjectWorkspace] Phase change:', p)
    setPhase(p)
    setProject((prev) => (prev ? { ...prev, phase: p } : prev))
  }, [])

  // ── Initial pipeline: specs → scaffold → layout → first page ─────────────────
  const handleProceed = useCallback(
    async (_dirPath: string, name: string, _overviewContent: string) => {
      console.log('[handleProceed] ▶ Starting full build pipeline for:', name)
      setProjectName(name)
      setGenEvents([])
      setPhaseLabel('')

      suppressPreviewRef.current = true

      // Step 1: generate specs
      console.log('[handleProceed] Step 1: generate-specs')
      setStepInfo(null)
      const specsDone = await runSkill('generate-specs')
      console.log('[handleProceed] generate-specs done. Result:', specsDone)

      // Build the approval queue from discovered pages
      const pages = Array.isArray(specsDone.pages) ? (specsDone.pages as string[]) : ['home']
      const queue = ['build-layout', ...pages.map((p) => `page-${p}`), 'build-backend']
      console.log('[handleProceed] Build queue:', queue)
      buildQueueRef.current = queue
      setBuildQueue(queue)

      const total = 1 + queue.length
      setStepInfo({ current: 1, total })

      // Step 2: scaffold
      console.log('[handleProceed] Step 2: scaffold-frontend')
      setGenEvents([])
      setPhaseLabel('')
      await runSkill('scaffold-frontend')
      console.log('[handleProceed] scaffold-frontend done')

      // Step 3: build layout
      if (buildQueueRef.current.length > 0 && buildQueueRef.current[0] === 'build-layout') {
        console.log('[handleProceed] Step 3: build-layout')
        const [, ...afterLayout] = buildQueueRef.current
        buildQueueRef.current = afterLayout
        setBuildQueue(afterLayout)
        setStepInfo({ current: 2, total })
        setGenEvents([])
        setPhaseLabel('')
        await runSkill('build-layout')
        console.log('[handleProceed] build-layout done')
      }

      // Step 4: first page
      if (buildQueueRef.current.length > 0 && buildQueueRef.current[0].startsWith('page-')) {
        const [firstPage, ...rest] = buildQueueRef.current
        console.log('[handleProceed] Step 4: build-page', firstPage)
        buildQueueRef.current = rest
        setBuildQueue(rest)
        setStepInfo({ current: 3, total })
        setGenEvents([])
        setPhaseLabel('')
        await runSkill('build-page', firstPage.replace(/^page-/, ''))
        console.log('[handleProceed] build-page done for', firstPage)
      }

      // Pipeline done — reveal preview
      console.log('[handleProceed] ✅ Full pipeline complete — revealing preview')
      suppressPreviewRef.current = false
      setIsBuilding(false)
      setPhase('preview')
      setProject((prev) => (prev ? { ...prev, phase: 'preview' } : prev))
    },
    [runSkill],
  )

  // ── Approve: run next item from the queue ────────────────────────────────────
  const handleApprove = useCallback(async () => {
    const queue = buildQueueRef.current
    if (queue.length === 0) return

    const [next, ...rest] = queue
    buildQueueRef.current = rest
    setBuildQueue(rest)

    setStepInfo((prev) => prev ? { current: prev.current + 1, total: prev.total } : null)
    setGenEvents([])
    setPhaseLabel('')

    if (next === 'build-layout') {
      await runSkill('build-layout')
    } else if (next.startsWith('page-')) {
      await runSkill('build-page', next.replace(/^page-/, ''))
    } else if (next === 'build-backend') {
      await runSkill('build-backend')
    }
  }, [runSkill])

  // Resizable divider
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setDragging(true)
      const startX = e.clientX
      const startWidth = panelWidth
      const onMove = (ev: MouseEvent) =>
        setPanelWidth(Math.max(300, Math.min(700, startWidth + ev.clientX - startX)))
      const onUp = () => {
        setDragging(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [panelWidth],
  )

  if (!project) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Show full-screen generation loader while Claude Code is working
  const showGenerationScreen = isBuilding || GENERATING_PHASES.includes(phase)
  if (showGenerationScreen) {
    return (
      <GenerationScreen
        projectName={projectName}
        phaseLabel={phaseLabel}
        stepInfo={stepInfo ?? undefined}
        events={genEvents}
      />
    )
  }

  // The next step label shown on the approve button
  const nextStepLabel =
    buildQueueRef.current.length > 0 ? queueItemLabel(buildQueueRef.current[0]) : undefined

  // Split-pane workspace
  return (
    <div className={`h-screen flex overflow-hidden bg-zinc-950 ${dragging ? 'select-none' : ''}`}>
      <div style={{ width: panelWidth, minWidth: 300 }} className="flex-shrink-0 border-r border-zinc-800">
        <ChatPanel
          project={project}
          phase={phase}
          nextStepLabel={nextStepLabel}
          onPhaseChange={handlePhaseChange}
          onProceed={handleProceed}
          onApprove={handleApprove}
          onPreviewRefresh={handlePreviewRefresh}
        />
      </div>

      <div
        onMouseDown={onMouseDown}
        className="w-1 cursor-col-resize bg-zinc-800 hover:bg-violet-600 transition-colors shrink-0"
      />

      <div className="flex-1 min-w-0">
        <PreviewPanel
          port={previewPort}
          phase={phase}
          isRestarting={previewLoading}
          refreshTick={previewRefreshTick}
        />
      </div>
    </div>
  )
}
