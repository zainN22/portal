'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChatPanel } from '@/components/chat-panel'
import { PreviewPanel } from '@/components/preview-panel'
import { GenerationScreen } from '@/components/generation-screen'
import type { Project, ProjectPhase, GenerationEvent } from '@/types'

interface Props {
  params: Promise<{ id: string }>
}

const GENERATING_PHASES: ProjectPhase[] = ['writing-specs', 'building', 'building-backend']

export default function ProjectPage({ params }: Props) {
  const { id } = use(params)
  const router = useRouter()

  const [project, setProject] = useState<Project | null>(null)
  const [previewPort, setPreviewPort] = useState<number | null>(null)
  const [phase, setPhase] = useState<ProjectPhase>('gathering')
  const [genEvents, setGenEvents] = useState<GenerationEvent[]>([])
  const [projectName, setProjectName] = useState('Your app')

  // Resizable divider
  const [panelWidth, setPanelWidth] = useState(420)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((p: Project) => {
        setProject(p)
        setPhase(p.phase)
        setProjectName(p.name !== 'New Project' ? p.name : 'Your app')
        if (p.previewPort) setPreviewPort(p.previewPort)
      })
      .catch(() => router.push('/'))
  }, [id, router])

  const handlePhaseChange = useCallback((p: ProjectPhase) => {
    setPhase(p)
    setProject((prev) => prev ? { ...prev, phase: p } : prev)
  }, [])

  // Called by ChatPanel when user submits path + name and setup succeeds.
  // Runs both skills back-to-back.
  const handleProceed = useCallback(async (
    _dirPath: string,
    name: string,
    _overviewContent: string
  ) => {
    setProjectName(name)
    setGenEvents([])
    setPhase('writing-specs')
    setProject((prev) => prev ? { ...prev, phase: 'writing-specs' } : prev)

    await runSkill('generate-specs')
    await runSkill('build-frontend')
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const runSkill = async (skill: string) => {
    const phaseMap: Record<string, ProjectPhase> = {
      'generate-specs': 'writing-specs',
      'build-frontend': 'building',
      'build-backend': 'building-backend',
    }
    setPhase(phaseMap[skill] ?? 'building')

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, skill }),
    })

    if (!res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let eventName = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event: ')) { eventName = line.slice(7).trim(); continue }
        if (!line.startsWith('data: ')) continue

        let payload: Record<string, unknown>
        try { payload = JSON.parse(line.slice(6)) } catch { continue }

        if (payload.text)    setGenEvents((p) => [...p, { kind: 'text',  data: payload.text as string }])
        if (payload.path)    setGenEvents((p) => [...p, { kind: 'file',  data: payload.path as string }])
        if (payload.command) setGenEvents((p) => [...p, { kind: 'shell', data: payload.command as string }])
        if (payload.message) setGenEvents((p) => [...p, { kind: 'error', data: payload.message as string }])
        if (payload.skill)   setGenEvents((p) => [...p, { kind: 'done',  data: `${payload.skill} complete` }])

        if (eventName === 'preview-ready' && payload.port) {
          setPhase('preview')
          setProject((prev) => prev ? { ...prev, phase: 'preview' } : prev)
          setPreviewPort(payload.port as number)
        }

        eventName = ''
      }
    }
  }

  // Resizable divider
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startWidth = panelWidth
    const onMove = (ev: MouseEvent) => setPanelWidth(Math.max(300, Math.min(700, startWidth + ev.clientX - startX)))
    const onUp = () => { setDragging(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [panelWidth])

  if (!project) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Show full-screen generation loader while Claude Code is working
  if (GENERATING_PHASES.includes(phase)) {
    return <GenerationScreen projectName={projectName} phase={phase} events={genEvents} />
  }

  // Split-pane workspace
  return (
    <div className={`h-screen flex overflow-hidden bg-zinc-950 ${dragging ? 'select-none' : ''}`}>
      <div style={{ width: panelWidth, minWidth: 300 }} className="flex-shrink-0 border-r border-zinc-800">
        <ChatPanel
          project={project}
          phase={phase}
          onPhaseChange={handlePhaseChange}
          onProceed={handleProceed}
        />
      </div>

      <div onMouseDown={onMouseDown} className="w-1 cursor-col-resize bg-zinc-800 hover:bg-violet-600 transition-colors shrink-0" />

      <div className="flex-1 min-w-0">
        <PreviewPanel port={previewPort} phase={phase} />
      </div>
    </div>
  )
}
