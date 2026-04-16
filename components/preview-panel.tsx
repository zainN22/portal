'use client'

import { useState, useEffect } from 'react'
import { HiComputerDesktop, HiDeviceTablet, HiDevicePhoneMobile } from 'react-icons/hi2'
import { HiRefresh } from 'react-icons/hi'
import type { ProjectPhase } from '@/types'

type Viewport = 'desktop' | 'tablet' | 'mobile'

interface Props {
  port: number | null
  phase: ProjectPhase
  isRestarting?: boolean
  refreshTick?: number
}

const VIEWPORTS: Record<Viewport, { width: string; label: string; icon: React.ReactNode }> = {
  desktop: { width: '100%',  label: 'Desktop', icon: <HiComputerDesktop size={16} /> },
  tablet:  { width: '768px', label: 'Tablet',  icon: <HiDeviceTablet    size={16} /> },
  mobile:  { width: '390px', label: 'Mobile',  icon: <HiDevicePhoneMobile size={16} /> },
}

export function PreviewPanel({ port, phase, isRestarting = false, refreshTick = 0 }: Props) {
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (refreshTick > 0) setReloadKey((k) => k + 1)
  }, [refreshTick])

  const previewUrl = port ? `http://localhost:${port}` : null

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">

        {/* Viewport switcher — same height as URL bar */}
        <div className="flex items-center gap-0.5 bg-zinc-800 border border-zinc-700/60 rounded-lg p-0.5 h-8">
          {(Object.keys(VIEWPORTS) as Viewport[]).map((v) => (
            <button
              key={v}
              onClick={() => setViewport(v)}
              title={VIEWPORTS[v].label}
              className={`flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150 ${
                viewport === v
                  ? 'bg-violet-600 text-white shadow-sm shadow-violet-900/50'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700'
              }`}
            >
              {VIEWPORTS[v].icon}
            </button>
          ))}
        </div>

        {/* URL bar — same height as switcher */}
        <div className="flex items-center flex-1 h-8 bg-zinc-800 border border-zinc-700/60 rounded-lg px-3 gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
          <span className="text-xs text-zinc-400 font-mono truncate">
            {previewUrl ?? 'Preview not ready'}
          </span>
        </div>

        {/* Reload — same height */}
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={!previewUrl}
          title="Reload preview"
          className="flex items-center justify-center w-8 h-8 bg-zinc-800 border border-zinc-700/60 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
        >
          <HiRefresh size={16} />
        </button>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-hidden flex items-start justify-center bg-zinc-950 p-4">
        {!previewUrl ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            {isRestarting ? (
              <>
                <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                <div>
                  <p className="text-zinc-300 font-medium">Starting preview...</p>
                  <p className="text-zinc-500 text-sm mt-1">Restarting dev server for this project</p>
                </div>
              </>
            ) : phase === 'gathering' || phase === 'ready' ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center text-3xl">
                  🏗
                </div>
                <div>
                  <p className="text-zinc-300 font-medium">Preview will appear here</p>
                  <p className="text-zinc-500 text-sm mt-1">Complete the chat to start building</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-zinc-400 text-sm">Starting preview...</p>
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
