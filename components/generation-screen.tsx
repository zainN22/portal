'use client'

import { useEffect, useRef } from 'react'
import type { GenerationEvent } from '@/types'

interface Props {
  projectName: string
  phaseLabel: string
  stepInfo?: { current: number; total: number }
  events: GenerationEvent[]
}

export function GenerationScreen({ projectName, phaseLabel, stepInfo, events }: Props) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [events])

  const progress = stepInfo ? Math.round((stepInfo.current / stepInfo.total) * 100) : 0

  const fileCount = events.filter((e) => e.kind === 'file').length

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center z-50 px-6">
      {/* Subtle animated background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-600/5 blur-3xl animate-pulse" />
      </div>

      <div className="relative w-full max-w-xl space-y-8">
        {/* Spinner + title */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-zinc-400 text-sm font-medium">
              {phaseLabel || 'Working...'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">{projectName || 'Your app'}</h1>
          {stepInfo && (
            <p className="text-zinc-500 text-xs">Step {stepInfo.current} of {stepInfo.total}</p>
          )}
        </div>

        {/* Progress bar — only when we know total steps */}
        {stepInfo && (
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Live file log */}
        <div
          ref={logRef}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 h-64 overflow-y-auto font-mono text-xs space-y-1.5 scroll-smooth"
        >
          {events.length === 0 ? (
            <span className="text-zinc-600">Waiting for output...</span>
          ) : (
            events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 leading-relaxed">
                {e.kind === 'file' && (
                  <>
                    <span className="text-green-400 shrink-0 mt-px">+</span>
                    <span className="text-zinc-300 break-all">{e.data}</span>
                  </>
                )}
                {e.kind === 'shell' && (
                  <>
                    <span className="text-yellow-400 shrink-0 mt-px">$</span>
                    <span className="text-zinc-500 break-all truncate">{e.data}</span>
                  </>
                )}
                {e.kind === 'text' && (
                  <>
                    <span className="text-zinc-700 shrink-0 mt-px">·</span>
                    <span className="text-zinc-500 line-clamp-1">{e.data}</span>
                  </>
                )}
                {e.kind === 'phase' && (
                  <>
                    <span className="text-violet-400 shrink-0 mt-px">→</span>
                    <span className="text-violet-300 font-sans font-medium">{e.data}</span>
                  </>
                )}
                {e.kind === 'warning' && (
                  <span className="text-yellow-400 break-all">{e.data}</span>
                )}
                {e.kind === 'error' && (
                  <span className="text-red-400 break-all">{e.data}</span>
                )}
                {e.kind === 'done' && (
                  <span className="text-violet-400 font-sans font-medium">✓ {e.data}</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Stats */}
        <div className="flex justify-center gap-6 text-xs text-zinc-600">
          <span>{fileCount} file{fileCount !== 1 ? 's' : ''} written</span>
          <span>{events.filter((e) => e.kind === 'shell').length} commands run</span>
        </div>
      </div>
    </div>
  )
}
