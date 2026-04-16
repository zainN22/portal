'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from './message-bubble'
import type { ChatMessage, Project, ProjectPhase } from '@/types'

interface Props {
  project: Project
  phase: ProjectPhase
  /** Label of the next build step — shown on the Approve button. Undefined when queue is empty. */
  nextStepLabel?: string
  onPhaseChange: (phase: ProjectPhase) => void
  onProceed: (dirPath: string, projectName: string, overviewContent: string) => void
  onApprove: () => void
}

export function ChatPanel({
  project,
  phase,
  nextStepLabel,
  onPhaseChange,
  onProceed,
  onApprove,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  // Set once the agent decides it has enough info
  const [isReady, setIsReady] = useState(false)
  const [overviewContent, setOverviewContent] = useState('')

  // Path + name picker shown after agent is ready
  const [projectName, setProjectName] = useState('')
  const [dirPath, setDirPath] = useState('')
  const [dirError, setDirError] = useState('')
  const [settingUp, setSettingUp] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  // Greeting on mount
  useEffect(() => {
    setMessages([
      {
        role: 'assistant',
        content:
          "Hi! I'm here to help you build your web app. Tell me — what are you looking to create? It can be anything: a SaaS tool, a marketplace, a portfolio, whatever's on your mind.",
      },
    ])
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, isReady])

  // ── Send a chat message to the gathering agent ────────────────────────────────

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return

    const userMsg: ChatMessage = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setStreaming(true)
    setStreamingText('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, messages: nextMessages }),
      })

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let accumulated = ''
      let eventName = ''

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

          if (eventName === 'delta' && typeof payload.text === 'string') {
            accumulated += payload.text
            setStreamingText(accumulated)
          }

          if (eventName === 'done') {
            setStreamingText('')
            setMessages((prev) => [...prev, { role: 'assistant', content: payload.text as string }])
            if (payload.ready) {
              setIsReady(true)
              onPhaseChange('ready')
            }
          }

          if (eventName === 'overview-ready') {
            setOverviewContent(payload.content as string)
          }

          if (eventName === 'error') {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: `Something went wrong: ${payload.message}` },
            ])
          }

          eventName = ''
        }
      }
    } finally {
      setStreaming(false)
      setStreamingText('')
    }
  }, [input, messages, streaming, project.id, onPhaseChange])

  // ── Handle edit messages once preview is live ─────────────────────────────────

  const sendEdit = useCallback(async () => {
    if (!input.trim() || streaming) return

    const userMsg: ChatMessage = { role: 'user', content: input.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, userRequest: userMsg.content }),
      })

      if (!res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let summary = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const p = JSON.parse(line.slice(6))
            if (p.text) summary += p.text as string
          } catch {
            /* ignore */
          }
        }
      }

      if (summary) setMessages((prev) => [...prev, { role: 'assistant', content: summary }])
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, project.id])

  // ── Directory + name submit → hand off to parent ──────────────────────────────

  const handleSetup = async () => {
    if (!projectName.trim()) {
      setDirError('Please enter a project name')
      return
    }
    if (!dirPath.trim()) {
      setDirError('Please enter a folder path')
      return
    }
    setDirError('')
    setSettingUp(true)

    try {
      const res = await fetch(`/api/projects/${project.id}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dirPath: dirPath.trim(),
          projectName: projectName.trim(),
          overviewContent,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setDirError(err.error ?? 'Failed to create project directory')
        return
      }

      setIsReady(false)
      onProceed(dirPath.trim(), projectName.trim(), overviewContent)
    } finally {
      setSettingUp(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      isPreviewPhase ? sendEdit() : sendMessage()
    }
  }

  const isPreviewPhase = phase === 'preview' || phase === 'complete'
  const canChat = phase === 'gathering' || (phase === 'ready' && !isReady) || isPreviewPhase

  // Whether to show the Approve CTA (only in preview with a next step remaining)
  const showApprove = phase === 'preview' && !!nextStepLabel

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-500" />
          <span className="text-sm font-medium text-zinc-200">{project.name}</span>
          <span className="ml-auto text-xs text-zinc-500 capitalize">{phase.replace(/-/g, ' ')}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            isStreaming={i === messages.length - 1 && streaming && m.role === 'assistant'}
          />
        ))}

        {streamingText && (
          <MessageBubble message={{ role: 'assistant', content: streamingText }} isStreaming />
        )}

        {/* Project name + path picker — shown once agent is ready */}
        {isReady && (
          <div className="mt-4 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-medium text-zinc-200">Let&apos;s set up your project</p>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Project name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value)
                  setDirError('')
                }}
                placeholder="my-saas-app"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500 transition-colors"
              />
              <p className="text-xs text-zinc-600">
                Folder will be created as{' '}
                <code className="text-zinc-500">
                  project-{projectName ? projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'name'}/
                </code>
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Where to create it</label>
              <input
                type="text"
                value={dirPath}
                onChange={(e) => {
                  setDirPath(e.target.value)
                  setDirError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
                placeholder="/Users/you/projects"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>

            {!overviewContent && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <div className="w-3 h-3 border border-zinc-500 border-t-transparent rounded-full animate-spin shrink-0" />
                Preparing requirements...
              </div>
            )}

            {dirError && <p className="text-xs text-red-400">{dirError}</p>}

            <button
              onClick={handleSetup}
              disabled={settingUp || !projectName.trim() || !dirPath.trim() || !overviewContent}
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
            >
              {settingUp ? 'Setting up...' : 'Create project and start building →'}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Approve CTA ─── shown between messages and input when preview is live */}
      {showApprove && (
        <div className="px-4 pt-3 pb-1 border-t border-zinc-800 shrink-0 space-y-2">
          <p className="text-xs text-zinc-500 text-center">
            Chat to make edits, or approve to continue
          </p>
          <button
            onClick={onApprove}
            disabled={streaming}
            className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
          >
            Approve → {nextStepLabel}
          </button>
        </div>
      )}

      {/* Input bar */}
      {canChat && (
        <div className="px-4 py-3 border-t border-zinc-800 shrink-0">
          <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 focus-within:border-violet-500 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isPreviewPhase ? 'Describe a change...' : 'Tell me about your app...'}
              disabled={streaming}
              rows={1}
              className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 resize-none outline-none max-h-32 overflow-y-auto"
            />
            <button
              onClick={isPreviewPhase ? sendEdit : sendMessage}
              disabled={!input.trim() || streaming}
              className="p-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors shrink-0"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-zinc-600 mt-1.5 pl-1">Enter to send · Shift+Enter for new line</p>
        </div>
      )}
    </div>
  )
}
