'use client'

import { useState, useEffect } from 'react'
import type { ProjectPhase } from '@/types'

type Viewport = 'desktop' | 'tablet' | 'mobile'

interface Props {
  port: number | null
  phase: ProjectPhase
  isBuilding?: boolean
  buildingLabel?: string
  refreshTick?: number
}

const VIEWPORTS: Record<Viewport, { width: string; label: string; icon: string }> = {
  desktop: { width: '100%', label: 'Desktop', icon: '🖥' },
  tablet: { width: '768px', label: 'Tablet', icon: '📱' },
  mobile: { width: '390px', label: 'Mobile', icon: '📲' },
}

export function PreviewPanel({ port, phase, isBuilding = false, buildingLabel = '', refreshTick = 0 }: Props) {
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [reloadKey, setReloadKey] = useState(0)

  // Reload the iframe whenever the pipeline signals a phase completed
  useEffect(() => {
    if (refreshTick > 0) setReloadKey((k) => k + 1)
  }, [refreshTick])

  const previewUrl = port ? `http://localhost:${port}` : null

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Building progress bar — visible while layout/page sessions are running */}
      {isBuilding && (
        <div className="shrink-0 bg-violet-950 border-b border-violet-800 px-4 py-2 flex items-center gap-3">
          <div className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-xs text-violet-300 truncate">
            {buildingLabel || 'Building...'}
          </span>
          <span className="ml-auto text-xs text-violet-500">Preview updates automatically</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 shrink-0">
        {/* Viewport switcher */}
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5">
          {(Object.keys(VIEWPORTS) as Viewport[]).map((v) => (
            <button
              key={v}
              onClick={() => setViewport(v)}
              title={VIEWPORTS[v].label}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                viewport === v
                  ? 'bg-zinc-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {VIEWPORTS[v].icon}
            </button>
          ))}
        </div>

        {/* URL bar */}
        <div className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-400 font-mono truncate">
          {previewUrl ?? 'Preview not ready'}
        </div>

        {/* Reload */}
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={!previewUrl}
          title="Reload preview"
          className="p-1.5 hover:bg-zinc-800 disabled:opacity-40 rounded-lg transition-colors text-zinc-400"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-hidden flex items-start justify-center bg-zinc-950 p-4">
        {!previewUrl ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            {phase === 'gathering' || phase === 'ready' ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center text-3xl">🏗</div>
                <div>
                  <p className="text-zinc-300 font-medium">Preview will appear here</p>
                  <p className="text-zinc-500 text-sm mt-1">Complete the chat to start building</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                <div>
                  <p className="text-zinc-300 font-medium">
                    {phase === 'writing-specs' ? 'Writing spec files...' :
                     phase === 'building' ? 'Generating frontend...' :
                     phase === 'building-backend' ? 'Building backend...' :
                     'Starting preview...'}
                  </p>
                  <p className="text-zinc-500 text-sm mt-1">Watch the progress in the chat panel</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            className="h-full transition-all duration-300 bg-white rounded-xl overflow-hidden shadow-2xl"
            style={{ width: VIEWPORTS[viewport].width, maxWidth: '100%' }}
          >
            <iframe
              key={reloadKey}
              src={previewUrl}
              className="w-full h-full border-0"
              title="App Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        )}
      </div>
    </div>
  )
}
