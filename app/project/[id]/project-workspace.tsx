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
  // Populated after generate-specs completes; each approval pops the first item.
  const [buildQueue, setBuildQueue] = useState<string[]>([])
  // ref keeps the approve handler closure always current without re-creating it
  const buildQueueRef = useRef<string[]>([])
  // When true, preview-ready / done events do NOT transition out of GenerationScreen.
  // This keeps the generation overlay up during the initial specs → scaffold → layout → first-page pipeline.
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

  useEffect(() => {
    // Guard against stale async work. Because the parent passes key={id},
    // React unmounts this component on navigation — but the cleanup still
    // fires, aborting any in-flight fetches cleanly.
    let cancelled = false
    const controller = new AbortController()

    fetch(`/api/projects/${id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then(async (p: Project) => {
        if (cancelled) return
        setProject(p)
        setPhase(p.phase)
        setProjectName(p.name !== 'New Project' ? p.name : 'Your app')

        // For projects that already have a live preview, restart the dev server
        // so the iframe always points to THIS project's server — not a recycled
        // port that was used by a different project before the portal restarted.
        if (p.phase === 'preview' || p.phase === 'complete') {
          setPreviewLoading(true)
          try {
            const res = await fetch(`/api/projects/${id}/preview`, {
              method: 'POST',
              signal: controller.signal,
            })
            if (cancelled) return
            if (res.ok) {
              const { port } = await res.json()
              if (!cancelled) setPreviewPort(port)
            }
          } catch {
            // If restart fails or was aborted, show an error state in the preview panel
          } finally {
            if (!cancelled) setPreviewLoading(false)
          }
        }
      })
      .catch(() => {
        if (!cancelled) router.push('/')
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, router])

  const handlePreviewRefresh = useCallback(() => {
    setPreviewRefreshTick((t) => t + 1)
  }, [])

  const handlePhaseChange = useCallback((p: ProjectPhase) => {
    setPhase(p)
    setProject((prev) => (prev ? { ...prev, phase: p } : prev))
  }, [])

  // ── Core SSE streaming helper ────────────────────────────────────────────────
  // Streams a single skill session. Returns the payload from the `done` event.
  const runSkill = useCallback(
    async (skill: string, pageName?: string): Promise<Record<string, unknown>> => {
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

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, skill, pageName }),
      })

      if (!res.body) {
        setIsBuilding(false)
        return {}
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let eventName = ''
      let doneData: Record<string, unknown> = {}

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

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
            setGenEvents((p) => [...p, { kind: 'error', data: payload.message as string }])
          }

          if (eventName === 'preview-ready' && payload.port) {
            // Always save the port so the iframe can connect later
            setPreviewPort(payload.port as number)
            // Only transition to preview if we're not in the initial pipeline
            if (!suppressPreviewRef.current) {
              setIsBuilding(false)
              setPhase('preview')
              setProject((prev) => (prev ? { ...prev, phase: 'preview' } : prev))
            }
          }

          if (eventName === 'preview-refresh') {
            setPreviewRefreshTick((t) => t + 1)
          }

          if (eventName === 'done') {
            doneData = payload
            setGenEvents((p) => [...p, { kind: 'done', data: `${payload.skill} complete` }])

            const s = payload.skill as string
            // build-layout and build-page transition back to preview after done
            // (unless suppressed during the initial pipeline)
            if (s === 'build-layout' || s === 'build-page') {
              if (!suppressPreviewRef.current) {
                setIsBuilding(false)
                setPhase('preview')
                setProject((prev) => (prev ? { ...prev, phase: 'preview' } : prev))
              }
            }
            // build-backend transitions to complete
            if (s === 'build-backend') {
              setIsBuilding(false)
              setPhase('complete')
              setProject((prev) => (prev ? { ...prev, phase: 'complete' } : prev))
            }
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

  // ── Initial pipeline: specs → scaffold → layout → first page ─────────────────
  // Keeps the GenerationScreen up until there is real content to preview.
  const handleProceed = useCallback(
    async (_dirPath: string, name: string, _overviewContent: string) => {
      setProjectName(name)
      setGenEvents([])
      setPhaseLabel('')

      // Suppress all preview transitions so the generation overlay stays up
      // through the entire initial pipeline.
      suppressPreviewRef.current = true

      // Step 1: write all spec files
      setStepInfo(null) // no total yet
      const specsDone = await runSkill('generate-specs')

      // Build the approval queue from discovered pages
      const pages = Array.isArray(specsDone.pages) ? (specsDone.pages as string[]) : ['home']
      const queue = ['build-layout', ...pages.map((p) => `page-${p}`), 'build-backend']
      buildQueueRef.current = queue
      setBuildQueue(queue)

      // Total build steps: scaffold + queue items
      const total = 1 + queue.length
      setStepInfo({ current: 1, total })

      // Step 2: scaffold and start the dev server (port saved, preview still hidden)
      await runSkill('scaffold-frontend')

      // Step 3: auto-run build-layout
      if (buildQueueRef.current.length > 0 && buildQueueRef.current[0] === 'build-layout') {
        const [, ...afterLayout] = buildQueueRef.current
        buildQueueRef.current = afterLayout
        setBuildQueue(afterLayout)
        setStepInfo({ current: 2, total })
        setGenEvents([])
        setPhaseLabel('')
        await runSkill('build-layout')
      }

      // Step 4: auto-run the first page so the preview has real content
      if (buildQueueRef.current.length > 0 && buildQueueRef.current[0].startsWith('page-')) {
        const [firstPage, ...rest] = buildQueueRef.current
        buildQueueRef.current = rest
        setBuildQueue(rest)
        setStepInfo({ current: 3, total })
        setGenEvents([])
        setPhaseLabel('')
        await runSkill('build-page', firstPage.replace(/^page-/, ''))
      }

      // Pipeline done — reveal the preview with actual content
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

    // Advance step counter (scaffold was step 1, so layout is 2, etc.)
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
